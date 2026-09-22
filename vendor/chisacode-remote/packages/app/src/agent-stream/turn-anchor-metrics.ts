/**
 * Turn-anchor scroll geometry for the agent chat timeline.
 *
 * After the user sends a message, the sent row is anchored near the top of the
 * usable viewport and the assistant reply grows into the reserved space below
 * it. These pure functions compute how much scroll offset is needed to reveal
 * the end of the anchored turn, taking the composer overlay height into
 * account. Ported semantics from T3 Code's `timelineScrollAnchoring.ts` /
 * `chatList.ts` (see docs/research/t3code-message-render-ux.md).
 */

export type TurnAnchorScrollMode = "following-end" | "anchoring-new-turn" | "free-scrolling";

export interface TurnAnchorMeasurementState {
  readonly data: readonly unknown[];
  readonly scroll: number;
  readonly scrollLength: number;
  /** Visible height of the scroll viewport (used to detect content too short to pin). */
  readonly viewportLength: number;
  readonly positionAtIndex: (index: number) => number | undefined;
  readonly sizeAtIndex: (index: number) => number | undefined;
}

export interface AnchoredTurnMetrics {
  readonly anchorTop: number;
  readonly lastBottom: number;
  readonly turnHeight: number;
  readonly usableViewportHeight: number;
  readonly visibleUsableBottom: number;
  readonly overflowsUsableViewport: boolean;
  readonly targetScrollToRevealEnd: number;
  readonly scrollDeltaToRevealEnd: number;
}

export interface TurnAnchoredEndSpace {
  readonly anchorIndex: number;
  readonly anchorOffset: number;
}

/** Offset between the viewport top and the anchored sent row. */
export const TURN_ANCHOR_OFFSET_PX = 16;

export function getRowBottom(state: TurnAnchorMeasurementState, index: number): number | null {
  const top = state.positionAtIndex(index);
  const height = state.sizeAtIndex(index);
  if (
    typeof top !== "number" ||
    typeof height !== "number" ||
    !Number.isFinite(top) ||
    !Number.isFinite(height)
  ) {
    return null;
  }

  return top + Math.max(1, height);
}

/**
 * Computes how the anchored turn (anchor row .. last row) relates to the usable
 * viewport, and the exact scroll delta required to reveal the turn's end.
 * @param state List measurement snapshot
 * @param anchorIndex Index of the anchored (sent user message) row
 * @param composerOverlayHeight Height of the composer overlay that eats usable viewport
 * @param anchorOffset Gap kept between the viewport top and the anchor row
 * @returns Metrics, or null when the list is empty or the anchor cannot be measured
 */
export function getAnchoredTurnMetrics(input: {
  state: TurnAnchorMeasurementState;
  anchorIndex: number;
  composerOverlayHeight: number;
  anchorOffset?: number;
}): AnchoredTurnMetrics | null {
  const { state, anchorIndex, composerOverlayHeight } = input;
  const anchorOffset = input.anchorOffset ?? TURN_ANCHOR_OFFSET_PX;
  if (state.data.length === 0) {
    return null;
  }

  const boundedAnchorIndex = Math.max(0, Math.min(anchorIndex, state.data.length - 1));
  const anchorTop = state.positionAtIndex(boundedAnchorIndex);
  const lastBottom = getRowBottom(state, state.data.length - 1);
  if (typeof anchorTop !== "number" || !Number.isFinite(anchorTop) || lastBottom === null) {
    return null;
  }

  const usableViewportHeight = Math.max(
    0,
    state.scrollLength - composerOverlayHeight - anchorOffset,
  );
  const turnHeight = Math.max(0, lastBottom - anchorTop);
  const visibleUsableBottom = state.scroll + usableViewportHeight;
  const targetScrollToRevealEnd = Math.max(0, lastBottom - usableViewportHeight);
  const scrollDeltaToRevealEnd = Math.max(0, targetScrollToRevealEnd - state.scroll);

  return {
    anchorTop,
    lastBottom,
    turnHeight,
    usableViewportHeight,
    visibleUsableBottom,
    overflowsUsableViewport: turnHeight > usableViewportHeight,
    targetScrollToRevealEnd,
    scrollDeltaToRevealEnd,
  };
}

/**
 * Finds the anchor row (from the tail) and the end-space reserved after it.
 * @param items Rendered rows in document order
 * @param anchorId Id of the anchored sent message, null disables anchoring
 * @param getAnchorId Maps a row to its message id
 * @param options Optional override of the anchor offset
 * @returns The anchor index and offset, or undefined when no row matches
 */
export function resolveTurnAnchoredEndSpace<Item, AnchorId>(
  items: ReadonlyArray<Item>,
  anchorId: AnchorId | null,
  getAnchorId: (item: Item) => AnchorId | null,
  options: { anchorOffset?: number } = {},
): TurnAnchoredEndSpace | undefined {
  if (anchorId === null) {
    return undefined;
  }

  for (let index = items.length - 1; index >= 0; index -= 1) {
    const item = items[index];
    if (item !== undefined && getAnchorId(item) === anchorId) {
      return {
        anchorIndex: index,
        anchorOffset: options.anchorOffset ?? TURN_ANCHOR_OFFSET_PX,
      };
    }
  }

  return undefined;
}
