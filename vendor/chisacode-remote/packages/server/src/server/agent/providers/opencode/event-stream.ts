import type { Event as OpenCodeEvent, OpencodeClient } from "@opencode-ai/sdk/v2/client";
import type { Logger } from "pino";

import { toDiagnosticErrorMessage } from "../diagnostic-utils.js";
import { toTerminalTurnEvent, type TerminalTurnEvent } from "./helpers.js";
import type { AgentStreamEvent, ToolCallTimelineItem } from "../../agent-sdk-types.js";

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (error: unknown) => void;
}

type OpenCodeEventStreamTraceMessage =
  | "provider.opencode.subscribe.start"
  | "provider.opencode.subscribe.ready"
  | "provider.opencode.stream.eof"
  | "provider.opencode.turn.fail_eof"
  | "provider.opencode.subscribe.error"
  | "provider.opencode.raw_event"
  | "provider.opencode.event.skip"
  | "provider.opencode.parsed_event"
  | "provider.opencode.parsed_event.skip_active"
  | "provider.opencode.event.terminal";

interface OpenCodeEventStreamControllerOptions {
  client: OpencodeClient;
  sessionId: string;
  getDirectory: () => string;
  getActiveTurnId: () => string | null;
  translateEvent: (event: OpenCodeEvent) => Promise<AgentStreamEvent[]>;
  trackToolCall: (item: ToolCallTimelineItem) => void;
  finishTurn: (event: TerminalTurnEvent, turnId: string) => void;
  notify: (event: AgentStreamEvent, turnId: string) => void;
  trace: (message: OpenCodeEventStreamTraceMessage, data?: Record<string, unknown>) => void;
  logger: Logger;
}

function createDeferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function toObjectRecord(value: unknown): Record<string, unknown> | null {
  return value != null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function unwrapOpenCodeGlobalEvent(event: unknown): OpenCodeEvent | null {
  const record = toObjectRecord(event);
  if (!record) {
    return null;
  }
  const payload = toObjectRecord(record.payload);
  if (typeof payload?.type === "string") {
    return payload as unknown as OpenCodeEvent;
  }
  return typeof record.type === "string" ? (record as unknown as OpenCodeEvent) : null;
}

function isOpenCodeUserMessageEvent(event: OpenCodeEvent, sessionId: string): boolean {
  return (
    event.type === "message.updated" &&
    event.properties.info.sessionID === sessionId &&
    event.properties.info.role === "user"
  );
}

function isOpenCodeTerminalEvent(event: OpenCodeEvent, sessionId: string): boolean {
  if (event.type === "session.idle" || event.type === "session.error") {
    return event.properties.sessionID === sessionId;
  }
  return (
    event.type === "session.status" &&
    event.properties.sessionID === sessionId &&
    event.properties.status.type === "idle"
  );
}

/** Owns OpenCode SSE readiness, consumption, stale-terminal suppression, and shutdown. */
export class OpenCodeEventStreamController {
  private abortController: AbortController | null = null;
  private ready: Deferred<void> | null = null;
  private suppressTerminalUntilNextUserMessage = false;

  constructor(private readonly options: OpenCodeEventStreamControllerOptions) {}

  start(): void {
    void this.ensureReady().catch((error) => {
      this.options.logger.warn(
        { err: error, sessionId: this.options.sessionId },
        "OpenCode event stream failed",
      );
    });
  }

  ensureReady(): Promise<void> {
    if (this.ready) {
      return this.ready.promise;
    }
    const abortController = new AbortController();
    const ready = createDeferred<void>();
    this.abortController = abortController;
    this.ready = ready;
    void this.consume(abortController, ready).finally(() => {
      if (this.abortController === abortController) {
        this.abortController = null;
        this.ready = null;
      }
    });
    return ready.promise;
  }

  suppressTerminalUntilUserMessage(): void {
    this.suppressTerminalUntilNextUserMessage = true;
  }

  close(): void {
    this.abortController?.abort();
    this.abortController = null;
    this.ready = null;
  }

  private async consume(abortController: AbortController, ready: Deferred<void>): Promise<void> {
    this.options.trace("provider.opencode.subscribe.start", {
      sessionId: this.options.sessionId,
      cwd: this.options.getDirectory(),
    });
    let readyResolved = false;
    try {
      const result = await this.options.client.global.event({
        signal: abortController.signal,
        sseMaxRetryAttempts: 0,
      });
      readyResolved = true;
      this.options.trace("provider.opencode.subscribe.ready", {
        sessionId: this.options.sessionId,
      });
      ready.resolve();

      let eventCount = 0;
      for await (const rawEvent of result.stream) {
        eventCount += 1;
        await this.consumeRawEvent(rawEvent, eventCount);
      }

      const activeTurnId = this.options.getActiveTurnId();
      this.options.trace("provider.opencode.stream.eof", {
        eventCount,
        aborted: abortController.signal.aborted,
        activeTurnId,
      });
      if (!abortController.signal.aborted) {
        if (!readyResolved) {
          ready.reject(new Error("OpenCode event stream ended before it became ready"));
        }
        if (activeTurnId) {
          this.options.trace("provider.opencode.turn.fail_eof", {
            turnId: activeTurnId,
            eventCount,
          });
          this.options.finishTurn(
            {
              type: "turn_failed",
              provider: "opencode",
              error: "OpenCode event stream ended before the turn reached a terminal state",
            },
            activeTurnId,
          );
        }
      }
    } catch (error) {
      const activeTurnId = this.options.getActiveTurnId();
      this.options.trace("provider.opencode.subscribe.error", {
        turnId: activeTurnId ?? undefined,
        error:
          error instanceof Error ? { name: error.name, message: error.message } : String(error),
      });
      if (!readyResolved) {
        ready.reject(error);
      }
      if (!abortController.signal.aborted && activeTurnId) {
        this.options.finishTurn(
          {
            type: "turn_failed",
            provider: "opencode",
            error: toDiagnosticErrorMessage(error),
          },
          activeTurnId,
        );
      }
    }
  }

  private async consumeRawEvent(rawEvent: unknown, eventCount: number): Promise<void> {
    const turnId = this.options.getActiveTurnId();
    const event = unwrapOpenCodeGlobalEvent(rawEvent);
    const rawRecord = toObjectRecord(rawEvent);
    this.options.trace("provider.opencode.raw_event", {
      turnId: turnId ?? undefined,
      n: eventCount,
      type: event?.type,
      rawType: rawRecord?.type,
      directory: rawRecord?.directory,
      rawEvent,
      properties: event?.properties,
    });
    if (!event) {
      return;
    }
    if (!turnId) {
      this.options.trace("provider.opencode.event.skip", {
        n: eventCount,
        reason: "no_active_turn",
        type: event.type,
      });
      return;
    }
    if (this.suppressTerminalUntilNextUserMessage) {
      if (isOpenCodeUserMessageEvent(event, this.options.sessionId)) {
        this.suppressTerminalUntilNextUserMessage = false;
      } else if (isOpenCodeTerminalEvent(event, this.options.sessionId)) {
        this.options.trace("provider.opencode.event.skip", {
          n: eventCount,
          reason: "stale_interrupt_terminal",
          type: event.type,
        });
        return;
      }
    }

    const translated = await this.options.translateEvent(event);
    this.options.trace("provider.opencode.parsed_event", {
      turnId,
      n: eventCount,
      count: translated.length,
      types: translated.map((item) => item.type),
      events: translated,
    });
    for (const translatedEvent of translated) {
      if (this.options.getActiveTurnId() !== turnId) {
        this.options.trace("provider.opencode.parsed_event.skip_active", {
          turnId,
          type: translatedEvent.type,
        });
        return;
      }
      if (translatedEvent.type === "timeline" && translatedEvent.item.type === "tool_call") {
        this.options.trackToolCall(translatedEvent.item);
      }
      const terminalEvent = toTerminalTurnEvent(translatedEvent);
      if (terminalEvent) {
        this.options.trace("provider.opencode.event.terminal", {
          turnId,
          type: terminalEvent.type,
        });
        this.options.finishTurn(terminalEvent, turnId);
        return;
      }
      this.options.notify(translatedEvent, turnId);
    }
  }
}
