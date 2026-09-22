import type {
  SessionInboundMessage,
  SubscribeTerminalRequest,
  TerminalInput,
} from "@chisacode/protocol/messages";
import type { TerminalStreamFrame } from "@chisacode/protocol/binary-frames/index";

import type {
  DaemonCommandResponsePayload,
  DaemonCommandTransport,
} from "./daemon-client-command-transport.js";
import { TerminalStreamRouter, type TerminalStreamEvent } from "./terminal-stream-router.js";

export type { TerminalStreamEvent } from "./terminal-stream-router.js";

export type ListTerminalsPayload = DaemonCommandResponsePayload<"list_terminals_response">;
export type CreateTerminalPayload = DaemonCommandResponsePayload<"create_terminal_response">;
export type SubscribeTerminalPayload = DaemonCommandResponsePayload<"subscribe_terminal_response">;
export type KillTerminalPayload = DaemonCommandResponsePayload<"kill_terminal_response">;
export type CaptureTerminalPayload = DaemonCommandResponsePayload<"capture_terminal_response">;
export type RenameTerminalResult = DaemonCommandResponsePayload<"terminal.rename.response">;

export interface RenameTerminalInput {
  terminalId: string;
  title: string;
  requestId?: string;
}

interface TerminalClientTransport extends DaemonCommandTransport {
  isConnected(): boolean;
  sendMessage(message: SessionInboundMessage): void;
  sendBinaryFrame(frame: Uint8Array): void;
}

/** Owns terminal RPCs, directory subscriptions, and binary stream slot state. */
export class TerminalClient {
  private readonly directorySubscriptions = new Set<string>();
  private readonly streams = new TerminalStreamRouter();
  /** Intentional stream subscriptions restored on reconnect (not transient slots). */
  private readonly streamSubscriptionIntents = new Map<
    string,
    { restore?: SubscribeTerminalRequest["restore"]; generation: number }
  >();
  private reconnectGeneration = 0;

  constructor(private readonly transport: TerminalClientTransport) {}

  subscribeDirectories(input: { cwd: string }): void {
    this.directorySubscriptions.add(input.cwd);
    if (!this.transport.isConnected()) {
      return;
    }
    this.transport.sendMessage({
      type: "subscribe_terminals_request",
      cwd: input.cwd,
    });
  }

  unsubscribeDirectories(input: { cwd: string }): void {
    this.directorySubscriptions.delete(input.cwd);
    if (!this.transport.isConnected()) {
      return;
    }
    this.transport.sendMessage({
      type: "unsubscribe_terminals_request",
      cwd: input.cwd,
    });
  }

  resubscribeDirectories(): void {
    if (!this.transport.isConnected()) {
      return;
    }
    for (const cwd of this.directorySubscriptions) {
      this.transport.sendMessage({
        type: "subscribe_terminals_request",
        cwd,
      });
    }
  }

  /**
   * Re-subscribe intentional terminal streams after reconnect.
   * Failures are isolated per terminal and do not block directory resubscribe.
   */
  async resubscribeStreams(): Promise<void> {
    if (!this.transport.isConnected()) {
      return;
    }
    this.reconnectGeneration += 1;
    const generation = this.reconnectGeneration;
    const intents = [...this.streamSubscriptionIntents.entries()];
    for (const [terminalId, intent] of intents) {
      if (generation !== this.reconnectGeneration) {
        return;
      }
      if (!this.streamSubscriptionIntents.has(terminalId)) {
        continue;
      }
      try {
        const payload = await this.transport.request({
          message: {
            type: "subscribe_terminal_request",
            terminalId,
            ...(intent.restore ? { restore: intent.restore } : {}),
          },
          responseType: "subscribe_terminal_response",
          timeout: 10_000,
        });
        if (generation !== this.reconnectGeneration) {
          return;
        }
        if (payload.error === null) {
          this.streams.setSlot(terminalId, payload.slot);
          const current = this.streamSubscriptionIntents.get(terminalId);
          if (current) {
            current.generation = generation;
          }
        }
      } catch {
        // Isolate single-terminal restore failure.
      }
    }
  }

  listTerminals(cwd?: string, requestId?: string): Promise<ListTerminalsPayload> {
    return this.transport.request({
      requestId,
      message: {
        type: "list_terminals_request",
        ...(cwd === undefined ? {} : { cwd }),
      },
      responseType: "list_terminals_response",
      timeout: 10_000,
    });
  }

  createTerminal(
    cwd: string,
    name?: string,
    requestId?: string,
    options?: { agentId?: string; command?: string; args?: string[] },
  ): Promise<CreateTerminalPayload> {
    return this.transport.request({
      requestId,
      message: {
        type: "create_terminal_request",
        cwd,
        name,
        agentId: options?.agentId,
        command: options?.command,
        args: options?.args,
      },
      responseType: "create_terminal_response",
      timeout: 10_000,
    });
  }

  renameTerminal(input: RenameTerminalInput): Promise<RenameTerminalResult> {
    return this.transport.request({
      requestId: input.requestId,
      message: {
        type: "terminal.rename.request",
        terminalId: input.terminalId,
        title: input.title,
      },
      responseType: "terminal.rename.response",
      timeout: 10_000,
    });
  }

  async subscribeTerminal(
    terminalId: string,
    optionsOrRequestId?:
      | { restore?: SubscribeTerminalRequest["restore"]; requestId?: string }
      | string,
  ): Promise<SubscribeTerminalPayload> {
    const restore = typeof optionsOrRequestId === "object" ? optionsOrRequestId.restore : undefined;
    const requestId =
      typeof optionsOrRequestId === "object" ? optionsOrRequestId.requestId : optionsOrRequestId;
    const payload = await this.transport.request({
      requestId,
      message: {
        type: "subscribe_terminal_request",
        terminalId,
        ...(restore ? { restore } : {}),
      },
      responseType: "subscribe_terminal_response",
      timeout: 10_000,
    });
    if (payload.error === null) {
      this.streams.setSlot(terminalId, payload.slot);
      this.streamSubscriptionIntents.set(terminalId, {
        restore,
        generation: this.reconnectGeneration,
      });
    }
    return payload;
  }

  unsubscribeTerminal(terminalId: string): void {
    this.streamSubscriptionIntents.delete(terminalId);
    this.streams.removeTerminal(terminalId);
    this.transport.sendMessage({
      type: "unsubscribe_terminal_request",
      terminalId,
    });
  }

  sendInput(terminalId: string, message: TerminalInput["message"]): void {
    const frame = this.streams.encodeInput(terminalId, message);
    if (frame) {
      this.transport.sendBinaryFrame(frame);
      return;
    }
    this.transport.sendMessage({
      type: "terminal_input",
      terminalId,
      message,
    });
  }

  killTerminal(terminalId: string, requestId?: string): Promise<KillTerminalPayload> {
    return this.transport.request({
      requestId,
      message: { type: "kill_terminal_request", terminalId },
      responseType: "kill_terminal_response",
      timeout: 10_000,
    });
  }

  captureTerminal(
    terminalId: string,
    options?: { start?: number; end?: number; stripAnsi?: boolean },
    requestId?: string,
  ): Promise<CaptureTerminalPayload> {
    return this.transport.request({
      requestId,
      message: {
        type: "capture_terminal_request",
        terminalId,
        ...(options?.start === undefined ? {} : { start: options.start }),
        ...(options?.end === undefined ? {} : { end: options.end }),
        ...(options?.stripAnsi === undefined ? {} : { stripAnsi: options.stripAnsi }),
      },
      responseType: "capture_terminal_response",
      timeout: 10_000,
    });
  }

  onStreamEvent(handler: (event: TerminalStreamEvent) => void): () => void {
    return this.streams.onEvent(handler);
  }

  waitForStreamEvent(
    predicate: (event: TerminalStreamEvent) => boolean,
    timeout = 5_000,
  ): Promise<TerminalStreamEvent> {
    return new Promise<TerminalStreamEvent>((resolve, reject) => {
      const timeoutHandle = setTimeout(() => {
        unsubscribe();
        reject(new Error(`Timeout waiting for terminal stream event (${timeout}ms)`));
      }, timeout);

      const unsubscribe = this.onStreamEvent((event) => {
        if (!predicate(event)) {
          return;
        }
        clearTimeout(timeoutHandle);
        unsubscribe();
        resolve(event);
      });
    });
  }

  handleFrame(frame: TerminalStreamFrame): void {
    this.streams.handleFrame(frame);
  }

  handleStreamExit(terminalId: string): void {
    this.streamSubscriptionIntents.delete(terminalId);
    this.streams.removeTerminal(terminalId);
  }

  clearStreamSlots(): void {
    // Clear transient transport slots only; intents remain for reconnect restore.
    this.streams.clearSlots();
  }

  clearAllSubscriptions(): void {
    this.streamSubscriptionIntents.clear();
    this.streams.clearSlots();
  }
}
