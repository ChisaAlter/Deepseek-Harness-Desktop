import { describe, expect, test, vi } from "vitest";
import { WorkspaceDescriptorBuilder } from "./workspace-descriptor-builder.js";
import {
  createPersistedProjectRecord,
  createPersistedWorkspaceRecord,
} from "./workspace-registry.js";
import { createNoopWorkspaceGitService } from "./test-utils/workspace-git-service-stub.js";

function createRecords() {
  const project = createPersistedProjectRecord({
    projectId: "project-1",
    rootPath: "/tmp/project",
    kind: "git",
    displayName: "project",
    createdAt: "2026-07-14T00:00:00.000Z",
    updatedAt: "2026-07-14T00:00:00.000Z",
  });
  const workspace = createPersistedWorkspaceRecord({
    workspaceId: "workspace-1",
    projectId: project.projectId,
    cwd: "/tmp/project",
    kind: "local_checkout",
    displayName: "main",
    createdAt: "2026-07-14T00:00:00.000Z",
    updatedAt: "2026-07-14T00:00:00.000Z",
  });
  return { project, workspace };
}

describe("WorkspaceDescriptorBuilder", () => {
  test("projects passive Git and script snapshots without cold-loading runtime data", async () => {
    const { project, workspace } = createRecords();
    const workspaceGitService = createNoopWorkspaceGitService({
      getSnapshot: vi.fn(async () => {
        throw new Error("cold snapshot load is forbidden");
      }),
      peekSnapshot: vi.fn(() => ({
        cwd: workspace.cwd,
        git: {
          isGit: true,
          repoRoot: workspace.cwd,
          mainRepoRoot: null,
          currentBranch: "feature/read-model",
          remoteUrl: null,
          isChisaCodeOwnedWorktree: false,
          isDirty: true,
          baseRef: "main",
          aheadBehind: null,
          aheadOfOrigin: null,
          behindOfOrigin: null,
          hasRemote: false,
          diffStat: { additions: 3, deletions: 1 },
        },
        github: { featuresEnabled: false, pullRequest: null, error: null },
      })),
    });
    const builder = new WorkspaceDescriptorBuilder({
      projectRegistry: { get: async () => project },
      workspaceGitService,
      buildWorkspaceScriptPayloadSnapshot: () => [],
    });

    const descriptor = await builder.describeWorkspaceRecordWithGitData(workspace, project);
    expect(descriptor).toMatchObject({
      name: "feature/read-model",
      diffStat: { additions: 3, deletions: 1 },
      gitRuntime: { currentBranch: "feature/read-model", isDirty: true },
    });
    expect(workspaceGitService.getSnapshot).not.toHaveBeenCalled();
  });

  test("builds the created-worktree response without requiring a warmed snapshot", async () => {
    const { project, workspace } = createRecords();
    const builder = new WorkspaceDescriptorBuilder({
      projectRegistry: { get: async () => project },
      workspaceGitService: createNoopWorkspaceGitService(),
      buildWorkspaceScriptPayloadSnapshot: () => [],
    });

    const descriptor = await builder.describeCreatedWorktreeWorkspace({
      repoRoot: project.rootPath,
      workspace: { ...workspace, kind: "worktree", displayName: "feature/new" },
      worktree: {
        worktreePath: workspace.cwd,
        branchName: "feature/new",
      },
    });
    expect(descriptor).toMatchObject({
      id: workspace.workspaceId,
      name: "feature/new",
      workspaceKind: "worktree",
      gitRuntime: { currentBranch: "feature/new", isChisaCodeOwnedWorktree: true },
    });
  });
});
