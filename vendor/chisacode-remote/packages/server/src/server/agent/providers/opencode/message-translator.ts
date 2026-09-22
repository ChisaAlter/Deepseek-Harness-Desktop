import type {
  AssistantMessage as OpenCodeAssistantMessage,
  Event as OpenCodeEvent,
  Message as OpenCodeMessage,
  Part as OpenCodePart,
} from "@opencode-ai/sdk/v2/client";

import type { AgentStreamEvent, AgentUsage } from "../../agent-sdk-types.js";
import { buildOpenCodeModelLookupKey, readPositiveFiniteNumber } from "./catalog.js";
import { readNonEmptyString, readOpenCodeRecord } from "./event-values.js";
import { OpencodeToolPartToTimelineItemSchema } from "./helpers.js";
import {
  appendOpenCodeSubAgentChildToolPart,
  appendOpenCodeToolCallTimelineItem,
  type OpenCodeSubAgentActivityState,
  type OpenCodeSubAgentTrackingState,
  type OpenCodeToolPartEventPart,
} from "./sub-agent-tracking.js";

export type OpenCodeMessageRole = "user" | "assistant";

export interface OpenCodeMessageTranslationState extends OpenCodeSubAgentTrackingState {
  messageRoles: Map<string, OpenCodeMessageRole>;
  pendingUserMessageText?: string | null;
  emittedUserMessageIds?: Set<string>;
  accumulatedUsage: AgentUsage;
  sessionTotalCostUsd?: number;
  streamedPartKeys: Set<string>;
  emittedStructuredMessageIds: Set<string>;
  /** Tracks the type of each part by ID, learned from message.part.updated events. */
  partTypes: Map<string, string>;
  modelContextWindowsByModelKey?: ReadonlyMap<string, number>;
  onAssistantModelContextWindowResolved?: (contextWindowMaxTokens: number) => void;
}

export type { OpenCodeSubAgentActivityState, OpenCodeToolPartEventPart };

function resolvePartDedupeKey(
  part: { id: string; messageID: string },
  partType: "text" | "reasoning",
): string | null {
  if (part.id.trim().length > 0) {
    return `${partType}:${part.id}`;
  }
  if (part.messageID.trim().length > 0) {
    return `${partType}:message:${part.messageID}`;
  }
  return null;
}

function assignUsageNumber(usage: AgentUsage, key: keyof AgentUsage, value: number | undefined) {
  if (value !== undefined) {
    usage[key] = value;
  }
}

export function resolveOpenCodeModelLookupKeyFromAssistantMessage(
  info: OpenCodeAssistantMessage,
): string | undefined {
  const providerId = info.providerID;
  const modelId = info.modelID;
  if (!providerId || !modelId) {
    return undefined;
  }

  return buildOpenCodeModelLookupKey(providerId, modelId);
}

export function mergeOpenCodeStepFinishUsage(
  usage: AgentUsage,
  part: {
    cost?: unknown;
    tokens?: {
      input?: unknown;
      output?: unknown;
      reasoning?: unknown;
      total?: unknown;
      cache?: {
        read?: unknown;
        write?: unknown;
      };
    };
  },
  options: { totalCostUsd?: number } = {},
): void {
  const inputTokens = readPositiveFiniteNumber(part.tokens?.input);
  const outputTokens = readPositiveFiniteNumber(part.tokens?.output);
  const reasoningTokens = readPositiveFiniteNumber(part.tokens?.reasoning);
  const cacheReadTokens = readPositiveFiniteNumber(part.tokens?.cache?.read);
  const cacheWriteTokens = readPositiveFiniteNumber(part.tokens?.cache?.write);
  const totalTokens =
    (inputTokens ?? 0) +
    (outputTokens ?? 0) +
    (reasoningTokens ?? 0) +
    (cacheReadTokens ?? 0) +
    (cacheWriteTokens ?? 0);
  const cost = readPositiveFiniteNumber(part.cost);

  assignUsageNumber(usage, "inputTokens", inputTokens);
  assignUsageNumber(usage, "cachedInputTokens", cacheReadTokens);
  assignUsageNumber(usage, "outputTokens", outputTokens);
  if (totalTokens > 0) {
    usage.contextWindowUsedTokens = totalTokens;
  }
  if (cost !== undefined) {
    usage.totalCostUsd = options.totalCostUsd ?? (usage.totalCostUsd ?? 0) + cost;
  }
}

export function hasNormalizedOpenCodeUsage(usage: AgentUsage): boolean {
  return [
    usage.inputTokens,
    usage.cachedInputTokens,
    usage.outputTokens,
    usage.totalCostUsd,
    usage.contextWindowMaxTokens,
    usage.contextWindowUsedTokens,
  ].some((value) => typeof value === "number" && Number.isFinite(value));
}

export function stringifyStructuredAssistantMessage(value: unknown): string | null {
  if (value === undefined) {
    return null;
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }
  try {
    return JSON.stringify(value);
  } catch {
    return null;
  }
}

export function isOpenCodeTodoWriteToolPart(
  part: OpenCodeToolPartEventPart | OpenCodePart,
): boolean {
  return part.type === "tool" && part.tool.trim().toLowerCase() === "todowrite";
}

function readOpenCodeTodoItems(
  value: unknown,
): Array<{ content?: string | null; status?: string | null }> | null {
  if (typeof value === "string") {
    try {
      return readOpenCodeTodoItems(JSON.parse(value));
    } catch {
      return null;
    }
  }
  if (Array.isArray(value)) {
    return value.flatMap((entry) => {
      const record = readOpenCodeRecord(entry);
      if (!record) {
        return [];
      }
      const content = readNonEmptyString(record.content);
      if (!content) {
        return [];
      }
      return [
        {
          content,
          status: readNonEmptyString(record.status),
        },
      ];
    });
  }
  const record = readOpenCodeRecord(value);
  if (!record) {
    return null;
  }
  return readOpenCodeTodoItems(record.todos);
}

export function readOpenCodeTodoItemsFromToolPart(
  part: Extract<OpenCodePart, { type: "tool" }>,
): Array<{ content?: string | null; status?: string | null }> | null {
  const state = readOpenCodeRecord(part.state);
  return (
    readOpenCodeTodoItems(state?.input) ??
    readOpenCodeTodoItems(state?.output) ??
    readOpenCodeTodoItems(state?.metadata)
  );
}

export function appendOpenCodeMessageUpdated(
  event: Extract<OpenCodeEvent, { type: "message.updated" }>,
  state: OpenCodeMessageTranslationState,
  events: AgentStreamEvent[],
): void {
  const info = event.properties.info;
  if (info.sessionID !== state.sessionId) {
    return;
  }
  state.messageRoles.set(info.id, info.role);
  if (info.role === "user") {
    appendOpenCodeUserMessageUpdated(info, state, events);
    return;
  }
  if (info.role !== "assistant") {
    return;
  }
  const modelLookupKey = resolveOpenCodeModelLookupKeyFromAssistantMessage(info);
  if (modelLookupKey) {
    const contextWindowMaxTokens = state.modelContextWindowsByModelKey?.get(modelLookupKey);
    if (contextWindowMaxTokens !== undefined) {
      state.onAssistantModelContextWindowResolved?.(contextWindowMaxTokens);
    }
  }
  if (state.emittedStructuredMessageIds.has(info.id) || info.time?.completed === undefined) {
    return;
  }
  const text = stringifyStructuredAssistantMessage(info.structured);
  if (!text) {
    return;
  }
  state.emittedStructuredMessageIds.add(info.id);
  events.push({
    type: "timeline",
    provider: "opencode",
    item: { type: "assistant_message", text },
  });
}

function appendOpenCodeUserMessageUpdated(
  info: Extract<OpenCodeMessage, { role: "user" }>,
  state: OpenCodeMessageTranslationState,
  events: AgentStreamEvent[],
): void {
  const text = state.pendingUserMessageText;
  if (!text || text.trim().length === 0 || state.emittedUserMessageIds?.has(info.id)) {
    return;
  }
  state.emittedUserMessageIds?.add(info.id);
  events.push({
    type: "timeline",
    provider: "opencode",
    item: { type: "user_message", text, messageId: info.id },
  });
}

export function appendOpenCodeMessagePartUpdated(
  event: Extract<OpenCodeEvent, { type: "message.part.updated" }>,
  state: OpenCodeMessageTranslationState,
  events: AgentStreamEvent[],
): void {
  const part = event.properties.part;
  if (part.type === "tool" && isOpenCodeTodoWriteToolPart(part)) {
    return;
  }
  if (part.sessionID !== state.sessionId) {
    if (part.type === "tool") {
      appendOpenCodeSubAgentChildToolPart(part, state, events);
    }
    return;
  }
  const messageRole = state.messageRoles.get(part.messageID);
  state.partTypes.set(part.id, part.type);

  if (part.type === "text") {
    appendOpenCodeTextPart(part, messageRole, state, events);
    return;
  }
  if (part.type === "reasoning") {
    appendOpenCodeReasoningPart(part, state, events);
    return;
  }
  if (part.type === "tool") {
    const parsedToolPart = OpencodeToolPartToTimelineItemSchema.safeParse(part);
    if (parsedToolPart.success && parsedToolPart.data) {
      appendOpenCodeToolCallTimelineItem(parsedToolPart.data, state, events);
    }
    return;
  }
  if (part.type === "compaction") {
    events.push({
      type: "timeline",
      provider: "opencode",
      item: {
        type: "compaction",
        status: "loading",
        trigger: part.auto ? "auto" : "manual",
      },
    });
    return;
  }
  if (part.type === "step-finish") {
    const stepCost = readPositiveFiniteNumber(part.cost);
    if (stepCost !== undefined) {
      state.sessionTotalCostUsd = (state.sessionTotalCostUsd ?? 0) + stepCost;
    }
    mergeOpenCodeStepFinishUsage(state.accumulatedUsage, part, {
      totalCostUsd: state.sessionTotalCostUsd,
    });
    if (hasNormalizedOpenCodeUsage(state.accumulatedUsage)) {
      events.push({
        type: "usage_updated",
        provider: "opencode",
        usage: { ...state.accumulatedUsage },
      });
    }
  }
}

function appendOpenCodeTextPart(
  part: Extract<
    Extract<OpenCodeEvent, { type: "message.part.updated" }>["properties"]["part"],
    { type: "text" }
  >,
  messageRole: OpenCodeMessageRole | undefined,
  state: OpenCodeMessageTranslationState,
  events: AgentStreamEvent[],
): void {
  if (messageRole === "user") {
    return;
  }
  if (!part.time?.end) {
    return;
  }
  const partKey = resolvePartDedupeKey(part, "text");
  if (partKey && state.streamedPartKeys.delete(partKey)) {
    return;
  }
  if (part.text) {
    events.push({
      type: "timeline",
      provider: "opencode",
      item: { type: "assistant_message", text: part.text },
    });
  }
}

function appendOpenCodeReasoningPart(
  part: Extract<
    Extract<OpenCodeEvent, { type: "message.part.updated" }>["properties"]["part"],
    { type: "reasoning" }
  >,
  state: OpenCodeMessageTranslationState,
  events: AgentStreamEvent[],
): void {
  if (!part.time.end) {
    return;
  }
  const partKey = resolvePartDedupeKey(part, "reasoning");
  if (partKey && state.streamedPartKeys.delete(partKey)) {
    return;
  }
  if (part.text) {
    events.push({
      type: "timeline",
      provider: "opencode",
      item: { type: "reasoning", text: part.text },
    });
  }
}

export function appendOpenCodeMessagePartDelta(
  event: Extract<OpenCodeEvent, { type: "message.part.delta" }>,
  state: OpenCodeMessageTranslationState,
  events: AgentStreamEvent[],
): void {
  const { sessionID, messageID, partID, field, delta } = event.properties;
  if (sessionID !== state.sessionId) {
    return;
  }
  if (!delta || !field) {
    return;
  }
  const messageRole = messageID ? state.messageRoles.get(messageID) : undefined;
  const knownPartType = partID ? state.partTypes.get(partID) : undefined;
  const isReasoning = knownPartType === "reasoning" || field === "reasoning";

  if (isReasoning) {
    if (partID) {
      state.streamedPartKeys.add(`reasoning:${partID}`);
    }
    events.push({
      type: "timeline",
      provider: "opencode",
      item: { type: "reasoning", text: delta },
    });
    return;
  }
  if (field !== "text") {
    return;
  }
  if (messageRole === "user") {
    return;
  }
  if (partID) {
    state.streamedPartKeys.add(`text:${partID}`);
  }
  events.push({
    type: "timeline",
    provider: "opencode",
    item: { type: "assistant_message", text: delta },
  });
}
