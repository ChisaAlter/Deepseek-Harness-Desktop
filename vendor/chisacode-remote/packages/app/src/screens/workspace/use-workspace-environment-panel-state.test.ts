import { describe, expect, it } from "vitest";

import { shouldAutoShowEnvironmentPanel } from "./use-workspace-environment-panel-state";

describe("shouldAutoShowEnvironmentPanel", () => {
  it("stays closed when chat fills the pane (no right gutter)", () => {
    // Tall pane: chat width fills available → no blank right gutter.
    expect(shouldAutoShowEnvironmentPanel(800, 272, 900)).toBe(false);
    expect(shouldAutoShowEnvironmentPanel(1000, 272, 1000)).toBe(false);
  });

  it("stays closed when the left-aligned right gutter is smaller than the panel", () => {
    // Pane 1000×800 → chat width 800 → right gutter 200 < panel 272 + inset 8.
    expect(shouldAutoShowEnvironmentPanel(1000, 272, 800)).toBe(false);
  });

  it("auto-shows when the right gutter fully fits the floating panel", () => {
    // Pane 1600×800 → chat width 800 → right gutter 800 ≥ 280.
    expect(shouldAutoShowEnvironmentPanel(1600, 272, 800)).toBe(true);
  });

  it("rejects unmeasured or zero dimensions", () => {
    expect(shouldAutoShowEnvironmentPanel(0, 272, 800)).toBe(false);
    expect(shouldAutoShowEnvironmentPanel(1600, 272, 0)).toBe(false);
    expect(shouldAutoShowEnvironmentPanel(1600, 0, 800)).toBe(false);
  });
});
