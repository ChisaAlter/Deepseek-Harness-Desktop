import type pino from "pino";
import { CLIENT_CAPS } from "@chisacode/protocol/client-capabilities";
import { serializeAgentStreamEvent } from "./messages.js";
import type { SessionOutboundMessage } from "./messages.js";
import type { AgentManager, AgentManagerEvent, ManagedAgent } from "./agent/agent-manager.js";
import { getAgentStreamEventTurnId, type AgentStreamEvent } from "./agent/agent-sdk-types.js";
import { buildAgentStreamPayload } from "./agent-session-helpers.js";

interface AgentEventForwarderOptions {
  agentManager: Pick<AgentManager, "subscribe">;
  sessionLogger: pino.Logger;
  supports(capability: string): boolean;
  forwardAgentUpdate(agent: ManagedAgent): Promise<void>;
  emit(message: SessionOutboundMessage): void;
}

/** Owns one client session's AgentManager event subscription and wire projection. */
export class AgentEventForwarder {
  private unsubscribe: (() => void) | null = null;

  constructor(private readonly options: AgentEventForwarderOptions) {}

  start(): void {
    this.dispose();
    this.unsubscribe = this.options.agentManager.subscribe((event) => this.handleEvent(event), {
      replayState: false,
    });
  }

  dispose(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
  }

  private handleEvent(event: AgentManagerEvent): void {
    if (event.type === "agent_state") {
      this.options.sessionLogger.trace(
        {
          agentId: event.agent.id,
          provider: event.agent.provider,
          providerSessionId: event.agent.persistence?.sessionId ?? undefined,
          turnId: event.agent.activeForegroundTurnId ?? undefined,
          lifecycle: event.agent.lifecycle,
        },
        "agent.session.forward_update",
      );
      this.forwardStateUpdate(event.agent);
      return;
    }

    if (
      !this.options.supports(CLIENT_CAPS.generativeUi) &&
      isGenerativeUiStreamEvent(event.event)
    ) {
      return;
    }

    const serializedEvent = serializeAgentStreamEvent(event.event);
    if (!serializedEvent) {
      return;
    }
    this.options.sessionLogger.trace(
      {
        agentId: event.agentId,
        provider: event.event.provider,
        turnId: getAgentStreamEventTurnId(event.event),
        seq: event.seq,
        epoch: event.epoch,
        event: event.event,
      },
      "agent.session.forward_stream",
    );
    this.options.emit({
      type: "agent_stream",
      payload: buildAgentStreamPayload(event, serializedEvent),
    });

    if (event.event.type === "permission_requested") {
      this.options.emit({
        type: "agent_permission_request",
        payload: { agentId: event.agentId, request: event.event.request },
      });
    } else if (event.event.type === "permission_resolved") {
      this.options.emit({
        type: "agent_permission_resolved",
        payload: {
          agentId: event.agentId,
          requestId: event.event.requestId,
          resolution: event.event.resolution,
        },
      });
    }
  }

  private forwardStateUpdate(agent: ManagedAgent): void {
    try {
      void this.options.forwardAgentUpdate(agent).catch((error: unknown) => {
        this.logStateProjectionFailure(agent, error);
      });
    } catch (error) {
      this.logStateProjectionFailure(agent, error);
    }
  }

  private logStateProjectionFailure(agent: ManagedAgent, error: unknown): void {
    this.options.sessionLogger.error(
      { err: error, agentId: agent.id, provider: agent.provider },
      "Failed to project AgentManager state update to client session",
    );
  }
}

function isGenerativeUiStreamEvent(event: AgentStreamEvent): boolean {
  return (
    event.type === "generative_ui_update" ||
    event.type === "generative_ui_remove" ||
    (event.type === "timeline" && event.item.type === "generative_ui")
  );
}
