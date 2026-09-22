import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import type { Logger } from "pino";
import { afterEach, describe, expect, test, vi } from "vitest";

import { archiveIfSafe, type AutoArchiveArchiveOptions } from "./archive-if-safe.js";
import { WorkspaceMutationCoordinator } from "../workspace-mutation-coordinator.js";
import { deleteChisaCodeWorktree, isChisaCodeOwnedWorktreeCwd } from "../../utils/worktree.js";

function run(cwd: string, command: string, args: string[]): void {
  execFileSync(command, args, { cwd, stdio: "pipe" });
}

function createLogger(): Logger {
  const logger = {
    child: () => logger,
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };
  return logger as unknown as Logger;
}

describe("archiveIfSafe temp repo safety", () => {
  const cleanup: string[] = [];

  afterEach(() => {
    for (const path of cleanup.splice(0)) {
      rmSync(path, { recursive: true, force: true });
    }
  });

  test("force-refresh sees newly created untracked file and refuses delete", async () => {
    const tempDir = mkdtempSync(join(tmpdir(), "chisacode-archive-safe-"));
    cleanup.push(tempDir);
    const repoDir = join(tempDir, "repo");
    const chisacodeHome = join(tempDir, ".chisacode");
    mkdirSync(repoDir);
    run(repoDir, "git", ["init"]);
    run(repoDir, "git", ["config", "user.email", "test@example.com"]);
    run(repoDir, "git", ["config", "user.name", "Test"]);
    writeFileSync(join(repoDir, "README.md"), "hello\n");
    run(repoDir, "git", ["add", "README.md"]);
    run(repoDir, "git", ["commit", "-m", "init"]);
    run(repoDir, "git", ["branch", "-M", "main"]);
    run(repoDir, "git", ["checkout", "-b", "feature"]);
    writeFileSync(join(repoDir, "feature.txt"), "feature\n");
    run(repoDir, "git", ["add", "feature.txt"]);
    run(repoDir, "git", ["commit", "-m", "feature"]);

    // Simulate a ChisaCode-owned worktree path by creating under chisacode home hash root.
    // For this test we only need force-refresh semantics via a real git dirty state.
    const worktreePath = repoDir;
    writeFileSync(join(worktreePath, "unexpected-untracked.txt"), "do not delete me\n");

    const getSnapshot = vi.fn(async (_cwd: string, options?: { force?: boolean }) => {
      // Cached path would have claimed clean; force path must re-read.
      if (!options?.force) {
        return {
          cwd: worktreePath,
          git: {
            isGit: true,
            isDirty: false,
            aheadOfOrigin: 0,
            repoRoot: repoDir,
            mainRepoRoot: repoDir,
            currentBranch: "feature",
            remoteUrl: null,
            isChisaCodeOwnedWorktree: true,
            baseRef: "main",
            aheadBehind: { ahead: 0, behind: 0 },
            behindOfOrigin: 0,
            hasRemote: false,
            diffStat: { additions: 0, deletions: 0 },
          },
          github: { featuresEnabled: false, pullRequest: null, error: null },
        };
      }
      const status = execFileSync("git", ["status", "--porcelain"], {
        cwd: worktreePath,
        encoding: "utf8",
      });
      return {
        cwd: worktreePath,
        git: {
          isGit: true,
          isDirty: status.trim().length > 0,
          aheadOfOrigin: 0,
          repoRoot: repoDir,
          mainRepoRoot: repoDir,
          currentBranch: "feature",
          remoteUrl: null,
          isChisaCodeOwnedWorktree: true,
          baseRef: "main",
          aheadBehind: { ahead: 0, behind: 0 },
          behindOfOrigin: 0,
          hasRemote: false,
          diffStat: { additions: 0, deletions: 0 },
        },
        github: { featuresEnabled: false, pullRequest: null, error: null },
      };
    });

    const archiveChisaCodeWorktree = vi.fn(async () => []);
    const coordinator = new WorkspaceMutationCoordinator();
    const options = {
      chisacodeHome,
      daemonConfigStore: { get: () => ({ autoArchiveAfterMerge: true }) },
      workspaceGitService: { getSnapshot },
      github: {},
      agentManager: {},
      agentStorage: {},
      terminalManager: {},
      archiveWorkspaceRecord: vi.fn(),
      markWorkspaceArchiving: vi.fn(),
      clearWorkspaceArchiving: vi.fn(),
      emitWorkspaceUpdatesForWorkspaceIds: vi.fn(),
    } as unknown as AutoArchiveArchiveOptions;

    await archiveIfSafe({
      cwd: worktreePath,
      pullRequest: {
        url: "https://example.com/pr/1",
        title: "t",
        state: "merged",
        baseRefName: "main",
        headRefName: "feature",
        isMerged: true,
      },
      inFlight: new Set(),
      options,
      log: createLogger(),
      deps: {
        archiveChisaCodeWorktree,
        isChisaCodeOwnedWorktreeCwd: async () => ({
          allowed: true,
          repoRoot: repoDir,
          worktreeRoot: tempDir,
          worktreePath,
        }),
        killTerminalsUnderPath: vi.fn(),
        isPathWithinRoot: () => true,
        mutationCoordinator: coordinator,
      },
    });

    expect(getSnapshot).toHaveBeenCalledWith(worktreePath, {
      force: true,
      reason: "auto-archive-on-merge-safety-gate",
    });
    expect(archiveChisaCodeWorktree).not.toHaveBeenCalled();
    expect(existsSync(join(worktreePath, "unexpected-untracked.txt"))).toBe(true);
  });

  test("delete path refuses non-managed roots", async () => {
    const tempDir = mkdtempSync(join(tmpdir(), "chisacode-delete-refuse-"));
    cleanup.push(tempDir);
    const outside = join(tempDir, "outside");
    mkdirSync(outside);
    writeFileSync(join(outside, "file.txt"), "x\n");

    await expect(
      deleteChisaCodeWorktree({
        cwd: null,
        worktreePath: outside,
        worktreesRoot: join(tempDir, "managed-root"),
      }),
    ).rejects.toThrow("Refusing to delete non-ChisaCode worktree");
    expect(existsSync(join(outside, "file.txt"))).toBe(true);
  });

  test("ownership helper rejects paths outside chisacode worktrees", async () => {
    const tempDir = mkdtempSync(join(tmpdir(), "chisacode-own-"));
    cleanup.push(tempDir);
    const ownership = await isChisaCodeOwnedWorktreeCwd(tempDir, {
      chisacodeHome: join(tempDir, ".chisacode"),
    });
    expect(ownership.allowed).toBe(false);
  });
});
