import { describe, expect, it } from "vitest";
import { planNewWorkspaceSendOpen } from "./new-workspace-ensure";

describe("planNewWorkspaceSendOpen", () => {
  it("reuses an already-open workspace for the same directory", () => {
    expect(
      planNewWorkspaceSendOpen({
        cwd: "C:\\Ai\\ChisaCode",
        openWorkspaces: [{ id: "ws-1", workspaceDirectory: "C:/Ai/ChisaCode" }],
      }),
    ).toEqual({ mode: "reuse-open", workspaceId: "ws-1" });
  });

  it("opens the selected directory instead of creating a worktree", () => {
    expect(
      planNewWorkspaceSendOpen({
        cwd: "C:\\Ai\\ChisaCode",
        openWorkspaces: [],
      }),
    ).toEqual({ mode: "open-existing" });
  });
});
