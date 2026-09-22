import path from "node:path";
import pino from "pino";
import { describe, expect, it, vi } from "vitest";

import type { SessionOutboundMessage } from "./messages.js";
import { WorkspaceGitObserverController } from "./workspace-git-observer-controller.js";
import type {
  WorkspaceGitListener,
  WorkspaceGitRuntimeSnapshot,
  WorkspaceGitService,
} from "./workspace-git-service.js";

function createSnapshot(cwd: string): WorkspaceGitRuntimeSnapshot {
  return {
    cwd,
    git: {
      isGit: true,
      repoRoot: cwd,
      mainRepoRoot: null,
      currentBranch: "main",
      remoteUrl: null,
      isChisaCodeOwnedWorktree: false,
      isDirty: false,
      baseRef: "main",
      aheadBehind: { ahead: 0, behind: 0 },
      aheadOfOrigin: 0,
      behindOfOrigin: 0,
      hasRemote: false,
      diffStat: { additions: 1, deletions: 0 },
    },
    github: {
      featuresEnabled: false,
      pullRequest: null,
      error: null,
    },
  };
}

describe("WorkspaceGitObserverController", () => {
  it("fans out snapshots and releases the workspace subscription", async () => {
    let listener: WorkspaceGitListener | null = null;
    const unsubscribe = vi.fn();
    const registerWorkspace = vi.fn(
      (_input: { cwd: string }, nextListener: WorkspaceGitListener) => {
        listener = nextListener;
        return { unsubscribe };
      },
    );
    const emitted: SessionOutboundMessage[] = [];
    const cwd = path.resolve("/tmp/repo");
    const emitWorkspaceUpdateForCwd = vi.fn(async () => undefined);
    const onBranchChanged = vi.fn();
    const controller = new WorkspaceGitObserverController({
      workspaceGitService: { registerWorkspace } as unknown as WorkspaceGitService,
      sessionLogger: pino({ level: "silent" }),
      emit: (message) => emitted.push(message),
      emitWorkspaceUpdateForCwd,
      onBranchChanged,
    });

    controller.syncObserver(cwd, { isGit: true, workspaceId: "workspace-1" });
    expect(listener).not.toBeNull();
    listener!(createSnapshot(cwd));

    await vi.waitFor(() => expect(emitWorkspaceUpdateForCwd).toHaveBeenCalledWith(cwd));
    expect(onBranchChanged).toHaveBeenCalledWith("workspace-1", null, "main");
    expect(emitted).toContainEqual(
      expect.objectContaining({
        type: "checkout_status_update",
        payload: expect.objectContaining({ cwd, requestId: `subscription:${cwd}` }),
      }),
    );

    controller.dispose();
    expect(unsubscribe).toHaveBeenCalledTimes(1);
  });
});
