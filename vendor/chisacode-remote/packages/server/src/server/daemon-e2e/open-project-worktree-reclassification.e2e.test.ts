import { execFileSync } from "node:child_process";
import { mkdtempSync, realpathSync, writeFileSync } from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, test } from "vitest";

import { DaemonClient } from "../test-utils/daemon-client.js";
import {
  createTestChisaCodeDaemon,
  type TestChisaCodeDaemon,
} from "../test-utils/chisacode-daemon.js";
import {
  createPersistedProjectRecord,
  createPersistedWorkspaceRecord,
  type PersistedProjectRecord,
  type PersistedWorkspaceRecord,
} from "../workspace-registry.js";

const cleanupPaths = new Set<string>();
const cleanupDaemons = new Set<TestChisaCodeDaemon>();
const cleanupClients = new Set<DaemonClient>();
const cleanupGitWorktrees: Array<{ repoRoot: string; worktreeRoot: string }> = [];

function git(cwd: string, args: string[]): void {
  execFileSync("git", args, { cwd, stdio: "pipe" });
}

afterEach(async () => {
  await Promise.all(Array.from(cleanupClients, (client) => client.close().catch(() => undefined)));
  cleanupClients.clear();
  await Promise.all(Array.from(cleanupDaemons, (daemon) => daemon.close().catch(() => undefined)));
  cleanupDaemons.clear();
  for (const worktree of cleanupGitWorktrees.splice(0)) {
    try {
      git(worktree.repoRoot, ["worktree", "remove", "--force", worktree.worktreeRoot]);
    } catch {
      // The recursive temp cleanup below still handles already-removed worktrees.
    }
  }
  await Promise.all(
    Array.from(cleanupPaths, (target) => rm(target, { recursive: true, force: true })),
  );
  cleanupPaths.clear();
});

test("openProject reclassifies an existing directory workspace into its parent git project", async () => {
  const previousSupervised = process.env.CHISACODE_SUPERVISED;
  process.env.CHISACODE_SUPERVISED = "0";
  try {
    const repoRoot = realpathSync(
      mkdtempSync(path.join(os.tmpdir(), "chisacode-open-project-repo-")),
    );
    const worktreeRoot = realpathSync(
      mkdtempSync(path.join(os.tmpdir(), "chisacode-open-project-worktree-")),
    );
    const chisacodeHomeRoot = realpathSync(
      mkdtempSync(path.join(os.tmpdir(), "chisacode-open-project-home-")),
    );
    cleanupPaths.add(repoRoot);
    cleanupPaths.add(worktreeRoot);
    cleanupPaths.add(chisacodeHomeRoot);

    git(repoRoot, ["init", "-b", "main"]);
    git(repoRoot, ["config", "user.email", "test@chisacode.dev"]);
    git(repoRoot, ["config", "user.name", "ChisaCode Test"]);
    writeFileSync(path.join(repoRoot, "README.md"), "# repo\n", "utf8");
    git(repoRoot, ["add", "README.md"]);
    git(repoRoot, ["-c", "commit.gpgSign=false", "commit", "-m", "initial"]);
    git(repoRoot, ["branch", "feature/desktop-daemon-settings"]);
    git(repoRoot, ["worktree", "add", worktreeRoot, "feature/desktop-daemon-settings"]);
    cleanupGitWorktrees.push({ repoRoot, worktreeRoot });

    const chisacodeHome = path.join(chisacodeHomeRoot, ".chisacode");
    const projectsPath = path.join(chisacodeHome, "projects", "projects.json");
    const workspacesPath = path.join(chisacodeHome, "projects", "workspaces.json");
    const timestamp = "2026-04-24T09:46:43.146Z";

    await mkdir(path.dirname(projectsPath), { recursive: true });
    await writeRegistry(projectsPath, [
      createPersistedProjectRecord({
        projectId: repoRoot,
        rootPath: repoRoot,
        kind: "git",
        displayName: "repo",
        createdAt: timestamp,
        updatedAt: timestamp,
      }),
      createPersistedProjectRecord({
        projectId: worktreeRoot,
        rootPath: worktreeRoot,
        kind: "non_git",
        displayName: "desktop-daemon-settings",
        createdAt: timestamp,
        updatedAt: timestamp,
      }),
    ]);
    await writeRegistry(workspacesPath, [
      createPersistedWorkspaceRecord({
        workspaceId: repoRoot,
        projectId: repoRoot,
        cwd: repoRoot,
        kind: "local_checkout",
        displayName: "main",
        createdAt: timestamp,
        updatedAt: timestamp,
      }),
      createPersistedWorkspaceRecord({
        workspaceId: worktreeRoot,
        projectId: worktreeRoot,
        cwd: worktreeRoot,
        kind: "directory",
        displayName: "desktop-daemon-settings",
        createdAt: timestamp,
        updatedAt: timestamp,
      }),
    ]);

    const daemon = await createTestChisaCodeDaemon({ chisacodeHomeRoot, cleanup: false });
    cleanupDaemons.add(daemon);
    const client = new DaemonClient({ url: `ws://127.0.0.1:${daemon.port}/ws` });
    cleanupClients.add(client);
    await client.connect();
    await client.fetchAgents({ subscribe: { subscriptionId: "worktree-reclassification" } });

    const response = await client.openProject(worktreeRoot);
    const persistedProjects = await readRegistry<PersistedProjectRecord>(projectsPath);
    const persistedWorkspaces = await readRegistry<PersistedWorkspaceRecord>(workspacesPath);

    expect(response.error).toBeNull();
    expect(response.workspace?.projectId).toBe(repoRoot);
    expect(response.workspace?.workspaceKind).toBe("worktree");
    expect(persistedProjects.find((project) => project.projectId === repoRoot)?.rootPath).toBe(
      repoRoot,
    );
    expect(
      persistedWorkspaces.find((workspace) => workspace.workspaceId === worktreeRoot)?.projectId,
    ).toBe(repoRoot);
    expect(
      persistedWorkspaces.find((workspace) => workspace.workspaceId === worktreeRoot)?.kind,
    ).toBe("worktree");
  } finally {
    process.env.CHISACODE_SUPERVISED = previousSupervised;
  }
}, 30_000);

async function writeRegistry(
  filePath: string,
  records: PersistedProjectRecord[] | PersistedWorkspaceRecord[],
): Promise<void> {
  await writeFile(filePath, JSON.stringify(records, null, 2), "utf8");
}

async function readRegistry<TRecord>(filePath: string): Promise<TRecord[]> {
  return JSON.parse(await readFile(filePath, "utf8")) as TRecord[];
}
