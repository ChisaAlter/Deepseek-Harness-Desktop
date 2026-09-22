import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";

import type { AgentTimelineItem } from "../../agent-sdk-types.js";
import { formatClaudeUserFacingErrorText } from "./user-facing-error-text.js";

interface TimelineFragment {
  kind: "assistant" | "reasoning";
  text: string;
}

interface TimelineMessageState {
  id: string;
  assistantText: string;
  reasoningText: string;
  emittedAssistantLength: number;
  emittedReasoningLength: number;
  stopped: boolean;
}

interface ClaudeTimelineAssemblerOptions {
  shouldSuppressAssistantText: (text: string) => boolean;
}

interface TimelineContentChunk {
  type: string;
  text?: unknown;
  thinking?: unknown;
}

function toObjectRecord(value: unknown): Record<string, unknown> | undefined {
  return value != null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function readTrimmedString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function isTimelineContentChunk(value: unknown): value is TimelineContentChunk {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { type?: unknown }).type === "string"
  );
}

/** Assembles Claude assistant and reasoning deltas into deduplicated timeline items. */
export class ClaudeTimelineAssembler {
  private readonly messages = new Map<string, TimelineMessageState>();
  private readonly finalizedMessageIds = new Set<string>();
  private readonly activeMessageByRun = new Map<string, string>();
  private syntheticMessageCounter = 0;

  constructor(private readonly options: ClaudeTimelineAssemblerOptions) {}

  consume(input: {
    message: SDKMessage;
    runId: string | null;
    messageIdHint?: string | null;
  }): AgentTimelineItem[] {
    if (input.message.type === "assistant") {
      return this.consumeAssistantMessage(input.message, input.runId, input.messageIdHint ?? null);
    }
    if (input.message.type === "stream_event") {
      return this.consumeStreamEvent(input.message, input.runId, input.messageIdHint ?? null);
    }
    return [];
  }

  private consumeAssistantMessage(
    message: SDKMessage & { type: "assistant" },
    runId: string | null,
    messageIdHint: string | null,
  ): AgentTimelineItem[] {
    const messageId =
      this.readMessageIdFromAssistantMessage(message) ??
      messageIdHint ??
      this.resolveMessageId({ runId, createIfMissing: true, messageId: null });
    if (!messageId) {
      return [];
    }
    if (this.finalizedMessageIds.has(messageId)) {
      return [];
    }
    const state = this.ensureMessageState(messageId, runId);
    const fragments = this.extractFragments(message.message?.content);
    return this.applyAbsoluteFragments(state, fragments);
  }

  private consumeStreamEvent(
    message: SDKMessage & { type: "stream_event" },
    runId: string | null,
    messageIdHint: string | null,
  ): AgentTimelineItem[] {
    const event = toObjectRecord(message.event) ?? {};
    const eventType = readTrimmedString(event.type);
    const streamEventMessageId = this.readMessageIdFromStreamEvent(event) ?? messageIdHint;

    if (eventType === "message_start") {
      const messageId = this.resolveMessageId({
        runId,
        createIfMissing: true,
        messageId: streamEventMessageId,
      });
      if (!messageId) {
        return [];
      }
      this.ensureMessageState(messageId, runId);
      return [];
    }

    if (eventType === "message_stop") {
      const messageId = this.resolveMessageId({
        runId,
        createIfMissing: false,
        messageId: streamEventMessageId,
      });
      if (!messageId) {
        return [];
      }
      return this.finalizeMessage(messageId, runId);
    }

    if (eventType === "content_block_start") {
      return this.consumeDeltaContent(event.content_block, runId, streamEventMessageId);
    }

    if (eventType === "content_block_delta") {
      return this.consumeDeltaContent(event.delta, runId, streamEventMessageId);
    }

    return [];
  }

  private consumeDeltaContent(
    content: unknown,
    runId: string | null,
    messageIdHint: string | null,
  ): AgentTimelineItem[] {
    const fragments = this.extractFragments(content);
    if (fragments.length === 0) {
      return [];
    }
    const messageId = this.resolveMessageId({
      runId,
      createIfMissing: true,
      messageId: messageIdHint,
    });
    if (!messageId) {
      return [];
    }
    const state = this.ensureMessageState(messageId, runId);
    return this.appendFragments(state, fragments);
  }

  private appendFragments(
    state: TimelineMessageState,
    fragments: TimelineFragment[],
  ): AgentTimelineItem[] {
    for (const fragment of fragments) {
      if (fragment.kind === "assistant") {
        state.assistantText += fragment.text;
      } else {
        state.reasoningText += fragment.text;
      }
    }
    return this.emitNewContent(state);
  }

  private applyAbsoluteFragments(
    state: TimelineMessageState,
    fragments: TimelineFragment[],
  ): AgentTimelineItem[] {
    const assistantText = fragments
      .filter((fragment) => fragment.kind === "assistant")
      .map((fragment) => fragment.text)
      .join("");
    const reasoningText = fragments
      .filter((fragment) => fragment.kind === "reasoning")
      .map((fragment) => fragment.text)
      .join("");

    if (assistantText.length > 0) {
      if (!assistantText.startsWith(state.assistantText)) {
        state.emittedAssistantLength = 0;
      }
      state.assistantText = assistantText;
    }
    if (reasoningText.length > 0) {
      if (!reasoningText.startsWith(state.reasoningText)) {
        state.emittedReasoningLength = 0;
      }
      state.reasoningText = reasoningText;
    }
    return this.emitNewContent(state);
  }

  private finalizeMessage(messageId: string, runId: string | null): AgentTimelineItem[] {
    const state = this.messages.get(messageId);
    if (!state) {
      return [];
    }
    state.stopped = true;
    const items = this.emitNewContent(state);
    if (runId && this.activeMessageByRun.get(runId) === messageId) {
      this.activeMessageByRun.delete(runId);
    }
    this.finalizedMessageIds.add(messageId);
    this.messages.delete(messageId);
    return items;
  }

  private emitNewContent(state: TimelineMessageState): AgentTimelineItem[] {
    const items: AgentTimelineItem[] = [];
    const nextAssistantText = state.assistantText.slice(state.emittedAssistantLength);
    if (
      nextAssistantText.length > 0 &&
      !this.options.shouldSuppressAssistantText(nextAssistantText)
    ) {
      state.emittedAssistantLength = state.assistantText.length;
      items.push({ type: "assistant_message", text: nextAssistantText, messageId: state.id });
    }

    const nextReasoningText = state.reasoningText.slice(state.emittedReasoningLength);
    if (nextReasoningText.length > 0) {
      state.emittedReasoningLength = state.reasoningText.length;
      items.push({ type: "reasoning", text: nextReasoningText });
    }
    return items;
  }

  private ensureMessageState(messageId: string, runId: string | null): TimelineMessageState {
    const existing = this.messages.get(messageId);
    if (existing) {
      existing.stopped = false;
      if (runId) {
        this.activeMessageByRun.set(runId, messageId);
      }
      return existing;
    }
    const created: TimelineMessageState = {
      id: messageId,
      assistantText: "",
      reasoningText: "",
      emittedAssistantLength: 0,
      emittedReasoningLength: 0,
      stopped: false,
    };
    this.messages.set(messageId, created);
    if (runId) {
      this.activeMessageByRun.set(runId, messageId);
    }
    return created;
  }

  private resolveMessageId(input: {
    runId: string | null;
    createIfMissing: boolean;
    messageId: string | null;
  }): string | null {
    if (input.messageId) {
      return input.messageId;
    }
    if (input.runId) {
      const active = this.activeMessageByRun.get(input.runId);
      if (active) {
        return active;
      }
    }
    if (!input.createIfMissing) {
      return null;
    }
    const synthetic = `synthetic-message-${++this.syntheticMessageCounter}`;
    if (input.runId) {
      this.activeMessageByRun.set(input.runId, synthetic);
    }
    return synthetic;
  }

  private extractFragments(content: unknown): TimelineFragment[] {
    if (typeof content === "string") {
      if (content.length === 0) {
        return [];
      }
      return [{ kind: "assistant", text: formatClaudeUserFacingErrorText(content) }];
    }
    const blocks = Array.isArray(content) ? content : [content];
    const fragments: TimelineFragment[] = [];
    for (const rawBlock of blocks) {
      if (!isTimelineContentChunk(rawBlock)) {
        continue;
      }
      if (
        (rawBlock.type === "text" || rawBlock.type === "text_delta") &&
        typeof rawBlock.text === "string" &&
        rawBlock.text.length > 0
      ) {
        fragments.push({
          kind: "assistant",
          text: formatClaudeUserFacingErrorText(rawBlock.text),
        });
      }
      if (
        (rawBlock.type === "thinking" || rawBlock.type === "thinking_delta") &&
        typeof rawBlock.thinking === "string" &&
        rawBlock.thinking.length > 0
      ) {
        fragments.push({ kind: "reasoning", text: rawBlock.thinking });
      }
    }
    return fragments;
  }

  private readMessageIdFromAssistantMessage(
    message: SDKMessage & { type: "assistant" },
  ): string | null {
    const candidate = toObjectRecord(message);
    const messageContainer = toObjectRecord(candidate?.message);
    return (
      readTrimmedString(candidate?.message_id) ?? readTrimmedString(messageContainer?.id) ?? null
    );
  }

  private readMessageIdFromStreamEvent(event: Record<string, unknown>): string | null {
    const messageContainer = toObjectRecord(event.message);
    return readTrimmedString(event.message_id) ?? readTrimmedString(messageContainer?.id) ?? null;
  }
}
