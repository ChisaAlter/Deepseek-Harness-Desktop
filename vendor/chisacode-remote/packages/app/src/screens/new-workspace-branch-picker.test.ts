import { describe, expect, it } from "vitest";
import {
  resolveBranchPickerEmptyText,
  seedCurrentBranchDetails,
} from "./new-workspace-branch-picker";

describe("seedCurrentBranchDetails", () => {
  it("returns the known current branch when suggestions have not arrived", () => {
    expect(seedCurrentBranchDetails("fix/right-panel-below-topbar", [])).toEqual([
      { name: "fix/right-panel-below-topbar", committerDate: Number.MAX_SAFE_INTEGER },
    ]);
  });

  it("does not duplicate a branch that suggestions already include", () => {
    const existing = [{ name: "fix/right-panel-below-topbar", committerDate: 10 }];
    expect(seedCurrentBranchDetails("fix/right-panel-below-topbar", existing)).toEqual(existing);
  });

  it("leaves an empty list empty when the current branch is unknown", () => {
    expect(seedCurrentBranchDetails(null, [])).toEqual([]);
    expect(seedCurrentBranchDetails("  ", [])).toEqual([]);
  });
});

describe("resolveBranchPickerEmptyText", () => {
  it("keeps searching only while local branches are still loading", () => {
    expect(
      resolveBranchPickerEmptyText({
        hasBranchOptions: false,
        branchesFetching: true,
        searchingLabel: "搜索中...",
        noMatchLabel: "没有匹配的分支",
      }),
    ).toBe("搜索中...");
  });

  it("does not stay on searching just because GitHub is still in flight", () => {
    expect(
      resolveBranchPickerEmptyText({
        hasBranchOptions: true,
        branchesFetching: false,
        searchingLabel: "搜索中...",
        noMatchLabel: "没有匹配的分支",
      }),
    ).toBe("没有匹配的分支");
  });
});
