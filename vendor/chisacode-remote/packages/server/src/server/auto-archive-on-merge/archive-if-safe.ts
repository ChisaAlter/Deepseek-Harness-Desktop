import type { Logger } from "pino";

import type { AgentManager } from "../agent/agent-manager.js";
import type { AgentStorage } from "../agent/agent-storage.js";
import type { DaemonConfigStore } from "../daemon-config-store.js";
import {
  archiveChisaCodeWorktree,
  killTerminalsUnderPath,
} from "../chisacode-worktree-archive-service.js";
import { isSameOrDescendantPath } from "../path-utils.js";
import {
  workspaceMutationCoordinator,
  type WorkspaceMutationCoordinator,
} from "../workspace-mutation-coordinator.js";
import type {
  WorkspaceGitRuntimeSnapshot,
  WorkspaceGitServiceImpl,
} from "../workspace-git-service.js";
import type { GitHubService } from "../../services/github-service.js";
import type { TerminalManager } from "../../terminal/terminal-manager.js";
import { isChisaCodeOwnedWorktreeCwd } from "../../utils/worktree.js";

export interface AutoArchiveArchiveOptions {
  chisacodeHome: string;
  daemonConfigStore: DaemonConfigStore;
  workspaceGitService: WorkspaceGitServiceImpl;
  github: GitHubService;
  agentManager: AgentManager;
  agentStorage: AgentStorage;
  terminalManager: TerminalManager;
  archiveWorkspaceRecord: (workspaceId: string) => Promise<void>;
  markWorkspaceArchiving: (workspaceIds: Iterable<string>, archivingAt: string) => void;
  clearWorkspaceArchiving: (workspaceIds: Iterable<string>) => void;
  emitWorkspaceUpdatesForWorkspaceIds: (workspaceIds: Iterable<string>) => Promise<void>;
}

export interface ArchiveIfSafeDependencies {
  archiveChisaCodeWorktree: typeof archiveChisaCodeWorktree;
  isChisaCodeOwnedWorktreeCwd: typeof isChisaCodeOwnedWorktreeCwd;
  killTerminalsUnderPath: typeof killTerminalsUnderPath;
  isPathWithinRoot: typeof isSameOrDescendantPath;
  mutationCoordinator: WorkspaceMutationCoordinator;
}

const defaultDependencies: ArchiveIfSafeDependencies = {
  archiveChisaCodeWorktree,
  isChisaCodeOwnedWorktreeCwd,
  killTerminalsUnderPath,
  isPathWithinRoot: isSameOrDescendantPath,
  mutationCoordinator: workspaceMutationCoordinator,
};

function isUnsafeForArchive(snapshot: WorkspaceGitRuntimeSnapshot): boolean {
  if (snapshot.git.isDirty === true) {
    return true;
  }
  if ((snapshot.git.aheadOfOrigin ?? 0) > 0) {
    return true;
  }
  // Unknown dirty/ahead state is fail-closed.
  if (snapshot.git.isDirty == null) {
    return true;
  }
  if (snapshot.git.aheadOfOrigin == null) {
    return true;
  }
  return false;
}

export async function archiveIfSafe(input: {
  cwd: string;
  pullRequest: WorkspaceGitRuntimeSnapshot["github"]["pullRequest"];
  inFlight: Set<string>;
  options: AutoArchiveArchiveOptions;
  log: Logger;
  deps?: ArchiveIfSafeDependencies;
}): Promise<void> {
  const { cwd, pullRequest, inFlight, options, log } = input;
  const deps = input.deps ?? defaultDependencies;

  if (!pullRequest?.isMerged) {
    return;
  }
  if (options.daemonConfigStore.get().autoArchiveAfterMerge !== true) {
    return;
  }
  if (inFlight.has(cwd)) {
    return;
  }

  inFlight.add(cwd);
  try {
    const ownership = await deps.isChisaCodeOwnedWorktreeCwd(cwd, {
      chisacodeHome: options.chisacodeHome,
    });
    if (!ownership.allowed) {
      log.info(
        {
          pathHash: deps.mutationCoordinator.pathHash(cwd),
          decision: "deny",
          reason: "not_chisacode_owned",
        },
        "Auto-archive skipped: ownership check failed",
      );
      return;
    }

    const targetPath = ownership.worktreePath ?? cwd;

    await deps.mutationCoordinator.runExclusive(
      targetPath,
      "auto-archive-on-merge",
      async ({ pathHash, setState }) => {
        setState("quiescing", "auto_archive_begin");

        let snapshot: Awaited<ReturnType<typeof options.workspaceGitService.getSnapshot>> | null;
        try {
          // Force-refresh: never authorize delete from latestSnapshot cache.
          snapshot = await options.workspaceGitService.getSnapshot(targetPath, {
            force: true,
            reason: "auto-archive-on-merge-safety-gate",
          });
        } catch (error) {
          log.warn(
            { err: error, pathHash, decision: "deny", reason: "snapshot_refresh_failed" },
            "Failed to force-refresh snapshot for auto-archive; skipping",
          );
          setState("active", "snapshot_refresh_failed");
          return;
        }
        if (!snapshot) {
          log.info(
            { pathHash, decision: "deny", reason: "snapshot_missing" },
            "Auto-archive skipped: no snapshot",
          );
          setState("active", "snapshot_missing");
          return;
        }

        if (isUnsafeForArchive(snapshot)) {
          log.info(
            {
              pathHash,
              decision: "deny",
              reason: "unsafe_git_state",
              isDirty: snapshot.git.isDirty,
              aheadOfOrigin: snapshot.git.aheadOfOrigin,
            },
            "Auto-archive skipped: worktree not clean or ahead/unknown",
          );
          setState("active", "unsafe_git_state");
          return;
        }

        // Re-check ownership after quiesce + force refresh (TOCTOU).
        const ownershipAfter = await deps.isChisaCodeOwnedWorktreeCwd(targetPath, {
          chisacodeHome: options.chisacodeHome,
        });
        if (!ownershipAfter.allowed) {
          log.info(
            { pathHash, decision: "deny", reason: "ownership_changed" },
            "Auto-archive skipped: ownership changed during quiesce",
          );
          setState("active", "ownership_changed");
          return;
        }

        try {
          await deps.archiveChisaCodeWorktree(
            {
              chisacodeHome: options.chisacodeHome,
              github: options.github,
              workspaceGitService: options.workspaceGitService,
              agentManager: options.agentManager,
              agentStorage: options.agentStorage,
              archiveWorkspaceRecord: options.archiveWorkspaceRecord,
              emitWorkspaceUpdatesForWorkspaceIds: options.emitWorkspaceUpdatesForWorkspaceIds,
              markWorkspaceArchiving: options.markWorkspaceArchiving,
              clearWorkspaceArchiving: options.clearWorkspaceArchiving,
              isPathWithinRoot: deps.isPathWithinRoot,
              killTerminalsUnderPath: (rootPath) =>
                deps.killTerminalsUnderPath(
                  {
                    terminalManager: options.terminalManager,
                    isPathWithinRoot: deps.isPathWithinRoot,
                    killTrackedTerminal: () => {},
                    sessionLogger: log,
                  },
                  rootPath,
                ),
              sessionLogger: log,
              // Nested exclusive is skipped when already holding the lock via outer runExclusive.
              mutationCoordinator: deps.mutationCoordinator,
              alreadyHoldingMutationLock: true,
              onMutationState: setState,
            },
            {
              targetPath,
              repoRoot: ownershipAfter.repoRoot ?? ownership.repoRoot ?? null,
              worktreesRoot: ownershipAfter.worktreeRoot ?? ownership.worktreeRoot,
              requestId: "auto-archive-on-merge",
            },
          );
          log.info(
            { pathHash, decision: "complete", reason: "archived_after_merge" },
            "Auto-archived worktree after PR merge",
          );
        } catch (error) {
          log.warn(
            { err: error, pathHash, decision: "abort", reason: "archive_failed" },
            "Auto-archive after merge failed",
          );
          setState("active", "archive_failed");
        }
      },
    );
  } catch (error) {
    log.warn(
      {
        err: error,
        pathHash: deps.mutationCoordinator.pathHash(cwd),
        decision: "abort",
        reason: "mutation_lock_or_outer_failure",
      },
      "Auto-archive outer failure",
    );
  } finally {
    inFlight.delete(cwd);
  }
}
