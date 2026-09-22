import type { Logger } from "pino";

import type { AgentProvider, AgentStreamEvent, AgentTimelineItem } from "./agent-sdk-types.js";
import type { ManagedAgent } from "./agent-manager.js";
import { AgentPermissionController } from "./agent-permission-controller.js";
import { AgentSessionStateController } from "./agent-session-state-controller.js";
import { AgentTimelineController } from "./agent-timeline-controller.js";
import { formatClaudeUserFacingErrorText } from "./providers/claude/user-facing-error-text.js";
import { createUsageEventRecord, type UsageStore } from "../usage/usage-store.js";

const SYSTEM_ERROR_PREFIX = "[System Error]";

type ActiveManagedAgent = Exclude<ManagedAgent, { lifecycle: "closed" }>;
type TurnCompletedEvent = Extract<AgentStreamEvent, { type: "turn_completed" }>;
type TurnFailedEvent = Extract<AgentStreamEvent, { type: "turn_failed" }>;
type TurnCanceledEvent = Extract<AgentStreamEvent, { type: "turn_canceled" }>;

interface AgentTurnEventControllerOptions {
  dispatchStream(
    agentId: string,
    event: AgentStreamEvent,
    metadata?: { seq?: number; epoch?: string; timestamp?: string },
  ): void;
  emitState(agent: ManagedAgent): void;
  logger: Logger;
  permissions: AgentPermissionController;
  sessionState: AgentSessionStateController;
  timeline: AgentTimelineController;
  trackBackgroundTask(task: Promise<void>): void;
  usageStore?: UsageStore;
  /** Called at turn start/end to create git snapshots for file-edit protection. */
  snapshotOnTurn?: (cwd: string, kind: "before-edit" | "after-edit", agentId: string) => void;
  /** Called after turn completion to evaluate goal continuation. */
  onGoalTurnCompleted?: (
    agentId: string,
    cwd: string,
    tokensUsed: number,
    usedTools: boolean,
  ) => void;
}

/** Owns turn lifecycle event projection, usage recording, and terminal error messages. */
export class AgentTurnEventController {
  constructor(private readonly options: AgentTurnEventControllerOptions) {}

  onCompleted(params: {
    agent: ActiveManagedAgent;
    event: TurnCompletedEvent;
    eventTurnId: string | undefined;
    isForegroundEvent: boolean;
    fromHistory: boolean;
  }): void {
    const { agent, event, eventTurnId, isForegroundEvent, fromHistory } = params;
    this.options.logger.trace(
      {
        agentId: agent.id,
        provider: agent.provider,
        sessionId: agent.persistence?.sessionId ?? undefined,
        turnId: eventTurnId,
        lifecycle: agent.lifecycle,
        activeForegroundTurnId: agent.activeForegroundTurnId,
      },
      "agent.manager.turn.completed",
    );
    agent.lastUsage = event.usage;
    if (!fromHistory) {
      this.recordUsageEvent(agent, event, eventTurnId);
    }
    agent.lastError = undefined;
    // Auto-snapshot after agent edits (no-op if no changes since last snapshot)
    if (!fromHistory && this.options.snapshotOnTurn && agent.cwd) {
      this.options.snapshotOnTurn(agent.cwd, "after-edit", agent.id);
    }
    // Goal continuation: evaluate whether to auto-continue after this turn
    if (!fromHistory && this.options.onGoalTurnCompleted && agent.cwd) {
      const tokensUsed = (event.usage?.inputTokens ?? 0) + (event.usage?.outputTokens ?? 0);
      const usedTools = agent.currentTurnToolCallCount > 0;
      this.options.onGoalTurnCompleted(agent.id, agent.cwd, tokensUsed, usedTools);
    }
    if (!isForegroundEvent && agent.lifecycle !== "idle" && !agent.pendingReplacement) {
      (agent as ActiveManagedAgent).lifecycle = "idle";
      this.options.emitState(agent);
    }
    void this.options.sessionState.refreshRuntimeInfo(agent);
  }

  async onFailed(params: {
    agent: ActiveManagedAgent;
    event: TurnFailedEvent;
    eventTurnId: string | undefined;
    isForegroundEvent: boolean;
    options: { fromHistory?: boolean } | undefined;
  }): Promise<void> {
    const { agent, event, eventTurnId, isForegroundEvent, options } = params;
    this.options.logger.warn(
      {
        agentId: agent.id,
        provider: agent.provider,
        sessionId: agent.persistence?.sessionId ?? undefined,
        turnId: eventTurnId,
        lifecycle: agent.lifecycle,
        activeForegroundTurnId: agent.activeForegroundTurnId,
        eventTurnId,
        error: event.error,
        code: event.code,
        diagnostic: event.diagnostic,
      },
      "handleStreamEvent: turn_failed",
    );
    if (!isForegroundEvent) {
      agent.lifecycle = "error";
    }
    agent.lastError = event.error;
    await this.appendSystemErrorTimelineMessage(
      agent,
      event.provider,
      this.formatFailure(event),
      options,
    );
    this.options.permissions.resolvePending(agent, event.provider, options, "Turn failed");
    if (!isForegroundEvent) {
      this.options.emitState(agent);
    }
  }

  onCanceled(params: {
    agent: ActiveManagedAgent;
    event: TurnCanceledEvent;
    eventTurnId: string | undefined;
    isForegroundEvent: boolean;
    options: { fromHistory?: boolean } | undefined;
  }): void {
    const { agent, event, eventTurnId, isForegroundEvent, options } = params;
    this.options.logger.trace(
      {
        agentId: agent.id,
        provider: agent.provider,
        sessionId: agent.persistence?.sessionId ?? undefined,
        turnId: eventTurnId,
        lifecycle: agent.lifecycle,
        activeForegroundTurnId: agent.activeForegroundTurnId,
        eventTurnId,
      },
      "agent.manager.turn.canceled",
    );
    if (!isForegroundEvent && !agent.pendingReplacement) {
      agent.lifecycle = "idle";
    }
    agent.lastError = undefined;
    this.options.permissions.resolvePending(agent, event.provider, options, "Interrupted");
    if (!isForegroundEvent) {
      this.options.emitState(agent);
    }
  }

  onStarted(params: {
    agent: ActiveManagedAgent;
    eventTurnId: string | undefined;
    isForegroundEvent: boolean;
  }): void {
    const { agent, eventTurnId, isForegroundEvent } = params;
    this.options.logger.trace(
      {
        agentId: agent.id,
        provider: agent.provider,
        sessionId: agent.persistence?.sessionId ?? undefined,
        turnId: eventTurnId,
        lifecycle: agent.lifecycle,
        activeForegroundTurnId: agent.activeForegroundTurnId,
      },
      "agent.manager.turn.started",
    );
    // Reset per-turn tool call counter for goal evaluation
    agent.currentTurnToolCallCount = 0;
    if (!isForegroundEvent) {
      agent.lifecycle = "running";
      this.options.emitState(agent);
    }
    // Auto-snapshot before agent edits (no-op if no changes since last snapshot)
    if (this.options.snapshotOnTurn && agent.cwd) {
      this.options.snapshotOnTurn(agent.cwd, "before-edit", agent.id);
    }
  }

  formatFailure(event: TurnFailedEvent): string {
    const base = event.error.trim();
    const parts = [base.length > 0 ? formatClaudeUserFacingErrorText(base) : "Provider run failed"];
    const code = event.code?.trim();
    if (code) {
      parts.push(`code: ${code}`);
    }
    const diagnostic = event.diagnostic?.trim();
    if (diagnostic && diagnostic !== base) {
      parts.push(diagnostic);
    }
    return parts.join("\n\n");
  }

  private recordUsageEvent(
    agent: ActiveManagedAgent,
    event: TurnCompletedEvent,
    eventTurnId: string | undefined,
  ): void {
    if (!this.options.usageStore || !event.usage) {
      return;
    }
    const record = createUsageEventRecord({
      agentId: agent.id,
      cwd: agent.cwd,
      provider: event.provider,
      model: agent.runtimeInfo?.model ?? agent.config.model ?? null,
      turnId: eventTurnId,
      usage: event.usage,
      messageCount: 1,
    });
    if (!record) {
      return;
    }
    const appendTask = this.options.usageStore.append(record).catch((error) => {
      this.options.logger.warn({ err: error, agentId: agent.id }, "Failed to record usage event");
    });
    this.options.trackBackgroundTask(appendTask);
  }

  private async appendSystemErrorTimelineMessage(
    agent: ActiveManagedAgent,
    provider: AgentProvider,
    message: string,
    options?: { fromHistory?: boolean },
  ): Promise<void> {
    if (options?.fromHistory) {
      return;
    }
    const normalized = message.trim();
    if (!normalized) {
      return;
    }

    const text = `${SYSTEM_ERROR_PREFIX} ${normalized}`;
    const lastItem = await this.options.timeline.getLastItem(agent.id);
    if (lastItem?.type === "assistant_message" && lastItem.text === text) {
      return;
    }

    const item: AgentTimelineItem = { type: "assistant_message", text };
    const row = this.options.timeline.append(agent.id, item);
    this.options.dispatchStream(
      agent.id,
      { type: "timeline", item, provider },
      {
        seq: row.seq,
        epoch: this.options.timeline.getEpoch(agent.id),
        timestamp: row.timestamp,
      },
    );
  }
}
