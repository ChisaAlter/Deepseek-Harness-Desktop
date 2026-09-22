import { describe, expect, it } from "vitest";
import { resolveIdleGitButtonLabel } from "./idle-git-button-label";

describe("resolveIdleGitButtonLabel", () => {
  it("prefers the current branch over the idle fallback", () => {
    expect(
      resolveIdleGitButtonLabel({ branchLabel: "cn-main", fallback: "git.actionUpToDate" }),
    ).toBe("cn-main");
  });

  it("uses the translated fallback when no branch is known", () => {
    expect(resolveIdleGitButtonLabel({ branchLabel: "  ", fallback: "已是最新" })).toBe("已是最新");
  });
});
