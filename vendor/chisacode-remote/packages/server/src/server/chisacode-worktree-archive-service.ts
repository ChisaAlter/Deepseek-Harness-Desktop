import type { Logger } from "pino";

import type { AgentManager } from "./agent/agent-manager.js";
import type { AgentStorage, StoredAgentRecord } from "./agent/agent-storage.js";
import type { WorkspaceGitService } from "./workspace-git-service.js";
import { normalizeWorkspaceId as normalizePersistedWorkspaceId } from "./workspace-registry-model.js";
import type { GitHubService } from "../services/github-service.js";
import { deleteChisaCodeWorktree, resolveChisaCodeWorktreeRootForCwd } from "../utils/worktree.js";
import type { TerminalManager } from "../terminal/terminal-manager.js";
import {
  workspaceMutationCoordinator,
  type WorkspaceMutationCoordinator,
  type WorkspaceMutationState,
} from "./workspace-mutation-coordinator.js";

export interface ArchiveChisaCodeWorktreeDependencies {
  chisacodeHome?: string;
  github: GitHubService;
  workspaceGitService: Pick<WorkspaceGitService, "getSnapshot">;
  agentManager: Pick<AgentManager, "listAgents" | "archiveAgent" | "archiveSnapshot">;
  agentStorage: Pick<AgentStorage, "list">;
  archiveWorkspaceRecord: (workspaceId: string) => Promise<void>;
  emitWorkspaceUpdatesForWorkspaceIds: (workspaceIds: Iterable<string>) => Promise<void>;
  markWorkspaceArchiving: (workspaceIds: Iterable<string>, archivingAt: string) => void;
  clearWorkspaceArchiving: (workspaceIds: Iterable<string>) => void;
  isPathWithinRoot: (rootPath: string, candidatePath: string) => boolean;
  killTerminalsUnderPath: (rootPath: string) => Promise<void>;
  sessionLogger?: Logger;
  mutationCoordinator?: WorkspaceMutationCoordinator;
  /**
   * When true, the caller already holds the mutation lock for targetPath
   * (e.g. archiveIfSafe) and this function must not re-enter runExclusive.
   */
  alreadyHoldingMutationLock?: boolean;
  onMutationState?: (state: WorkspaceMutationState, reason: string) => void;
}

export interface KillTerminalsUnderPathDependencies {
  isPathWithinRoot: (rootPath: string, candidatePath: string) => boolean;
  killTrackedTerminal: (terminalId: string, options?: { emitExit: boolean }) => void;
  detachTerminalStream?: (terminalId: string, options: { emitExit: boolean }) => void;
  sessionLogger: Logger;
  terminalManager: TerminalManager | null;
}

async function archiveChisaCodeWorktreeBody(
  dependencies: ArchiveChisaCodeWorktreeDependencies,
  options: {
    targetPath: string;
    repoRoot: string | null;
    worktreesRoot?: string;
    requestId: string;
  },
  setState: (state: WorkspaceMutationState, reason: string) => void,
): Promise<string[]> {
  let targetPath = options.targetPath;
  const resolvedWorktree = await resolveChisaCodeWorktreeRootForCwd(targetPath, {
    chisacodeHome: dependencies.chisacodeHome,
  });
  if (resolvedWorktree) {
    targetPath = resolvedWorktree.worktreePath;
  }

  const coordinator = dependencies.mutationCoordinator ?? workspaceMutationCoordinator;
  setState("quiescing", "archive_mark_quiescing");
  await coordinator.waitForWritesToDrain(targetPath);
  let filesystemDeleted = false;

  const archivedAgents = new Set<string>();
  const affectedWorkspaceCwds = new Set<string>([targetPath]);
  const affectedWorkspaceIds = new Set<string>([normalizePersistedWorkspaceId(targetPath)]);

  const liveAgents = dependencies.agentManager
    .listAgents()
    .filter((agent) => dependencies.isPathWithinRoot(targetPath, agent.cwd));
  for (const agent of liveAgents) {
    archivedAgents.add(agent.id);
    affectedWorkspaceCwds.add(agent.cwd);
    affectedWorkspaceIds.add(normalizePersistedWorkspaceId(agent.cwd));
  }

  let storedRecords: StoredAgentRecord[] = [];
  try {
    storedRecords = await dependencies.agentStorage.list();
  } catch (error) {
    dependencies.sessionLogger?.warn(
      { err: error, targetPath },
      "Failed to list stored agents during worktree archive; continuing",
    );
  }
  const liveAgentIds = new Set(liveAgents.map((agent) => agent.id));
  const matchingStoredRecords = storedRecords.filter((record) =>
    dependencies.isPathWithinRoot(targetPath, record.cwd),
  );
  for (const record of matchingStoredRecords) {
    archivedAgents.add(record.id);
    affectedWorkspaceCwds.add(record.cwd);
    affectedWorkspaceIds.add(normalizePersistedWorkspaceId(record.cwd));
  }

  const affectedWorkspaceIdList = Array.from(affectedWorkspaceIds);
  dependencies.markWorkspaceArchiving(affectedWorkspaceIdList, new Date().toISOString());

  try {
    await dependencies.emitWorkspaceUpdatesForWorkspaceIds(affectedWorkspaceIdList);

    const archivedAt = new Date().toISOString();
    // Concurrent teardown for latency, but awaited + gating: any failure aborts
    // before delete (no fire-and-forget continue-on-error).
    const teardownResults = await Promise.allSettled([
      ...liveAgents.map((agent) => dependencies.agentManager.archiveAgent(agent.id)),
      ...matchingStoredRecords
        .filter((record) => !liveAgentIds.has(record.id) && !record.archivedAt)
        .map((record) => dependencies.agentManager.archiveSnapshot(record.id, archivedAt)),
      dependencies.killTerminalsUnderPath(targetPath),
    ]);
    const teardownFailures = teardownResults.filter((result) => result.status === "rejected");
    if (teardownFailures.length > 0) {
      const first = teardownFailures[0];
      let reason = "unknown teardown failure";
      if (first && first.status === "rejected") {
        reason = first.reason instanceof Error ? first.reason.message : String(first.reason);
      }
      throw new Error(`Teardown failed before worktree delete: ${reason}`);
    }

    setState("deleting", "teardown_complete_begin_delete");

    await deleteChisaCodeWorktree({
      cwd: options.repoRoot,
      worktreePath: targetPath,
      worktreesRoot: options.worktreesRoot,
      chisacodeHome: dependencies.chisacodeHome,
      // Caller already holds the mutation lock.
      alreadyHoldingMutationLock: true,
      mutationCoordinator: dependencies.mutationCoordinator as
        | {
            runExclusive: <T>(
              path: string,
              reason: string,
              fn: (ctx: { setState: (state: string, reason: string) => void }) => Promise<T>,
            ) => Promise<T>;
          }
        | undefined,
    });
    filesystemDeleted = true;

    if (options.repoRoot) {
      try {
        await dependencies.workspaceGitService.getSnapshot(options.repoRoot, {
          force: true,
          reason: "archive-worktree",
        });
      } catch (error) {
        dependencies.sessionLogger?.warn(
          { err: error, cwd: options.repoRoot },
          "Failed to force-refresh workspace git snapshot after archiving worktree",
        );
      }
    }

    for (const cwd of affectedWorkspaceCwds) {
      dependencies.github.invalidate({ cwd });
    }

    let finalizeFailed = false;
    await Promise.all(
      affectedWorkspaceIdList.map(async (workspaceId) => {
        try {
          await dependencies.archiveWorkspaceRecord(workspaceId);
        } catch (error) {
          finalizeFailed = true;
          dependencies.sessionLogger?.warn(
            { err: error, workspaceId },
            "Failed to archive workspace record; worktree FS already removed",
          );
        }
      }),
    );

    if (finalizeFailed) {
      setState("delete_complete_pending_finalize", "fs_deleted_metadata_pending");
    } else {
      setState("archived", "archive_complete");
    }
  } catch (error) {
    if (filesystemDeleted) {
      setState("delete_complete_pending_finalize", "post_delete_finalize_failed");
    } else {
      setState("active", "archive_aborted_before_delete");
    }
    throw error;
  } finally {
    dependencies.clearWorkspaceArchiving(affectedWorkspaceIdList);
    await dependencies.emitWorkspaceUpdatesForWorkspaceIds(affectedWorkspaceIdList);
  }

  return Array.from(archivedAgents);
}

export async function archiveChisaCodeWorktree(
  dependencies: ArchiveChisaCodeWorktreeDependencies,
  options: {
    targetPath: string;
    repoRoot: string | null;
    worktreesRoot?: string;
    requestId: string;
  },
): Promise<string[]> {
  const coordinator = dependencies.mutationCoordinator ?? workspaceMutationCoordinator;
  const setStateExternal = dependencies.onMutationState;

  if (dependencies.alreadyHoldingMutationLock) {
    return archiveChisaCodeWorktreeBody(dependencies, options, (state, reason) => {
      setStateExternal?.(state, reason);
    });
  }

  const resolvedWorktree = await resolveChisaCodeWorktreeRootForCwd(options.targetPath, {
    chisacodeHome: dependencies.chisacodeHome,
  });
  const resolvedOptions = resolvedWorktree
    ? { ...options, targetPath: resolvedWorktree.worktreePath }
    : options;

  return coordinator.runExclusive(
    resolvedOptions.targetPath,
    "archive-worktree",
    async ({ setState }) => {
      return archiveChisaCodeWorktreeBody(dependencies, resolvedOptions, (state, reason) => {
        setState(state, reason);
        setStateExternal?.(state, reason);
      });
    },
  );
}

export async function killTerminalsUnderPath(
  dependencies: KillTerminalsUnderPathDependencies,
  rootPath: string,
): Promise<void> {
  const terminalManager = dependencies.terminalManager;
  if (!terminalManager) {
    return;
  }

  const terminalIds: string[] = [];
  const relevantCwds = [...terminalManager.listDirectories()].filter((terminalCwd) =>
    dependencies.isPathWithinRoot(rootPath, terminalCwd),
  );
  const terminalLists = await Promise.all(
    relevantCwds.map(async (terminalCwd) => {
      try {
        return await terminalManager.getTerminals(terminalCwd);
      } catch (error) {
        dependencies.sessionLogger.warn(
          { err: error, cwd: terminalCwd },
          "Failed to enumerate worktree terminals during archive",
        );
        return [];
      }
    }),
  );
  for (const terminals of terminalLists) {
    for (const terminal of terminals) {
      terminalIds.push(terminal.id);
    }
  }

  if (terminalIds.length === 0) {
    return;
  }

  const results = await Promise.allSettled(
    terminalIds.map(async (terminalId) => {
      dependencies.detachTerminalStream?.(terminalId, { emitExit: true });
      await terminalManager.killTerminalAndWait(terminalId, {
        gracefulTimeoutMs: 2000,
        forceTimeoutMs: 1500,
      });
    }),
  );

  const failures = results.filter((result) => result.status === "rejected");
  if (failures.length > 0) {
    for (const failure of failures) {
      if (failure.status === "rejected") {
        dependencies.sessionLogger.warn(
          { err: failure.reason },
          "Terminal kill escalation failed during archive",
        );
      }
    }
    throw new Error(`Failed to stop ${failures.length} terminal(s) under worktree before delete`);
  }
}
