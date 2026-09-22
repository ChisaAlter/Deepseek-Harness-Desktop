import { describe, expect, it } from "vitest";
import {
  TURN_ANCHOR_OFFSET_PX,
  getAnchoredTurnMetrics,
  getRowBottom,
  resolveTurnAnchoredEndSpace,
  type TurnAnchorMeasurementState,
} from "./turn-anchor-metrics";

function createMeasurementState(
  overrides?: Partial<TurnAnchorMeasurementState>,
): TurnAnchorMeasurementState {
  const items = Array.from({ length: 4 }, (_, index) => ({ id: `row-${index}` }));
  return {
    data: items,
    scroll: 0,
    scrollLength: 1000,
    viewportLength: 800,
    positionAtIndex: (index) => index * 100,
    sizeAtIndex: () => 100,
    ...overrides,
  };
}

describe("getRowBottom", () => {
  it("returns top + height for measured rows", () => {
    const state = createMeasurementState();
    expect(getRowBottom(state, 0)).toBe(100);
    expect(getRowBottom(state, 3)).toBe(400);
  });

  it("treats a zero height as 1px", () => {
    const state = createMeasurementState({ sizeAtIndex: () => 0 });
    expect(getRowBottom(state, 1)).toBe(101);
  });

  it("returns null when height is missing", () => {
    const state = createMeasurementState({ sizeAtIndex: () => undefined });
    expect(getRowBottom(state, 1)).toBeNull();
  });

  it("returns null when top is missing or not finite", () => {
    const missing = createMeasurementState({ positionAtIndex: () => undefined });
    expect(getRowBottom(missing, 2)).toBeNull();

    const nan = createMeasurementState({ positionAtIndex: () => Number.NaN });
    expect(getRowBottom(nan, 2)).toBeNull();
  });
});

describe("getAnchoredTurnMetrics", () => {
  it("returns null for an empty list", () => {
    const state = createMeasurementState({ data: [] });
    expect(getAnchoredTurnMetrics({ state, anchorIndex: 0, composerOverlayHeight: 0 })).toBeNull();
  });

  it("clamps an out-of-range anchor index to the list bounds", () => {
    const state = createMeasurementState();
    const below = getAnchoredTurnMetrics({ state, anchorIndex: -5, composerOverlayHeight: 0 });
    const above = getAnchoredTurnMetrics({ state, anchorIndex: 99, composerOverlayHeight: 0 });
    expect(below?.anchorTop).toBe(0);
    expect(above?.anchorTop).toBe(300);
  });

  it("returns null when the anchor row cannot be measured", () => {
    const state = createMeasurementState({
      positionAtIndex: (index) => (index === 2 ? Number.NaN : index * 100),
    });
    expect(getAnchoredTurnMetrics({ state, anchorIndex: 2, composerOverlayHeight: 0 })).toBeNull();
  });

  it("reports non-overflowing turns with zero scroll delta", () => {
    const state = createMeasurementState({
      data: [{ id: "anchor" }, { id: "reply" }],
      scrollLength: 600,
      viewportLength: 400,
      scroll: 0,
      positionAtIndex: (index) => index * 60,
      sizeAtIndex: () => 60,
    });
    const metrics = getAnchoredTurnMetrics({ state, anchorIndex: 0, composerOverlayHeight: 40 });
    expect(metrics).not.toBeNull();
    expect(metrics?.overflowsUsableViewport).toBe(false);
    expect(metrics?.scrollDeltaToRevealEnd).toBe(0);
    expect(metrics?.usableViewportHeight).toBe(600 - 40 - TURN_ANCHOR_OFFSET_PX);
  });

  it("computes the delta to reveal the turn end when it overflows", () => {
    const state = createMeasurementState({
      data: [{ id: "anchor" }, { id: "reply" }],
      scrollLength: 300,
      viewportLength: 100,
      scroll: 0,
      positionAtIndex: (index) => index * 100,
      sizeAtIndex: () => 100,
    });
    // Turn height 200; usable viewport = 300 - 0 - 16 = 284 → no overflow.
    const noOverflow = getAnchoredTurnMetrics({ state, anchorIndex: 0, composerOverlayHeight: 0 });
    expect(noOverflow?.overflowsUsableViewport).toBe(false);

    const tall = createMeasurementState({
      data: [{ id: "anchor" }, { id: "reply" }],
      scrollLength: 200,
      viewportLength: 150,
      scroll: 0,
      positionAtIndex: (index) => index * 100,
      sizeAtIndex: () => 100,
    });
    // Usable viewport = 200 - 0 - 16 = 184; turn end at 200 → target scroll = 16.
    const metrics = getAnchoredTurnMetrics({
      state: tall,
      anchorIndex: 0,
      composerOverlayHeight: 0,
    });
    expect(metrics?.overflowsUsableViewport).toBe(true);
    expect(metrics?.targetScrollToRevealEnd).toBe(16);
    expect(metrics?.scrollDeltaToRevealEnd).toBe(16);
  });

  it("grows the delta when the composer overlay eats viewport", () => {
    const state = createMeasurementState({
      data: [{ id: "anchor" }, { id: "reply" }],
      scrollLength: 200,
      viewportLength: 150,
      scroll: 0,
      positionAtIndex: (index) => index * 100,
      sizeAtIndex: () => 100,
    });
    const withoutComposer = getAnchoredTurnMetrics({
      state,
      anchorIndex: 0,
      composerOverlayHeight: 0,
    });
    const withComposer = getAnchoredTurnMetrics({
      state,
      anchorIndex: 0,
      composerOverlayHeight: 60,
    });
    expect(withComposer?.scrollDeltaToRevealEnd ?? 0).toBeGreaterThan(
      withoutComposer?.scrollDeltaToRevealEnd ?? 0,
    );
  });

  it("never reports a negative delta when already scrolled past the turn end", () => {
    const state = createMeasurementState({
      data: [{ id: "anchor" }, { id: "reply" }],
      scrollLength: 200,
      viewportLength: 150,
      scroll: 500,
      positionAtIndex: (index) => index * 100,
      sizeAtIndex: () => 100,
    });
    const metrics = getAnchoredTurnMetrics({ state, anchorIndex: 0, composerOverlayHeight: 0 });
    expect(metrics?.scrollDeltaToRevealEnd).toBe(0);
  });
});

describe("resolveTurnAnchoredEndSpace", () => {
  const items = [{ id: "m1" }, { id: "m2" }, { id: "m3" }];

  it("finds the anchor from the tail", () => {
    expect(resolveTurnAnchoredEndSpace(items, "m2", (item) => item.id)).toEqual({
      anchorIndex: 1,
      anchorOffset: TURN_ANCHOR_OFFSET_PX,
    });
  });

  it("returns undefined when anchorId is null", () => {
    expect(resolveTurnAnchoredEndSpace(items, null, (item) => item.id)).toBeUndefined();
  });

  it("returns undefined for an empty list", () => {
    const empty: Array<{ id: string }> = [];
    expect(resolveTurnAnchoredEndSpace(empty, "m1", (item) => item.id)).toBeUndefined();
  });

  it("returns undefined when no row matches", () => {
    expect(resolveTurnAnchoredEndSpace(items, "missing", (item) => item.id)).toBeUndefined();
  });

  it("prefers the last matching row for duplicate ids", () => {
    const duplicated = [{ id: "dup" }, { id: "other" }, { id: "dup" }];
    expect(resolveTurnAnchoredEndSpace(duplicated, "dup", (item) => item.id)).toEqual({
      anchorIndex: 2,
      anchorOffset: TURN_ANCHOR_OFFSET_PX,
    });
  });

  it("honors a custom anchor offset", () => {
    expect(
      resolveTurnAnchoredEndSpace(items, "m1", (item) => item.id, { anchorOffset: 24 }),
    ).toEqual({ anchorIndex: 0, anchorOffset: 24 });
  });
});
