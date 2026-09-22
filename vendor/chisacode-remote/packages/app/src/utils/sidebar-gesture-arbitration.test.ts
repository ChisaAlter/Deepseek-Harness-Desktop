import { describe, expect, it } from "vitest";

import {
  decideLongPressMove,
  shouldOpenContextMenuOnPressOut,
} from "./sidebar-gesture-arbitration";

describe("decideLongPressMove", () => {
  it("keeps long press pending for small movement before long-press arm", () => {
    expect(
      decideLongPressMove({
        dragArmed: false,
        didStartDrag: false,
        startPoint: { x: 0, y: 0 },
        currentPoint: { x: 3, y: 2 },
      }),
    ).toBe("none");
  });

  it("cancels long press when movement exceeds cancel slop before arm", () => {
    expect(
      decideLongPressMove({
        dragArmed: false,
        didStartDrag: false,
        startPoint: { x: 0, y: 0 },
        currentPoint: { x: 8, y: 8 },
      }),
    ).toBe("cancel_long_press");
  });

  it("yields to vertical scroll before drag arm", () => {
    expect(
      decideLongPressMove({
        dragArmed: false,
        didStartDrag: false,
        startPoint: { x: 0, y: 0 },
        currentPoint: { x: 2, y: 7 },
      }),
    ).toBe("vertical_scroll");
  });

  it("keeps diagonal motion neutral before drag arm", () => {
    expect(
      decideLongPressMove({
        dragArmed: false,
        didStartDrag: false,
        startPoint: { x: 0, y: 0 },
        currentPoint: { x: 5, y: 7 },
      }),
    ).toBe("none");
  });

  it("yields to horizontal swipe before drag arm", () => {
    expect(
      decideLongPressMove({
        dragArmed: false,
        didStartDrag: false,
        startPoint: { x: 0, y: 0 },
        currentPoint: { x: -10, y: 2 },
      }),
    ).toBe("horizontal_swipe");
  });

  it("starts drag when movement exceeds drag slop after long-press arm", () => {
    expect(
      decideLongPressMove({
        dragArmed: true,
        didStartDrag: false,
        startPoint: { x: 0, y: 0 },
        currentPoint: { x: 0, y: 9 },
      }),
    ).toBe("start_drag");
  });

  it("does nothing when drag already started", () => {
    expect(
      decideLongPressMove({
        dragArmed: true,
        didStartDrag: true,
        startPoint: { x: 0, y: 0 },
        currentPoint: { x: 20, y: 20 },
      }),
    ).toBe("none");
  });
});

describe("shouldOpenContextMenuOnPressOut", () => {
  it("opens menu only when long-press is armed and drag did not start", () => {
    expect(
      shouldOpenContextMenuOnPressOut({
        longPressArmed: true,
        didStartDrag: false,
      }),
    ).toBe(true);

    expect(
      shouldOpenContextMenuOnPressOut({
        longPressArmed: false,
        didStartDrag: false,
      }),
    ).toBe(false);

    expect(
      shouldOpenContextMenuOnPressOut({
        longPressArmed: true,
        didStartDrag: true,
      }),
    ).toBe(false);
  });
});
