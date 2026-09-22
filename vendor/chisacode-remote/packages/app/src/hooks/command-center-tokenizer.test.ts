import { describe, expect, it } from "vitest";
import { tokenizeCommandCenterQuery } from "./command-center-tokenizer";

describe("tokenizeCommandCenterQuery", () => {
  it("returns no tokens for blank or missing queries", () => {
    expect(tokenizeCommandCenterQuery(null)).toEqual([]);
    expect(tokenizeCommandCenterQuery(undefined)).toEqual([]);
    expect(tokenizeCommandCenterQuery("   ")).toEqual([]);
  });

  it("splits punctuation and lowercases latin tokens", () => {
    expect(tokenizeCommandCenterQuery("Open-DIFF/worktree.archive")).toEqual([
      "open",
      "diff",
      "worktree",
      "archive",
    ]);
  });

  it("preserves unicode letter and number tokens", () => {
    expect(tokenizeCommandCenterQuery("设置/工作区 版本2")).toEqual(["设置", "工作区", "版本2"]);
  });
});
