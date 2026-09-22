import type { ReactNode } from "react";
import { deriveStreamTurnTiming, type StreamTurnTiming } from "@/timeline/turn-time";
import type { StreamItem, ThoughtItem, ToolCallItem } from "@/types/stream";
import {
  findMountedWindowStart,
  getWebMountedRecentStreamItems,
  getWebPartialVirtualizationThreshold,
} from "./web-virtualization";
import { orderHeadForStreamRenderStrategy, orderTailForStreamRenderStrategy } from "./strategy";
import { resolveStreamRenderStrategy } from "./strategy-resolver";

export interface StreamRenderSegments {
  historyVirtualized: StreamItem[];
  historyMounted: StreamItem[];
  liveHead: StreamItem[];
}

export interface StreamHistoryBoundary {
  hasVirtualizedHistory: boolean;
  hasMountedHistory: boolean;
  hasLiveHead: boolean;
}

export interface StreamRenderAuxiliary {
  pendingPermissions: ReactNode;
  turnFooter: ReactNode;
}

export interface AgentStreamRenderModel {
  history: StreamItem[];
  segments: StreamRenderSegments;
  turnTiming: StreamTurnTiming;
  boundary: StreamHistoryBoundary;
  auxiliary: StreamRenderAuxiliary;
}

export interface BuildAgentStreamRenderModelInput {
  agentStatus: string;
  tail: StreamItem[];
  head: StreamItem[];
  platform: "web" | "native";
  isMobileBreakpoint: boolean;
}

const EMPTY_STREAM_ITEMS: StreamItem[] = [];
const EMPTY_AUXILIARY: StreamRenderAuxiliary = {
  pendingPermissions: null,
  turnFooter: null,
};
const TOOL_CALL_ARGUMENT_SUMMARY_MAX_LENGTH = 120;

const orderedTailCache = new WeakMap<StreamItem[], Map<string, StreamItem[]>>();
const orderedHeadCache = new WeakMap<StreamItem[], Map<string, StreamItem[]>>();
const splitHistoryCache = new WeakMap<
  StreamItem[],
  Map<string, Pick<AgentStreamRenderModel, "history" | "segments">>
>();
const turnTimingCache = new WeakMap<
  StreamItem[],
  WeakMap<StreamItem[], Map<string, StreamTurnTiming>>
>();

/** Cap inner cache maps so a long-lived StreamItem[] does not accumulate an
 *  unbounded number of cache-key variants (platform/breakpoint/mounted-window
 *  combinations). When the cap is reached the oldest entry is evicted. */
const CACHE_INNER_MAX_ENTRIES = 8;

function setBoundedCacheEntry<K, V>(map: Map<K, V>, key: K, value: V): void {
  if (map.size >= CACHE_INNER_MAX_ENTRIES && !map.has(key)) {
    // Evict the first (oldest) entry to keep the map bounded.
    const firstKey = map.keys().next().value;
    if (firstKey !== undefined) {
      map.delete(firstKey);
    }
  }
  map.set(key, value);
}

function isAssistantMessageItem(
  item: StreamItem,
): item is Extract<StreamItem, { kind: "assistant_message" }> {
  return item.kind === "assistant_message";
}

function getAssistantMessageGroupKey(
  item: Extract<StreamItem, { kind: "assistant_message" }>,
): string {
  return item.blockGroupId ?? item.messageId ?? item.id;
}

function trimSummarySourceText(text: string): string {
  return text
    .trim()
    .replace(/^(?:-{3,}|\*{3,}|_{3,})[ \t]*(?:\r?\n)+/, "")
    .trim();
}

function normalizeInlineSummaryText(text: string): string {
  const normalized = text.trim().replace(/\s+/g, " ");
  if (normalized.length <= TOOL_CALL_ARGUMENT_SUMMARY_MAX_LENGTH) {
    return normalized;
  }
  return `${normalized.slice(0, TOOL_CALL_ARGUMENT_SUMMARY_MAX_LENGTH - 1)}...`;
}

function stringifyUnknownForSummary(value: unknown): string {
  if (typeof value === "string") {
    return normalizeInlineSummaryText(value);
  }
  if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") {
    return String(value);
  }
  if (value === null || value === undefined) {
    return "";
  }
  try {
    return normalizeInlineSummaryText(JSON.stringify(value));
  } catch {
    return "";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function getPreferredArgumentSummary(value: unknown): string {
  if (!isRecord(value)) {
    return stringifyUnknownForSummary(value);
  }
  for (const key of ["command", "cmd", "input", "query", "path"]) {
    const candidate = value[key];
    if (typeof candidate === "string" && candidate.trim().length > 0) {
      return normalizeInlineSummaryText(candidate);
    }
  }
  return stringifyUnknownForSummary(value);
}

function getToolCallSummarySourceText(item: ToolCallItem): string {
  const isFailed = item.payload.data.status === "failed";
  const prefix = isFailed ? "工具调用失败" : "工具调用";
  const name =
    item.payload.source === "agent" ? item.payload.data.name : item.payload.data.toolName;
  const argumentSummary =
    item.payload.source === "orchestrator"
      ? getPreferredArgumentSummary(item.payload.data.arguments)
      : "";
  return [prefix, `${name}${argumentSummary ? ` ${argumentSummary}` : ""}`].join("：");
}

function getCompletedTurnThoughtSummarySourceText(input: {
  item: StreamItem;
  finalAssistantGroupKey: string;
  itemIndex: number;
  finalAssistantIndex: number;
}): string | null {
  if (input.item.kind === "thought") {
    return input.item.text;
  }
  if (input.item.kind === "tool_call" && input.itemIndex < input.finalAssistantIndex) {
    return getToolCallSummarySourceText(input.item);
  }
  if (
    input.item.kind === "assistant_message" &&
    getAssistantMessageGroupKey(input.item) !== input.finalAssistantGroupKey
  ) {
    return input.item.text;
  }
  return null;
}

function collapseCompletedTurn(turnItems: StreamItem[]): StreamItem[] {
  let lastAssistantIndex = -1;
  for (let index = turnItems.length - 1; index >= 0; index -= 1) {
    const item = turnItems[index];
    if (item && isAssistantMessageItem(item)) {
      lastAssistantIndex = index;
      break;
    }
  }

  const lastAssistant = turnItems[lastAssistantIndex];
  if (lastAssistantIndex < 0 || !lastAssistant || lastAssistant.kind !== "assistant_message") {
    return turnItems;
  }

  const finalAssistantGroupKey = getAssistantMessageGroupKey(lastAssistant);
  const summaryText = turnItems
    .map((item, itemIndex) =>
      getCompletedTurnThoughtSummarySourceText({
        item,
        finalAssistantGroupKey,
        itemIndex,
        finalAssistantIndex: lastAssistantIndex,
      }),
    )
    .filter((text): text is string => text !== null)
    .map(trimSummarySourceText)
    .filter((text) => text.length > 0)
    .join("\n\n");
  if (!summaryText) {
    return turnItems.filter((item) => {
      if (item.kind === "thought") {
        return false;
      }
      if (item.kind !== "assistant_message") {
        return true;
      }
      return getAssistantMessageGroupKey(item) === finalAssistantGroupKey;
    });
  }

  const summarySourceItems = turnItems.filter((item, itemIndex) => {
    if (item.kind === "thought") {
      return true;
    }
    if (item.kind === "tool_call") {
      return itemIndex < lastAssistantIndex;
    }
    if (item.kind !== "assistant_message") {
      return false;
    }
    return getAssistantMessageGroupKey(item) !== finalAssistantGroupKey;
  });
  const lastSummarySource = summarySourceItems.at(-1);
  const summary: ThoughtItem = {
    kind: "thought",
    id: `thought-summary:${lastAssistant.id}`,
    text: summaryText,
    timestamp: lastSummarySource?.timestamp ?? lastAssistant.timestamp,
    status: "ready",
    isCollapsedSummary: true,
    summaryForAssistantMessageId: lastAssistant.id,
  };

  const collapsed: StreamItem[] = [];
  let insertedSummary = false;
  for (let index = 0; index < turnItems.length; index += 1) {
    const item = turnItems[index];
    if (!item || item.kind === "thought") {
      continue;
    }
    if (item.kind === "tool_call" && index < lastAssistantIndex) {
      continue;
    }
    if (
      item.kind === "assistant_message" &&
      getAssistantMessageGroupKey(item) !== finalAssistantGroupKey
    ) {
      continue;
    }
    if (item.kind === "assistant_message" && !insertedSummary) {
      collapsed.push(summary);
      insertedSummary = true;
    }
    collapsed.push(item);
  }
  return collapsed;
}

export function collapseCompletedTurnThoughtsForDisplay(
  items: StreamItem[],
  input: { isRunning: boolean },
): StreamItem[] {
  if (items.length === 0 || input.isRunning) {
    return items;
  }

  const collapsed: StreamItem[] = [];
  let currentTurn: StreamItem[] = [];

  const flushTurn = () => {
    if (currentTurn.length === 0) {
      return;
    }
    collapsed.push(...collapseCompletedTurn(currentTurn));
    currentTurn = [];
  };

  for (const item of items) {
    if (item.kind === "user_message") {
      flushTurn();
    }
    currentTurn.push(item);
  }
  flushTurn();

  return collapsed.length === items.length &&
    collapsed.every((item, index) => item === items[index])
    ? items
    : collapsed;
}

function collapseCompletedTurnThoughtSegments(input: {
  tail: StreamItem[];
  head: StreamItem[];
  isRunning: boolean;
}): Pick<BuildAgentStreamRenderModelInput, "tail" | "head"> {
  if (input.head.length === 0 || input.isRunning) {
    return {
      tail: collapseCompletedTurnThoughtsForDisplay(input.tail, { isRunning: false }),
      head: input.head,
    };
  }

  const collapsed = collapseCompletedTurnThoughtsForDisplay([...input.tail, ...input.head], {
    isRunning: false,
  });
  const headItems = new Set(input.head);
  const headIds = new Set(input.head.map((item) => item.id));
  const displayTail: StreamItem[] = [];
  const displayHead: StreamItem[] = [];

  for (const item of collapsed) {
    const sourceId =
      item.kind === "thought" && item.summaryForAssistantMessageId
        ? item.summaryForAssistantMessageId
        : item.id;
    if (headItems.has(item) || headIds.has(sourceId)) {
      displayHead.push(item);
    } else {
      displayTail.push(item);
    }
  }

  return {
    tail:
      displayTail.length === input.tail.length &&
      displayTail.every((item, index) => item === input.tail[index])
        ? input.tail
        : displayTail,
    head:
      displayHead.length === input.head.length &&
      displayHead.every((item, index) => item === input.head[index])
        ? input.head
        : displayHead,
  };
}

function getOrderedItems(params: {
  cache: WeakMap<StreamItem[], Map<string, StreamItem[]>>;
  source: StreamItem[];
  cacheKey: string;
  order: (items: StreamItem[]) => StreamItem[];
}): StreamItem[] {
  const { cache, source, cacheKey, order } = params;
  let cachedByKey = cache.get(source);
  if (!cachedByKey) {
    cachedByKey = new Map();
    cache.set(source, cachedByKey);
  }
  const cached = cachedByKey.get(cacheKey);
  if (cached) {
    return cached;
  }
  const ordered = order(source);
  setBoundedCacheEntry(cachedByKey, cacheKey, ordered);
  return ordered;
}

function splitOrderedTail(params: {
  orderedTail: StreamItem[];
  platform: "web" | "native";
  isMobileBreakpoint: boolean;
}): Pick<AgentStreamRenderModel, "history" | "segments"> {
  const { orderedTail, platform, isMobileBreakpoint } = params;
  const shouldSplitHistory =
    platform === "web" &&
    !isMobileBreakpoint &&
    orderedTail.length > getWebPartialVirtualizationThreshold();
  const cacheKey = `${platform}:${isMobileBreakpoint}:${getWebMountedRecentStreamItems()}:${shouldSplitHistory}`;
  let cachedByKey = splitHistoryCache.get(orderedTail);
  if (!cachedByKey) {
    cachedByKey = new Map();
    splitHistoryCache.set(orderedTail, cachedByKey);
  }
  const cached = cachedByKey.get(cacheKey);
  if (cached) {
    return cached;
  }

  if (!shouldSplitHistory) {
    const unsplit = {
      history: orderedTail,
      segments: {
        historyVirtualized: EMPTY_STREAM_ITEMS,
        historyMounted: orderedTail,
        liveHead: EMPTY_STREAM_ITEMS,
      },
    } satisfies Pick<AgentStreamRenderModel, "history" | "segments">;
    setBoundedCacheEntry(cachedByKey, cacheKey, unsplit);
    return unsplit;
  }

  const mountedWindowStart = findMountedWindowStart({
    items: orderedTail,
    minMountedCount: getWebMountedRecentStreamItems(),
  });
  const split = {
    history: orderedTail,
    segments: {
      historyVirtualized: orderedTail.slice(0, mountedWindowStart),
      historyMounted: orderedTail.slice(mountedWindowStart),
      liveHead: EMPTY_STREAM_ITEMS,
    },
  } satisfies Pick<AgentStreamRenderModel, "history" | "segments">;
  setBoundedCacheEntry(cachedByKey, cacheKey, split);
  return split;
}

function getTurnTiming(params: {
  agentStatus: string;
  tail: StreamItem[];
  head: StreamItem[];
}): StreamTurnTiming {
  let cachedByHead = turnTimingCache.get(params.tail);
  if (!cachedByHead) {
    cachedByHead = new WeakMap();
    turnTimingCache.set(params.tail, cachedByHead);
  }
  let cachedByStatus = cachedByHead.get(params.head);
  if (!cachedByStatus) {
    cachedByStatus = new Map();
    cachedByHead.set(params.head, cachedByStatus);
  }
  const cached = cachedByStatus.get(params.agentStatus);
  if (cached) {
    return cached;
  }
  const timing = deriveStreamTurnTiming(params);
  setBoundedCacheEntry(cachedByStatus, params.agentStatus, timing);
  return timing;
}

export function buildAgentStreamRenderModel(
  input: BuildAgentStreamRenderModelInput,
): AgentStreamRenderModel {
  const strategy = resolveStreamRenderStrategy({
    platform: input.platform === "web" ? "web" : "native",
    isMobileBreakpoint: input.isMobileBreakpoint,
  });
  const orderingCacheKey = `${input.platform}:${input.isMobileBreakpoint}`;
  const displaySegments = collapseCompletedTurnThoughtSegments({
    tail: input.tail,
    head: input.head,
    isRunning: input.agentStatus === "running",
  });
  const orderedTail = getOrderedItems({
    cache: orderedTailCache,
    source: displaySegments.tail,
    cacheKey: orderingCacheKey,
    order: (items) =>
      orderTailForStreamRenderStrategy({
        strategy,
        streamItems: items,
      }),
  });
  const orderedHead = getOrderedItems({
    cache: orderedHeadCache,
    source: displaySegments.head,
    cacheKey: orderingCacheKey,
    order: (items) =>
      orderHeadForStreamRenderStrategy({
        strategy,
        streamHead: items,
      }),
  });
  const splitHistory = splitOrderedTail({
    orderedTail,
    platform: input.platform,
    isMobileBreakpoint: input.isMobileBreakpoint,
  });
  const turnTiming = getTurnTiming({
    agentStatus: input.agentStatus,
    tail: input.tail,
    head: input.head,
  });

  return {
    history: splitHistory.history,
    segments: {
      ...splitHistory.segments,
      liveHead: orderedHead,
    },
    turnTiming,
    boundary: {
      hasVirtualizedHistory: splitHistory.segments.historyVirtualized.length > 0,
      hasMountedHistory: splitHistory.segments.historyMounted.length > 0,
      hasLiveHead: orderedHead.length > 0,
    },
    auxiliary: EMPTY_AUXILIARY,
  };
}
