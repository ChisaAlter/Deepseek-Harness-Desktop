import { z } from "zod/v3";

import type { AgentTimelineItem } from "../../agent-sdk-types.js";
import { normalizeProviderReplayTimestamp } from "../../provider-history-timestamps.js";
import { mapCodexThreadImageItem } from "./image-attachments.js";
import { mapCodexPlanToToolCall, normalizePlanMarkdown } from "./permissions.js";
import { mapCodexToolCallFromThreadItem } from "./tool-call-mapper.js";
import { nonEmptyString } from "../tool-call-mapper-utils.js";

const CODEX_TOOL_THREAD_ITEM_TYPES = new Set([
  "commandExecution",
  "fileChange",
  "mcpToolCall",
  "webSearch",
  "collabAgentToolCall",
]);

export const CODEX_CONTEXT_COMPACTION_TYPE = "contextCompaction";

export interface PersistedTimelineEntry {
  item: AgentTimelineItem;
  timestamp?: string;
}

function toObjectRecord(value: unknown): Record<string, unknown> | undefined {
  return value != null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function extractUserText(content: unknown): string | null {
  if (!Array.isArray(content)) return null;
  const parts: string[] = [];
  for (const item of content) {
    const record = toObjectRecord(item);
    if (record?.type === "text" && typeof record.text === "string") {
      parts.push(record.text);
    }
  }
  return parts.length > 0 ? parts.join("\n") : null;
}

export function normalizeCodexThreadItemType(rawType: string | undefined): string | undefined {
  if (!rawType) {
    return rawType;
  }
  switch (rawType) {
    case "UserMessage":
      return "userMessage";
    case "AgentMessage":
      return "agentMessage";
    case "Reasoning":
      return "reasoning";
    case "Plan":
      return "plan";
    case "CommandExecution":
      return "commandExecution";
    case "FileChange":
      return "fileChange";
    case "McpToolCall":
      return "mcpToolCall";
    case "WebSearch":
      return "webSearch";
    case "CollabAgentToolCall":
      return "collabAgentToolCall";
    case "ImageView":
      return "imageView";
    case "ImageGeneration":
      return "imageGeneration";
    default:
      return rawType;
  }
}

function mapCodexThreadPlanItem(normalizedItem: Record<string, unknown>): AgentTimelineItem | null {
  const callId =
    nonEmptyString(normalizedItem.id ?? normalizedItem.itemId ?? undefined) ??
    `plan:${normalizePlanMarkdown(typeof normalizedItem.text === "string" ? normalizedItem.text : "")}`;
  return mapCodexPlanToToolCall({
    callId,
    text: typeof normalizedItem.text === "string" ? normalizedItem.text : "",
  });
}

function mapCodexThreadReasoningItem(
  normalizedItem: Record<string, unknown>,
): AgentTimelineItem | null {
  const summary = Array.isArray(normalizedItem.summary) ? normalizedItem.summary.join("\n") : "";
  const content = Array.isArray(normalizedItem.content) ? normalizedItem.content.join("\n") : "";
  const text = summary || content;
  return text ? { type: "reasoning", text } : null;
}

function mapCodexThreadUserMessageItem(
  normalizedItem: Record<string, unknown>,
  includeUserMessage: boolean,
): AgentTimelineItem | null {
  if (!includeUserMessage) {
    return null;
  }
  const text = extractUserText(normalizedItem.content) ?? "";
  const messageId = nonEmptyString(normalizedItem.id);
  return {
    type: "user_message",
    text,
    ...(messageId ? { messageId } : {}),
  };
}

function readCodexHistoryTimestamp(item: unknown): string | null {
  const record = toObjectRecord(item);
  if (!record) {
    return null;
  }
  return (
    normalizeProviderReplayTimestamp(record.timestamp) ??
    normalizeProviderReplayTimestamp(record.createdAt) ??
    normalizeProviderReplayTimestamp(record.created_at)
  );
}

function readCodexTurnHistoryTimestamp(
  turn: unknown,
  timelineItem: AgentTimelineItem,
): string | null {
  const record = toObjectRecord(turn);
  if (!record) {
    return null;
  }

  const startedAt =
    normalizeProviderReplayTimestamp(record.startedAt) ??
    normalizeProviderReplayTimestamp(record.started_at);
  const completedAt =
    normalizeProviderReplayTimestamp(record.completedAt) ??
    normalizeProviderReplayTimestamp(record.completed_at);

  if (timelineItem.type === "user_message") {
    return startedAt ?? completedAt;
  }
  return completedAt ?? startedAt;
}

export function threadItemToTimeline(
  item: unknown,
  options?: { includeUserMessage?: boolean; cwd?: string | null },
): AgentTimelineItem | null {
  const itemRecord = toObjectRecord(item);
  if (!itemRecord) return null;
  const includeUserMessage = options?.includeUserMessage ?? true;
  const cwd = options?.cwd ?? null;
  const normalizedType = normalizeCodexThreadItemType(
    typeof itemRecord.type === "string" ? itemRecord.type : undefined,
  );
  const normalizedItem: Record<string, unknown> =
    normalizedType && normalizedType !== itemRecord.type
      ? { ...itemRecord, type: normalizedType }
      : itemRecord;

  if (normalizedType === "imageView" || normalizedType === "imageGeneration") {
    return mapCodexThreadImageItem(normalizedType, normalizedItem);
  }
  if (normalizedType && CODEX_TOOL_THREAD_ITEM_TYPES.has(normalizedType)) {
    return mapCodexToolCallFromThreadItem(normalizedItem, { cwd });
  }

  switch (normalizedType) {
    case "userMessage":
      return mapCodexThreadUserMessageItem(normalizedItem, includeUserMessage);
    case "agentMessage": {
      const messageId = nonEmptyString(normalizedItem.id);
      return {
        type: "assistant_message",
        text: typeof normalizedItem.text === "string" ? normalizedItem.text : "",
        ...(messageId ? { messageId } : {}),
      };
    }
    case "plan":
      return mapCodexThreadPlanItem(normalizedItem);
    case "reasoning":
      return mapCodexThreadReasoningItem(normalizedItem);
    case CODEX_CONTEXT_COMPACTION_TYPE:
      return {
        type: "compaction",
        status: "completed",
      };
    default:
      return null;
  }
}

const CodexThreadReadResponseSchema = z
  .object({
    thread: z
      .object({
        turns: z
          .array(
            z
              .object({
                items: z.array(z.unknown()).default([]),
              })
              .passthrough(),
          )
          .default([]),
      })
      .passthrough()
      .default({ turns: [] }),
  })
  .passthrough();

type CodexThreadReadResponse = z.infer<typeof CodexThreadReadResponseSchema>;
type CodexThreadReadRequest = (threadId: string) => Promise<unknown>;

async function requestCodexThreadHistory(
  requestThread: CodexThreadReadRequest,
  threadId: string,
): Promise<CodexThreadReadResponse> {
  const response = await requestThread(threadId);
  return CodexThreadReadResponseSchema.parse(response);
}

export async function loadCodexThreadHistoryTimeline(params: {
  threadId: string;
  cwd: string | null;
  requestThread: CodexThreadReadRequest;
}): Promise<PersistedTimelineEntry[]> {
  const response = await requestCodexThreadHistory(params.requestThread, params.threadId);
  const timeline: PersistedTimelineEntry[] = [];
  for (const turn of response.thread.turns) {
    for (const item of turn.items) {
      const timelineItem = threadItemToTimeline(item, { cwd: params.cwd });
      if (timelineItem) {
        const timestamp =
          readCodexHistoryTimestamp(item) ?? readCodexTurnHistoryTimestamp(turn, timelineItem);
        timeline.push({
          item: timelineItem,
          timestamp: timestamp ?? undefined,
        });
      }
    }
  }
  return timeline;
}
