import { describe, expect, it } from "vitest";
import {
  buildNewWorkspaceDraftResetKey,
  resolveNewWorkspaceDraftReset,
} from "./new-workspace-draft-reset";

describe("new workspace draft reset", () => {
  it("resets the singleton draft when a new draft token is opened", () => {
    expect(
      resolveNewWorkspaceDraftReset({
        currentResetKey: buildNewWorkspaceDraftResetKey({
          resetKey: "old-draft",
          sourceDirectory: "/repo/app",
        }),
        resetKey: "new-draft",
        sourceDirectory: "/repo/app",
        pendingAction: null,
      }),
    ).toEqual({
      kind: "reset",
      nextResetKey: "new-draft:/repo/app",
      selectedDirectory: "/repo/app",
    });
  });

  it("switches the selected directory when a project row starts a replacement draft", () => {
    expect(
      resolveNewWorkspaceDraftReset({
        currentResetKey: buildNewWorkspaceDraftResetKey({
          resetKey: "draft-a",
          sourceDirectory: "/repo/old",
        }),
        resetKey: "draft-b",
        sourceDirectory: "  /repo/new  ",
        pendingAction: null,
      }),
    ).toEqual({
      kind: "reset",
      nextResetKey: "draft-b:/repo/new",
      selectedDirectory: "/repo/new",
    });
  });

  it("does not clear a draft while workspace creation is pending", () => {
    expect(
      resolveNewWorkspaceDraftReset({
        currentResetKey: buildNewWorkspaceDraftResetKey({
          resetKey: "draft-a",
          sourceDirectory: "/repo/old",
        }),
        resetKey: "draft-b",
        sourceDirectory: "/repo/new",
        pendingAction: "chat",
      }),
    ).toEqual({
      kind: "pending",
      nextResetKey: "draft-b:/repo/new",
    });
  });
});
