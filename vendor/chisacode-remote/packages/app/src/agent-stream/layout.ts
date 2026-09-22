import type { TurnTiming } from "@/timeline/turn-time";
import type { StreamItem } from "@/types/stream";
import { getAssistantBlockSpacing, getGapBetweenStreamItems } from "./spacing";
import type { StreamFrameChildOrder, StreamStrategy } from "./strategy";

export type StreamToolSequence = "single" | "first" | "middle" | "last" | "none";

export interface TurnFooterHost {
  itemId: string;
  items: StreamItem[];
  timing?: TurnTiming;
  startIndex: number;
}

export interface StreamLayoutItem {
  item: StreamItem;
  index: number;
  items: StreamItem[];
  aboveItem: StreamItem | null;
  belowItem: StreamItem | null;
  gapBelow: number;
  assistantSpacing: "default" | "compactTop" | "compactBottom" | "compactBoth";
  completedFooter: TurnFooterHost | null;
  turnTiming?: TurnTiming;
  toolSequence: StreamToolSequence;
  toolSequenceGroup: StreamLayoutItem[] | null;
  toolSequenceGroupGapBelow: number;
  isToolSequenceGroupContinuation: boolean;
  isFirstInUserGroup: boolean;
  isLastInUserGroup: boolean;
  isLastInToolSequence: boolean;
  frameOrder: StreamFrameChildOrder;
}

export interface StreamLayout {
  history: StreamLayoutItem[];
  liveHead: StreamLayoutItem[];
  auxiliaryTurnFooter: TurnFooterHost | null;
}

export interface StreamLayoutInput {
  strategy: StreamStrategy;
  agentStatus: string;
  history: StreamItem[];
  liveHead: StreamItem[];
  timingByAssistantId: Map<string, TurnTiming>;
}

interface LayoutSegmentInput {
  strategy: StreamStrategy;
  agentStatus: string;
  items: StreamItem[];
  timingByAssistantId: Map<string, TurnTiming>;
  auxiliaryTurnFooter: TurnFooterHost | null;
  frameOrder: StreamFrameChildOrder;
  boundaryIndex: number | null;
  boundaryAboveItem: StreamItem | null;
  boundaryBelowItem: StreamItem | null;
}

function isVisibleLayoutItem(item: StreamItem | null | undefined): item is StreamItem {
  return item != null && item.kind !== "turn_changes";
}

function isCollapsedThoughtSummary(item: StreamItem | null | undefined): boolean {
  return item?.kind === "thought" && item.isCollapsedSummary === true;
}

function findLatestVisibleItemIndex(input: {
  strategy: StreamStrategy;
  items: StreamItem[];
}): number | null {
  const startIndex = input.strategy.getLatestItemIndex(input.items);
  if (startIndex === null) {
    return null;
  }

  const step = startIndex === 0 ? 1 : -1;
  for (let index = startIndex; index >= 0 && index < input.items.length; index += step) {
    if (isVisibleLayoutItem(input.items[index])) {
      return index;
    }
  }
  return null;
}

function createTurnFooterHost(input: {
  item: StreamItem;
  items: StreamItem[];
  index: number;
  timingByAssistantId: Map<string, TurnTiming>;
}): TurnFooterHost {
  const timingId =
    input.item.kind === "thought" && input.item.summaryForAssistantMessageId
      ? input.item.summaryForAssistantMessageId
      : input.item.id;
  return {
    itemId: input.item.id,
    items: input.items,
    timing: input.timingByAssistantId.get(timingId),
    startIndex: input.index,
  };
}

function resolveAuxiliaryTurnFooter(input: StreamLayoutInput): TurnFooterHost | null {
  if (input.agentStatus === "running") {
    return null;
  }

  const footerItems = input.liveHead.length > 0 ? input.liveHead : input.history;
  const startIndex = findLatestVisibleItemIndex({
    strategy: input.strategy,
    items: footerItems,
  });
  if (startIndex === null) {
    return null;
  }

  const item = footerItems[startIndex];
  if (!item || (item.kind !== "assistant_message" && !isCollapsedThoughtSummary(item))) {
    return null;
  }

  return createTurnFooterHost({
    item,
    items: footerItems,
    index: startIndex,
    timingByAssistantId: input.timingByAssistantId,
  });
}

function shouldRenderCompletedFooter(input: {
  item: StreamItem;
  belowItem: StreamItem | null;
  agentStatus: string;
  auxiliaryTurnFooter: TurnFooterHost | null;
}): boolean {
  return (
    (input.item.kind === "assistant_message" || isCollapsedThoughtSummary(input.item)) &&
    input.auxiliaryTurnFooter?.itemId !== input.item.id &&
    (input.belowItem?.kind === "user_message" ||
      (input.belowItem === null && input.agentStatus !== "running"))
  );
}

function isToolSequenceItem(item: StreamItem | null): boolean {
  return item?.kind === "tool_call" || item?.kind === "thought" || item?.kind === "todo_list";
}

function getToolSequence(input: {
  item: StreamItem;
  aboveItem: StreamItem | null;
  belowItem: StreamItem | null;
}): StreamToolSequence {
  if (!isToolSequenceItem(input.item)) {
    return "none";
  }

  const hasAbove = isToolSequenceItem(input.aboveItem);
  const hasBelow = isToolSequenceItem(input.belowItem);
  if (hasAbove && hasBelow) {
    return "middle";
  }
  if (hasAbove) {
    return "last";
  }
  if (hasBelow) {
    return "first";
  }
  return "single";
}

function getSegmentNeighbor(input: {
  strategy: StreamStrategy;
  items: StreamItem[];
  index: number;
  relation: "above" | "below";
  boundaryIndex: number | null;
  boundaryItem: StreamItem | null;
}): StreamItem | null {
  for (
    let neighborIndex = input.strategy.getNeighborIndex(input.index, input.relation);
    neighborIndex >= 0 && neighborIndex < input.items.length;
    neighborIndex = input.strategy.getNeighborIndex(neighborIndex, input.relation)
  ) {
    const neighbor = input.items[neighborIndex];
    if (isVisibleLayoutItem(neighbor)) {
      return neighbor;
    }
  }

  if (input.index === input.boundaryIndex && isVisibleLayoutItem(input.boundaryItem)) {
    return input.boundaryItem;
  }
  return null;
}

function assignToolSequenceGroups(items: StreamLayoutItem[]): StreamLayoutItem[] {
  for (let index = 0; index < items.length; index += 1) {
    const layoutItem = items[index];
    if (
      !layoutItem ||
      (layoutItem.toolSequence !== "first" && layoutItem.toolSequence !== "single")
    ) {
      continue;
    }

    const group = [layoutItem];
    let cursor = index + 1;
    while (cursor < items.length) {
      const candidate = items[cursor];
      if (!candidate || !isToolSequenceItem(candidate.item)) {
        break;
      }
      group.push(candidate);
      candidate.isToolSequenceGroupContinuation = true;
      cursor += 1;
      if (candidate.toolSequence === "last" || candidate.toolSequence === "single") {
        break;
      }
    }

    layoutItem.toolSequenceGroup = group;
    layoutItem.toolSequenceGroupGapBelow = group.at(-1)?.gapBelow ?? layoutItem.gapBelow;
  }
  return items;
}

function layoutSegment(input: LayoutSegmentInput): StreamLayoutItem[] {
  const items = input.items.map((item, index) => {
    const aboveItem = getSegmentNeighbor({
      strategy: input.strategy,
      items: input.items,
      index,
      relation: "above",
      boundaryIndex: input.boundaryIndex,
      boundaryItem: input.boundaryAboveItem,
    });
    const belowItem = getSegmentNeighbor({
      strategy: input.strategy,
      items: input.items,
      index,
      relation: "below",
      boundaryIndex: input.boundaryIndex,
      boundaryItem: input.boundaryBelowItem,
    });
    const assistantSpacing = getAssistantBlockSpacing({
      item,
      aboveItem,
      belowItem,
    });
    const completedFooter = shouldRenderCompletedFooter({
      item,
      belowItem,
      agentStatus: input.agentStatus,
      auxiliaryTurnFooter: input.auxiliaryTurnFooter,
    })
      ? createTurnFooterHost({
          item,
          items: input.items,
          index,
          timingByAssistantId: input.timingByAssistantId,
        })
      : null;

    return {
      item,
      index,
      items: input.items,
      aboveItem,
      belowItem,
      gapBelow: completedFooter ? 0 : getGapBetweenStreamItems(item, belowItem),
      assistantSpacing,
      completedFooter,
      turnTiming:
        item.kind === "assistant_message" ? input.timingByAssistantId.get(item.id) : undefined,
      toolSequence: getToolSequence({ item, aboveItem, belowItem }),
      toolSequenceGroup: null,
      toolSequenceGroupGapBelow: 0,
      isToolSequenceGroupContinuation: false,
      isFirstInUserGroup: item.kind === "user_message" && aboveItem?.kind !== "user_message",
      isLastInUserGroup: item.kind === "user_message" && belowItem?.kind !== "user_message",
      isLastInToolSequence: isToolSequenceItem(item) && !isToolSequenceItem(belowItem),
      frameOrder: input.frameOrder,
    };
  });
  return assignToolSequenceGroups(items);
}

export function layoutStream(input: StreamLayoutInput): StreamLayout {
  const auxiliaryTurnFooter = resolveAuxiliaryTurnFooter(input);
  const historyBoundaryIndex = input.strategy.getHistoryLiveBoundaryIndex(input.history);
  const liveHeadBoundaryIndex = input.strategy.getLiveHeadHistoryBoundaryIndex(input.liveHead);
  const historyBoundaryItem =
    historyBoundaryIndex === null ? null : (input.history[historyBoundaryIndex] ?? null);
  const liveHeadBoundaryItem =
    liveHeadBoundaryIndex === null ? null : (input.liveHead[liveHeadBoundaryIndex] ?? null);
  const frameOrder = input.strategy.getFrameChildOrder();
  const history = layoutSegment({
    strategy: input.strategy,
    agentStatus: input.agentStatus,
    items: input.history,
    timingByAssistantId: input.timingByAssistantId,
    auxiliaryTurnFooter,
    frameOrder,
    boundaryIndex: historyBoundaryIndex,
    boundaryAboveItem: null,
    boundaryBelowItem: liveHeadBoundaryItem,
  });
  const liveHead = layoutSegment({
    strategy: input.strategy,
    agentStatus: input.agentStatus,
    items: input.liveHead,
    timingByAssistantId: input.timingByAssistantId,
    auxiliaryTurnFooter,
    frameOrder,
    boundaryIndex: liveHeadBoundaryIndex,
    boundaryAboveItem: historyBoundaryItem,
    boundaryBelowItem: null,
  });

  return {
    history,
    liveHead,
    auxiliaryTurnFooter,
  };
}
