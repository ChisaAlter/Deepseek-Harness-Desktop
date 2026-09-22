import type { EditorTargetId } from "@chisacode/protocol/messages";

import type {
  DaemonCommandResponsePayload,
  DaemonCommandTransport,
} from "./daemon-client-command-transport.js";

const DEFAULT_OPEN_PROJECT_TIMEOUT_MS = 60_000;

type OpenProjectPayload = DaemonCommandResponsePayload<"open_project_response">;
type StartWorkspaceScriptPayload = DaemonCommandResponsePayload<"start_workspace_script_response">;
type ListAvailableEditorsPayload = DaemonCommandResponsePayload<"list_available_editors_response">;
type OpenInEditorPayload = DaemonCommandResponsePayload<"open_in_editor_response">;
type ArchiveWorkspacePayload = DaemonCommandResponsePayload<"archive_workspace_response">;
type WorkspaceSetupStatusPayload = DaemonCommandResponsePayload<"workspace_setup_status_response">;
type FileExplorerPayload = DaemonCommandResponsePayload<"file_explorer_response">;
type FileExplorerDirectoryPayload = NonNullable<FileExplorerPayload["directory"]>;
type FileDownloadTokenPayload = DaemonCommandResponsePayload<"file_download_token_response">;
type ProjectIconPayload = DaemonCommandResponsePayload<"project_icon_response">;

/** Implements stateless workspace, editor, and file-explorer RPC commands. */
export class WorkspaceCommandClient {
  constructor(private readonly transport: DaemonCommandTransport) {}

  openProject(cwd: string, requestId?: string): Promise<OpenProjectPayload> {
    return this.transport.request({
      requestId,
      message: { type: "open_project_request", cwd },
      responseType: "open_project_response",
      timeout: DEFAULT_OPEN_PROJECT_TIMEOUT_MS,
    });
  }

  startWorkspaceScript(
    workspaceId: string,
    scriptName: string,
    requestId?: string,
  ): Promise<StartWorkspaceScriptPayload> {
    return this.transport.request({
      requestId,
      message: { type: "start_workspace_script_request", workspaceId, scriptName },
      responseType: "start_workspace_script_response",
      timeout: 10_000,
    });
  }

  listAvailableEditors(requestId?: string): Promise<ListAvailableEditorsPayload> {
    return this.transport.request({
      requestId,
      message: { type: "list_available_editors_request" },
      responseType: "list_available_editors_response",
      timeout: 10_000,
    });
  }

  openInEditor(
    path: string,
    editorId: EditorTargetId,
    requestId?: string,
  ): Promise<OpenInEditorPayload> {
    return this.transport.request({
      requestId,
      message: { type: "open_in_editor_request", path, editorId },
      responseType: "open_in_editor_response",
      timeout: 10_000,
    });
  }

  archiveWorkspace(workspaceId: string, requestId?: string): Promise<ArchiveWorkspacePayload> {
    return this.transport.request({
      requestId,
      message: { type: "archive_workspace_request", workspaceId },
      responseType: "archive_workspace_response",
      timeout: 10_000,
    });
  }

  fetchWorkspaceSetupStatus(
    workspaceId: string,
    requestId?: string,
  ): Promise<WorkspaceSetupStatusPayload> {
    return this.transport.request({
      requestId,
      message: { type: "workspace_setup_status_request", workspaceId },
      responseType: "workspace_setup_status_response",
      timeout: 10_000,
    });
  }

  async listDirectory(
    cwd: string,
    path: string,
    requestId?: string,
  ): Promise<FileExplorerDirectoryPayload> {
    const payload = await this.transport.request({
      requestId,
      message: { type: "file_explorer_request", cwd, path, mode: "list" },
      responseType: "file_explorer_response",
      timeout: 10_000,
    });
    if (payload.error) {
      throw new Error(payload.error);
    }
    if (!payload.directory) {
      throw new Error("Directory listing unavailable.");
    }
    return payload.directory;
  }

  requestDownloadToken(
    cwd: string,
    path: string,
    requestId?: string,
  ): Promise<FileDownloadTokenPayload> {
    return this.transport.request({
      requestId,
      message: { type: "file_download_token_request", cwd, path },
      responseType: "file_download_token_response",
      timeout: 10_000,
    });
  }

  requestProjectIcon(cwd: string, requestId?: string): Promise<ProjectIconPayload> {
    return this.transport.request({
      requestId,
      message: { type: "project_icon_request", cwd },
      responseType: "project_icon_response",
      timeout: 10_000,
    });
  }
}
