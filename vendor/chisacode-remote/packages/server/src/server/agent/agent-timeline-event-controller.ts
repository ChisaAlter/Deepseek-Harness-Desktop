import type { Logger } from "pino";

import type { AgentProvider, AgentStreamEvent, AgentTimelineItem } from "./agent-sdk-types.js";
import { getAgentStreamEventTurnId } from "./agent-sdk-types.js";
import { isSystemInjectedEnvelope } from "./agent-prompt.js";
import type { ManagedAgent } from "./agent-manager.js";
import { AgentTimelineController } from "./agent-timeline-controller.js";
import { ForegroundRunState } from "./foreground-run-state.js";

type ActiveManagedAgent = Exclude<ManagedAgent, { lifecycle: "closed" }>;
type TimelineEvent = Extract<AgentStreamEvent, { type: "timeline" }>;

interface AgentTimelineEventControllerOptions {
  dispatchStream(
    agentId: string,
    event: AgentStreamEvent,
    metadata?: { seq?: number; epoch?: string; timestamp?: string },
  ): void;
  emitState(agent: ManagedAgent): void;
  findAgent(agentId: string): ActiveManagedAgent | null;
  foregroundRuns: ForegroundRunState;
  logger: Logger;
  timeline: AgentTimelineController;
}

interface TimelineEventRoutingResult {
  shouldDispatchEvent: boolean;
  shouldNotifyWaiters: boolean;
}

/** Owns live, replayed, and coalesced timeline event routing. */
export class AgentTimelineEventController {
  constructor(private readonly options: AgentTimelineEventControllerOptions) {}

  onTimelineEvent(
    agent: ActiveManagedAgent,
    event: TimelineEvent,
    options?: { fromHistory?: boolean },
  ): TimelineEventRoutingResult {
    if (event.item.type === "user_message" && isSystemInjectedEnvelope(event.item.text)) {
      return { shouldDispatchEvent: false, shouldNotifyWaiters: false };
    }

    if (options?.fromHistory) {
      this.options.timeline.append(
        agent.id,
        event.item,
        event.timestamp ? { timestamp: event.timestamp } : undefined,
      );
      return { shouldDispatchEvent: false, shouldNotifyWaiters: false };
    }

    this.recordAndDispatch(agent.id, event.item, event.provider, event.turnId);
    if (event.item.type === "user_message") {
      agent.lastUserMessageAt = new Date();
      this.options.emitState(agent);
    }
    if (event.item.type === "tool_call") {
      agent.currentTurnToolCallCount++;
    }
    return { shouldDispatchEvent: false, shouldNotifyWaiters: true };
  }

  onCoalescedFlush(input: {
    agentId: string;
    item: AgentTimelineItem;
    provider: AgentProvider;
    turnId?: string;
  }): void {
    const event = this.recordAndDispatch(input.agentId, input.item, input.provider, input.turnId);
    this.notifyForegroundTurnWaiters(input.agentId, event);
  }

  private recordAndDispatch(
    agentId: string,
    item: AgentTimelineItem,
    provider: AgentProvider,
    turnId?: string,
  ): TimelineEvent {
    const row = this.options.timeline.append(agentId, item);
    const event: TimelineEvent = {
      type: "timeline",
      item,
      provider,
      ...(turnId !== undefined ? { turnId } : {}),
    };
    this.options.dispatchStream(agentId, event, {
      seq: row.seq,
      epoch: this.options.timeline.getEpoch(agentId),
      timestamp: row.timestamp,
    });
    return event;
  }

  private notifyForegroundTurnWaiters(agentId: string, event: TimelineEvent): void {
    const turnId = getAgentStreamEventTurnId(event);
    if (turnId == null) {
      return;
    }
    const agent = this.options.findAgent(agentId);
    if (!agent) {
      return;
    }

    this.options.foregroundRuns.notifyAgentWaiters(agent, event);
    this.options.logger.trace(
      {
        agentId,
        provider: event.provider,
        sessionId: agent.persistence?.sessionId ?? undefined,
        turnId,
        event,
      },
      "agent.manager.notify_waiters.coalesced",
    );
  }
}
