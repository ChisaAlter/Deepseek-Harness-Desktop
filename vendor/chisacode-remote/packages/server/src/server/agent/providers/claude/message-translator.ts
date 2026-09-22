import type {
  SDKMessage,
  SDKResultMessage,
  SDKSystemMessage,
} from "@anthropic-ai/claude-agent-sdk";

import type { AgentStreamEvent, AgentTimelineItem, AgentUsage } from "../../agent-sdk-types.js";
import {
  mapTaskNotificationSystemRecordToToolCall,
  mapTaskNotificationUserContentToToolCall,
} from "./task-notification-tool-call.js";
import {
  isClaudeTranscriptNoiseText,
  isSyntheticUserEntry,
  readCompactionMetadata,
} from "./history-converter.js";
import {
  extractContextWindowSize,
  readContextWindowUsedTokensFromTaskProgress,
  readStreamRequestInputTokens,
  readStreamRequestOutputTokens,
  readUsageFromTaskNotification,
} from "./sdk-types-mapping.js";

interface ClaudeSessionCapture {
  threadStartedSessionId: string | null;
  notice: AgentTimelineItem | null;
}

interface ClaudeMessageTranslatorOptions {
  getSessionId: () => string | null;
  captureSessionIdFromMessage: (message: SDKMessage) => ClaudeSessionCapture;
  handleSystemInit: (message: SDKSystemMessage) => ClaudeSessionCapture;
  handleSidechainMessage: (message: SDKMessage, parentToolUseId: string) => AgentStreamEvent[];
  mapBlocksToTimeline: (
    content: string | ReadonlyArray<unknown>,
    options?: {
      textMessageType?: "assistant_message" | "user_message";
      suppressAssistantText?: boolean;
      suppressReasoning?: boolean;
    },
  ) => AgentTimelineItem[];
  mapPartialEvent: (
    event: Extract<SDKMessage, { type: "stream_event" }>["event"],
    options?: { suppressAssistantText?: boolean; suppressReasoning?: boolean },
  ) => AgentTimelineItem[];
  getToolName: (toolUseId: string) => string | null;
  rememberUserMessageId: (messageId: string | undefined) => void;
  hasActiveTurnAssistantText: () => boolean;
  buildTurnFailedEvent: (
    errorMessage: string,
  ) => Extract<AgentStreamEvent, { type: "turn_failed" }>;
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

/** Owns Claude SDK message-to-event translation, user dedupe, and usage accumulation. */
export class ClaudeMessageTranslator {
  private compacting = false;
  private lastContextWindowUsedTokens: number | undefined;
  private lastContextWindowMaxTokens: number | undefined;
  private lastStreamRequestInputTokens: number | undefined;
  private lastStreamRequestOutputTokens: number | undefined;
  private readonly emittedUserMessageIds = new Set<string>();

  constructor(private readonly options: ClaudeMessageTranslatorOptions) {}

  translate(
    message: SDKMessage,
    options?: { suppressAssistantText?: boolean; suppressReasoning?: boolean },
  ): AgentStreamEvent[] {
    const parentToolUseId =
      "parent_tool_use_id" in message
        ? (message as { parent_tool_use_id: string | null }).parent_tool_use_id
        : null;
    if (parentToolUseId) {
      return this.options.handleSidechainMessage(message, parentToolUseId);
    }

    const events: AgentStreamEvent[] = [];
    if (message.type !== "system") {
      this.appendSessionCapture(this.options.captureSessionIdFromMessage(message), events);
    }
    switch (message.type) {
      case "system":
        this.appendSystemMessageEvents(message, events);
        break;
      case "user":
        this.appendUserMessageEvents(message, events);
        break;
      case "assistant": {
        const timelineItems = this.options.mapBlocksToTimeline(message.message.content, {
          suppressAssistantText: options?.suppressAssistantText ?? false,
          suppressReasoning: options?.suppressReasoning ?? false,
        });
        this.appendTimelineItems(timelineItems, events);
        break;
      }
      case "stream_event":
        this.appendStreamEventEvents(message, events, options);
        break;
      case "result":
        this.appendResultEvents(message, events);
        break;
      default:
        break;
    }
    return events;
  }

  translateUserMessage(message: Extract<SDKMessage, { type: "user" }>): AgentStreamEvent[] {
    const events: AgentStreamEvent[] = [];
    this.appendUserMessageEvents(message, events);
    return events;
  }

  resetUserMessageState(): void {
    this.emittedUserMessageIds.clear();
  }

  readMissingResumedConversationError(message: SDKMessage): string | null {
    if (message.type !== "result" || message.subtype !== "error_during_execution") {
      return null;
    }
    const sessionId = this.options.getSessionId();
    if (!sessionId) {
      return null;
    }
    const errors = "errors" in message && Array.isArray(message.errors) ? message.errors : [];
    for (const entry of errors) {
      if (typeof entry !== "string") {
        continue;
      }
      const match = entry.match(/^No conversation found with session ID:\s*(.+)$/);
      if (match?.[1]?.trim() === sessionId) {
        return entry.trim();
      }
    }
    return null;
  }

  convertUsage(message: SDKResultMessage, modelUsage?: unknown): AgentUsage | undefined {
    if (!message.usage) {
      return undefined;
    }
    const usage: AgentUsage = {
      inputTokens: message.usage.input_tokens,
      cachedInputTokens: message.usage.cache_read_input_tokens,
      outputTokens: message.usage.output_tokens,
      totalCostUsd: message.total_cost_usd,
    };
    const contextWindowMaxTokens = extractContextWindowSize(modelUsage ?? message.modelUsage);
    if (contextWindowMaxTokens !== undefined) {
      this.lastContextWindowMaxTokens = contextWindowMaxTokens;
      usage.contextWindowMaxTokens = contextWindowMaxTokens;
    } else if (this.lastContextWindowMaxTokens !== undefined) {
      usage.contextWindowMaxTokens = this.lastContextWindowMaxTokens;
    }
    if (typeof this.lastContextWindowUsedTokens === "number") {
      usage.contextWindowUsedTokens = this.lastContextWindowUsedTokens;
    } else if (
      typeof this.lastStreamRequestInputTokens === "number" &&
      typeof this.lastStreamRequestOutputTokens === "number"
    ) {
      usage.contextWindowUsedTokens =
        this.lastStreamRequestInputTokens + this.lastStreamRequestOutputTokens;
    } else {
      const usageWithCacheCreation = message.usage as typeof message.usage & {
        cache_creation_input_tokens?: number;
      };
      const derived =
        (message.usage.input_tokens ?? 0) +
        (usageWithCacheCreation.cache_creation_input_tokens ?? 0) +
        (message.usage.cache_read_input_tokens ?? 0) +
        (message.usage.output_tokens ?? 0);
      if (Number.isFinite(derived) && derived > 0) {
        usage.contextWindowUsedTokens = derived;
      }
    }
    return usage;
  }

  private appendSessionCapture(capture: ClaudeSessionCapture, events: AgentStreamEvent[]): void {
    if (capture.notice) {
      events.push({ type: "timeline", provider: "claude", item: capture.notice });
    }
    if (capture.threadStartedSessionId) {
      events.push({
        type: "thread_started",
        provider: "claude",
        sessionId: capture.threadStartedSessionId,
      });
    }
  }

  private appendSystemMessageEvents(
    message: Extract<SDKMessage, { type: "system" }>,
    events: AgentStreamEvent[],
  ): void {
    if (message.subtype === "init") {
      this.appendSessionCapture(this.options.handleSystemInit(message), events);
      return;
    }
    if (message.subtype === "status") {
      const status = toObjectRecord(message)?.status;
      if (status === "compacting") {
        this.compacting = true;
        events.push({
          type: "timeline",
          item: { type: "compaction", status: "loading" },
          provider: "claude",
        });
      }
      return;
    }
    if (message.subtype === "compact_boundary") {
      const compactMetadata = readCompactionMetadata(message);
      events.push({
        type: "timeline",
        item: {
          type: "compaction",
          status: "completed",
          trigger: compactMetadata?.trigger === "manual" ? "manual" : "auto",
          preTokens: compactMetadata?.preTokens,
        },
        provider: "claude",
      });
      return;
    }
    if (message.subtype === "task_notification") {
      this.appendTaskNotificationEvents(message, events);
      return;
    }
    if (message.subtype === "task_progress") {
      this.lastContextWindowUsedTokens =
        readContextWindowUsedTokensFromTaskProgress(message) ?? this.lastContextWindowUsedTokens;
      if (typeof this.lastContextWindowUsedTokens === "number") {
        events.push(this.createUsageUpdatedEvent(this.lastContextWindowUsedTokens));
      }
    }
  }

  private appendTaskNotificationEvents(
    message: Extract<SDKMessage, { type: "system"; subtype: "task_notification" }>,
    events: AgentStreamEvent[],
  ): void {
    const taskUseId = message.tool_use_id;
    const cachedToolName = taskUseId ? this.options.getToolName(taskUseId) : null;
    if (cachedToolName === "Task") {
      return;
    }
    const taskNotificationItem = mapTaskNotificationSystemRecordToToolCall(message);
    if (taskNotificationItem) {
      events.push({ type: "timeline", item: taskNotificationItem, provider: "claude" });
    }
    const usage = readUsageFromTaskNotification(message);
    if (typeof usage === "number") {
      this.lastContextWindowUsedTokens = usage;
      events.push(this.createUsageUpdatedEvent(usage));
    }
  }

  private appendUserMessageEvents(
    message: Extract<SDKMessage, { type: "user" }>,
    events: AgentStreamEvent[],
  ): void {
    if (isSyntheticUserEntry(message)) {
      return;
    }
    if (this.compacting) {
      this.compacting = false;
      return;
    }
    const messageId =
      typeof message.uuid === "string" && message.uuid.length > 0 ? message.uuid : undefined;
    if (messageId && this.emittedUserMessageIds.has(messageId)) {
      return;
    }
    this.options.rememberUserMessageId(messageId);
    if (messageId) {
      this.emittedUserMessageIds.add(messageId);
    }
    const content = message.message?.content;
    const taskNotificationItem = mapTaskNotificationUserContentToToolCall({ content, messageId });
    if (taskNotificationItem) {
      events.push({ type: "timeline", item: taskNotificationItem, provider: "claude" });
      return;
    }
    if (typeof content === "string" && content.length > 0) {
      if (!isClaudeTranscriptNoiseText(content)) {
        events.push({
          type: "timeline",
          item: {
            type: "user_message",
            text: content,
            ...(messageId ? { messageId } : {}),
          },
          provider: "claude",
        });
      }
      return;
    }
    if (Array.isArray(content)) {
      const timelineItems = this.options.mapBlocksToTimeline(content, {
        textMessageType: "user_message",
      });
      for (const item of timelineItems) {
        if (item.type === "user_message" && messageId && !item.messageId) {
          events.push({
            type: "timeline",
            item: { ...item, messageId },
            provider: "claude",
          });
        } else {
          events.push({ type: "timeline", item, provider: "claude" });
        }
      }
    }
  }

  private appendStreamEventEvents(
    message: Extract<SDKMessage, { type: "stream_event" }>,
    events: AgentStreamEvent[],
    options: { suppressAssistantText?: boolean; suppressReasoning?: boolean } | undefined,
  ): void {
    const usageUpdatedEvent = this.trackStreamEventUsage(message.event);
    if (usageUpdatedEvent) {
      events.push(usageUpdatedEvent);
    }
    const timelineItems = this.options.mapPartialEvent(message.event, {
      suppressAssistantText: options?.suppressAssistantText ?? false,
      suppressReasoning: options?.suppressReasoning ?? false,
    });
    this.appendTimelineItems(timelineItems, events);
  }

  private appendResultEvents(
    message: Extract<SDKMessage, { type: "result" }>,
    events: AgentStreamEvent[],
  ): void {
    const usage = this.convertUsage(message, message.modelUsage);
    if (message.subtype === "success") {
      const resultText = typeof message.result === "string" ? message.result.trim() : "";
      const outputTokens = message.usage?.output_tokens;
      if (
        resultText.length > 0 &&
        outputTokens === 0 &&
        !this.options.hasActiveTurnAssistantText()
      ) {
        events.push({
          type: "timeline",
          provider: "claude",
          item: {
            type: "assistant_message",
            text: resultText,
            messageId: message.uuid,
          },
        });
      }
      events.push({ type: "turn_completed", provider: "claude", usage });
      return;
    }
    const errorMessage =
      "errors" in message && Array.isArray(message.errors) && message.errors.length > 0
        ? message.errors.join("\n")
        : "Claude run failed";
    events.push(this.options.buildTurnFailedEvent(errorMessage));
  }

  private appendTimelineItems(items: AgentTimelineItem[], events: AgentStreamEvent[]): void {
    for (const item of items) {
      events.push({ type: "timeline", item, provider: "claude" });
    }
  }

  private createUsageUpdatedEvent(contextWindowUsedTokens: number): AgentStreamEvent {
    const usage: AgentUsage = { contextWindowUsedTokens };
    if (this.lastContextWindowMaxTokens !== undefined) {
      usage.contextWindowMaxTokens = this.lastContextWindowMaxTokens;
    }
    return { type: "usage_updated", provider: "claude", usage };
  }

  private trackStreamEventUsage(event: unknown): AgentStreamEvent | null {
    const streamEvent = toObjectRecord(event);
    if (!streamEvent) {
      return null;
    }
    const eventType = readTrimmedString(streamEvent.type);
    if (eventType === "message_start") {
      const inputTokens = readStreamRequestInputTokens(streamEvent);
      if (typeof inputTokens !== "number") {
        return null;
      }
      this.lastStreamRequestInputTokens = inputTokens;
      this.lastStreamRequestOutputTokens = 0;
    } else if (eventType === "message_delta") {
      const outputTokens = readStreamRequestOutputTokens(streamEvent);
      if (typeof outputTokens !== "number") {
        return null;
      }
      this.lastStreamRequestOutputTokens = outputTokens;
    } else {
      return null;
    }
    if (
      typeof this.lastStreamRequestInputTokens !== "number" ||
      typeof this.lastStreamRequestOutputTokens !== "number"
    ) {
      return null;
    }
    return this.createUsageUpdatedEvent(
      this.lastStreamRequestInputTokens + this.lastStreamRequestOutputTokens,
    );
  }
}
