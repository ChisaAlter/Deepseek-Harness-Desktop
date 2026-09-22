import type { Logger } from "pino";

import { getAgentStreamEventTurnId, type AgentStreamEvent } from "./agent-sdk-types.js";
import type { ManagedAgent } from "./agent-manager.js";
import type { AgentPermissionController } from "./agent-permission-controller.js";
import type { AgentSessionStateController } from "./agent-session-state-controller.js";
import type { AgentStreamCoalescer } from "./agent-stream-coalescer.js";
import type { AgentTimelineEventController } from "./agent-timeline-event-controller.js";
import type { AgentTurnEventController } from "./agent-turn-event-controller.js";
import type { ForegroundRunState } from "./foreground-run-state.js";

type ActiveManagedAgent = Exclude<ManagedAgent, { lifecycle: "closed" }>;

interface StreamEventFlags {
  shouldDispatchEvent: boolean;
  shouldNotifyWaiters: boolean;
}

interface HandleStreamEventOptions {
  fromHistory?: boolean;
}

interface AgentSessionEventPipelineControllerOptions {
  coalescer: AgentStreamCoalescer;
  dispatchStream(
    agentId: string,
    event: AgentStreamEvent,
    metadata?: { seq?: number; epoch?: string; timestamp?: string },
  ): void;
  finalizeForeground(agent: ActiveManagedAgent, turnId: string | undefined): void;
  findAgent(agentId: string): ActiveManagedAgent | null;
  foregroundRuns: ForegroundRunState;
  isTerminalEvent(event: AgentStreamEvent): boolean;
  logger: Logger;
  onAgentTerminal(agentId: string): void;
  permissions: AgentPermissionController;
  sessionState: AgentSessionStateController;
  timelineEvents: AgentTimelineEventController;
  touchUpdatedAt(agent: ManagedAgent): Date;
  trackBackgroundTask(task: Promise<void>): void;
  turnEvents: AgentTurnEventController;
}

/** Owns serialized provider event processing, routing, coalescing, and waiter delivery. */
export class AgentSessionEventPipelineController {
  private readonly tails = new Map<string, Promise<void>>();

  constructor(private readonly options: AgentSessionEventPipelineControllerOptions) {}

  getTail(agentId: string): Promise<void> | undefined {
    return this.tails.get(agentId);
  }

  enqueue(agentId: string, event: AgentStreamEvent): void {
    this.options.logger.trace(
      {
        agentId,
        provider: event.provider,
        sessionId: this.options.findAgent(agentId)?.persistence?.sessionId ?? undefined,
        turnId: getAgentStreamEventTurnId(event),
        event,
      },
      "agent.manager.enqueue",
    );
    const previous = this.tails.get(agentId) ?? Promise.resolve();
    const next = previous
      .catch(() => undefined)
      .then(async () => {
        const current = this.options.findAgent(agentId);
        if (!current || current.session == null) {
          return;
        }
        this.options.logger.trace(
          {
            agentId,
            provider: event.provider,
            sessionId: current.persistence?.sessionId ?? undefined,
            turnId: getAgentStreamEventTurnId(event),
            event,
          },
          "agent.manager.dequeue",
        );
        await this.dispatch(current, event);
        return;
      })
      .catch((error) => {
        this.options.logger.error(
          { err: error, agentId, eventType: event.type },
          "Failed to process session event",
        );
      });

    this.tails.set(agentId, next);
    this.options.trackBackgroundTask(next);
    void next.finally(() => {
      if (this.tails.get(agentId) === next) {
        this.tails.delete(agentId);
      }
    });
  }

  async dispatch(agent: ActiveManagedAgent, event: AgentStreamEvent): Promise<void> {
    const turnId = getAgentStreamEventTurnId(event);
    const matchingWaiters = this.options.foregroundRuns.getMatchingWaiters(agent, turnId);
    this.options.logger.trace(
      {
        agentId: agent.id,
        provider: event.provider,
        sessionId: agent.persistence?.sessionId ?? undefined,
        turnId,
        matchingWaiterCount: matchingWaiters.length,
        event,
      },
      "agent.manager.dispatch_session_event",
    );

    const shouldNotifyWaiters = await this.handle(agent, event);
    if (!shouldNotifyWaiters) {
      return;
    }

    const terminal = this.options.isTerminalEvent(event);
    this.options.foregroundRuns.notifyWaiters(matchingWaiters, event, { terminal });
    if (terminal && matchingWaiters.length === 0) {
      this.options.onAgentTerminal(agent.id);
    }
    this.options.logger.trace(
      {
        agentId: agent.id,
        provider: event.provider,
        sessionId: agent.persistence?.sessionId ?? undefined,
        turnId,
        notifiedWaiterCount: matchingWaiters.length,
        terminal,
        event,
      },
      "agent.manager.notify_waiters",
    );
  }

  async handle(
    agent: ActiveManagedAgent,
    event: AgentStreamEvent,
    options?: HandleStreamEventOptions,
  ): Promise<boolean> {
    const eventTurnId = getAgentStreamEventTurnId(event);
    const isForegroundEvent = Boolean(eventTurnId && agent.activeForegroundTurnId === eventTurnId);
    this.traceHandleStart(agent, event, eventTurnId, isForegroundEvent);
    if (
      eventTurnId &&
      this.options.isTerminalEvent(event) &&
      this.options.foregroundRuns.hasFinalizedTurn(agent, eventTurnId)
    ) {
      return false;
    }

    if (!options?.fromHistory) {
      this.options.touchUpdatedAt(agent);
      if (this.options.coalescer.handle(agent.id, event)) {
        this.traceCoalescerBuffered(agent, event, eventTurnId);
        return false;
      }
      this.options.coalescer.flushFor(agent.id);
    }

    const flags: StreamEventFlags = { shouldDispatchEvent: true, shouldNotifyWaiters: true };
    const dispatchPromise = this.dispatchByType({
      agent,
      event,
      options,
      isForegroundEvent,
      eventTurnId,
      flags,
    });
    if (dispatchPromise) {
      await dispatchPromise;
    }

    if (!options?.fromHistory && isForegroundEvent && this.options.isTerminalEvent(event)) {
      this.options.finalizeForeground(agent, eventTurnId);
    }

    if (!options?.fromHistory && flags.shouldDispatchEvent) {
      this.options.dispatchStream(agent.id, event, { timestamp: new Date().toISOString() });
    }

    this.traceHandleEnd(agent, event, eventTurnId, flags);
    return flags.shouldNotifyWaiters;
  }

  private dispatchByType(params: {
    agent: ActiveManagedAgent;
    event: AgentStreamEvent;
    options: HandleStreamEventOptions | undefined;
    isForegroundEvent: boolean;
    eventTurnId: string | undefined;
    flags: StreamEventFlags;
  }): Promise<void> | undefined {
    const { agent, event, options, isForegroundEvent, eventTurnId, flags } = params;
    switch (event.type) {
      case "thread_started":
        this.options.sessionState.onThreadStarted(agent);
        return undefined;
      case "usage_updated":
        this.options.sessionState.onUsageUpdated(agent, event);
        return undefined;
      case "mode_changed":
        this.options.sessionState.onModeChanged(agent, event);
        flags.shouldDispatchEvent = false;
        return undefined;
      case "model_changed":
        this.options.sessionState.onModelChanged(agent, event);
        flags.shouldDispatchEvent = false;
        return undefined;
      case "thinking_option_changed":
        this.options.sessionState.onThinkingOptionChanged(agent, event);
        flags.shouldDispatchEvent = false;
        return undefined;
      case "timeline": {
        const routing = this.options.timelineEvents.onTimelineEvent(agent, event, options);
        flags.shouldDispatchEvent = routing.shouldDispatchEvent;
        flags.shouldNotifyWaiters = routing.shouldNotifyWaiters;
        return undefined;
      }
      case "turn_completed":
        this.options.turnEvents.onCompleted({
          agent,
          event,
          eventTurnId,
          isForegroundEvent,
          fromHistory: options?.fromHistory === true,
        });
        return undefined;
      case "turn_failed":
        return this.options.turnEvents.onFailed({
          agent,
          event,
          eventTurnId,
          isForegroundEvent,
          options,
        });
      case "turn_canceled":
        this.options.turnEvents.onCanceled({
          agent,
          event,
          eventTurnId,
          isForegroundEvent,
          options,
        });
        return undefined;
      case "turn_started":
        this.options.turnEvents.onStarted({ agent, eventTurnId, isForegroundEvent });
        return undefined;
      case "permission_requested":
        this.options.permissions.onRequested(agent, event);
        return undefined;
      case "permission_resolved": {
        const shouldDispatchEvent = this.options.permissions.onResolved(agent, event, options);
        if (!shouldDispatchEvent) {
          flags.shouldDispatchEvent = false;
        }
        return undefined;
      }
      default:
        return undefined;
    }
  }

  private traceHandleStart(
    agent: ActiveManagedAgent,
    event: AgentStreamEvent,
    turnId: string | undefined,
    isForegroundEvent: boolean,
  ): void {
    this.options.logger.trace(
      {
        agentId: agent.id,
        provider: event.provider,
        sessionId: agent.persistence?.sessionId ?? undefined,
        turnId,
        lifecycle: agent.lifecycle,
        activeForegroundTurnId: agent.activeForegroundTurnId,
        isForegroundEvent,
        event,
      },
      "agent.manager.handle_stream_event.start",
    );
  }

  private traceCoalescerBuffered(
    agent: ActiveManagedAgent,
    event: AgentStreamEvent,
    turnId: string | undefined,
  ): void {
    this.options.logger.trace(
      {
        agentId: agent.id,
        provider: event.provider,
        sessionId: agent.persistence?.sessionId ?? undefined,
        turnId,
        event,
      },
      "agent.manager.coalescer.buffer",
    );
  }

  private traceHandleEnd(
    agent: ActiveManagedAgent,
    event: AgentStreamEvent,
    turnId: string | undefined,
    flags: StreamEventFlags,
  ): void {
    this.options.logger.trace(
      {
        agentId: agent.id,
        provider: event.provider,
        sessionId: agent.persistence?.sessionId ?? undefined,
        turnId,
        lifecycle: agent.lifecycle,
        activeForegroundTurnId: agent.activeForegroundTurnId,
        shouldDispatchEvent: flags.shouldDispatchEvent,
        shouldNotifyWaiters: flags.shouldNotifyWaiters,
        event,
      },
      "agent.manager.handle_stream_event.end",
    );
  }
}
