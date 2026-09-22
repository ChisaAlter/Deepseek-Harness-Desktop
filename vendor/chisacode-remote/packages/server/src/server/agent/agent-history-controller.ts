import type { Logger } from "pino";

import type { AgentStreamEvent } from "./agent-sdk-types.js";
import { isSystemInjectedEnvelope } from "./agent-prompt.js";
import type { ManagedAgent } from "./agent-manager.js";
import { AgentStreamCoalescer } from "./agent-stream-coalescer.js";
import { AgentTimelineController } from "./agent-timeline-controller.js";
import { ForegroundRunState } from "./foreground-run-state.js";
import { invokeRewindCapability, type RewindMode } from "./rewind/rewind.js";

type ActiveManagedAgent = Exclude<ManagedAgent, { lifecycle: "closed" }>;

export interface HydrateTimelineOptions {
  force?: boolean;
  broadcast?: boolean;
}

export type AgentHydrationState = "idle" | "hydrating" | "hydrated";

interface AgentHistoryControllerOptions {
  cancelAgentRun(agentId: string): Promise<boolean>;
  coalescer: AgentStreamCoalescer;
  dispatchStream(
    agentId: string,
    event: AgentStreamEvent,
    metadata?: { seq?: number; epoch?: string; timestamp?: string },
  ): void;
  emitState(agent: ManagedAgent): void;
  foregroundRuns: ForegroundRunState;
  getAgent(agentId: string): ActiveManagedAgent;
  logger: Logger;
  persistSnapshot(agent: ManagedAgent): Promise<void>;
  refreshRuntimeInfo(agent: ActiveManagedAgent): Promise<void>;
  timeline: AgentTimelineController;
  touchUpdatedAt(agent: ManagedAgent): Date;
}

/** Owns provider history hydration, timeline epoch replacement, and rewind coordination. */
export class AgentHistoryController {
  private readonly pendingHydrations = new Map<string, Promise<void>>();

  constructor(private readonly options: AgentHistoryControllerOptions) {}

  /**
   * Returns whether provider history has been fully seeded for the agent.
   * `historyPrimed` is only true after a successful/failed seed completes.
   */
  getHydrationState(agentId: string): AgentHydrationState {
    if (this.pendingHydrations.has(agentId)) {
      return "hydrating";
    }
    try {
      const agent = this.options.getAgent(agentId);
      return agent.historyPrimed ? "hydrated" : "idle";
    } catch {
      return "idle";
    }
  }

  getHydrationPromise(agentId: string): Promise<void> | undefined {
    return this.pendingHydrations.get(agentId);
  }

  async hydrate(agentId: string, options?: HydrateTimelineOptions): Promise<void> {
    const agent = this.options.getAgent(agentId);
    if (agent.historyPrimed && !options?.force) {
      return;
    }

    if (options?.force) {
      await this.replaceFromProviderHistory(agent, options.broadcast === true);
      return;
    }

    const inflight = this.pendingHydrations.get(agentId);
    if (inflight) {
      await inflight;
      return;
    }

    const hydrationPromise = this.seedFromProviderHistory(agent).finally(() => {
      if (this.pendingHydrations.get(agentId) === hydrationPromise) {
        this.pendingHydrations.delete(agentId);
      }
    });
    this.pendingHydrations.set(agentId, hydrationPromise);
    await hydrationPromise;
  }

  async rewind(agentId: string, messageId: string, mode: RewindMode): Promise<void> {
    const agent = this.options.getAgent(agentId);
    const hadActiveRun =
      Boolean(agent.activeForegroundTurnId) || this.options.foregroundRuns.hasPendingRun(agentId);
    if (hadActiveRun) {
      await this.options.cancelAgentRun(agentId);
    }

    const lock = this.options.foregroundRuns.createPendingRun(agentId);
    try {
      this.options.logger.info(
        { agentId, provider: agent.provider, messageId, mode },
        "agent.rewind.start",
      );
      await invokeRewindCapability(agent.session, { messageId, mode });
      if (mode !== "files") {
        await this.hydrate(agentId, { force: true, broadcast: true });
      }
      await this.options.refreshRuntimeInfo(agent);
      await this.options.persistSnapshot(agent);
      this.options.logger.info(
        { agentId, provider: agent.provider, messageId, mode },
        "agent.rewind.complete",
      );
    } catch (error) {
      this.options.logger.warn(
        { err: error, agentId, provider: agent.provider, messageId, mode },
        "agent.rewind.failed",
      );
      throw error;
    } finally {
      this.options.foregroundRuns.settlePendingRun(agentId, lock.token);
    }
  }

  private async replaceFromProviderHistory(
    agent: ActiveManagedAgent,
    broadcast: boolean,
  ): Promise<void> {
    const historyEvents: Array<Extract<AgentStreamEvent, { type: "timeline" }>> = [];
    for await (const event of this.streamTimelineHistory(agent)) {
      historyEvents.push(event);
    }

    this.options.coalescer.flushAndDiscard(agent.id);
    await this.options.timeline.deleteCommitted(agent.id);
    this.options.timeline.resetMemory(agent.id);
    agent.historyPrimed = true;

    for (const event of historyEvents) {
      const row = this.options.timeline.append(
        agent.id,
        event.item,
        event.timestamp ? { timestamp: event.timestamp } : undefined,
      );
      if (broadcast) {
        this.options.dispatchStream(agent.id, event, {
          seq: row.seq,
          epoch: this.options.timeline.getEpoch(agent.id),
          timestamp: row.timestamp,
        });
      }
    }
    this.options.touchUpdatedAt(agent);
    this.options.emitState(agent);
  }

  private async seedFromProviderHistory(agent: ActiveManagedAgent): Promise<void> {
    try {
      for await (const event of this.streamTimelineHistory(agent)) {
        this.options.timeline.append(
          agent.id,
          event.item,
          event.timestamp ? { timestamp: event.timestamp } : undefined,
        );
      }
    } catch (error) {
      this.options.logger.debug(
        { err: error, agentId: agent.id },
        "Failed to hydrate timeline from legacy provider history",
      );
    } finally {
      // Mark primed only after the seed attempt finishes so callers can distinguish
      // "hydration in flight" from "hydration complete" (including best-effort failures).
      agent.historyPrimed = true;
    }
  }

  private async *streamTimelineHistory(
    agent: ActiveManagedAgent,
  ): AsyncGenerator<Extract<AgentStreamEvent, { type: "timeline" }>> {
    for await (const event of agent.session.streamHistory()) {
      if (event.type !== "timeline") {
        continue;
      }
      if (event.item.type === "user_message" && isSystemInjectedEnvelope(event.item.text)) {
        continue;
      }
      yield event;
    }
  }
}
