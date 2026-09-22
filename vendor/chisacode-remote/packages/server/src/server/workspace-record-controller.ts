import { basename } from "node:path";
import {
  classifyDirectoryForProjectMembership,
  normalizeWorkspaceId,
} from "./workspace-registry-model.js";
import {
  createPersistedProjectRecord,
  createPersistedWorkspaceRecord,
  type PersistedProjectRecord,
  type PersistedWorkspaceRecord,
  type ProjectRegistry,
  type WorkspaceRegistry,
} from "./workspace-registry.js";
import { archivePersistedWorkspaceRecord } from "./workspace-archive-service.js";
import type { WorkspaceGitService } from "./workspace-git-service.js";

interface WorkspaceRecordControllerOptions {
  projectRegistry: Pick<ProjectRegistry, "archive" | "get" | "list" | "upsert">;
  workspaceRegistry: Pick<WorkspaceRegistry, "archive" | "get" | "list" | "upsert">;
  workspaceGitService: Pick<WorkspaceGitService, "getCheckout" | "peekSnapshot">;
  resolveRegisteredWorkspaceIdForCwd(cwd: string, workspaces: PersistedWorkspaceRecord[]): string;
  removeWorkspaceGitSubscription(cwd: string): void;
  removeWorkspaceScriptRuntime(cwd: string): void;
  now?: () => string;
}

/** Owns persisted workspace/project lookup, creation, reclassification, and archive mutations. */
export class WorkspaceRecordController {
  private readonly findOrCreateOperations = new Map<string, Promise<PersistedWorkspaceRecord>>();
  private readonly now: () => string;

  constructor(private readonly options: WorkspaceRecordControllerOptions) {
    this.now = options.now ?? (() => new Date().toISOString());
  }

  async findWorkspaceByDirectory(
    cwd: string,
    options?: { refreshGit?: boolean },
  ): Promise<PersistedWorkspaceRecord | null> {
    const normalizedCwd = await this.resolveWorkspaceDirectory(cwd, options);
    const workspaces = await this.options.workspaceRegistry.list();
    const workspaceId = this.options.resolveRegisteredWorkspaceIdForCwd(normalizedCwd, workspaces);
    return workspaces.find((workspace) => workspace.workspaceId === workspaceId) ?? null;
  }

  async findOrCreateWorkspaceForDirectory(cwd: string): Promise<PersistedWorkspaceRecord> {
    const operationKey = normalizeWorkspaceId(cwd);
    const activeOperation = this.findOrCreateOperations.get(operationKey);
    if (activeOperation) {
      return activeOperation;
    }

    const operation = this.findOrCreateWorkspaceForDirectoryUncoalesced(cwd).finally(() => {
      if (this.findOrCreateOperations.get(operationKey) === operation) {
        this.findOrCreateOperations.delete(operationKey);
      }
    });
    this.findOrCreateOperations.set(operationKey, operation);
    return operation;
  }

  async archiveWorkspaceRecord(workspaceId: string, archivedAt?: string): Promise<void> {
    const existingWorkspace = await archivePersistedWorkspaceRecord({
      workspaceId,
      archivedAt,
      workspaceRegistry: this.options.workspaceRegistry,
      projectRegistry: this.options.projectRegistry,
    });
    if (!existingWorkspace) {
      this.options.removeWorkspaceGitSubscription(workspaceId);
      return;
    }

    this.options.removeWorkspaceScriptRuntime(existingWorkspace.cwd);
    this.options.removeWorkspaceGitSubscription(existingWorkspace.cwd);
  }

  private async findOrCreateWorkspaceForDirectoryUncoalesced(
    cwd: string,
  ): Promise<PersistedWorkspaceRecord> {
    const inputCwd = normalizeWorkspaceId(cwd);
    const normalizedCwd = await this.resolveWorkspaceDirectory(cwd);
    const existingWorkspace = await this.findExactWorkspaceByDirectory(normalizedCwd, {
      refreshGit: false,
    });
    if (existingWorkspace) {
      if (existingWorkspace.archivedAt && inputCwd !== normalizedCwd) {
        return this.createDirectoryWorkspace(inputCwd);
      }
      return this.reclassifyOrUnarchiveWorkspaceForDirectory({
        workspace: existingWorkspace,
        cwd: normalizedCwd,
      });
    }

    return this.createWorkspaceForDirectory(normalizedCwd);
  }

  private async findExactWorkspaceByDirectory(
    cwd: string,
    options?: { refreshGit?: boolean },
  ): Promise<PersistedWorkspaceRecord | null> {
    const normalizedCwd = await this.resolveWorkspaceDirectory(cwd, options);
    const workspaces = await this.options.workspaceRegistry.list();
    return workspaces.find((workspace) => workspace.cwd === normalizedCwd) ?? null;
  }

  private async resolveWorkspaceDirectory(
    cwd: string,
    options?: { refreshGit?: boolean },
  ): Promise<string> {
    const normalizedCwd = normalizeWorkspaceId(cwd);
    if (options?.refreshGit === false) {
      const snapshot = this.options.workspaceGitService.peekSnapshot(normalizedCwd);
      return normalizeWorkspaceId(snapshot?.git.repoRoot ?? normalizedCwd);
    }

    const checkout = await this.options.workspaceGitService.getCheckout(normalizedCwd);
    return normalizeWorkspaceId(checkout.worktreeRoot ?? normalizedCwd);
  }

  private async createWorkspaceForDirectory(cwd: string): Promise<PersistedWorkspaceRecord> {
    const checkout = await this.options.workspaceGitService.getCheckout(cwd);
    const membership = classifyDirectoryForProjectMembership({ cwd, checkout });
    const timestamp = this.now();
    const projectRecord = await this.resolveProjectRecordForPlacement({
      membership,
      timestamp,
    });
    await this.options.projectRegistry.upsert(projectRecord);

    const workspaceRecord = createPersistedWorkspaceRecord({
      workspaceId: membership.workspaceId,
      projectId: projectRecord.projectId,
      cwd,
      kind: membership.workspaceKind,
      displayName: membership.workspaceDisplayName,
      createdAt: timestamp,
      updatedAt: timestamp,
    });
    await this.options.workspaceRegistry.upsert(workspaceRecord);
    return workspaceRecord;
  }

  private async createDirectoryWorkspace(cwd: string): Promise<PersistedWorkspaceRecord> {
    const timestamp = this.now();
    const displayName = basename(cwd) || cwd;
    const projectRecord = createPersistedProjectRecord({
      projectId: cwd,
      rootPath: cwd,
      kind: "non_git",
      displayName,
      createdAt: timestamp,
      updatedAt: timestamp,
    });
    await this.options.projectRegistry.upsert(projectRecord);
    const workspaceRecord = createPersistedWorkspaceRecord({
      workspaceId: cwd,
      projectId: projectRecord.projectId,
      cwd,
      kind: "directory",
      displayName,
      createdAt: timestamp,
      updatedAt: timestamp,
    });
    await this.options.workspaceRegistry.upsert(workspaceRecord);
    return workspaceRecord;
  }

  private async reclassifyOrUnarchiveWorkspaceForDirectory(input: {
    workspace: PersistedWorkspaceRecord;
    cwd: string;
  }): Promise<PersistedWorkspaceRecord> {
    const checkout = await this.options.workspaceGitService.getCheckout(input.cwd);
    const membership = classifyDirectoryForProjectMembership({ cwd: input.cwd, checkout });
    const timestamp = this.now();
    const projectRecord = await this.resolveProjectRecordForPlacement({
      membership,
      timestamp,
    });
    const projectId = projectRecord.projectId;
    const kind = membership.workspaceKind;
    const displayName = membership.workspaceDisplayName;

    if (
      input.workspace.workspaceId === membership.workspaceId &&
      input.workspace.projectId === projectId &&
      input.workspace.kind === kind &&
      input.workspace.displayName === displayName
    ) {
      return this.ensureWorkspaceRecordUnarchived(input.workspace);
    }

    await this.options.projectRegistry.upsert(projectRecord);
    const nextWorkspace = {
      ...input.workspace,
      workspaceId: membership.workspaceId,
      projectId,
      cwd: input.cwd,
      kind,
      displayName,
      archivedAt: null,
      updatedAt: timestamp,
    };
    await this.options.workspaceRegistry.upsert(nextWorkspace);
    return nextWorkspace;
  }

  private async resolveProjectRecordForPlacement(input: {
    membership: ReturnType<typeof classifyDirectoryForProjectMembership>;
    timestamp: string;
  }): Promise<PersistedProjectRecord> {
    const rootPath = input.membership.projectRootPath;
    const kind = input.membership.projectKind;
    const projects = await this.options.projectRegistry.list();
    const existingProject =
      projects.find((project) => !project.archivedAt && project.rootPath === rootPath) ??
      projects.find((project) => project.rootPath === rootPath) ??
      null;

    if (!existingProject) {
      return createPersistedProjectRecord({
        projectId: input.membership.projectKey,
        rootPath,
        kind,
        displayName: input.membership.projectName,
        createdAt: input.timestamp,
        updatedAt: input.timestamp,
      });
    }

    return {
      ...existingProject,
      rootPath,
      kind,
      archivedAt: null,
      updatedAt: input.timestamp,
    };
  }

  private async ensureWorkspaceRecordUnarchived(
    workspace: PersistedWorkspaceRecord,
  ): Promise<PersistedWorkspaceRecord> {
    const project = await this.options.projectRegistry.get(workspace.projectId);
    if (!workspace.archivedAt && (!project || !project.archivedAt)) {
      return workspace;
    }

    const timestamp = this.now();
    let unarchivedWorkspace = workspace;
    if (workspace.archivedAt) {
      unarchivedWorkspace = { ...workspace, archivedAt: null, updatedAt: timestamp };
      await this.options.workspaceRegistry.upsert(unarchivedWorkspace);
    }
    if (project?.archivedAt) {
      await this.options.projectRegistry.upsert({
        ...project,
        archivedAt: null,
        updatedAt: timestamp,
      });
    }
    return unarchivedWorkspace;
  }
}
