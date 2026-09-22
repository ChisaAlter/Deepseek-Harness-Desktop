import { describe, expect, it } from "vitest";
import {
  buildBranchSwitcherOptions,
  resolveBranchSwitcherQueryEnabled,
} from "./use-branch-switcher";

describe("resolveBranchSwitcherQueryEnabled", () => {
  it("prefetches local branches before the picker opens", () => {
    expect(
      resolveBranchSwitcherQueryEnabled({
        isGitCheckout: true,
        hasClient: true,
        isConnected: true,
      }),
    ).toBe(true);
  });

  it("stays off when the checkout is not git or the host is down", () => {
    expect(
      resolveBranchSwitcherQueryEnabled({
        isGitCheckout: false,
        hasClient: true,
        isConnected: true,
      }),
    ).toBe(false);
    expect(
      resolveBranchSwitcherQueryEnabled({
        isGitCheckout: true,
        hasClient: false,
        isConnected: true,
      }),
    ).toBe(false);
  });
});

describe("buildBranchSwitcherOptions", () => {
  it("seeds the known current branch so the menu is never empty on open", () => {
    expect(buildBranchSwitcherOptions("large-bird", [])).toEqual([
      { id: "large-bird", label: "large-bird" },
    ]);
  });

  it("does not duplicate a branch that suggestions already include", () => {
    const existing = [{ id: "large-bird", label: "large-bird" }];
    expect(buildBranchSwitcherOptions("large-bird", existing)).toEqual(existing);
  });
});
