import { beforeEach, describe, expect, it } from "vitest";
import {
  shouldAutoOpenWorkspaceSetup,
  shouldShowWorkspaceSetup,
  useWorkspaceSetupStore,
} from "./workspace-setup-store";

describe("workspace-setup-store", () => {
  beforeEach(() => {
    useWorkspaceSetupStore.setState({ pendingWorkspaceSetup: null, snapshots: {} });
  });

  it("tracks deferred workspace setup by source directory and optional workspace id", () => {
    useWorkspaceSetupStore.getState().beginWorkspaceSetup({
      serverId: "server-1",
      sourceDirectory: "/Users/test/project",
      sourceWorkspaceId: "42",
      displayName: "project",
      creationMethod: "open_project",
    });

    expect(useWorkspaceSetupStore.getState().pendingWorkspaceSetup).toEqual({
      serverId: "server-1",
      sourceDirectory: "/Users/test/project",
      sourceWorkspaceId: "42",
      displayName: "project",
      creationMethod: "open_project",
    });
  });

  it("clears pending setup state", () => {
    useWorkspaceSetupStore.getState().beginWorkspaceSetup({
      serverId: "server-1",
      sourceDirectory: "/Users/test/project",
      creationMethod: "create_worktree",
    });

    useWorkspaceSetupStore.getState().clearWorkspaceSetup();

    expect(useWorkspaceSetupStore.getState().pendingWorkspaceSetup).toBeNull();
  });

  it("hides empty successful setup snapshots", () => {
    expect(shouldShowWorkspaceSetup(null)).toBe(false);
    expect(shouldAutoOpenWorkspaceSetup(null)).toBe(false);

    expect(
      shouldShowWorkspaceSetup({
        workspaceId: "workspace-1",
        status: "completed",
        detail: {
          type: "worktree_setup",
          worktreePath: "/Users/test/project",
          branchName: "main",
          log: "",
          commands: [],
        },
        error: null,
        updatedAt: Date.now(),
        autoOpenUntil: null,
      }),
    ).toBe(false);
  });

  it("shows setup snapshots with commands or errors", () => {
    expect(
      shouldShowWorkspaceSetup({
        workspaceId: "workspace-1",
        status: "completed",
        detail: {
          type: "worktree_setup",
          worktreePath: "/Users/test/project",
          branchName: "main",
          log: "done\n",
          commands: [
            {
              index: 1,
              command: "npm install",
              cwd: "/Users/test/project",
              log: "done\n",
              status: "completed",
              exitCode: 0,
            },
          ],
        },
        error: null,
        updatedAt: Date.now(),
        autoOpenUntil: null,
      }),
    ).toBe(true);

    expect(
      shouldShowWorkspaceSetup({
        workspaceId: "workspace-1",
        status: "failed",
        detail: {
          type: "worktree_setup",
          worktreePath: "/Users/test/project",
          branchName: "main",
          log: "",
          commands: [],
        },
        error: "Failed to parse chisacode.json",
        updatedAt: Date.now(),
        autoOpenUntil: null,
      }),
    ).toBe(true);
  });

  it("does not auto-open completed setup loaded from cached status", () => {
    useWorkspaceSetupStore.getState().upsertProgress({
      serverId: "server-1",
      source: "cached",
      payload: {
        workspaceId: "workspace-1",
        status: "completed",
        detail: {
          type: "worktree_setup",
          worktreePath: "/Users/test/project",
          branchName: "main",
          log: "done\n",
          commands: [
            {
              index: 1,
              command: "npm install",
              cwd: "/Users/test/project",
              log: "done\n",
              status: "completed",
              exitCode: 0,
            },
          ],
        },
        error: null,
      },
    });

    const snapshot = useWorkspaceSetupStore.getState().snapshots["server-1:workspace-1"] ?? null;

    expect(shouldShowWorkspaceSetup(snapshot)).toBe(true);
    expect(shouldAutoOpenWorkspaceSetup(snapshot)).toBe(false);
  });

  it("auto-opens recently completed live setup progress", () => {
    const now = Date.now();
    useWorkspaceSetupStore.getState().upsertProgress({
      serverId: "server-1",
      payload: {
        workspaceId: "workspace-1",
        status: "completed",
        detail: {
          type: "worktree_setup",
          worktreePath: "/Users/test/project",
          branchName: "main",
          log: "done\n",
          commands: [
            {
              index: 1,
              command: "npm install",
              cwd: "/Users/test/project",
              log: "done\n",
              status: "completed",
              exitCode: 0,
            },
          ],
        },
        error: null,
      },
    });

    const snapshot = useWorkspaceSetupStore.getState().snapshots["server-1:workspace-1"] ?? null;

    expect(shouldAutoOpenWorkspaceSetup(snapshot, now)).toBe(true);
    expect(shouldAutoOpenWorkspaceSetup(snapshot, now + 31_000)).toBe(false);
  });
});
