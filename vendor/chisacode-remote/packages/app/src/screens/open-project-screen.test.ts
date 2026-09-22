import { describe, expect, it } from "vitest";
import { shouldShowOpenProjectMenuHeader } from "./open-project-screen-layout";

describe("open-project screen layout", () => {
  it("hides the duplicate menu header on desktop where the left sidebar is already visible", () => {
    expect(shouldShowOpenProjectMenuHeader({ isCompactLayout: false })).toBe(false);
  });

  it("keeps the menu header on compact layouts", () => {
    expect(shouldShowOpenProjectMenuHeader({ isCompactLayout: true })).toBe(true);
  });
});
