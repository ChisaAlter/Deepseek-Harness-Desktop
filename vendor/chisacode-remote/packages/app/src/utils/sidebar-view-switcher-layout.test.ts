import { describe, expect, it } from "vitest";
import {
  resolveSidebarViewSwitcherLayout,
  type SidebarViewSwitcherLayoutInput,
} from "./sidebar-view-switcher-layout";

function layout(partial: Partial<SidebarViewSwitcherLayoutInput> & { sidebarWidth: number }) {
  return resolveSidebarViewSwitcherLayout({
    placement: "full-width",
    variant: "desktop",
    ...partial,
  });
}

describe("resolveSidebarViewSwitcherLayout", () => {
  it("uses full labels+icons on the default 260 full-width row", () => {
    // 260 - 24 pad = 236
    const result = layout({ sidebarWidth: 260 });
    expect(result.density).toBe("full");
    expect(result.showIcons).toBe(true);
    expect(result.showLabels).toBe(true);
    expect(result.useShortLabels).toBe(false);
    expect(result.switcherMinWidth).toBe(176);
  });

  it("uses full density at MIN_SIDEBAR_WIDTH 200 when full-width under search", () => {
    // 200 - 24 = 176 → exactly full
    const result = layout({ sidebarWidth: 200 });
    expect(result.density).toBe("full");
    expect(result.showLabels).toBe(true);
    expect(result.useShortLabels).toBe(false);
  });

  it("uses full density on a wide desktop rail", () => {
    const result = layout({ sidebarWidth: 320 });
    expect(result.density).toBe("full");
  });

  it("compacts when the full-width row is extremely narrow", () => {
    // 150 - 24 = 126 → compact short labels
    const result = layout({ sidebarWidth: 150 });
    expect(result.density).toBe("compact");
    expect(result.useShortLabels).toBe(true);
    expect(result.showIcons).toBe(false);
  });

  it("falls to icon-only only when the full-width track is tiny", () => {
    // 100 - 24 = 76 → icon
    const result = layout({ sidebarWidth: 100 });
    expect(result.density).toBe("icon");
    expect(result.showLabels).toBe(false);
  });

  it("still budgets shell+icons when placement is inline-top", () => {
    // 260 - 24 - 32 shell - 32 search - 12 gaps = 160 → compact
    const result = layout({
      sidebarWidth: 260,
      placement: "inline-top",
      trailingIconCount: 1,
    });
    expect(result.density).toBe("compact");
    expect(result.useShortLabels).toBe(true);
  });

  it("inline-top at 200 desktop is icon-only", () => {
    // 200 - 24 - 32 - 32 - 12 = 100
    const result = layout({
      sidebarWidth: 200,
      placement: "inline-top",
      trailingIconCount: 1,
    });
    expect(result.density).toBe("icon");
  });

  it("treats non-finite width as empty rail", () => {
    const result = layout({ sidebarWidth: Number.NaN });
    expect(result.density).toBe("icon");
    expect(result.switcherAvailableWidth).toBe(0);
  });
});
