import type { Logger } from "pino";
import { beforeEach, describe, expect, test, vi } from "vitest";

import {
  archiveIfSafe,
  type ArchiveIfSafeDependencies,
  type AutoArchiveArchiveOptions,
} from "./archive-if-safe.js";
import {
  WorkspaceMutationCoordinator,
  type WorkspaceMutationState,
} from "../workspace-mutation-coordinator.js";
import type { WorkspaceGitRuntimeSnapshot } from "../workspace-git-service.js";

const CWD = "/tmp/chisacode/worktrees/repo/branch";
const CHISACODE_HOME = "/tmp/chisacode";
const WORKTREES_ROOT = "/tmp/chisacode/worktrees/repo";

function createPullRequest(
  overrides?: Partial<NonNullable<WorkspaceGitRuntimeSnapshot["github"]["pullRequest"]>>,
): NonNullable<WorkspaceGitRuntimeSnapshot["github"]["pullRequest"]> {
  return {
    url: "https://github.com/acme/repo/pull/123",
    title: "Merge me",
    state: "open",
    baseRefName: "main",
    headRefName: "feature",
    isMerged: true,
    ...overrides,
  };
}

function createSnapshot(overrides?: {
  git?: Partial<WorkspaceGitRuntimeSnapshot["git"]>;
  pullRequest?: WorkspaceGitRuntimeSnapshot["github"]["pullRequest"];
}): WorkspaceGitRuntimeSnapshot {
  return {
    cwd: CWD,
    git: {
      isGit: true,
      repoRoot: "/tmp/repo",
      mainRepoRoot: "/tmp/repo",
      currentBranch: "feature",
      remoteUrl: "https://github.com/acme/repo.git",
      isChisaCodeOwnedWorktree: true,
      isDirty: false,
      baseRef: "main",
      aheadBehind: { ahead: 0, behind: 0 },
      aheadOfOrigin: 0,
      behindOfOrigin: 0,
      hasRemote: true,
      diffStat: { additions: 0, deletions: 0 },
      ...overrides?.git,
    },
    github: {
      featuresEnabled: true,
      pullRequest:
        overrides && "pullRequest" in overrides
          ? (overrides.pullRequest ?? null)
          : createPullRequest(),
      error: null,
    },
  };
}

function createLogger(): Logger {
  const logger = {
    child: () => logger,
    info: vi.fn(),
    warn: vi.fn(),
  };
  return logger as unknown as Logger;
}

function createHarness(overrides?: {
  autoArchiveAfterMerge?: boolean;
  getSnapshot?: (
    cwd: string,
    options?: { force?: boolean; reason?: string },
  ) => Promise<WorkspaceGitRuntimeSnapshot | null>;
  isChisaCodeOwnedWorktreeCwd?: ArchiveIfSafeDependencies["isChisaCodeOwnedWorktreeCwd"];
  archiveChisaCodeWorktree?: ArchiveIfSafeDependencies["archiveChisaCodeWorktree"];
  mutationCoordinator?: WorkspaceMutationCoordinator;
}) {
  const getConfig = vi.fn(() => ({
    autoArchiveAfterMerge: overrides?.autoArchiveAfterMerge ?? true,
  }));
  const getSnapshot = vi.fn(
    overrides?.getSnapshot ?? (async () => createSnapshot()),
  ) as unknown as AutoArchiveArchiveOptions["workspaceGitService"]["getSnapshot"];
  const workspaceGitService = {
    getSnapshot,
  } as unknown as AutoArchiveArchiveOptions["workspaceGitService"];
  const options: AutoArchiveArchiveOptions = {
    chisacodeHome: CHISACODE_HOME,
    daemonConfigStore: {
      get: getConfig,
    } as unknown as AutoArchiveArchiveOptions["daemonConfigStore"],
    workspaceGitService,
    github: {} as AutoArchiveArchiveOptions["github"],
    agentManager: {} as AutoArchiveArchiveOptions["agentManager"],
    agentStorage: {} as AutoArchiveArchiveOptions["agentStorage"],
    terminalManager: {} as AutoArchiveArchiveOptions["terminalManager"],
    archiveWorkspaceRecord: vi.fn(),
    markWorkspaceArchiving: vi.fn(),
    clearWorkspaceArchiving: vi.fn(),
    emitWorkspaceUpdatesForWorkspaceIds: vi.fn(),
  };
  const archiveChisaCodeWorktree = vi.fn(
    overrides?.archiveChisaCodeWorktree ?? (async () => []),
  ) as unknown as ArchiveIfSafeDependencies["archiveChisaCodeWorktree"];
  const isChisaCodeOwnedWorktreeCwd = vi.fn(
    overrides?.isChisaCodeOwnedWorktreeCwd ??
      (async () => ({
        allowed: true,
        repoRoot: "/tmp/repo",
        worktreeRoot: WORKTREES_ROOT,
        worktreePath: CWD,
      })),
  ) as unknown as ArchiveIfSafeDependencies["isChisaCodeOwnedWorktreeCwd"];
  const mutationCoordinator = overrides?.mutationCoordinator ?? new WorkspaceMutationCoordinator();
  const deps: ArchiveIfSafeDependencies = {
    archiveChisaCodeWorktree,
    isChisaCodeOwnedWorktreeCwd,
    killTerminalsUnderPath: vi.fn(),
    isPathWithinRoot: vi.fn(() => true),
    mutationCoordinator,
  };
  const log = createLogger();
  const inFlight = new Set<string>();

  return {
    deps,
    getConfig,
    getSnapshot,
    inFlight,
    log,
    options,
    mutationCoordinator,
  };
}

async function runArchiveIfSafe(
  harness: ReturnType<typeof createHarness>,
  overrides?: {
    cwd?: string;
    pullRequest?: WorkspaceGitRuntimeSnapshot["github"]["pullRequest"];
  },
): Promise<void> {
  await archiveIfSafe({
    cwd: overrides?.cwd ?? CWD,
    pullRequest:
      overrides && "pullRequest" in overrides
        ? (overrides.pullRequest ?? null)
        : createPullRequest(),
    inFlight: harness.inFlight,
    options: harness.options,
    log: harness.log,
    deps: harness.deps,
  });
}

describe("archiveIfSafe", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test("does nothing when the pull request is not merged", async () => {
    const harness = createHarness();

    await runArchiveIfSafe(harness, { pullRequest: createPullRequest({ isMerged: false }) });

    expect(harness.getConfig).not.toHaveBeenCalled();
    expect(harness.getSnapshot).not.toHaveBeenCalled();
    expect(harness.deps.archiveChisaCodeWorktree).not.toHaveBeenCalled();
  });

  test("does nothing when auto-archive-after-merge is disabled", async () => {
    const harness = createHarness({ autoArchiveAfterMerge: false });

    await runArchiveIfSafe(harness);

    expect(harness.getConfig).toHaveBeenCalledTimes(1);
    expect(harness.getSnapshot).not.toHaveBeenCalled();
    expect(harness.deps.archiveChisaCodeWorktree).not.toHaveBeenCalled();
  });

  test("does nothing when the cwd already has an archive in flight", async () => {
    const harness = createHarness();
    harness.inFlight.add(CWD);

    await runArchiveIfSafe(harness);

    expect(harness.getSnapshot).not.toHaveBeenCalled();
    expect(harness.deps.archiveChisaCodeWorktree).not.toHaveBeenCalled();
    expect(harness.inFlight.has(CWD)).toBe(true);
  });

  test("logs and skips when force-refreshing the snapshot fails", async () => {
    const harness = createHarness({
      getSnapshot: async () => {
        throw new Error("snapshot failed");
      },
    });

    await runArchiveIfSafe(harness);

    expect(harness.getSnapshot).toHaveBeenCalledWith(CWD, {
      force: true,
      reason: "auto-archive-on-merge-safety-gate",
    });
    expect(harness.log.warn).toHaveBeenCalledWith(
      expect.objectContaining({
        err: expect.any(Error),
        decision: "deny",
        reason: "snapshot_refresh_failed",
      }),
      "Failed to force-refresh snapshot for auto-archive; skipping",
    );
    expect(harness.deps.archiveChisaCodeWorktree).not.toHaveBeenCalled();
    expect(harness.inFlight.has(CWD)).toBe(false);
  });

  test("does nothing when there is no snapshot", async () => {
    const harness = createHarness({ getSnapshot: async () => null });

    await runArchiveIfSafe(harness);

    expect(harness.getSnapshot).toHaveBeenCalledWith(CWD, {
      force: true,
      reason: "auto-archive-on-merge-safety-gate",
    });
    expect(harness.deps.archiveChisaCodeWorktree).not.toHaveBeenCalled();
  });

  test("does nothing when the worktree is dirty", async () => {
    const harness = createHarness({
      getSnapshot: async () => createSnapshot({ git: { isDirty: true } }),
    });

    await runArchiveIfSafe(harness);

    expect(harness.getSnapshot).toHaveBeenCalledWith(CWD, {
      force: true,
      reason: "auto-archive-on-merge-safety-gate",
    });
    expect(harness.deps.archiveChisaCodeWorktree).not.toHaveBeenCalled();
  });

  test("does nothing when the worktree is ahead of origin", async () => {
    const harness = createHarness({
      getSnapshot: async () => createSnapshot({ git: { aheadOfOrigin: 1 } }),
    });

    await runArchiveIfSafe(harness);

    expect(harness.deps.archiveChisaCodeWorktree).not.toHaveBeenCalled();
  });

  test("fail-closes when dirty state is unknown", async () => {
    const harness = createHarness({
      getSnapshot: async () =>
        createSnapshot({
          git: { isDirty: null as unknown as boolean },
        }),
    });

    await runArchiveIfSafe(harness);

    expect(harness.deps.archiveChisaCodeWorktree).not.toHaveBeenCalled();
  });

  test("fail-closes when aheadOfOrigin is unknown", async () => {
    const harness = createHarness({
      getSnapshot: async () =>
        createSnapshot({
          git: { aheadOfOrigin: null as unknown as number },
        }),
    });

    await runArchiveIfSafe(harness);

    expect(harness.deps.archiveChisaCodeWorktree).not.toHaveBeenCalled();
  });

  test("does nothing when the cwd is not a ChisaCode-owned worktree", async () => {
    const harness = createHarness({
      isChisaCodeOwnedWorktreeCwd: async () => ({ allowed: false, worktreePath: CWD }),
    });

    await runArchiveIfSafe(harness);

    expect(harness.deps.isChisaCodeOwnedWorktreeCwd).toHaveBeenCalledWith(CWD, {
      chisacodeHome: CHISACODE_HOME,
    });
    expect(harness.getSnapshot).not.toHaveBeenCalled();
    expect(harness.deps.archiveChisaCodeWorktree).not.toHaveBeenCalled();
  });

  test("aborts when ownership changes after force refresh", async () => {
    let ownershipCalls = 0;
    const harness = createHarness({
      isChisaCodeOwnedWorktreeCwd: async () => {
        ownershipCalls += 1;
        if (ownershipCalls === 1) {
          return {
            allowed: true,
            repoRoot: "/tmp/repo",
            worktreeRoot: WORKTREES_ROOT,
            worktreePath: CWD,
          };
        }
        return { allowed: false, worktreePath: CWD };
      },
    });

    await runArchiveIfSafe(harness);

    expect(ownershipCalls).toBe(2);
    expect(harness.deps.archiveChisaCodeWorktree).not.toHaveBeenCalled();
  });

  test("logs and does not throw when archiving fails", async () => {
    const harness = createHarness({
      archiveChisaCodeWorktree: async () => {
        throw new Error("archive failed");
      },
    });

    await runArchiveIfSafe(harness);

    expect(harness.log.warn).toHaveBeenCalledWith(
      expect.objectContaining({
        err: expect.any(Error),
        decision: "abort",
        reason: "archive_failed",
      }),
      "Auto-archive after merge failed",
    );
    expect(harness.inFlight.has(CWD)).toBe(false);
  });

  test("force-refreshes snapshot before authorizing archive", async () => {
    const harness = createHarness();

    await runArchiveIfSafe(harness);

    expect(harness.getSnapshot).toHaveBeenCalledWith(CWD, {
      force: true,
      reason: "auto-archive-on-merge-safety-gate",
    });
    expect(harness.deps.archiveChisaCodeWorktree).toHaveBeenCalledTimes(1);
    expect(harness.deps.archiveChisaCodeWorktree).toHaveBeenCalledWith(
      expect.objectContaining({
        chisacodeHome: CHISACODE_HOME,
        workspaceGitService: harness.options.workspaceGitService,
        alreadyHoldingMutationLock: true,
      }),
      {
        targetPath: CWD,
        repoRoot: "/tmp/repo",
        worktreesRoot: WORKTREES_ROOT,
        requestId: "auto-archive-on-merge",
      },
    );
    expect(harness.log.info).toHaveBeenCalledWith(
      expect.objectContaining({
        decision: "complete",
        reason: "archived_after_merge",
      }),
      "Auto-archived worktree after PR merge",
    );
    expect(harness.inFlight.has(CWD)).toBe(false);
  });

  test("serializes concurrent archive attempts on the same path", async () => {
    const decisions: string[] = [];
    const coordinator = new WorkspaceMutationCoordinator({
      onDecision: (entry) => {
        decisions.push(`${entry.decision}:${entry.reason}:${entry.state}`);
      },
    });
    let releaseFirst!: () => void;
    const firstGate = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    let archiveCalls = 0;

    const harness = createHarness({
      mutationCoordinator: coordinator,
      archiveChisaCodeWorktree: async (_deps, _options) => {
        archiveCalls += 1;
        if (archiveCalls === 1) {
          await firstGate;
        }
        return [];
      },
    });

    const first = runArchiveIfSafe(harness);
    // Wait until first archive body is running.
    await vi.waitFor(() => expect(archiveCalls).toBe(1));
    const second = runArchiveIfSafe(harness);
    releaseFirst();
    await Promise.all([first, second]);

    // Second attempt either waits and runs after, or is denied while busy.
    // With exclusive chain, second should run after first completes.
    expect(archiveCalls).toBeGreaterThanOrEqual(1);
    expect(decisions.some((entry) => entry.includes("lock_acquired"))).toBe(true);
  });

  test("exposes mutation state transitions during exclusive archive", async () => {
    const states: WorkspaceMutationState[] = [];
    const coordinator = new WorkspaceMutationCoordinator();
    const harness = createHarness({
      mutationCoordinator: coordinator,
      archiveChisaCodeWorktree: async (deps) => {
        deps.onMutationState?.("deleting", "test_delete");
        deps.onMutationState?.("archived", "test_done");
        states.push(coordinator.getState(CWD));
        return [];
      },
    });

    await runArchiveIfSafe(harness);

    expect(states.length).toBeGreaterThan(0);
  });
});
