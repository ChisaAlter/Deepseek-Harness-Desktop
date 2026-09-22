import {
  parseServerInfoStatusPayload,
  WSOutboundMessageSchema,
  type AgentStreamEventPayload,
  type ServerInfoStatusPayload,
  type SessionOutboundMessage,
} from "@chisacode/protocol/messages";
import type {
  AgentPermissionRequest,
  AgentPermissionResponse,
} from "@chisacode/protocol/agent-types";
import {
  asUint8Array,
  decodeFileTransferFrame,
  decodeTerminalStreamFrame,
  TerminalStreamOpcode,
  type FileTransferFrame,
} from "@chisacode/protocol/binary-frames/index";

import { decodeMessageData } from "./daemon-client-transport.js";
import type { BinaryFileTransferOutcome } from "./daemon-client-file-transfer.js";
import type { Logger } from "./daemon-client-connection-controller.js";

type TerminalStreamFrame = NonNullable<ReturnType<typeof decodeTerminalStreamFrame>>;

export type DaemonEvent =
  | {
      type: "agent_update";
      agentId: string;
      payload: Extract<SessionOutboundMessage, { type: "agent_update" }>["payload"];
    }
  | {
      type: "workspace_update";
      workspaceId: string;
      payload: Extract<SessionOutboundMessage, { type: "workspace_update" }>["payload"];
    }
  | {
      type: "workspace_setup_progress";
      workspaceId: string;
      payload: Extract<SessionOutboundMessage, { type: "workspace_setup_progress" }>["payload"];
    }
  | {
      type: "agent_stream";
      agentId: string;
      event: AgentStreamEventPayload;
      timestamp: string;
      seq?: number;
      epoch?: string;
    }
  | { type: "status"; payload: { status: string } & Record<string, unknown> }
  | { type: "agent_deleted"; agentId: string }
  | {
      type: "agent_permission_request";
      agentId: string;
      request: AgentPermissionRequest;
    }
  | {
      type: "agent_permission_resolved";
      agentId: string;
      requestId: string;
      resolution: AgentPermissionResponse;
    }
  | {
      type: "providers_snapshot_update";
      payload: Extract<SessionOutboundMessage, { type: "providers_snapshot_update" }>["payload"];
    }
  | { type: "error"; message: string };

export type DaemonEventHandler = (event: DaemonEvent) => void;

interface InboundRuntimeMetrics {
  recordMessage(type: string, bytes: number, handlerMs: number): void;
  recordAgentStream(
    payload: Extract<SessionOutboundMessage, { type: "agent_stream" }>["payload"],
  ): void;
  recordBinaryFrame(kind: string, bytes: number, handlerMs: number): void;
}

interface DaemonClientInboundControllerOptions {
  fileTransfers: {
    handleFrame(frame: FileTransferFrame): BinaryFileTransferOutcome | null;
  };
  getRuntimeMetrics(): InboundRuntimeMetrics | null;
  isConnecting(): boolean;
  logger: Logger;
  markConnected(): void;
  onInboundActivity(): void;
  onRequestMessage(message: SessionOutboundMessage): void;
  onRelayDeviceAuthResult?: (message: {
    type: "relay_device_auth_result";
    ok: boolean;
    version: 1;
    reason?: string;
    deviceId?: string;
    deviceSecret?: string;
    securityLevel?: "v2" | "legacy";
  }) => void;
  onTerminalFrame(frame: TerminalStreamFrame): void;
  onTerminalStreamExit(terminalId: string): void;
  resolvePong(): void;
}

const perfNow: () => number =
  typeof performance !== "undefined" && typeof performance.now === "function"
    ? () => performance.now()
    : () => Date.now();

/** Owns daemon inbound decoding, capability state, subscriptions, and event projection. */
export class DaemonClientInboundController {
  private readonly rawMessageListeners = new Set<(message: SessionOutboundMessage) => void>();
  private readonly messageHandlers = new Map<
    SessionOutboundMessage["type"],
    Set<(message: SessionOutboundMessage) => void>
  >();
  private readonly eventListeners = new Set<DaemonEventHandler>();
  private lastServerInfoMessage: ServerInfoStatusPayload | null = null;

  constructor(private readonly options: DaemonClientInboundControllerOptions) {}

  subscribe(handler: DaemonEventHandler): () => void {
    this.eventListeners.add(handler);
    return () => this.eventListeners.delete(handler);
  }

  subscribeRaw(handler: (message: SessionOutboundMessage) => void): () => void {
    this.rawMessageListeners.add(handler);
    return () => {
      this.rawMessageListeners.delete(handler);
    };
  }

  subscribeMessage<TType extends SessionOutboundMessage["type"]>(
    type: TType,
    handler: (message: Extract<SessionOutboundMessage, { type: TType }>) => void,
  ): () => void {
    const normalizedHandler = handler as (message: SessionOutboundMessage) => void;
    let handlers = this.messageHandlers.get(type);
    if (!handlers) {
      handlers = new Set();
      this.messageHandlers.set(type, handlers);
    }
    handlers.add(normalizedHandler);

    return () => {
      const currentHandlers = this.messageHandlers.get(type);
      if (!currentHandlers) {
        return;
      }
      currentHandlers.delete(normalizedHandler);
      if (currentHandlers.size === 0) {
        this.messageHandlers.delete(type);
      }
    };
  }

  getLastServerInfoMessage(): ServerInfoStatusPayload | null {
    return this.lastServerInfoMessage;
  }

  supportsGenerativeUi(): boolean {
    return this.lastServerInfoMessage?.features?.generativeUi === true;
  }

  reset(): void {
    this.lastServerInfoMessage = null;
  }

  handle(rawData: unknown): void {
    const rawBytes = asUint8Array(rawData);
    if (rawBytes && this.tryHandleBinaryFrame(rawBytes)) {
      return;
    }
    const payload = decodeMessageData(rawData);
    if (!payload) {
      return;
    }
    this.handleJsonPayload(payload, rawBytes?.byteLength);
  }

  private handleJsonPayload(payload: string, rawBytesLength: number | undefined): void {
    const bytes = rawBytesLength ?? payload.length;
    const startMs = perfNow();
    let parsedJson: unknown;
    try {
      parsedJson = JSON.parse(payload);
    } catch {
      return;
    }

    const parsed = WSOutboundMessageSchema.safeParse(parsedJson);
    if (!parsed.success) {
      const msgType =
        parsedJson != null &&
        typeof parsedJson === "object" &&
        "type" in parsedJson &&
        typeof parsedJson.type === "string"
          ? parsedJson.type
          : "unknown";
      this.options.logger.warn(
        { msgType, error: parsed.error.message },
        "Message validation failed",
      );
      return;
    }

    this.options.onInboundActivity();
    const metrics = this.options.getRuntimeMetrics();
    if (parsed.data.type === "pong") {
      this.options.resolvePong();
      metrics?.recordMessage("pong", bytes, perfNow() - startMs);
      return;
    }

    // Relay device-auth results are WS-level (not session-wrapped).
    if (parsed.data.type === "relay_device_auth_result") {
      this.options.onRelayDeviceAuthResult?.(parsed.data);
      metrics?.recordMessage("relay_device_auth_result", bytes, perfNow() - startMs);
      return;
    }

    this.handleSessionMessage(parsed.data.message);
    const msgType = parsed.data.message.type;
    metrics?.recordMessage(msgType, bytes, perfNow() - startMs);
    if (parsed.data.message.type === "agent_stream") {
      metrics?.recordAgentStream(parsed.data.message.payload);
    }
  }

  private tryHandleBinaryFrame(rawBytes: Uint8Array): boolean {
    const fileFrame = decodeFileTransferFrame(rawBytes);
    if (fileFrame) {
      this.handleFileTransferFrame(fileFrame);
      this.options.getRuntimeMetrics()?.recordBinaryFrame("other", rawBytes.byteLength, 0);
      return true;
    }

    const frame = decodeTerminalStreamFrame(rawBytes);
    if (!frame) {
      return false;
    }
    const binaryStartMs = perfNow();
    this.options.onTerminalFrame(frame);
    let frameKind: "output" | "snapshot" | "other" = "other";
    if (frame.opcode === TerminalStreamOpcode.Output) {
      frameKind = "output";
    } else if (frame.opcode === TerminalStreamOpcode.Snapshot) {
      frameKind = "snapshot";
    } else if (frame.opcode === TerminalStreamOpcode.Restore) {
      frameKind = "output";
    }
    this.options
      .getRuntimeMetrics()
      ?.recordBinaryFrame(frameKind, rawBytes.byteLength, perfNow() - binaryStartMs);
    return true;
  }

  private handleFileTransferFrame(frame: FileTransferFrame): void {
    const outcome = this.options.fileTransfers.handleFrame(frame);
    if (!outcome) {
      return;
    }
    this.handleSessionMessage({
      type: "file_explorer_response",
      payload: {
        cwd: outcome.cwd,
        path: outcome.path,
        mode: "file",
        directory: null,
        file: null,
        error: outcome.error,
        requestId: outcome.requestId,
      },
    });
  }

  private handleSessionMessage(message: SessionOutboundMessage): void {
    if (message.type === "status") {
      const serverInfo = parseServerInfoStatusPayload(message.payload);
      if (serverInfo) {
        this.lastServerInfoMessage = serverInfo;
        if (this.options.isConnecting()) {
          this.options.markConnected();
        }
      }
    }

    if (message.type === "terminal_stream_exit") {
      this.options.onTerminalStreamExit(message.payload.terminalId);
    }

    for (const handler of this.rawMessageListeners) {
      try {
        handler(message);
      } catch {
        // Listener failures must not interrupt protocol processing.
      }
    }

    const handlers = this.messageHandlers.get(message.type);
    if (handlers) {
      for (const handler of handlers) {
        try {
          handler(message);
        } catch {
          // Listener failures must not interrupt protocol processing.
        }
      }
    }

    const event = this.toEvent(message);
    if (event) {
      for (const handler of this.eventListeners) {
        try {
          handler(event);
        } catch (error) {
          this.options.logger.warn(
            { err: error, eventType: event.type },
            "Daemon event listener failed",
          );
        }
      }
    }

    this.options.onRequestMessage(message);
  }

  private toEvent(message: SessionOutboundMessage): DaemonEvent | null {
    switch (message.type) {
      case "agent_update":
        return {
          type: "agent_update",
          agentId:
            message.payload.kind === "upsert" ? message.payload.agent.id : message.payload.agentId,
          payload: message.payload,
        };
      case "workspace_update":
        return {
          type: "workspace_update",
          workspaceId:
            message.payload.kind === "upsert" ? message.payload.workspace.id : message.payload.id,
          payload: message.payload,
        };
      case "workspace_setup_progress":
        return {
          type: "workspace_setup_progress",
          workspaceId: message.payload.workspaceId,
          payload: message.payload,
        };
      case "agent_stream":
        return {
          type: "agent_stream",
          agentId: message.payload.agentId,
          event: message.payload.event,
          timestamp: message.payload.timestamp,
          ...(typeof message.payload.seq === "number" ? { seq: message.payload.seq } : {}),
          ...(typeof message.payload.epoch === "string" ? { epoch: message.payload.epoch } : {}),
        };
      case "status":
        return { type: "status", payload: message.payload };
      case "agent_deleted":
        return { type: "agent_deleted", agentId: message.payload.agentId };
      case "agent_permission_request":
        return {
          type: "agent_permission_request",
          agentId: message.payload.agentId,
          request: message.payload.request,
        };
      case "agent_permission_resolved":
        return {
          type: "agent_permission_resolved",
          agentId: message.payload.agentId,
          requestId: message.payload.requestId,
          resolution: message.payload.resolution,
        };
      case "providers_snapshot_update":
        return {
          type: "providers_snapshot_update",
          payload: message.payload,
        };
      default:
        return null;
    }
  }
}
