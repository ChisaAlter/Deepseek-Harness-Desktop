import {
  getAgentStreamEventTurnId,
  type AgentStreamEvent,
  type ToolCallTimelineItem,
} from "../../agent-sdk-types.js";

type TerminalTurnEvent = Extract<
  AgentStreamEvent,
  { type: "turn_completed" | "turn_failed" | "turn_canceled" }
>;

interface OpenCodeSessionEventBusOptions {
  trace: (
    message: "provider.opencode.finish_foreground_turn" | "provider.opencode.event_emit",
    data: Record<string, unknown>,
  ) => void;
  onTurnFinished: () => void;
}

/** Owns OpenCode foreground turn identity, subscribers, and running tool lifecycle. */
export class OpenCodeSessionEventBus {
  private readonly subscribers = new Set<(event: AgentStreamEvent) => void>();
  private readonly runningToolCalls = new Map<string, ToolCallTimelineItem>();
  private nextTurnOrdinal = 0;
  private activeTurnId: string | null = null;
  private closed = false;

  constructor(private readonly options: OpenCodeSessionEventBusOptions) {}

  getActiveTurnId(): string | null {
    return this.activeTurnId;
  }

  prepareTurn(): void {
    this.runningToolCalls.clear();
  }

  beginTurn(): string {
    const turnId = `opencode-turn-${this.nextTurnOrdinal++}`;
    this.activeTurnId = turnId;
    this.notify({ type: "turn_started", provider: "opencode" }, turnId);
    return turnId;
  }

  subscribe(callback: (event: AgentStreamEvent) => void): () => void {
    this.subscribers.add(callback);
    return () => {
      this.subscribers.delete(callback);
    };
  }

  trackToolCall(item: ToolCallTimelineItem): void {
    if (item.status === "running") {
      this.runningToolCalls.set(item.callId, item);
      return;
    }
    this.runningToolCalls.delete(item.callId);
  }

  finish(event: TerminalTurnEvent, turnId: string): void {
    this.options.trace("provider.opencode.finish_foreground_turn", {
      turnId,
      activeTurnId: this.activeTurnId,
      type: event.type,
      error: event.type === "turn_failed" ? event.error : undefined,
      reason: event.type === "turn_canceled" ? event.reason : undefined,
    });
    if (this.activeTurnId !== turnId) {
      return;
    }
    if (event.type === "turn_canceled" || event.type === "turn_failed") {
      this.synthesizeInterruptedToolCalls(turnId);
    } else {
      this.runningToolCalls.clear();
    }
    this.activeTurnId = null;
    this.options.onTurnFinished();
    this.notify(event, turnId);
  }

  notify(event: AgentStreamEvent, turnIdOverride?: string): void {
    if (this.closed) {
      return;
    }
    const turnId = turnIdOverride ?? this.activeTurnId;
    const tagged = turnId ? { ...event, turnId } : event;
    this.options.trace("provider.opencode.event_emit", {
      turnId: getAgentStreamEventTurnId(tagged),
      event: tagged,
    });
    for (const callback of this.subscribers) {
      try {
        callback(tagged);
      } catch {
        // Subscriber callback error isolation
      }
    }
  }

  close(): void {
    this.closed = true;
    this.activeTurnId = null;
    this.runningToolCalls.clear();
    this.subscribers.clear();
  }

  private synthesizeInterruptedToolCalls(turnId: string): void {
    for (const item of this.runningToolCalls.values()) {
      const error = { message: "Tool execution aborted" };
      this.notify(
        {
          type: "timeline",
          provider: "opencode",
          item: {
            ...item,
            status: "failed",
            error,
            detail:
              item.detail.type === "sub_agent"
                ? {
                    ...item.detail,
                    log: [item.detail.log, error.message]
                      .filter((entry) => entry.trim().length > 0)
                      .join("\n"),
                  }
                : item.detail,
          },
        },
        turnId,
      );
    }
    this.runningToolCalls.clear();
  }
}
