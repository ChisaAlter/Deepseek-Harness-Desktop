import { describe, expect, it } from "vitest";
import {
  getDesktopSidebarResizeState,
  getLeftSidebarAnimationTargets,
  getMobileSidebarWidth,
  getRightSidebarAnimationTargets,
  shouldSyncSidebarAnimation,
} from "./sidebar-animation-state";

describe("sidebar-animation-state", () => {
  it("requests a sync when the open state changes", () => {
    expect(
      shouldSyncSidebarAnimation({
        previousIsOpen: false,
        nextIsOpen: true,
        previousWindowWidth: 390,
        nextWindowWidth: 390,
      }),
    ).toBe(true);
  });

  it("requests a sync when the viewport width changes", () => {
    expect(
      shouldSyncSidebarAnimation({
        previousIsOpen: false,
        nextIsOpen: false,
        previousWindowWidth: 390,
        nextWindowWidth: 430,
      }),
    ).toBe(true);
  });

  it("keeps the left sidebar fully off-screen when closed", () => {
    expect(getLeftSidebarAnimationTargets({ isOpen: false, windowWidth: 430 })).toEqual({
      translateX: -430,
      backdropOpacity: 0,
    });
  });

  it("keeps the left sidebar drawer width off-screen when closed", () => {
    expect(
      getLeftSidebarAnimationTargets({ isOpen: false, windowWidth: 430, sidebarWidth: 280 }),
    ).toEqual({
      translateX: -280,
      backdropOpacity: 0,
    });
  });

  it("falls back to window width when the left sidebar width is invalid", () => {
    expect(
      getLeftSidebarAnimationTargets({
        isOpen: false,
        windowWidth: 430,
        sidebarWidth: Number.NaN,
      }),
    ).toEqual({
      translateX: -430,
      backdropOpacity: 0,
    });
  });

  it("keeps the right sidebar fully off-screen when closed", () => {
    expect(getRightSidebarAnimationTargets({ isOpen: false, windowWidth: 430 })).toEqual({
      translateX: 430,
      backdropOpacity: 0,
    });
  });

  it("keeps the right sidebar drawer width off-screen when closed", () => {
    expect(
      getRightSidebarAnimationTargets({ isOpen: false, windowWidth: 430, sidebarWidth: 280 }),
    ).toEqual({
      translateX: 280,
      backdropOpacity: 0,
    });
  });

  it("clamps invalid closed animation widths to a stable value", () => {
    expect(getLeftSidebarAnimationTargets({ isOpen: false, windowWidth: Number.NaN })).toEqual({
      translateX: 0,
      backdropOpacity: 0,
    });
    expect(
      getRightSidebarAnimationTargets({ isOpen: false, windowWidth: 430, sidebarWidth: -10 }),
    ).toEqual({
      translateX: 0,
      backdropOpacity: 0,
    });
  });

  it("uses Soft .drawer width 86% capped at 300 on mobile viewports", () => {
    // Soft .drawer: width 86%, max-width 300.
    expect(getMobileSidebarWidth(390)).toBe(300);
    expect(getMobileSidebarWidth(720)).toBe(300);
  });

  it("caps the mobile drawer width on large viewports", () => {
    expect(getMobileSidebarWidth(1200)).toBe(300);
  });

  it("uses a stable Soft max-width fallback for invalid mobile viewport widths", () => {
    expect(getMobileSidebarWidth(0)).toBe(300);
    expect(getMobileSidebarWidth(Number.NaN)).toBe(300);
    expect(getMobileSidebarWidth(Number.POSITIVE_INFINITY)).toBe(300);
  });

  it("does not exceed extremely narrow but valid mobile viewports", () => {
    // Soft 86% of 240 ≈ 206.
    expect(getMobileSidebarWidth(240)).toBe(206);
  });

  it("keeps the stored desktop sidebar width instead of resetting to the default", () => {
    expect(
      getDesktopSidebarResizeState({
        storedWidth: 280,
        viewportWidth: 1200,
        minWidth: 200,
        maxWidth: 360,
        minContentWidth: 400,
      }),
    ).toEqual({
      width: 280,
      maxWidth: 360,
    });
  });

  it("clamps the desktop sidebar width to leave room for the workspace content", () => {
    expect(
      getDesktopSidebarResizeState({
        storedWidth: 360,
        viewportWidth: 640,
        minWidth: 200,
        maxWidth: 360,
        minContentWidth: 400,
      }),
    ).toEqual({
      width: 240,
      maxWidth: 240,
    });
  });
});
