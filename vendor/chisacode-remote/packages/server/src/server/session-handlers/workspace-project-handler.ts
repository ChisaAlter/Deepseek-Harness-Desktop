/**
 * WorkspaceProjectHandler — extracted from Session.
 *
 * Handles workspace/project dispatch, workspace state machine, and
 * workspace-specific operations (file explorer, project icons, downloads,
 * worktrees, editors).
 */

import { getErrorMessage } from "@chisacode/protocol/error-utils";
import {
  listDirectoryEntries,
  readExplorerFile,
  readExplorerFileBytes,
  getDownloadableFileInfo,
} from "../file-explorer/service.js";
import { getProjectIcon } from "../../utils/project-icon.js";
import {
  handleCreateChisaCodeWorktreeRequest as handleCreateWorktreeRequest,
  handleChisaCodeWorktreeArchiveRequest as handleWorktreeArchiveRequest,
  handleChisaCodeWorktreeListRequest as handleWorktreeListRequest,
  handleWorkspaceSetupStatusRequest as handleWorkspaceSetupStatusRequestMessage,
} from "../worktree-session.js";
import {
  encodeFileTransferFrame,
  FileTransferOpcode,
} from "@chisacode/protocol/binary-frames/index";
import { CursorError } from "../pagination/cursor.js";
import { summarizeFetchWorkspacesEntries } from "../workspace-directory.js";
import { resolveSubscriptionId } from "../session-helpers.js";
import { attemptFirstAgentBranchAutoName } from "../chisacode-worktree-service.js";
import { generateBranchNameFromFirstAgentContext } from "../worktree-branch-name-generator.js";
import type {
  SessionInboundMessage,
  SessionOutboundMessage,
  FileExplorerRequest,
  FileDownloadTokenRequest,
  FirstAgentContext,
} from "../messages.js";
import type { PersistedWorkspaceRecord } from "../workspace-registry.js";
import type { WorkspaceProjectHandlerContext, DisposableHandler } from "./session-context.js";

type FetchWorkspacesResponsePayload = Extract<
  SessionOutboundMessage,
  { type: "fetch_workspaces_response" }
>["payload"];
type FetchWorkspacesResponseEntry = FetchWorkspacesResponsePayload["entries"][number];
type FetchWorkspacesResponsePageInfo = FetchWorkspacesResponsePayload["pageInfo"];

class SessionRequestError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "SessionRequestError";
  }
}

/** Handles workspace/project CRUD, worktree operations, file explorer, editors, and workspace subscription state machine. */
export class WorkspaceProjectHandler implements DisposableHandler {
  private readonly context: WorkspaceProjectHandlerContext;

  constructor(context: WorkspaceProjectHandlerContext) {
    this.context = context;
  }

  dispose(): void {
    this.context.cancelWorkspaceUpdatesSubscription();
  }

  // --- Dispatch ---

  /** Dispatch workspace/project messages to the appropriate handler. Returns undefined for unhandled messages. */
  dispatch(msg: SessionInboundMessage): Promise<void> | undefined {
    switch (msg.type) {
      case "fetch_workspaces_request":
        return this.handleFetchWorkspacesRequest(msg);
      case "chisacode_worktree_list_request":
        return this.handleChisaCodeWorktreeListRequest(msg);
      case "chisacode_worktree_archive_request":
        return this.handleChisaCodeWorktreeArchiveRequest(msg);
      case "create_chisacode_worktree_request":
        return this.handleCreateChisaCodeWorktreeRequest(msg);
      case "workspace_setup_status_request":
        return this.handleWorkspaceSetupStatusRequest(msg);
      case "list_available_editors_request":
        return this.handleListAvailableEditorsRequest(msg);
      case "open_in_editor_request":
        return this.handleOpenInEditorRequest(msg);
      case "open_project_request":
        return this.handleOpenProjectRequest(msg);
      case "archive_workspace_request":
        return this.handleArchiveWorkspaceRequest(msg);
      case "file_explorer_request":
        return this.handleFileExplorerRequest(msg);
      case "project_icon_request":
        return this.handleProjectIconRequest(msg);
      case "file_download_token_request":
        return this.handleFileDownloadTokenRequest(msg);
      case "project.rename.request":
        return this.handleProjectRenameRequest(msg.projectId, msg.customName, msg.requestId);
      default:
        return undefined;
    }
  }

  // --- Handler methods ---

  private async handleFetchWorkspacesRequest(
    request: Extract<SessionInboundMessage, { type: "fetch_workspaces_request" }>,
  ): Promise<void> {
    const requestedSubscriptionId = request.subscribe?.subscriptionId?.trim();
    const subscriptionId = resolveSubscriptionId(request.subscribe, requestedSubscriptionId);

    try {
      this.context.sessionLogger.debug(
        {
          requestId: request.requestId,
          subscribeRequested: Boolean(request.subscribe),
          filter: request.filter ?? null,
          sort: request.sort ?? null,
          page: request.page ?? null,
        },
        "fetch_workspaces_request_received",
      );
      if (subscriptionId) {
        this.context.startWorkspaceUpdatesSubscription(subscriptionId, request.filter);
      }

      const payload = await this.listFetchWorkspacesEntries(request);
      this.context.syncWorkspaceGitObservers(payload.entries);
      this.context.sessionLogger.debug(
        {
          requestId: request.requestId,
          subscriptionId,
          pageInfo: payload.pageInfo,
          payload: summarizeFetchWorkspacesEntries(payload.entries),
        },
        "fetch_workspaces_response_ready",
      );

      this.context.emit({
        type: "fetch_workspaces_response",
        payload: {
          requestId: request.requestId,
          ...(subscriptionId ? { subscriptionId } : {}),
          ...payload,
        },
      });

      if (subscriptionId) {
        this.context.completeWorkspaceUpdatesBootstrap(subscriptionId, payload.entries);
      }
    } catch (error) {
      if (subscriptionId) {
        this.context.cancelWorkspaceUpdatesSubscription(subscriptionId);
      }
      const code = error instanceof SessionRequestError ? error.code : "fetch_workspaces_failed";
      const message = error instanceof Error ? error.message : "Failed to fetch workspaces";
      this.context.sessionLogger.error({ err: error }, "Failed to handle fetch_workspaces_request");
      this.context.emit({
        type: "rpc_error",
        payload: {
          requestId: request.requestId,
          requestType: request.type,
          error: message,
          code,
        },
      });
    }
  }

  private async handleChisaCodeWorktreeListRequest(
    msg: Extract<SessionInboundMessage, { type: "chisacode_worktree_list_request" }>,
  ): Promise<void> {
    return handleWorktreeListRequest(
      {
        emit: (message) => this.context.emit(message),
        chisacodeHome: this.context.chisacodeHome,
        workspaceGitService: this.context.workspaceGitService,
      },
      msg,
    );
  }

  private async handleChisaCodeWorktreeArchiveRequest(
    msg: Extract<SessionInboundMessage, { type: "chisacode_worktree_archive_request" }>,
  ): Promise<void> {
    return handleWorktreeArchiveRequest(
      {
        chisacodeHome: this.context.chisacodeHome,
        github: this.context.github,
        workspaceGitService: this.context.workspaceGitService,
        agentManager: this.context.agentManager,
        agentStorage: this.context.agentStorage,
        archiveWorkspaceRecord: (workspaceId) => this.context.archiveWorkspaceRecord(workspaceId),
        emit: (message) => this.context.emit(message),
        emitWorkspaceUpdatesForWorkspaceIds: (workspaceIds) =>
          this.context.emitWorkspaceUpdatesForWorkspaceIds(workspaceIds),
        markWorkspaceArchiving: (workspaceIds, archivingAt) =>
          this.context.markWorkspaceArchiving(workspaceIds, archivingAt),
        clearWorkspaceArchiving: (workspaceIds) =>
          this.context.clearWorkspaceArchiving(workspaceIds),
        isPathWithinRoot: (rootPath, candidatePath) =>
          this.context.isPathWithinRoot(rootPath, candidatePath),
        killTerminalsUnderPath: (rootPath) =>
          this.context.terminalController.killTerminalsUnderPath(rootPath),
        sessionLogger: this.context.sessionLogger,
      },
      msg,
    );
  }

  private async handleCreateChisaCodeWorktreeRequest(
    request: Extract<SessionInboundMessage, { type: "create_chisacode_worktree_request" }>,
  ): Promise<void> {
    return handleCreateWorktreeRequest(
      {
        chisacodeHome: this.context.chisacodeHome,
        describeWorkspaceRecord: (result) => this.context.describeCreatedWorktreeWorkspace(result),
        emit: (message) => this.context.emit(message),
        sessionLogger: this.context.sessionLogger,
        createChisaCodeWorktreeWorkflow: (input) =>
          this.context.createChisaCodeWorktreeWorkflow(input),
      },
      request,
    );
  }

  private async handleWorkspaceSetupStatusRequest(
    request: Extract<SessionInboundMessage, { type: "workspace_setup_status_request" }>,
  ): Promise<void> {
    return handleWorkspaceSetupStatusRequestMessage(
      {
        emit: (message) => this.context.emit(message),
        workspaceSetupSnapshots: this.context.workspaceSetupSnapshots,
      },
      request,
    );
  }

  private async handleListAvailableEditorsRequest(
    request: Extract<SessionInboundMessage, { type: "list_available_editors_request" }>,
  ): Promise<void> {
    try {
      const editors = await this.context.getAvailableEditorTargets();
      this.context.emit({
        type: "list_available_editors_response",
        payload: {
          requestId: request.requestId,
          editors,
          error: null,
        },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to list available editors";
      this.context.sessionLogger.error(
        { err: error, requestType: request.type },
        "Failed to list available editors",
      );
      this.context.emit({
        type: "list_available_editors_response",
        payload: {
          requestId: request.requestId,
          editors: [],
          error: message,
        },
      });
    }
  }

  private async handleOpenInEditorRequest(
    request: Extract<SessionInboundMessage, { type: "open_in_editor_request" }>,
  ): Promise<void> {
    try {
      await this.context.openEditorTarget({ editorId: request.editorId, path: request.path });
      this.context.emit({
        type: "open_in_editor_response",
        payload: {
          requestId: request.requestId,
          error: null,
        },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to open in editor";
      this.context.sessionLogger.error(
        {
          err: error,
          editorId: request.editorId,
          path: request.path,
          requestType: request.type,
        },
        "Failed to open in editor",
      );
      this.context.emit({
        type: "open_in_editor_response",
        payload: {
          requestId: request.requestId,
          error: message,
        },
      });
    }
  }

  private async handleOpenProjectRequest(
    request: Extract<SessionInboundMessage, { type: "open_project_request" }>,
  ): Promise<void> {
    try {
      const workspace = await this.context.findOrCreateWorkspaceForDirectory(request.cwd);
      await this.context.syncWorkspaceGitObserverForWorkspace(workspace);
      const descriptor = await this.context.describeWorkspaceRecord(workspace);
      await this.context.emitWorkspaceUpdateForCwd(workspace.cwd);
      this.context.emit({
        type: "open_project_response",
        payload: {
          requestId: request.requestId,
          workspace: descriptor,
          error: null,
        },
      });
      void this.context.workspaceGitService
        .getSnapshot(workspace.cwd, {
          force: true,
          includeGitHub: true,
          reason: "open_project",
        })
        .catch((error) => {
          this.context.sessionLogger.warn(
            { err: error, cwd: workspace.cwd },
            "Background snapshot refresh failed after open_project",
          );
        });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to open project";
      this.context.sessionLogger.error({ err: error, cwd: request.cwd }, "Failed to open project");
      this.context.emit({
        type: "open_project_response",
        payload: {
          requestId: request.requestId,
          workspace: null,
          error: message,
        },
      });
    }
  }

  private async handleArchiveWorkspaceRequest(
    request: Extract<SessionInboundMessage, { type: "archive_workspace_request" }>,
  ): Promise<void> {
    try {
      const existing = await this.context.workspaceRegistry.get(request.workspaceId);
      if (!existing) {
        throw new Error(`Workspace not found: ${request.workspaceId}`);
      }
      if (existing.kind === "worktree") {
        throw new Error("Use worktree archive for ChisaCode worktrees");
      }
      const archivedAt = new Date().toISOString();
      await this.context.terminalController.killTerminalsUnderPath(existing.cwd);
      await this.context.archiveWorkspaceRecord(existing.workspaceId, archivedAt);
      await this.context.emitWorkspaceUpdateForCwd(existing.cwd);
      this.context.emit({
        type: "archive_workspace_response",
        payload: {
          requestId: request.requestId,
          workspaceId: request.workspaceId,
          archivedAt,
          error: null,
        },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to archive workspace";
      this.context.sessionLogger.error(
        { err: error, workspaceId: request.workspaceId },
        "Failed to archive workspace",
      );
      this.context.emit({
        type: "archive_workspace_response",
        payload: {
          requestId: request.requestId,
          workspaceId: request.workspaceId,
          archivedAt: null,
          error: message,
        },
      });
    }
  }

  private async handleFileExplorerRequest(request: FileExplorerRequest): Promise<void> {
    const { cwd: workspaceCwd, path: requestedPath = ".", mode, requestId } = request;
    const cwd = workspaceCwd.trim();
    if (!cwd) {
      this.context.emit({
        type: "file_explorer_response",
        payload: {
          cwd: workspaceCwd,
          path: requestedPath,
          mode,
          directory: null,
          file: null,
          error: "cwd is required",
          requestId,
        },
      });
      return;
    }

    try {
      if (mode === "list") {
        const directory = await listDirectoryEntries({
          root: cwd,
          relativePath: requestedPath,
        });

        this.context.emit({
          type: "file_explorer_response",
          payload: {
            cwd,
            path: directory.path,
            mode,
            directory,
            file: null,
            error: null,
            requestId,
          },
        });
      } else {
        if (request.acceptBinary && this.context.hasBinaryChannel()) {
          const file = await readExplorerFileBytes({
            root: cwd,
            relativePath: requestedPath,
          });

          this.context.emitBinary(
            encodeFileTransferFrame({
              opcode: FileTransferOpcode.FileBegin,
              requestId,
              metadata: {
                mime: file.mimeType,
                size: file.size,
                encoding: file.encoding,
                modifiedAt: file.modifiedAt,
              },
            }),
          );
          // Chunk large files so clients can apply per-chunk idle deadlines and
          // avoid a single 64MB logical frame on constrained links.
          const FILE_TRANSFER_CHUNK_BYTES = 1024 * 1024;
          const bytes = file.bytes;
          for (let offset = 0; offset < bytes.byteLength; offset += FILE_TRANSFER_CHUNK_BYTES) {
            const end = Math.min(offset + FILE_TRANSFER_CHUNK_BYTES, bytes.byteLength);
            this.context.emitBinary(
              encodeFileTransferFrame({
                opcode: FileTransferOpcode.FileChunk,
                requestId,
                payload: bytes.subarray(offset, end),
              }),
            );
          }
          this.context.emitBinary(
            encodeFileTransferFrame({
              opcode: FileTransferOpcode.FileEnd,
              requestId,
            }),
          );
        } else {
          const file = await readExplorerFile({
            root: cwd,
            relativePath: requestedPath,
          });

          this.context.emit({
            type: "file_explorer_response",
            payload: {
              cwd,
              path: file.path,
              mode,
              directory: null,
              file,
              error: null,
              requestId,
            },
          });
        }
      }
    } catch (error) {
      this.context.sessionLogger.error(
        { err: error, cwd, path: requestedPath },
        `Failed to fulfill file explorer request for workspace ${cwd}`,
      );
      this.context.emit({
        type: "file_explorer_response",
        payload: {
          cwd,
          path: requestedPath,
          mode,
          directory: null,
          file: null,
          error: getErrorMessage(error),
          requestId,
        },
      });
    }
  }

  private async handleProjectIconRequest(
    request: Extract<SessionInboundMessage, { type: "project_icon_request" }>,
  ): Promise<void> {
    const { cwd, requestId } = request;

    try {
      const icon = await getProjectIcon(cwd);
      this.context.emit({
        type: "project_icon_response",
        payload: {
          cwd,
          icon,
          error: null,
          requestId,
        },
      });
    } catch (error) {
      this.context.emit({
        type: "project_icon_response",
        payload: {
          cwd,
          icon: null,
          error: getErrorMessage(error),
          requestId,
        },
      });
    }
  }

  private async handleFileDownloadTokenRequest(request: FileDownloadTokenRequest): Promise<void> {
    const { cwd: workspaceCwd, path: requestedPath, requestId } = request;
    const cwd = workspaceCwd.trim();
    if (!cwd) {
      this.context.emit({
        type: "file_download_token_response",
        payload: {
          cwd: workspaceCwd,
          path: requestedPath,
          token: null,
          fileName: null,
          mimeType: null,
          size: null,
          error: "cwd is required",
          requestId,
        },
      });
      return;
    }

    this.context.sessionLogger.debug(
      { cwd, path: requestedPath },
      `Handling file download token request for workspace ${cwd} (${requestedPath})`,
    );

    try {
      const info = await getDownloadableFileInfo({
        root: cwd,
        relativePath: requestedPath,
      });

      const entry = this.context.downloadTokenStore.issueToken({
        path: info.path,
        absolutePath: info.absolutePath,
        fileName: info.fileName,
        mimeType: info.mimeType,
        size: info.size,
      });

      this.context.emit({
        type: "file_download_token_response",
        payload: {
          cwd,
          path: info.path,
          token: entry.token,
          fileName: entry.fileName,
          mimeType: entry.mimeType,
          size: entry.size,
          error: null,
          requestId,
        },
      });
    } catch (error) {
      this.context.sessionLogger.error(
        { err: error, cwd, path: requestedPath },
        `Failed to issue download token for workspace ${cwd}`,
      );
      this.context.emit({
        type: "file_download_token_response",
        payload: {
          cwd,
          path: requestedPath,
          token: null,
          fileName: null,
          mimeType: null,
          size: null,
          error: getErrorMessage(error),
          requestId,
        },
      });
    }
  }

  private async handleProjectRenameRequest(
    projectId: string,
    customName: string | null,
    requestId: string,
  ): Promise<void> {
    this.context.sessionLogger.info(
      { projectId, requestId, hasCustomName: typeof customName === "string" },
      "session: project.rename.request",
    );

    try {
      const existing = await this.context.projectRegistry.get(projectId);
      if (!existing) {
        this.context.emit({
          type: "project.rename.response",
          payload: {
            requestId,
            projectId,
            accepted: false,
            customName: null,
            error: "Project not found",
          },
        });
        return;
      }

      const trimmed = customName?.trim() ?? "";
      const nextCustomName = trimmed.length === 0 ? null : trimmed;

      await this.context.projectRegistry.upsert({
        ...existing,
        customName: nextCustomName,
        updatedAt: new Date().toISOString(),
      });

      this.context.emit({
        type: "project.rename.response",
        payload: {
          requestId,
          projectId,
          accepted: true,
          customName: nextCustomName,
          error: null,
        },
      });

      // Re-emit descriptors for every workspace under this project so the new
      // resolved name lands in the UI immediately.
      const workspaces = await this.context.workspaceRegistry.list();
      const affectedWorkspaceIds = workspaces
        .filter((workspace) => workspace.projectId === projectId)
        .map((workspace) => workspace.workspaceId);
      if (affectedWorkspaceIds.length > 0) {
        await this.context.emitWorkspaceUpdatesForWorkspaceIds(affectedWorkspaceIds, {
          skipReconcile: true,
        });
      }
    } catch (error) {
      this.context.sessionLogger.error(
        { err: error, projectId, requestId },
        "session: project.rename.request error",
      );
      this.context.emit({
        type: "activity_log",
        payload: {
          id: crypto.randomUUID(),
          timestamp: new Date(),
          type: "error",
          content: `Failed to rename project: ${getErrorMessage(error)}`,
        },
      });
      this.context.emit({
        type: "project.rename.response",
        payload: {
          requestId,
          projectId,
          accepted: false,
          customName: null,
          error: getErrorMessage(error),
        },
      });
    }
  }

  // --- Workspace state machine helpers ---

  private async listFetchWorkspacesEntries(
    request: Extract<SessionInboundMessage, { type: "fetch_workspaces_request" }>,
  ): Promise<{
    entries: FetchWorkspacesResponseEntry[];
    pageInfo: FetchWorkspacesResponsePageInfo;
  }> {
    try {
      return await this.context.listFetchWorkspacesEntries(request);
    } catch (error) {
      if (error instanceof CursorError) {
        throw new SessionRequestError("invalid_cursor", error.message);
      }
      throw error;
    }
  }

  // --- Workspace auto-name ---

  /** Attempt to auto-name a workspace's git branch from the first agent context, returning the updated workspace record. */
  async maybeAutoNameWorkspaceBranchForFirstAgent(input: {
    workspace: PersistedWorkspaceRecord;
    firstAgentContext: FirstAgentContext;
  }): Promise<PersistedWorkspaceRecord> {
    const result = await attemptFirstAgentBranchAutoName({
      cwd: input.workspace.cwd,
      firstAgentContext: input.firstAgentContext,
      generateBranchNameFromContext: ({ cwd, firstAgentContext }) => {
        return generateBranchNameFromFirstAgentContext({
          agentManager: this.context.agentManager,
          cwd,
          workspaceGitService: this.context.workspaceGitService,
          providerSnapshotManager: this.context.providerSnapshotManager,
          daemonConfig: this.context.readStructuredGenerationDaemonConfig(),
          currentSelection: this.context.getFocusedAgentSelectionForCwd(cwd),
          firstAgentContext,
          logger: this.context.sessionLogger,
        });
      },
    });
    if (!result.renamed || !result.branchName) {
      return input.workspace;
    }

    const updatedWorkspace: PersistedWorkspaceRecord = {
      ...input.workspace,
      displayName: result.branchName,
      updatedAt: new Date().toISOString(),
    };
    await this.context.workspaceRegistry.upsert(updatedWorkspace);
    await this.context.notifyGitMutation(input.workspace.cwd, "rename-branch");
    await this.context.emitWorkspaceUpdateForCwd(input.workspace.cwd);
    return updatedWorkspace;
  }
}
