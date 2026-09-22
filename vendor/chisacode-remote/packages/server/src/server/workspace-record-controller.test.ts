import path from "node:path";
import { describe, expect, test, vi } from "vitest";
import { WorkspaceRecordController } from "./workspace-record-controller.js";
import {
  createPersistedProjectRecord,
  createPersistedWorkspaceRecord,
  type PersistedProjectRecord,
  type PersistedWorkspaceRecord,
} from "./workspace-registry.js";
import { createNoopWorkspaceGitService } from "./test-utils/workspace-git-service-stub.js";

function createHarness() {
  const projects = new Map<string, PersistedProjectRecord>();
  const workspaces = new Map<string, PersistedWorkspaceRecord>();
  const projectUpsert = vi.fn(async (record: PersistedProjectRecord) => {
    projects.set(record.projectId, record);
  });
  const workspaceUpsert = vi.fn(async (record: PersistedWorkspaceRecord) => {
    workspaces.set(record.workspaceId, record);
  });
  const removeWorkspaceGitSubscription = vi.fn();
  const removeWorkspaceScriptRuntime = vi.fn();
  const workspaceGitService = createNoopWorkspaceGitService();
  const controller = new WorkspaceRecordController({
    projectRegistry: {
      archive: async (projectId, archivedAt) => {
        const project = projects.get(projectId);
        if (project) projects.set(projectId, { ...project, archivedAt });
      },
      get: async (projectId) => projects.get(projectId) ?? null,
      list: async () => Array.from(projects.values()),
      upsert: projectUpsert,
    },
    workspaceRegistry: {
      archive: async (workspaceId, archivedAt) => {
        const workspace = workspaces.get(workspaceId);
        if (workspace) workspaces.set(workspaceId, { ...workspace, archivedAt });
      },
      get: async (workspaceId) => workspaces.get(workspaceId) ?? null,
      list: async () => Array.from(workspaces.values()),
      upsert: workspaceUpsert,
    },
    workspaceGitService,
    resolveRegisteredWorkspaceIdForCwd: (cwd, records) =>
      records.find((record) => record.cwd === cwd)?.workspaceId ?? cwd,
    removeWorkspaceGitSubscription,
    removeWorkspaceScriptRuntime,
    now: () => "2026-07-14T00:00:00.000Z",
  });
  return {
    controller,
    projects,
    workspaces,
    projectUpsert,
    workspaceUpsert,
    workspaceGitService,
    removeWorkspaceGitSubscription,
    removeWorkspaceScriptRuntime,
  };
}

describe("WorkspaceRecordController", () => {
  test("coalesces concurrent first-open mutations for the same directory", async () => {
    const harness = createHarness();
    let releaseCheckout: (() => void) | null = null;
    const checkoutGate = new Promise<void>((resolve) => {
      releaseCheckout = resolve;
    });
    harness.workspaceGitService.getCheckout = vi.fn(async (cwd: string) => {
      await checkoutGate;
      return {
        cwd,
        isGit: false,
        currentBranch: null,
        remoteUrl: null,
        worktreeRoot: null,
        isChisaCodeOwnedWorktree: false,
        mainRepoRoot: null,
      };
    });

    const first = harness.controller.findOrCreateWorkspaceForDirectory("/tmp/project");
    const second = harness.controller.findOrCreateWorkspaceForDirectory("/tmp/project");
    releaseCheckout?.();

    const [firstWorkspace, secondWorkspace] = await Promise.all([first, second]);
    expect(firstWorkspace).toBe(secondWorkspace);
    expect(harness.workspaceGitService.getCheckout).toHaveBeenCalledTimes(2);
    expect(harness.projectUpsert).toHaveBeenCalledTimes(1);
    expect(harness.workspaceUpsert).toHaveBeenCalledTimes(1);
  });

  test("unarchives an exact workspace and its project with one shared timestamp", async () => {
    const harness = createHarness();
    const archivedAt = "2026-07-13T00:00:00.000Z";
    const cwd = path.resolve("/tmp/project");
    const project = createPersistedProjectRecord({
      projectId: cwd,
      rootPath: cwd,
      kind: "non_git",
      displayName: "project",
      createdAt: archivedAt,
      updatedAt: archivedAt,
      archivedAt,
    });
    const workspace = createPersistedWorkspaceRecord({
      workspaceId: cwd,
      projectId: project.projectId,
      cwd,
      kind: "directory",
      displayName: "project",
      createdAt: archivedAt,
      updatedAt: archivedAt,
      archivedAt,
    });
    harness.projects.set(project.projectId, project);
    harness.workspaces.set(workspace.workspaceId, workspace);

    const reopened = await harness.controller.findOrCreateWorkspaceForDirectory(workspace.cwd);
    expect(reopened.archivedAt).toBeNull();
    expect(reopened.updatedAt).toBe("2026-07-14T00:00:00.000Z");
    expect(harness.projects.get(project.projectId)).toMatchObject({
      archivedAt: null,
      updatedAt: "2026-07-14T00:00:00.000Z",
    });
  });

  test("archives workspace resources by canonical cwd and handles missing records", async () => {
    const harness = createHarness();
    const project = createPersistedProjectRecord({
      projectId: "project-1",
      rootPath: "/tmp/project",
      kind: "non_git",
      displayName: "project",
      createdAt: "2026-07-14T00:00:00.000Z",
      updatedAt: "2026-07-14T00:00:00.000Z",
    });
    const workspace = createPersistedWorkspaceRecord({
      workspaceId: "workspace-1",
      projectId: project.projectId,
      cwd: "/tmp/project",
      kind: "directory",
      displayName: "project",
      createdAt: "2026-07-14T00:00:00.000Z",
      updatedAt: "2026-07-14T00:00:00.000Z",
    });
    harness.projects.set(project.projectId, project);
    harness.workspaces.set(workspace.workspaceId, workspace);

    await harness.controller.archiveWorkspaceRecord(workspace.workspaceId);
    expect(harness.removeWorkspaceScriptRuntime).toHaveBeenCalledWith(workspace.cwd);
    expect(harness.removeWorkspaceGitSubscription).toHaveBeenCalledWith(workspace.cwd);

    await harness.controller.archiveWorkspaceRecord("missing-workspace");
    expect(harness.removeWorkspaceGitSubscription).toHaveBeenCalledWith("missing-workspace");
  });
});
