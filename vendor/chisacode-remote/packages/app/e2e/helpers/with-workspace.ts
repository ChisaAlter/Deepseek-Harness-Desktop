import { execSync } from "node:child_process";
import path from "node:path";
import type { Page } from "@playwright/test";
import { buildHostWorkspaceRoute } from "../../src/utils/host-routes";
import { waitForWorkspaceTabsVisible } from "./workspace-ui";
import { getServerId } from "./server-id";
import { createTempGitRepo, resolveTempRoot } from "./workspace";
import { connectWorkspaceSetupClient, type WorkspaceSetupDaemonClient } from "./workspace-setup";

export interface CreatedWorkspace {
  workspaceId: string;
  repoPath: string;
  navigateTo(): Promise<void>;
}

export interface WithWorkspaceOptions {
  worktree?: boolean;
  prefix?: string;
}

export type WithWorkspace = (options?: WithWorkspaceOptions) => Promise<CreatedWorkspace>;

interface WorktreeRecord {
  repoPath: string;
  worktreePath: string;
  workspaceId: string;
}

export interface WithWorkspaceHandle {
  withWorkspace: WithWorkspace;
  cleanup: () => Promise<void>;
}

export function createWithWorkspace(page: Page): WithWorkspaceHandle {
  let client: WorkspaceSetupDaemonClient | null = null;
  const workspaceIds: string[] = [];
  const repos: Array<{ cleanup: () => Promise<void> }> = [];
  const worktrees: WorktreeRecord[] = [];

  const withWorkspace: WithWorkspace = async (options) => {
    if (!client) {
      client = await connectWorkspaceSetupClient();
    }
    const prefix = options?.prefix ?? (options?.worktree ? "wt-" : "ws-");
    const repo = await createTempGitRepo(prefix);
    repos.push(repo);

    let workspacePath = repo.path;
    let worktreeRecord: WorktreeRecord | null = null;
    if (options?.worktree) {
      const tempRoot = await resolveTempRoot();
      workspacePath = path.join(
        tempRoot,
        `chisacode-wt-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      );
      const branchName = `chisacode-wt-${Date.now()}`;
      execSync(
        `git worktree add ${JSON.stringify(workspacePath)} -b ${JSON.stringify(branchName)} main`,
        { cwd: repo.path, stdio: "ignore" },
      );
      // Register the parent project so the sidebar lists it before we navigate.
      const parent = await client.openProject(repo.path);
      if (parent.workspace) {
        workspaceIds.push(parent.workspace.id);
      }
      worktreeRecord = { repoPath: repo.path, worktreePath: workspacePath, workspaceId: "" };
      worktrees.push(worktreeRecord);
    }

    const opened = await client.openProject(workspacePath);
    if (!opened.workspace) {
      throw new Error(opened.error ?? `Failed to open project ${workspacePath}`);
    }
    const workspaceId = opened.workspace.id;
    workspaceIds.push(workspaceId);
    if (worktreeRecord) {
      worktreeRecord.workspaceId = workspaceId;
    }

    return {
      workspaceId,
      repoPath: workspacePath,
      navigateTo: async () => {
        await page.goto(buildHostWorkspaceRoute(getServerId(), workspaceId), {
          waitUntil: "domcontentloaded",
        });
        await page.waitForURL((url) => url.pathname.includes("/workspace/"), {
          timeout: 60_000,
        });
        await waitForWorkspaceTabsVisible(page);
      },
    };
  };

  return {
    withWorkspace,
    cleanup: async () => {
      if (client) {
        const worktreeWorkspaceIds = new Set(
          worktrees.map((worktree) => worktree.workspaceId).filter(Boolean),
        );
        for (const workspaceId of workspaceIds) {
          if (worktreeWorkspaceIds.has(workspaceId)) {
            continue;
          }
          await client.archiveWorkspace(workspaceId).catch(() => undefined);
        }
        for (const worktree of worktrees) {
          if (!worktree.workspaceId) {
            continue;
          }
          await client
            .archiveChisaCodeWorktree({ worktreePath: worktree.workspaceId })
            .catch(() => undefined);
        }
        await client.close().catch(() => undefined);
        client = null;
      }
      workspaceIds.length = 0;
      for (const { repoPath, worktreePath } of worktrees) {
        try {
          execSync(`git worktree remove ${JSON.stringify(worktreePath)} --force`, {
            cwd: repoPath,
            stdio: "ignore",
          });
        } catch {
          // Best-effort cleanup so the original test failure is preserved.
        }
      }
      for (const repo of repos) {
        await repo.cleanup();
      }
    },
  };
}
