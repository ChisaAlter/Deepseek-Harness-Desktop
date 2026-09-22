import {
  mapTaskNotificationSystemRecordToToolCall,
  mapTaskNotificationUserContentToToolCall,
} from "./task-notification-tool-call.js";
import type { AgentTimelineItem } from "../../agent-sdk-types.js";

const INTERRUPT_PLACEHOLDER_PATTERN = /^\[Request interrupted by user(?:[^\]]*)\]$/;
const NO_RESPONSE_REQUESTED_PLACEHOLDER = "No response requested.";
const LOCAL_COMMAND_STDOUT_PATTERN =
  /^\s*<local-command-stdout>[\s\S]*<\/local-command-stdout>\s*$/;

interface ClaudeHistoryContentChunk {
  type: string;
  [key: string]: unknown;
}

export interface ClaudeHistoryEntry {
  type?: unknown;
  subtype?: unknown;
  isCompactSummary?: unknown;
  isSidechain?: unknown;
  uuid?: unknown;
  message?: { content?: unknown; [key: string]: unknown };
  [key: string]: unknown;
}

function toObjectRecord(value: unknown): Record<string, unknown> | undefined {
  return value != null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function normalizeClaudeTranscriptText(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

function isClaudeInterruptPlaceholderText(value: unknown): boolean {
  const normalized = normalizeClaudeTranscriptText(value);
  return normalized !== null && INTERRUPT_PLACEHOLDER_PATTERN.test(normalized);
}

function isClaudeNoResponsePlaceholderText(value: unknown): boolean {
  return normalizeClaudeTranscriptText(value) === NO_RESPONSE_REQUESTED_PLACEHOLDER;
}

function isClaudeLocalCommandStdout(value: unknown): boolean {
  const normalized = normalizeClaudeTranscriptText(value);
  return normalized !== null && LOCAL_COMMAND_STDOUT_PATTERN.test(normalized);
}

export function isClaudeTranscriptNoiseText(value: unknown): boolean {
  return (
    isClaudeInterruptPlaceholderText(value) ||
    isClaudeNoResponsePlaceholderText(value) ||
    isClaudeLocalCommandStdout(value)
  );
}

function collectClaudeTextContentParts(content: unknown): string[] {
  if (typeof content === "string") {
    const normalized = normalizeClaudeTranscriptText(content);
    return normalized ? [normalized] : [];
  }
  if (!Array.isArray(content)) {
    return [];
  }

  const parts: string[] = [];
  for (const block of content) {
    const blockRecord = toObjectRecord(block);
    if (!blockRecord) {
      continue;
    }
    const text = normalizeClaudeTranscriptText(blockRecord.text);
    if (text) {
      parts.push(text);
      continue;
    }
    const input = normalizeClaudeTranscriptText(blockRecord.input);
    if (input) {
      parts.push(input);
    }
  }
  return parts;
}

function isClaudeTranscriptNoiseContent(content: unknown): boolean {
  const parts = collectClaudeTextContentParts(content);
  return parts.length > 0 && parts.every((part) => isClaudeTranscriptNoiseText(part));
}

/** Extracts visible user text from Claude transcript content. */
export function extractUserMessageText(content: unknown): string | null {
  if (typeof content === "string") {
    const normalized = content.trim();
    if (!normalized || isClaudeTranscriptNoiseText(normalized)) {
      return null;
    }
    return normalized;
  }

  if (!Array.isArray(content)) {
    return null;
  }

  const parts: string[] = [];
  for (const block of content) {
    if (!block || typeof block !== "object") {
      continue;
    }
    const blockRecord = block as Record<string, unknown>;
    const text = typeof blockRecord.text === "string" ? blockRecord.text : undefined;
    if (text && text.trim()) {
      const trimmed = text.trim();
      if (!isClaudeTranscriptNoiseText(trimmed)) {
        parts.push(trimmed);
      }
      continue;
    }
    const input = typeof blockRecord.input === "string" ? blockRecord.input : undefined;
    if (input && input.trim()) {
      const trimmed = input.trim();
      if (!isClaudeTranscriptNoiseText(trimmed)) {
        parts.push(trimmed);
      }
    }
  }

  if (parts.length === 0) {
    return null;
  }
  const combined = parts.join("\n\n").trim();
  return combined.length > 0 ? combined : null;
}

export function isSyntheticUserEntry(entry: unknown): boolean {
  const candidate = toObjectRecord(entry);
  if (!candidate) {
    return false;
  }
  return (
    candidate.isSynthetic === true || candidate.isMeta === true || Boolean(candidate.toolUseResult)
  );
}

export function isToolResultUserEntry(entry: unknown): boolean {
  const candidate = toObjectRecord(entry);
  if (!candidate) {
    return false;
  }
  const message = toObjectRecord(candidate.message);
  const content = message?.content;
  return (
    Array.isArray(content) && content.some((block) => toObjectRecord(block)?.type === "tool_result")
  );
}

export function isSyntheticHistoryUserEntry(entry: Record<string, unknown>): boolean {
  return isSyntheticUserEntry(entry) && !isToolResultUserEntry(entry);
}

export function readCompactionMetadata(
  source: unknown,
): { trigger?: string; preTokens?: number } | null {
  const sourceRecord = toObjectRecord(source);
  if (!sourceRecord) {
    return null;
  }
  const candidates = [
    sourceRecord.compact_metadata,
    sourceRecord.compactMetadata,
    sourceRecord.compactionMetadata,
  ];
  for (const candidate of candidates) {
    const metadata = toObjectRecord(candidate);
    if (!metadata) {
      continue;
    }
    const trigger = typeof metadata.trigger === "string" ? metadata.trigger : undefined;
    const preTokensRaw = metadata.preTokens ?? metadata.pre_tokens;
    const preTokens = typeof preTokensRaw === "number" ? preTokensRaw : undefined;
    return { trigger, preTokens };
  }
  return null;
}

function isClaudeHistoryContentChunk(value: unknown): value is ClaudeHistoryContentChunk {
  const record = toObjectRecord(value);
  return Boolean(record) && typeof record?.type === "string";
}

function hasToolLikeBlock(block?: ClaudeHistoryContentChunk | null): boolean {
  if (!block) {
    return false;
  }
  return block.type.toLowerCase().includes("tool");
}

function normalizeHistoryBlocks(content: unknown): ClaudeHistoryContentChunk[] | null {
  if (Array.isArray(content)) {
    const blocks = content.filter((entry) => isClaudeHistoryContentChunk(entry));
    return blocks.length > 0 ? blocks : null;
  }
  if (isClaudeHistoryContentChunk(content)) {
    return [content];
  }
  return null;
}

function mapAssistantHistoryBlocksWithMessageId(
  entry: ClaudeHistoryEntry,
  content: string | ClaudeHistoryContentChunk[],
  mapBlocks: (content: string | ClaudeHistoryContentChunk[]) => AgentTimelineItem[],
): AgentTimelineItem[] {
  const items = mapBlocks(content);
  const assistantMessageId =
    typeof entry.uuid === "string" && entry.uuid.length > 0 ? entry.uuid : null;
  if (!assistantMessageId) {
    return items;
  }
  for (const item of items) {
    if (item.type === "assistant_message" && !item.messageId) {
      item.messageId = assistantMessageId;
    }
  }
  return items;
}

function convertClaudeHistoryEntryPreamble(
  entry: ClaudeHistoryEntry,
): { shortCircuit: AgentTimelineItem[] } | { proceed: { content: unknown } } {
  if (entry.type === "system" && entry.subtype === "compact_boundary") {
    const compactMetadata = readCompactionMetadata(entry);
    return {
      shortCircuit: [
        {
          type: "compaction",
          status: "completed",
          trigger: compactMetadata?.trigger === "manual" ? "manual" : "auto",
          preTokens: compactMetadata?.preTokens,
        },
      ],
    };
  }

  const taskNotificationItem = mapTaskNotificationSystemRecordToToolCall(entry);
  if (taskNotificationItem) {
    return { shortCircuit: [taskNotificationItem] };
  }
  if (entry.isCompactSummary) {
    return { shortCircuit: [] };
  }
  if (entry.type === "user" && isSyntheticHistoryUserEntry(entry)) {
    return { shortCircuit: [] };
  }

  const message = entry.message;
  if (!message || !("content" in message)) {
    return { shortCircuit: [] };
  }
  const content = message.content;
  if (
    (entry.type === "user" || entry.type === "assistant") &&
    isClaudeTranscriptNoiseContent(content)
  ) {
    return { shortCircuit: [] };
  }
  return { proceed: { content } };
}

/** Converts one Claude JSONL history entry into timeline items. */
export function convertClaudeHistoryEntry(
  entry: ClaudeHistoryEntry,
  mapBlocks: (content: string | ClaudeHistoryContentChunk[]) => AgentTimelineItem[],
): AgentTimelineItem[] {
  const preamble = convertClaudeHistoryEntryPreamble(entry);
  if ("shortCircuit" in preamble) {
    return preamble.shortCircuit;
  }
  const { content } = preamble.proceed;
  const normalizedBlocks = normalizeHistoryBlocks(content);
  const contentValue = typeof content === "string" ? content : normalizedBlocks;
  const hasToolBlock = normalizedBlocks?.some((block) => hasToolLikeBlock(block)) ?? false;
  const userMessageId =
    entry.type === "user" && typeof entry.uuid === "string" && entry.uuid.length > 0
      ? entry.uuid
      : null;

  if (entry.type === "user") {
    const userTaskNotificationItem = mapTaskNotificationUserContentToToolCall({
      content,
      messageId: userMessageId,
    });
    if (userTaskNotificationItem) {
      return [userTaskNotificationItem];
    }
  }

  const timeline: AgentTimelineItem[] = [];
  if (entry.type === "user") {
    const text = extractUserMessageText(content);
    if (text) {
      timeline.push({
        type: "user_message",
        text,
        ...(userMessageId ? { messageId: userMessageId } : {}),
      });
    }
  }

  if (hasToolBlock && normalizedBlocks) {
    const mapped = mapBlocks(normalizedBlocks);
    if (entry.type === "user") {
      const toolItems = mapped.filter((item) => item.type === "tool_call");
      return timeline.length ? [...timeline, ...toolItems] : toolItems;
    }
    return mapped;
  }
  if (entry.type === "assistant" && contentValue) {
    return mapAssistantHistoryBlocksWithMessageId(entry, contentValue, mapBlocks);
  }
  return timeline;
}
