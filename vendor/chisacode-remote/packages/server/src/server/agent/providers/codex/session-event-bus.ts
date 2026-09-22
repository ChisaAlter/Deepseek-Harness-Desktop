import type { Logger } from "pino";

import { getAgentStreamEventTurnId, type AgentStreamEvent } from "../../agent-sdk-types.js";

interface CodexSessionEventBusContext {
  agentId?: string;
  getSessionId(): string | null;
  getTurnId(): string | null;
}

/** Tags, traces, and broadcasts Codex session events while isolating subscriber failures. */
export class CodexSessionEventBus {
  private readonly subscribers = new Set<(event: AgentStreamEvent) => void>();

  constructor(
    private readonly logger: Logger,
    private readonly context: CodexSessionEventBusContext,
  ) {}

  subscribe(callback: (event: AgentStreamEvent) => void): () => void {
    this.subscribers.add(callback);
    return () => {
      this.subscribers.delete(callback);
    };
  }

  emit(event: AgentStreamEvent): void {
    const turnId = this.context.getTurnId();
    const tagged = turnId ? { ...event, turnId } : event;
    this.logger.trace(
      {
        agentId: this.context.agentId,
        provider: "codex",
        sessionId: this.context.getSessionId(),
        turnId: getAgentStreamEventTurnId(tagged),
        event: tagged,
      },
      "provider.codex.event_emit",
    );
    for (const callback of this.subscribers) {
      try {
        callback(tagged);
      } catch (error) {
        this.logger.warn({ err: error }, "Subscriber callback threw");
      }
    }
  }

  clear(): void {
    this.subscribers.clear();
  }
}
