import {
  SessionInboundMessageSchema,
  type FetchAgentTimelineResponseMessage,
  type SendAgentMessageRequest,
} from "@chisacode/protocol/messages";

import type { DaemonCommandTransport } from "./daemon-client-command-transport.js";
import { DaemonRpcError } from "./daemon-client-rpc-error.js";
import { safeRandomId } from "./daemon-client-transport-utils.js";

const DEFAULT_FETCH_AGENT_TIMELINE_TIMEOUT_MS = 60_000;

/** Options for sending a user message to an agent. */
export interface SendMessageOptions {
  messageId?: string;
  images?: Array<{ data: string; mimeType: string }>;
  attachments?: SendAgentMessageRequest["attachments"];
}

/** Agent timeline response payload returned by the daemon. */
export type FetchAgentTimelinePayload = FetchAgentTimelineResponseMessage["payload"];
export type FetchAgentTimelineDirection = FetchAgentTimelinePayload["direction"];
export type FetchAgentTimelineProjection = FetchAgentTimelinePayload["projection"];
export type FetchAgentTimelineCursor = NonNullable<FetchAgentTimelinePayload["startCursor"]>;

/** Query options for fetching an agent timeline page. */
export interface FetchAgentTimelineOptions {
  direction?: FetchAgentTimelineDirection;
  cursor?: FetchAgentTimelineCursor;
  limit?: number;
  projection?: FetchAgentTimelineProjection;
  requestId?: string;
}

interface AgentInteractionTransport extends DaemonCommandTransport {
  createRequestId(requestId?: string): string;
  supportsGenerativeUi(): boolean;
}

/** Implements agent timeline queries and user interaction commands. */
export class AgentInteractionClient {
  constructor(private readonly transport: AgentInteractionTransport) {}

  async fetchAgentTimeline(
    agentId: string,
    options: FetchAgentTimelineOptions = {},
  ): Promise<FetchAgentTimelinePayload> {
    const requestId = this.transport.createRequestId(options.requestId);
    const message = SessionInboundMessageSchema.parse({
      type: "fetch_agent_timeline_request",
      agentId,
      requestId,
      ...(options.direction ? { direction: options.direction } : {}),
      ...(options.cursor ? { cursor: options.cursor } : {}),
      ...(typeof options.limit === "number" ? { limit: options.limit } : {}),
      ...(options.projection ? { projection: options.projection } : {}),
    });
    const payload = await this.transport.request({
      requestId,
      message,
      responseType: "fetch_agent_timeline_response",
      timeout: DEFAULT_FETCH_AGENT_TIMELINE_TIMEOUT_MS,
    });
    if (payload.error) {
      throw new Error(payload.error);
    }
    return payload;
  }

  async sendAgentMessage(
    agentId: string,
    text: string,
    options?: SendMessageOptions,
  ): Promise<{ pendingRun?: boolean }> {
    const requestId = this.transport.createRequestId();
    const messageId = options?.messageId ?? safeRandomId();
    const message = SessionInboundMessageSchema.parse({
      type: "send_agent_message_request",
      requestId,
      agentId,
      text,
      ...(messageId ? { messageId } : {}),
      ...(options?.images ? { images: options.images } : {}),
      ...(options?.attachments ? { attachments: options.attachments } : {}),
    });
    const response = await this.transport.request({
      requestId,
      message,
      responseType: "send_agent_message_response",
      timeout: 15_000,
    });
    if (!response.accepted) {
      throw new Error(response.error ?? "sendAgentMessage rejected");
    }
    return { pendingRun: response.pendingRun };
  }

  /**
   * Sends a generative UI user-interaction callback to the server.
   * @param agentId Target agent session ID
   * @param instanceId Generative UI component instance ID
   * @param action Action name as defined in the component's actions
   * @param payload Action-specific payload
   * @param options Optional timeout configuration
   * @throws {DaemonRpcError} If the server rejects the action or does not support it
   */
  async sendGenerativeUiAction(
    agentId: string,
    instanceId: string,
    action: string,
    payload: unknown,
    options?: { timeout?: number },
  ): Promise<void> {
    if (!this.transport.supportsGenerativeUi()) {
      throw new DaemonRpcError({
        requestId: "",
        error: "generative UI actions are not supported by this server",
        requestType: "generative_ui.action.request",
      });
    }
    const requestId = this.transport.createRequestId();
    const message = SessionInboundMessageSchema.parse({
      type: "generative_ui.action.request",
      requestId,
      agentId,
      instanceId,
      action,
      payload,
      timestamp: Date.now(),
    });
    const response = await this.transport.request({
      requestId,
      message,
      responseType: "generative_ui.action.response",
      timeout: options?.timeout ?? 10_000,
    });
    if (!response.received) {
      throw new DaemonRpcError({
        requestId,
        error: response.error ?? "generative_ui.action rejected",
        requestType: "generative_ui.action.request",
      });
    }
  }
}
