import type { ProjectPlacementPayload, WorkspaceDescriptorPayload } from "./messages.js";
import {
  checkoutLiteFromGitSnapshot,
  deriveWorkspaceDisplayName,
} from "./workspace-registry-model.js";
import {
  resolveProjectDisplayName,
  type PersistedProjectRecord,
  type PersistedWorkspaceRecord,
  type ProjectRegistry,
} from "./workspace-registry.js";
import type { WorkspaceGitService } from "./workspace-git-service.js";
import type { CreateChisaCodeWorktreeResult } from "./chisacode-worktree-service.js";
import { buildWorkspaceCheckout } from "./session-helpers.js";
import {
  buildWorkspaceGitHubRuntimePayload,
  buildWorkspaceGitRuntimePayload,
} from "./workspace-core.js";

interface WorkspaceDescriptorBuilderOptions {
  projectRegistry: Pick<ProjectRegistry, "get">;
  workspaceGitService: Pick<WorkspaceGitService, "peekSnapshot">;
  buildWorkspaceScriptPayloadSnapshot(
    workspaceId: string,
    workspaceDirectory: string,
  ): WorkspaceDescriptorPayload["scripts"];
}

/** Builds workspace and project read-model payloads without mutating persisted state. */
export class WorkspaceDescriptorBuilder {
  constructor(private readonly options: WorkspaceDescriptorBuilderOptions) {}

  async buildProjectPlacementForWorkspace(
    workspace: PersistedWorkspaceRecord,
    projectRecord?: PersistedProjectRecord | null,
  ): Promise<ProjectPlacementPayload> {
    const project = projectRecord ?? (await this.options.projectRegistry.get(workspace.projectId));
    if (!project) {
      throw new Error(`Project not found for workspace ${workspace.workspaceId}`);
    }
    return {
      projectKey: project.projectId,
      projectName: resolveProjectDisplayName(project),
      checkout: buildWorkspaceCheckout(workspace, project),
    };
  }

  async describeWorkspaceRecord(
    workspace: PersistedWorkspaceRecord,
    projectRecord?: PersistedProjectRecord | null,
  ): Promise<WorkspaceDescriptorPayload> {
    const resolvedProjectRecord =
      projectRecord ?? (await this.options.projectRegistry.get(workspace.projectId));
    const snapshot = this.options.workspaceGitService.peekSnapshot(workspace.cwd);

    return {
      id: workspace.workspaceId,
      projectId: workspace.projectId,
      projectDisplayName: resolvedProjectRecord
        ? resolveProjectDisplayName(resolvedProjectRecord)
        : workspace.projectId,
      projectCustomName: resolvedProjectRecord?.customName ?? null,
      projectRootPath: resolvedProjectRecord?.rootPath ?? workspace.cwd,
      workspaceDirectory: workspace.cwd,
      projectKind: (resolvedProjectRecord?.kind ?? "directory") === "git" ? "git" : "non_git",
      workspaceKind: workspace.kind,
      name: workspace.displayName,
      archivingAt: null,
      status: "done",
      activityAt: null,
      diffStat: snapshot?.git.diffStat ?? null,
      scripts: this.options.buildWorkspaceScriptPayloadSnapshot(
        workspace.workspaceId,
        workspace.cwd,
      ),
      ...(resolvedProjectRecord
        ? {
            project: await this.buildProjectPlacementForWorkspace(workspace, resolvedProjectRecord),
          }
        : {}),
    };
  }

  async describeWorkspaceRecordWithGitData(
    workspace: PersistedWorkspaceRecord,
    projectRecord?: PersistedProjectRecord | null,
  ): Promise<WorkspaceDescriptorPayload> {
    const base = await this.describeWorkspaceRecord(workspace, projectRecord);
    const snapshot = this.options.workspaceGitService.peekSnapshot(workspace.cwd);
    if (!snapshot) {
      return base;
    }

    const checkout = checkoutLiteFromGitSnapshot(workspace.cwd, snapshot.git);
    return {
      ...base,
      name: deriveWorkspaceDisplayName({ cwd: workspace.cwd, checkout }),
      diffStat: snapshot.git.diffStat ?? null,
      gitRuntime: buildWorkspaceGitRuntimePayload(snapshot) ?? undefined,
      githubRuntime: buildWorkspaceGitHubRuntimePayload(snapshot),
    };
  }

  async describeCreatedWorktreeWorkspace(
    result: CreateChisaCodeWorktreeResult,
  ): Promise<WorkspaceDescriptorPayload> {
    const projectRecord = await this.options.projectRegistry.get(result.workspace.projectId);
    return {
      id: result.workspace.workspaceId,
      projectId: result.workspace.projectId,
      projectDisplayName: projectRecord
        ? resolveProjectDisplayName(projectRecord)
        : result.workspace.projectId,
      projectCustomName: projectRecord?.customName ?? null,
      projectRootPath: projectRecord?.rootPath ?? result.repoRoot,
      workspaceDirectory: result.workspace.cwd,
      projectKind: "git",
      workspaceKind: result.workspace.kind,
      name: result.worktree.branchName || result.workspace.displayName,
      archivingAt: null,
      status: "done",
      activityAt: null,
      diffStat: { additions: 0, deletions: 0 },
      scripts: [],
      gitRuntime: {
        currentBranch: result.worktree.branchName || null,
        remoteUrl: null,
        isChisaCodeOwnedWorktree: true,
        isDirty: false,
        aheadBehind: null,
        aheadOfOrigin: null,
        behindOfOrigin: null,
      },
      githubRuntime: null,
    };
  }
}
