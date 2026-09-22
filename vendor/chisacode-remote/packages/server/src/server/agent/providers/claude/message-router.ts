import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import type { Logger } from "pino";

import type { AgentStreamEvent, AgentTimelineItem } from "../../agent-sdk-types.js";

export type ClaudeTurnState = "idle" | "foreground" | "autonomous";

export interface ClaudeAutonomousTurnState {
  id: string;
}

export interface ClaudeEventIdentifiers {
  taskId: string | null;
  parentMessageId: string | null;
  messageId: string | null;
}

interface ClaudeMessageRouterOptions {
  logger: Logger;
  getTraceContext: () => { agentId?: string; sessionId?: string | null };
  notifySubscribers: (event: AgentStreamEvent) => void;
  flushPendingToolCalls: () => void;
  buildTurnFailedEvent: (
    errorMessage: string,
  ) => Extract<AgentStreamEvent, { type: "turn_failed" }>;
  rememberTranscriptProgress: (message: SDKMessage, messageId: string | null) => void;
  translateMessageToEvents: (
    message: SDKMessage,
    options: { suppressAssistantText: boolean; suppressReasoning: boolean },
  ) => AgentStreamEvent[];
  assembleTimelineItems: (input: {
    message: SDKMessage;
    runId: string | null;
    messageIdHint: string | null;
  }) => AgentTimelineItem[];
}

function toObjectRecord(value: unknown): Record<string, unknown> | undefined {
  return value != null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function readTrimmedString(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function firstTrimmedString(sources: readonly unknown[]): string | null {
  for (const source of sources) {
    const value = readTrimmedString(source);
    if (value) {
      return value;
    }
  }
  return null;
}

function readTranscriptUuid(message: SDKMessage): string | null {
  const root = toObjectRecord(message) ?? {};
  const messageType = readTrimmedString(root.type);
  if (messageType !== "user" && messageType !== "assistant") {
    return null;
  }
  return firstTrimmedString([root.uuid]);
}

export function readEventIdentifiers(message: SDKMessage): ClaudeEventIdentifiers {
  const root = toObjectRecord(message) ?? {};
  const messageType = readTrimmedString(root.type);
  const streamEvent = toObjectRecord(root.event);
  const streamEventMessage = toObjectRecord(streamEvent?.message);
  const messageContainer = toObjectRecord(root.message);

  const messageIdFromUuid =
    messageType === "user" || messageType === "assistant" || messageType === "system"
      ? root.uuid
      : undefined;

  return {
    taskId: firstTrimmedString([
      root.task_id,
      streamEvent?.task_id,
      streamEventMessage?.task_id,
      messageContainer?.task_id,
    ]),
    parentMessageId: firstTrimmedString([
      root.parent_message_id,
      streamEvent?.parent_message_id,
      streamEventMessage?.parent_message_id,
      messageContainer?.parent_message_id,
    ]),
    messageId: firstTrimmedString([
      root.message_id,
      streamEvent?.message_id,
      streamEventMessage?.id,
      streamEventMessage?.message_id,
      messageContainer?.id,
      messageContainer?.message_id,
      messageIdFromUuid,
    ]),
  };
}

function isTerminalTurnEvent(event: AgentStreamEvent): boolean {
  return (
    event.type === "turn_completed" ||
    event.type === "turn_failed" ||
    event.type === "turn_canceled"
  );
}

function isAbortError(message: SDKMessage): boolean {
  const errors = "errors" in message && Array.isArray(message.errors) ? message.errors : [];
  return errors.some((error: string) => /\baborted\b/i.test(error));
}

function isAssistantishMessage(message: SDKMessage): boolean {
  return (
    message.type === "assistant" ||
    message.type === "stream_event" ||
    message.type === "tool_progress" ||
    (message.type === "system" && message.subtype === "task_notification")
  );
}

/** Owns Claude foreground/autonomous turn state and SDK message routing. */
export class ClaudeMessageRouter {
  private activeForegroundTurnId: string | null = null;
  private autonomousTurn: ClaudeAutonomousTurnState | null = null;
  private turnState: ClaudeTurnState = "idle";
  private nextTurnOrdinal = 1;
  private cancelCurrentTurn: (() => void) | null = null;
  private pendingInterruptAbort = false;
  private foregroundHasVisibleActivity = false;
  private activeTurnHasAssistantText = false;

  constructor(private readonly options: ClaudeMessageRouterOptions) {}

  getActiveForegroundTurnId(): string | null {
    return this.activeForegroundTurnId;
  }

  setActiveForegroundTurnId(turnId: string | null): void {
    this.activeForegroundTurnId = turnId;
  }

  getAutonomousTurn(): ClaudeAutonomousTurnState | null {
    return this.autonomousTurn;
  }

  setAutonomousTurn(turn: ClaudeAutonomousTurnState | null): void {
    this.autonomousTurn = turn;
  }

  getTurnState(): ClaudeTurnState {
    return this.turnState;
  }

  setTurnState(turnState: ClaudeTurnState): void {
    this.turnState = turnState;
  }

  getNextTurnOrdinal(): number {
    return this.nextTurnOrdinal;
  }

  setNextTurnOrdinal(ordinal: number): void {
    this.nextTurnOrdinal = ordinal;
  }

  getCancelCurrentTurn(): (() => void) | null {
    return this.cancelCurrentTurn;
  }

  setCancelCurrentTurn(cancel: (() => void) | null): void {
    this.cancelCurrentTurn = cancel;
  }

  isPendingInterruptAbort(): boolean {
    return this.pendingInterruptAbort;
  }

  setPendingInterruptAbort(pending: boolean): void {
    this.pendingInterruptAbort = pending;
  }

  hasForegroundVisibleActivity(): boolean {
    return this.foregroundHasVisibleActivity;
  }

  setForegroundVisibleActivity(visible: boolean): void {
    this.foregroundHasVisibleActivity = visible;
  }

  hasActiveTurnAssistantText(): boolean {
    return this.activeTurnHasAssistantText;
  }

  setActiveTurnAssistantText(hasText: boolean): void {
    this.activeTurnHasAssistantText = hasText;
  }

  createTurnId(owner: "foreground" | "autonomous"): string {
    return `${owner}-turn-${this.nextTurnOrdinal++}`;
  }

  transitionTurnState(next: ClaudeTurnState, reason: string): void {
    if (this.turnState === next) {
      return;
    }
    this.options.logger.debug(
      { from: this.turnState, to: next, reason },
      "Claude turn state transition",
    );
    this.turnState = next;
  }

  syncTurnState(reason: string): void {
    if (this.activeForegroundTurnId) {
      this.transitionTurnState("foreground", reason);
      return;
    }
    if (this.autonomousTurn) {
      this.transitionTurnState("autonomous", reason);
      return;
    }
    this.transitionTurnState("idle", reason);
  }

  finishForegroundTurn(
    event: Extract<AgentStreamEvent, { type: "turn_completed" | "turn_failed" | "turn_canceled" }>,
  ): void {
    if (event.type === "turn_failed" || event.type === "turn_canceled") {
      this.options.flushPendingToolCalls();
    }
    this.options.notifySubscribers(event);
    this.activeForegroundTurnId = null;
    this.cancelCurrentTurn = null;
    this.activeTurnHasAssistantText = false;
    this.syncTurnState("foreground turn terminal");
  }

  dispatchEvents(events: AgentStreamEvent[]): void {
    let terminalSeen = false;
    for (const event of events) {
      this.options.notifySubscribers(event);
      terminalSeen ||= isTerminalTurnEvent(event);
    }

    if (terminalSeen) {
      if (this.activeForegroundTurnId) {
        this.activeForegroundTurnId = null;
        this.cancelCurrentTurn = null;
        this.activeTurnHasAssistantText = false;
        this.syncTurnState("foreground turn terminal");
      } else if (this.autonomousTurn) {
        this.autonomousTurn = null;
        this.activeTurnHasAssistantText = false;
        this.syncTurnState("autonomous turn terminal");
      }
    }
  }

  completeAutonomousTurn(): void {
    if (!this.autonomousTurn) {
      return;
    }
    this.options.notifySubscribers({ type: "turn_completed", provider: "claude" });
    this.autonomousTurn = null;
    this.activeTurnHasAssistantText = false;
    this.syncTurnState("autonomous turn completed");
  }

  failActiveTurns(errorMessage: string): void {
    const failure = this.options.buildTurnFailedEvent(errorMessage);
    this.options.flushPendingToolCalls();
    if (this.activeForegroundTurnId) {
      this.finishForegroundTurn(failure);
      return;
    }
    if (this.autonomousTurn) {
      this.dispatchEvents([failure]);
    }
  }

  routeMessage(message: SDKMessage): void {
    if (this.shouldSuppressStaleResult(message)) {
      return;
    }

    const isForeground = Boolean(this.activeForegroundTurnId);
    if (!isForeground && isAssistantishMessage(message)) {
      this.startAutonomousTurn();
    }
    if (!isForeground && !this.autonomousTurn && message.type === "result") {
      return;
    }

    const turnId = this.activeForegroundTurnId ?? this.autonomousTurn?.id ?? null;
    const identifiers = readEventIdentifiers(message);
    this.options.rememberTranscriptProgress(message, readTranscriptUuid(message));

    this.options.logger.trace(
      {
        ...this.options.getTraceContext(),
        turnId: turnId ?? undefined,
        messageType: message.type,
        identifiers,
        rawEvent: message,
      },
      "provider.claude.parsed_event",
    );

    const messageEvents = this.options.translateMessageToEvents(message, {
      suppressAssistantText: true,
      suppressReasoning: true,
    });
    const assistantTimelineEvents = this.options
      .assembleTimelineItems({
        message,
        runId: turnId,
        messageIdHint: identifiers.messageId,
      })
      .map(
        (item) =>
          ({
            type: "timeline",
            item,
            provider: "claude",
          }) satisfies AgentStreamEvent,
      );

    const events = [...messageEvents, ...assistantTimelineEvents];
    if (events.length === 0) {
      return;
    }
    if (
      this.pendingInterruptAbort &&
      message.type === "result" &&
      events.some((event) => event.type === "turn_completed" || event.type === "turn_failed") &&
      (!this.activeForegroundTurnId || !this.foregroundHasVisibleActivity)
    ) {
      this.pendingInterruptAbort = false;
      this.options.logger.debug("Suppressing stale Claude interrupt terminal result");
      return;
    }
    if (
      events.some((event) => event.type === "timeline" && event.item.type === "assistant_message")
    ) {
      this.activeTurnHasAssistantText = true;
    }
    if (
      this.activeForegroundTurnId &&
      events.some(
        (event) =>
          event.type === "timeline" ||
          event.type === "permission_requested" ||
          event.type === "permission_resolved",
      )
    ) {
      this.foregroundHasVisibleActivity = true;
    }

    this.dispatchEvents(events);
  }

  private startAutonomousTurn(): void {
    if (this.autonomousTurn) {
      return;
    }
    this.autonomousTurn = {
      id: this.createTurnId("autonomous"),
    };
    this.activeTurnHasAssistantText = false;
    this.options.notifySubscribers({ type: "turn_started", provider: "claude" });
    this.syncTurnState("autonomous turn started");
  }

  private shouldSuppressStaleResult(message: SDKMessage): boolean {
    if (message.type === "result" && this.pendingInterruptAbort) {
      this.pendingInterruptAbort = false;
      if (message.subtype !== "success") {
        this.options.logger.debug("Suppressing stale non-success result from interrupted request");
        return true;
      }
    }
    if (message.type === "result" && message.subtype !== "success" && isAbortError(message)) {
      this.options.logger.debug("Suppressing abort result by content");
      return true;
    }
    return false;
  }
}
