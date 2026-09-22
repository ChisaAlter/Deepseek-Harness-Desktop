import type { AgentTimelineItem, ToolCallTimelineItem } from "../../agent-sdk-types.js";
import { CodexContextCompactionState } from "./context-compaction-state.js";
import { normalizeCodexThreadItemType, threadItemToTimeline } from "./history.js";
import { CodexNotificationStreamState } from "./notification-stream-state.js";
import type { ParsedCodexNotification } from "./notifications.js";
import { CodexSubAgentTracker } from "./sub-agent-tracker.js";
import { CodexUserMessageTurnState } from "./user-message-turn-state.js";

interface CodexItemNotificationHandlerOptions {
  notificationStream: CodexNotificationStreamState;
  compactionState: CodexContextCompactionState;
  subAgentTracker: CodexSubAgentTracker;
  userMessageTurns: CodexUserMessageTurnState;
  getCwd: () => string | null;
  resolveSubAgentCallId: (threadId: string | null) => string | null;
  emitSubAgentActivity: (callId: string, status: ToolCallTimelineItem["status"]) => void;
  rememberTextualToolCallFailure: (text: string) => void;
  rememberPlanResult: (item: ToolCallTimelineItem) => void;
  isPlanModeEnabled: () => boolean;
  markAssistantMessageBoundary: () => void;
  warnOnIncompleteEdit: (item: ToolCallTimelineItem, source: string, payload: unknown) => void;
  emit: (item: AgentTimelineItem) => void;
}

export class CodexItemNotificationHandler {
  constructor(private readonly options: CodexItemNotificationHandlerOptions) {}

  handleCompleted(parsed: Extract<ParsedCodexNotification, { kind: "item_completed" }>): void {
    if (parsed.source === "codex_event") {
      return;
    }
    if (this.isUserMessageItem(parsed.item)) {
      this.handleUserMessageItem(parsed);
      return;
    }
    if (this.options.compactionState.isCompactionItem(parsed.item)) {
      if (!this.options.compactionState.shouldEmitItemCompletion()) {
        return;
      }
      this.options.emit(
        this.options.compactionState.createTimelineItem("completed", parsed.item.id),
      );
      return;
    }
    const timelineItem = threadItemToTimeline(parsed.item, {
      includeUserMessage: false,
      cwd: this.options.getCwd(),
    });
    if (!timelineItem) {
      return;
    }
    const childSubAgentCallId = this.options.resolveSubAgentCallId(parsed.threadId);
    if (childSubAgentCallId) {
      this.handleSubAgentChildItemCompleted(childSubAgentCallId, parsed.item.id, timelineItem);
      return;
    }
    const normalizedItemType = normalizeCodexThreadItemType(
      typeof parsed.item.type === "string" ? parsed.item.type : undefined,
    );
    const itemId = parsed.item.id;
    if (this.shouldSkipCompletedThreadItem(timelineItem, normalizedItemType, itemId)) {
      return;
    }
    if (this.consumeStreamedTextCompletion(timelineItem, itemId)) {
      if (timelineItem.type === "assistant_message") {
        this.options.markAssistantMessageBoundary();
      }
      if (itemId) {
        this.options.notificationStream.markItemCompleted(itemId);
        this.options.notificationStream.clearItemStarted(itemId);
      }
      return;
    }
    this.applyBufferedDeltaTextToTimelineItem(timelineItem, itemId);
    if (timelineItem.type === "tool_call") {
      this.options.subAgentTracker.registerToolCall(timelineItem, parsed.item);
      if (timelineItem.detail.type === "plan") {
        this.options.rememberPlanResult(timelineItem);
        if (this.options.isPlanModeEnabled()) {
          return;
        }
      }
      this.options.warnOnIncompleteEdit(timelineItem, "item_completed", parsed.item);
    }
    this.options.emit(timelineItem);
    if (timelineItem.type === "assistant_message") {
      this.options.markAssistantMessageBoundary();
    }
    if (itemId) {
      this.options.notificationStream.markItemCompleted(itemId);
      this.options.notificationStream.clearItemStarted(itemId);
      this.options.notificationStream.clearCommandOutput(itemId);
      this.options.notificationStream.clearFileChangeOutput(itemId);
    }
  }

  handleStarted(parsed: Extract<ParsedCodexNotification, { kind: "item_started" }>): void {
    if (parsed.source === "codex_event") {
      return;
    }
    if (this.isUserMessageItem(parsed.item)) {
      this.handleUserMessageItem(parsed);
      return;
    }
    if (this.options.compactionState.isCompactionItem(parsed.item)) {
      this.options.emit(this.options.compactionState.createTimelineItem("loading", parsed.item.id));
      return;
    }
    const timelineItem = threadItemToTimeline(parsed.item, {
      includeUserMessage: false,
      cwd: this.options.getCwd(),
    });
    if (!timelineItem || timelineItem.type !== "tool_call") {
      return;
    }
    const childSubAgentCallId = this.options.resolveSubAgentCallId(parsed.threadId);
    if (childSubAgentCallId) {
      if (parsed.item.id) {
        this.options.subAgentTracker.upsertChildItem(
          childSubAgentCallId,
          parsed.item.id,
          timelineItem,
        );
      }
      this.options.emitSubAgentActivity(childSubAgentCallId, "running");
      return;
    }
    const normalizedItemType = normalizeCodexThreadItemType(
      typeof parsed.item.type === "string" ? parsed.item.type : undefined,
    );
    const itemId = parsed.item.id;
    if (normalizedItemType === "commandExecution") {
      const callId = timelineItem.callId || itemId;
      if (callId && this.options.notificationStream.hasExecCommandStarted(callId)) {
        return;
      }
    }
    if (itemId && this.options.notificationStream.hasItemStarted(itemId)) {
      return;
    }
    this.options.warnOnIncompleteEdit(timelineItem, "item_started", parsed.item);
    this.options.subAgentTracker.registerToolCall(timelineItem, parsed.item);
    this.options.emit(timelineItem);
    if (itemId) {
      this.options.notificationStream.markItemStarted(itemId);
      this.options.notificationStream.clearCommandOutput(itemId);
      this.options.notificationStream.clearFileChangeOutput(itemId);
    }
  }

  private isUserMessageItem(item: { type?: string; [key: string]: unknown }): boolean {
    return (
      normalizeCodexThreadItemType(typeof item.type === "string" ? item.type : undefined) ===
      "userMessage"
    );
  }

  private handleSubAgentChildItemCompleted(
    callId: string,
    itemId: string | undefined,
    timelineItem: AgentTimelineItem,
  ): void {
    this.applyBufferedDeltaTextToTimelineItem(timelineItem, itemId);
    if (itemId) {
      this.options.subAgentTracker.upsertChildItem(callId, itemId, timelineItem);
      this.options.notificationStream.clearItem(itemId);
    }
    this.options.emitSubAgentActivity(callId, "running");
  }

  private shouldSkipCompletedThreadItem(
    timelineItem: AgentTimelineItem,
    normalizedItemType: string | undefined,
    itemId: string | undefined,
  ): boolean {
    if (timelineItem.type === "tool_call" && normalizedItemType === "commandExecution") {
      const callId = timelineItem.callId || itemId;
      return Boolean(callId && this.options.notificationStream.hasExecCommandCompleted(callId));
    }
    return Boolean(itemId && this.options.notificationStream.hasItemCompleted(itemId));
  }

  private consumeStreamedTextCompletion(
    timelineItem: AgentTimelineItem,
    itemId: string | null | undefined,
  ): boolean {
    if (!itemId) {
      return false;
    }
    if (timelineItem.type === "assistant_message") {
      const streamedText = this.options.notificationStream.consumeAssistantText(itemId);
      if (streamedText !== null) {
        this.options.rememberTextualToolCallFailure(timelineItem.text);
        this.emitMissingFinalTextSuffix(timelineItem, streamedText);
        return true;
      }
    }
    if (timelineItem.type === "reasoning") {
      const streamedText = this.options.notificationStream.consumeReasoningText(itemId);
      if (streamedText !== null) {
        this.emitMissingFinalTextSuffix(timelineItem, streamedText);
        return true;
      }
    }
    return false;
  }

  private emitMissingFinalTextSuffix(
    timelineItem: Extract<AgentTimelineItem, { type: "assistant_message" | "reasoning" }>,
    streamedText: string,
  ): void {
    if (!timelineItem.text.startsWith(streamedText)) {
      this.options.emit(timelineItem);
      return;
    }
    const suffix = timelineItem.text.slice(streamedText.length);
    if (!suffix) {
      return;
    }
    this.options.emit(
      timelineItem.type === "assistant_message"
        ? {
            type: timelineItem.type,
            text: suffix,
            ...(timelineItem.messageId ? { messageId: timelineItem.messageId } : {}),
          }
        : { type: timelineItem.type, text: suffix },
    );
  }

  private applyBufferedDeltaTextToTimelineItem(
    timelineItem: AgentTimelineItem,
    itemId: string | null | undefined,
  ): void {
    if (!itemId) {
      return;
    }
    if (timelineItem.type === "assistant_message") {
      const buffered = this.options.notificationStream.peekAssistantText(itemId);
      if (buffered && buffered.length > 0) {
        timelineItem.text = buffered;
      }
      this.options.rememberTextualToolCallFailure(timelineItem.text);
      return;
    }
    if (timelineItem.type === "reasoning") {
      const buffered = this.options.notificationStream.peekReasoningText(itemId);
      if (buffered && buffered.length > 0) {
        timelineItem.text = buffered;
      }
    }
  }

  private handleUserMessageItem(
    parsed: Extract<ParsedCodexNotification, { kind: "item_started" | "item_completed" }>,
  ): void {
    const itemId = parsed.item.id;
    const timelineItem = threadItemToTimeline(parsed.item, {
      includeUserMessage: true,
      cwd: this.options.getCwd(),
    });
    if (!timelineItem || timelineItem.type !== "user_message") {
      return;
    }
    const childSubAgentCallId = this.options.resolveSubAgentCallId(parsed.threadId);
    if (childSubAgentCallId) {
      if (itemId) {
        this.options.subAgentTracker.upsertChildItem(childSubAgentCallId, itemId, timelineItem);
      }
      this.options.emitSubAgentActivity(childSubAgentCallId, "running");
      return;
    }
    if (!this.options.userMessageTurns.remember(timelineItem.messageId)) {
      return;
    }
    this.options.emit(timelineItem);
  }
}
