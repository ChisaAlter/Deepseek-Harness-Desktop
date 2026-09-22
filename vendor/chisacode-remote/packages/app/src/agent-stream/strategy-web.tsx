import React, {
  Fragment,
  type CSSProperties,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { ActivityIndicator } from "react-native";
import { measureElement as measureVirtualElement, useVirtualizer } from "@tanstack/react-virtual";
import { estimateStreamItemHeight } from "./web-virtualization";
import type { StreamRenderInput, StreamStrategy, StreamViewportHandle } from "./strategy";
import { createStreamStrategy } from "./strategy";
import {
  createTurnAnchorControllerDriver,
  type TurnAnchorControllerDriver,
  type TurnAnchorMeasurement,
} from "./turn-anchor-controller";
import type { TurnAnchorRequest } from "./turn-anchor-controller";
import type { StreamItem } from "@/types/stream";

interface CreateWebStreamStrategyInput {
  isMobileBreakpoint: boolean;
}

type ScrollBehaviorLike = "auto" | "smooth";

const WEB_BOTTOM_SETTLE_TIMEOUT_MS = 200;
const USER_SCROLL_DELTA_EPSILON = 1;
const AUTO_SCROLL_BOTTOM_THRESHOLD_PX = 64;
const AUTO_SCROLL_RESUME_THRESHOLD_PX = 1;
const HISTORY_START_THRESHOLD_PX = 96;
import { useWebElementScrollbar } from "@/components/use-web-scrollbar";

const historyStartSlotStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  minHeight: 32,
  paddingTop: 4,
  paddingBottom: 8,
};

function isScrollContainerNearBottom(
  scrollContainer: Pick<HTMLElement, "scrollTop" | "clientHeight" | "scrollHeight">,
  thresholdPx = AUTO_SCROLL_BOTTOM_THRESHOLD_PX,
): boolean {
  const threshold = Number.isFinite(thresholdPx)
    ? Math.max(0, thresholdPx)
    : AUTO_SCROLL_BOTTOM_THRESHOLD_PX;
  const { scrollTop, clientHeight, scrollHeight } = scrollContainer;
  if (![scrollTop, clientHeight, scrollHeight].every(Number.isFinite)) {
    return true;
  }
  const distanceFromBottom = scrollHeight - clientHeight - scrollTop;
  return distanceFromBottom <= threshold;
}

function isScrollContainerAtBottom(
  scrollContainer: Pick<HTMLElement, "scrollTop" | "clientHeight" | "scrollHeight">,
): boolean {
  return isScrollContainerNearBottom(scrollContainer, AUTO_SCROLL_RESUME_THRESHOLD_PX);
}

function scrollElementToBottom(
  scrollContainer: HTMLElement,
  behavior: ScrollBehaviorLike = "auto",
): void {
  scrollContainer.scrollTo({
    top: scrollContainer.scrollHeight,
    behavior,
  });
}

function syncNearBottom(
  scrollContainer: HTMLElement | null,
  onNearBottomChange: (value: boolean) => void,
): boolean {
  if (!scrollContainer) {
    onNearBottomChange(true);
    return true;
  }
  const nextValue = isScrollContainerNearBottom(scrollContainer);
  onNearBottomChange(nextValue);
  return nextValue;
}

function getScrollContainerDistanceFromBottom(
  scrollContainer: Pick<HTMLElement, "scrollTop" | "clientHeight" | "scrollHeight">,
): number {
  return scrollContainer.scrollHeight - scrollContainer.clientHeight - scrollContainer.scrollTop;
}

function isScrollContainerOverscrolledPastBottom(
  scrollContainer: Pick<HTMLElement, "scrollTop" | "clientHeight" | "scrollHeight">,
): boolean {
  return getScrollContainerDistanceFromBottom(scrollContainer) < 0;
}

function WebStreamViewport(props: StreamRenderInput & { isMobileBreakpoint: boolean }) {
  const {
    segments,
    boundary,
    renderers,
    listEmptyComponent,
    viewportRef,
    routeBottomAnchorRequest,
    isAuthoritativeHistoryReady,
    onNearBottomChange,
    onNearHistoryStart,
    isLoadingOlderHistory,
    hasOlderHistory,
    scrollEnabled,
    isMobileBreakpoint,
    turnAnchorRequest = null,
    isTurnAnchorEnabled = false,
  } = props;
  const scrollContainerRef = useRef<HTMLElement | null>(null);
  const contentRef = useRef<HTMLElement | null>(null);
  const handleScrollContainerRef = useCallback((node: HTMLElement | null) => {
    scrollContainerRef.current = node;
  }, []);
  const handleContentRef = useCallback((node: HTMLElement | null) => {
    contentRef.current = node;
  }, []);
  const [followOutput, setFollowOutputr] = useState(true);
  const setFollowOutput = (value: boolean) => {
    setFollowOutputr(value);
    return value;
  };
  const followOutputRef = useRef(followOutput);
  const lastKnownScrollTopRef = useRef(0);
  const pendingUserScrollUpIntentRef = useRef(false);
  const isPointerScrollActiveRef = useRef(false);
  const lastTouchClientYRef = useRef<number | null>(null);
  const pendingAutoScrollFrameRef = useRef<number | null>(null);
  const pendingAutoScrollTimeoutRef = useRef<number | null>(null);
  const pendingVirtualRowMeasureFramesRef = useRef(new Map<Element, number>());
  const historyStartReadyRef = useRef(false);
  const showDesktopWebScrollbar = !isMobileBreakpoint;
  const scrollbarOverlay = useWebElementScrollbar(scrollContainerRef, {
    enabled: showDesktopWebScrollbar,
    contentRef,
  });
  const shouldUseVirtualizer = segments.historyVirtualized.length > 0;
  const {
    renderHistoryVirtualizedRow,
    renderHistoryMountedRow,
    renderLiveHeadRow,
    renderLiveAuxiliary,
  } = renderers;

  followOutputRef.current = followOutput;

  const activationKey = routeBottomAnchorRequest?.requestKey ?? props.agentId;
  const isActivationReady = routeBottomAnchorRequest === null || isAuthoritativeHistoryReady;

  const rowVirtualizer = useVirtualizer({
    count: segments.historyVirtualized.length,
    getScrollElement: () => scrollContainerRef.current,
    getItemKey: (index: number) => segments.historyVirtualized[index]?.id ?? index,
    estimateSize: (index: number) => {
      const row = segments.historyVirtualized[index];
      return row ? estimateStreamItemHeight(row) : 120;
    },
    measureElement: measureVirtualElement,
    useAnimationFrameWithResizeObserver: true,
    overscan: 8,
  });
  useEffect(() => {
    rowVirtualizer.shouldAdjustScrollPositionOnItemSizeChange = (_item, _delta, instance) => {
      const viewportHeight = instance.scrollRect?.height ?? 0;
      const scrollOffset = instance.scrollOffset ?? 0;
      const remainingDistance = instance.getTotalSize() - (scrollOffset + viewportHeight);
      return remainingDistance > AUTO_SCROLL_BOTTOM_THRESHOLD_PX;
    };
    return () => {
      rowVirtualizer.shouldAdjustScrollPositionOnItemSizeChange = undefined;
    };
  }, [rowVirtualizer]);
  const virtualRows = rowVirtualizer.getVirtualItems();
  const virtualTotalSize = rowVirtualizer.getTotalSize();

  const measureVirtualizedRowElement = useCallback(
    (node: HTMLDivElement | null) => {
      if (!node) {
        rowVirtualizer.measureElement(null);
        return;
      }
      const pendingFrames = pendingVirtualRowMeasureFramesRef.current;
      const existingFrame = pendingFrames.get(node);
      if (existingFrame !== undefined) {
        window.cancelAnimationFrame(existingFrame);
      }
      const frame = window.requestAnimationFrame(() => {
        pendingFrames.delete(node);
        if (node.isConnected) {
          rowVirtualizer.measureElement(node);
        }
      });
      pendingFrames.set(node, frame);
    },
    [rowVirtualizer],
  );

  useEffect(() => {
    const pendingFrames = pendingVirtualRowMeasureFramesRef.current;
    return () => {
      for (const frame of pendingFrames.values()) {
        window.cancelAnimationFrame(frame);
      }
      pendingFrames.clear();
    };
  }, []);

  const cancelPendingStickToBottom = useCallback(() => {
    const pendingFrame = pendingAutoScrollFrameRef.current;
    if (pendingFrame !== null) {
      pendingAutoScrollFrameRef.current = null;
      window.cancelAnimationFrame(pendingFrame);
    }
    const pendingTimeout = pendingAutoScrollTimeoutRef.current;
    if (pendingTimeout !== null) {
      pendingAutoScrollTimeoutRef.current = null;
      window.clearTimeout(pendingTimeout);
    }
  }, []);

  const scrollMessagesToBottom = useCallback(
    (behavior: ScrollBehaviorLike = "auto") => {
      const scrollContainer = scrollContainerRef.current;
      if (!scrollContainer) {
        return;
      }
      if (isScrollContainerOverscrolledPastBottom(scrollContainer)) {
        return;
      }
      scrollElementToBottom(scrollContainer, behavior);
      lastKnownScrollTopRef.current = scrollContainer.scrollTop;
      syncNearBottom(scrollContainer, onNearBottomChange);
    },
    [onNearBottomChange],
  );

  const scheduleStickToBottom = useCallback(() => {
    const scrollContainer = scrollContainerRef.current;
    if (scrollContainer && isScrollContainerOverscrolledPastBottom(scrollContainer)) {
      return;
    }
    if (pendingAutoScrollFrameRef.current !== null) {
      return;
    }
    pendingAutoScrollFrameRef.current = window.requestAnimationFrame(() => {
      pendingAutoScrollFrameRef.current = null;
      if (!followOutputRef.current) {
        return;
      }
      scrollMessagesToBottom("auto");
    });
  }, [scrollMessagesToBottom]);

  const forceStickToBottom = useCallback(() => {
    cancelPendingStickToBottom();
    scrollMessagesToBottom("auto");
    scheduleStickToBottom();
  }, [cancelPendingStickToBottom, scheduleStickToBottom, scrollMessagesToBottom]);

  const updateScrollMetrics = useCallback(() => {
    const scrollContainer = scrollContainerRef.current;
    if (!scrollContainer) {
      onNearBottomChange(true);
      return;
    }
    syncNearBottom(scrollContainer, onNearBottomChange);
  }, [onNearBottomChange]);

  const handleDomScroll = useCallback(() => {
    const scrollContainer = scrollContainerRef.current;
    if (!scrollContainer) {
      return;
    }

    const currentScrollTop = scrollContainer.scrollTop;
    const isAtBottom = isScrollContainerAtBottom(scrollContainer);
    const scrolledUp = currentScrollTop < lastKnownScrollTopRef.current - USER_SCROLL_DELTA_EPSILON;

    if (!followOutputRef.current && isAtBottom) {
      setFollowOutput(true);
      pendingUserScrollUpIntentRef.current = false;
    } else if (followOutputRef.current && pendingUserScrollUpIntentRef.current) {
      if (scrolledUp) {
        cancelPendingStickToBottom();
        setFollowOutput(false);
      }
      pendingUserScrollUpIntentRef.current = false;
    } else if (followOutputRef.current && isPointerScrollActiveRef.current) {
      if (scrolledUp) {
        cancelPendingStickToBottom();
        setFollowOutput(false);
      }
    }

    lastKnownScrollTopRef.current = currentScrollTop;
    updateScrollMetrics();
    if (
      historyStartReadyRef.current &&
      hasOlderHistory &&
      currentScrollTop <= HISTORY_START_THRESHOLD_PX
    ) {
      onNearHistoryStart();
    }
  }, [cancelPendingStickToBottom, hasOlderHistory, onNearHistoryStart, updateScrollMetrics]);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      historyStartReadyRef.current = true;
    });
    return () => {
      window.cancelAnimationFrame(frame);
      historyStartReadyRef.current = false;
    };
  }, [props.agentId]);

  useLayoutEffect(() => {
    if (!isActivationReady) {
      return;
    }
    setFollowOutput(true);
    forceStickToBottom();
    const timeout = window.setTimeout(() => {
      if (!followOutputRef.current) {
        return;
      }
      const scrollContainer = scrollContainerRef.current;
      if (!scrollContainer) {
        return;
      }
      if (isScrollContainerNearBottom(scrollContainer)) {
        return;
      }
      scheduleStickToBottom();
    }, WEB_BOTTOM_SETTLE_TIMEOUT_MS);
    return () => {
      window.clearTimeout(timeout);
    };
  }, [activationKey, forceStickToBottom, isActivationReady, scheduleStickToBottom]);

  useEffect(() => {
    if (!followOutputRef.current) {
      return;
    }
    scheduleStickToBottom();
  }, [
    scheduleStickToBottom,
    segments.historyMounted,
    segments.historyVirtualized,
    segments.liveHead,
  ]);

  useEffect(() => {
    if (!followOutputRef.current || !shouldUseVirtualizer) {
      return;
    }
    scheduleStickToBottom();
  }, [scheduleStickToBottom, shouldUseVirtualizer, virtualTotalSize]);

  useEffect(() => {
    updateScrollMetrics();
  }, [
    segments.historyMounted.length,
    segments.historyVirtualized.length,
    segments.liveHead.length,
    updateScrollMetrics,
    virtualTotalSize,
  ]);

  useEffect(() => {
    const scrollContainer = scrollContainerRef.current;
    const contentNode = contentRef.current;
    if (!scrollContainer || typeof ResizeObserver === "undefined") {
      return;
    }

    updateScrollMetrics();
    const observer = new ResizeObserver(() => {
      updateScrollMetrics();
      if (!followOutputRef.current) {
        return;
      }
      scheduleStickToBottom();
    });
    observer.observe(scrollContainer);
    if (contentNode) {
      observer.observe(contentNode);
    }
    return () => {
      observer.disconnect();
    };
  }, [scheduleStickToBottom, updateScrollMetrics]);

  useEffect(() => {
    const scrollContainer = scrollContainerRef.current;
    if (!scrollContainer) {
      return;
    }

    const handleWheel = (event: WheelEvent) => {
      if (event.deltaY < 0) {
        pendingUserScrollUpIntentRef.current = true;
        cancelPendingStickToBottom();
      }
    };
    const handlePointerDown = () => {
      isPointerScrollActiveRef.current = true;
    };
    const handlePointerUp = () => {
      isPointerScrollActiveRef.current = false;
    };
    const handleTouchStart = (event: TouchEvent) => {
      const touch = event.touches[0];
      if (!touch) {
        return;
      }
      lastTouchClientYRef.current = touch.clientY;
    };
    const handleTouchMove = (event: TouchEvent) => {
      const touch = event.touches[0];
      if (!touch) {
        return;
      }
      const previousTouchY = lastTouchClientYRef.current;
      if (previousTouchY !== null && touch.clientY > previousTouchY + 1) {
        pendingUserScrollUpIntentRef.current = true;
        cancelPendingStickToBottom();
      }
      lastTouchClientYRef.current = touch.clientY;
    };
    const handleTouchEnd = () => {
      lastTouchClientYRef.current = null;
    };

    scrollContainer.addEventListener("scroll", handleDomScroll, { passive: true });
    scrollContainer.addEventListener("wheel", handleWheel, { passive: true });
    scrollContainer.addEventListener("pointerdown", handlePointerDown, { passive: true });
    scrollContainer.addEventListener("pointerup", handlePointerUp, { passive: true });
    scrollContainer.addEventListener("pointercancel", handlePointerUp, { passive: true });
    scrollContainer.addEventListener("touchstart", handleTouchStart, { passive: true });
    scrollContainer.addEventListener("touchmove", handleTouchMove, { passive: true });
    scrollContainer.addEventListener("touchend", handleTouchEnd, { passive: true });
    scrollContainer.addEventListener("touchcancel", handleTouchEnd, { passive: true });

    return () => {
      scrollContainer.removeEventListener("scroll", handleDomScroll);
      scrollContainer.removeEventListener("wheel", handleWheel);
      scrollContainer.removeEventListener("pointerdown", handlePointerDown);
      scrollContainer.removeEventListener("pointerup", handlePointerUp);
      scrollContainer.removeEventListener("pointercancel", handlePointerUp);
      scrollContainer.removeEventListener("touchstart", handleTouchStart);
      scrollContainer.removeEventListener("touchmove", handleTouchMove);
      scrollContainer.removeEventListener("touchend", handleTouchEnd);
      scrollContainer.removeEventListener("touchcancel", handleTouchEnd);
    };
  }, [cancelPendingStickToBottom, handleDomScroll]);

  useEffect(() => {
    const handle: StreamViewportHandle = {
      scrollToBottom: () => {
        setFollowOutput(true);
        cancelPendingStickToBottom();
        forceStickToBottom();
        // Forget any pending anchor: jumping to the end cancels anchoring.
        turnAnchorRequestRef.current = null;
        turnAnchorControllerRef.current?.applySendAnchor({
          reason: "jump-to-end",
          anchorMessageId: null,
          requestKey: `${props.agentId}:jump-to-end`,
        });
      },
      prepareForViewportChange: () => {
        if (!followOutputRef.current) {
          return;
        }
        scheduleStickToBottom();
      },
      requestTurnAnchor: (request) => {
        // Record the request so the lazy measurement can resolve the anchor
        // row, then hand it to the controller.
        turnAnchorRequestRef.current = request;
        turnAnchorControllerRef.current?.applySendAnchor(request);
      },
    };
    viewportRef.current = handle;
    return () => {
      if (viewportRef.current === handle) {
        viewportRef.current = null;
      }
      cancelPendingStickToBottom();
    };
  }, [
    cancelPendingStickToBottom,
    forceStickToBottom,
    props.agentId,
    scheduleStickToBottom,
    viewportRef,
  ]);

  // ---------------------------------------------------------------------------
  // Turn-anchor scroll (web only): after the user sends a message, pin the
  // sent row near the top of the usable viewport and let the reply grow below
  // it. Reuses the estimated row positions so no extra DOM measurement pass is
  // needed, and falls back to plain sticky-bottom when disabled.
  // ---------------------------------------------------------------------------

  const turnAnchorControllerRef = useRef<TurnAnchorControllerDriver | null>(null);
  const turnAnchorRequestRef = useRef<TurnAnchorRequest | null>(null);
  const anchorScrollDeltaRef = useRef(0);
  const previousContentHeightRef = useRef(0);

  const turnAnchorMeasurementRef = useRef<TurnAnchorMeasurement>({
    data: [],
    scroll: 0,
    scrollLength: 0,
    viewportLength: 0,
    positionAtIndex: () => undefined,
    sizeAtIndex: () => undefined,
    anchorIndex: null,
    composerOverlayHeight: 0,
  });

  const getTurnAnchorMeasurement = useCallback((): TurnAnchorMeasurement => {
    const current = turnAnchorMeasurementRef.current;
    const anchorId = turnAnchorRequestRef.current?.anchorMessageId ?? null;
    if (anchorId === null) {
      return current;
    }
    // Resolve the anchor row lazily at positioning time: the request can land
    // before or after the optimistic entry appears in the rendered items.
    let anchorIndex: number | null = null;
    for (let index = 0; index < current.data.length; index += 1) {
      const item = current.data[index] as { id?: string } | undefined;
      if (item?.id === anchorId) {
        anchorIndex = index;
        break;
      }
    }
    if (anchorIndex === null) {
      // The daemon may have adopted the message under a different id (the
      // canonical merge keeps the server id), so fall back to the last user
      // message — the row the user just sent.
      for (let index = current.data.length - 1; index >= 0; index -= 1) {
        const item = current.data[index] as { kind?: string } | undefined;
        if (item?.kind === "user_message") {
          anchorIndex = index;
          break;
        }
      }
    }
    return anchorIndex === current.anchorIndex ? current : { ...current, anchorIndex };
  }, []);

  const scrollByDelta = useCallback((delta: number) => {
    const scrollContainer = scrollContainerRef.current;
    if (!scrollContainer) {
      return;
    }
    anchorScrollDeltaRef.current += delta;
    const nextTop = scrollContainer.scrollTop + delta;
    // Clamp to the valid range; the scroll handler keeps follow state in sync.
    scrollContainer.scrollTop = Math.max(
      0,
      Math.min(nextTop, scrollContainer.scrollHeight - scrollContainer.clientHeight),
    );
  }, []);

  const scheduleFrame = useCallback((callback: () => void): number => {
    return window.requestAnimationFrame(callback);
  }, []);
  const cancelFrame = useCallback((handle: unknown) => {
    if (typeof handle === "number") {
      window.cancelAnimationFrame(handle);
    }
  }, []);

  useEffect(() => {
    turnAnchorControllerRef.current?.destroy();
    turnAnchorControllerRef.current = createTurnAnchorControllerDriver({
      getMeasurement: getTurnAnchorMeasurement,
      scrollByDelta,
      onModeChange: (nextMode) => {
        if (nextMode === "following-end") {
          setFollowOutput(true);
          scheduleStickToBottom();
        } else if (nextMode === "anchoring-new-turn") {
          setFollowOutput(false);
          cancelPendingStickToBottom();
        }
      },
      scheduleFrame,
      cancelFrame,
    });
    return () => {
      turnAnchorControllerRef.current?.destroy();
      turnAnchorControllerRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.agentId]);

  // Build the flat rendered item order (virtualized + mounted + live head) so
  // the anchor row index and estimated positions are consistent with the DOM.
  const orderedRenderItems = useMemo<StreamItem[]>(() => {
    if (shouldUseVirtualizer) {
      return [...segments.historyVirtualized, ...segments.historyMounted, ...segments.liveHead];
    }
    return [...segments.historyMounted, ...segments.liveHead];
  }, [
    segments.historyMounted,
    segments.historyVirtualized,
    segments.liveHead,
    shouldUseVirtualizer,
  ]);

  useEffect(() => {
    const items = orderedRenderItems;

    const scrollContainer = scrollContainerRef.current;
    const scroll = scrollContainer?.scrollTop ?? 0;
    const scrollLength = scrollContainer?.scrollHeight ?? 0;
    const viewportLength = scrollContainer?.clientHeight ?? 0;

    // anchorIndex is resolved lazily in getTurnAnchorMeasurement, because the
    // anchor request can arrive in a different commit than the row it targets.
    turnAnchorMeasurementRef.current = {
      data: items,
      scroll,
      scrollLength,
      viewportLength,
      positionAtIndex: (index) => {
        if (index < 0) {
          return 0;
        }
        let top = 0;
        for (let i = 0; i < index; i += 1) {
          const item = items[i];
          top += item ? estimateStreamItemHeight(item) : 0;
        }
        return top;
      },
      sizeAtIndex: (index) => {
        const item = items[index];
        return item ? estimateStreamItemHeight(item) : undefined;
      },
      anchorIndex: null,
      composerOverlayHeight: 0,
    };
  }, [orderedRenderItems, props.agentId, shouldUseVirtualizer]);

  // Feed send anchors from the parent into the controller, keyed per agent.
  useEffect(() => {
    if (!isTurnAnchorEnabled) {
      return;
    }
    if (!turnAnchorRequest) {
      return;
    }
    turnAnchorRequestRef.current = turnAnchorRequest;
    turnAnchorControllerRef.current?.applySendAnchor(turnAnchorRequest);
    previousContentHeightRef.current = turnAnchorMeasurementRef.current.scrollLength;
  }, [isTurnAnchorEnabled, turnAnchorRequest]);

  // Notify the controller of content growth so the reply end stays visible
  // once the anchored turn overflows the usable viewport.
  useEffect(() => {
    if (!isTurnAnchorEnabled) {
      return;
    }
    const scrollContainer = scrollContainerRef.current;
    if (!scrollContainer || typeof ResizeObserver === "undefined") {
      return;
    }
    const observer = new ResizeObserver(() => {
      const contentHeight = scrollContainer.scrollHeight;
      turnAnchorControllerRef.current?.handleContentSizeChange({
        previousContentHeight: previousContentHeightRef.current,
        contentHeight,
      });
      previousContentHeightRef.current = contentHeight;
    });
    observer.observe(scrollContainer);
    if (contentRef.current) {
      observer.observe(contentRef.current);
    }
    return () => {
      observer.disconnect();
    };
  }, [contentRef, isTurnAnchorEnabled, scrollContainerRef]);

  // User scroll-away while anchored detaches to free-scrolling; returning to
  // the bottom resumes following-end.
  useEffect(() => {
    if (!isTurnAnchorEnabled) {
      return;
    }
    const scrollContainer = scrollContainerRef.current;
    if (!scrollContainer) {
      return;
    }
    let lastScrollTop = scrollContainer.scrollTop;
    const handleScroll = () => {
      const currentScrollTop = scrollContainer.scrollTop;
      const delta = currentScrollTop - lastScrollTop;
      lastScrollTop = currentScrollTop;
      const nearBottom = isScrollContainerNearBottom(scrollContainer);
      turnAnchorControllerRef.current?.handleScrollNearBottomChange({
        nextIsNearBottom: nearBottom,
        scrollDelta: delta,
      });
    };
    scrollContainer.addEventListener("scroll", handleScroll, { passive: true });
    return () => {
      scrollContainer.removeEventListener("scroll", handleScroll);
    };
  }, [isTurnAnchorEnabled, scrollContainerRef]);

  // Detach when the user wheels/touches upward while anchored.
  useEffect(() => {
    if (!isTurnAnchorEnabled) {
      return;
    }
    const scrollContainer = scrollContainerRef.current;
    if (!scrollContainer) {
      return;
    }
    const handleWheel = (event: WheelEvent) => {
      if (event.deltaY < 0) {
        turnAnchorControllerRef.current?.detachByUser();
      }
    };
    scrollContainer.addEventListener("wheel", handleWheel, { passive: true });
    return () => {
      scrollContainer.removeEventListener("wheel", handleWheel);
    };
  }, [isTurnAnchorEnabled, scrollContainerRef]);

  const contentContainerStyle = useMemo((): CSSProperties => {
    // Soft .stream: padding 14px 28px 10px.
    return {
      display: "flex",
      flexDirection: "column",
      minHeight: "100%",
      paddingTop: 14,
      paddingBottom: 10,
      // Soft .m-stream: 12 14 8; desktop .stream: 14 28 10.
      paddingLeft: isMobileBreakpoint ? 14 : 28,
      paddingRight: isMobileBreakpoint ? 14 : 28,
      boxSizing: "border-box",
    };
  }, [isMobileBreakpoint]);
  const scrollContainerStyle = useMemo((): CSSProperties => {
    return {
      flex: 1,
      minHeight: 0,
      overflowX: "hidden",
      overflowY: scrollEnabled ? "auto" : "hidden",
      overscrollBehaviorY: "contain",
    };
  }, [scrollEnabled]);
  const virtualRowsContainerStyle = useMemo((): CSSProperties => {
    return {
      position: "relative",
      width: "100%",
      height: virtualTotalSize,
    };
  }, [virtualTotalSize]);
  const renderVirtualRowStyle = useCallback(
    (start: number): CSSProperties => ({
      position: "absolute",
      top: 0,
      left: 0,
      display: "flex",
      flexDirection: "column",
      width: "100%",
      transform: `translateY(${start}px)`,
    }),
    [],
  );
  const mountedHistoryRows = useMemo(() => {
    return segments.historyMounted.map((item, index) => (
      <Fragment key={item.id}>
        {renderHistoryMountedRow(item, index, segments.historyMounted)}
      </Fragment>
    ));
  }, [renderHistoryMountedRow, segments.historyMounted]);
  const liveHeadRows = useMemo(() => {
    return segments.liveHead.map((item, index) => (
      <Fragment key={item.id}>{renderLiveHeadRow(item, index, segments.liveHead)}</Fragment>
    ));
  }, [renderLiveHeadRow, segments.liveHead]);
  const liveAuxiliary = useMemo(() => {
    return renderLiveAuxiliary();
  }, [renderLiveAuxiliary]);
  const historyStartSlot = useMemo(() => {
    if (!isLoadingOlderHistory) {
      return null;
    }
    return (
      <div style={historyStartSlotStyle} data-testid="load-older-history-spinner">
        <ActivityIndicator size="small" />
      </div>
    );
  }, [isLoadingOlderHistory]);
  const shouldRenderEmpty =
    !boundary.hasMountedHistory &&
    !boundary.hasVirtualizedHistory &&
    !boundary.hasLiveHead &&
    !liveAuxiliary;

  return (
    <>
      <div
        ref={handleScrollContainerRef}
        data-testid="agent-chat-scroll"
        id={`agent-chat-scroll-${shouldUseVirtualizer ? "web-dom-virtualized" : "web-dom-scroll"}`}
        style={scrollContainerStyle}
      >
        <div ref={handleContentRef} style={contentContainerStyle}>
          {historyStartSlot}
          {shouldUseVirtualizer ? (
            <div style={virtualRowsContainerStyle}>
              {virtualRows.map((virtualRow) => {
                const item = segments.historyVirtualized[virtualRow.index];
                if (!item) {
                  return null;
                }
                return (
                  <div
                    key={virtualRow.key}
                    data-index={virtualRow.index}
                    ref={measureVirtualizedRowElement}
                    style={renderVirtualRowStyle(virtualRow.start)}
                  >
                    {renderHistoryVirtualizedRow(
                      item,
                      virtualRow.index,
                      segments.historyVirtualized,
                    )}
                  </div>
                );
              })}
            </div>
          ) : null}
          {mountedHistoryRows}
          {liveHeadRows}
          {liveAuxiliary}
          {shouldRenderEmpty ? listEmptyComponent : null}
        </div>
      </div>
      {scrollbarOverlay}
    </>
  );
}

export function createWebStreamStrategy(input: CreateWebStreamStrategyInput): StreamStrategy {
  return createStreamStrategy({
    render: (renderInput) => (
      <WebStreamViewport
        key={renderInput.agentId}
        {...renderInput}
        isMobileBreakpoint={input.isMobileBreakpoint}
      />
    ),
    orderTailReverse: false,
    orderHeadReverse: false,
    assistantTurnTraversalStep: -1,
    edgeSlot: "footer",
    historyLiveBoundaryEdge: "last",
    liveHeadHistoryBoundaryEdge: "first",
    frameChildOrder: "content-then-footer",
    flatListInverted: false,
    overlayScrollbarInverted: false,
    maintainVisibleContentPosition: undefined,
    bottomAnchorTransportBehavior: {
      verificationDelayFrames: 0,
      verificationRetryMode: "rescroll",
    },
    disableParentScrollOnInlineDetailsExpansion: false,
    anchorBottomOnContentSizeChange: true,
    animateManualScrollToBottom: false,
    useVirtualizedList: false,
    isNearBottom: (inputMetrics) => {
      const distanceFromBottom = Math.max(
        0,
        inputMetrics.contentHeight - (inputMetrics.offsetY + inputMetrics.viewportHeight),
      );
      return distanceFromBottom <= inputMetrics.threshold;
    },
    getBottomOffset: (metrics) => Math.max(0, metrics.contentHeight - metrics.viewportHeight),
  });
}
