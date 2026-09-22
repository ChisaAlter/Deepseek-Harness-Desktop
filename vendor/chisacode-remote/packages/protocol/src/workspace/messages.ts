import { z } from "zod/v3";

import { AgentAttachmentsSchema } from "../agent/attachments.js";
import { CheckoutErrorSchema } from "../checkout/messages.js";
import type { LiteralUnion } from "../literal-union.js";

const WorktreeSetupCommandSnapshotSchema = z.object({
  index: z.number().int().positive(),
  command: z.string(),
  cwd: z.string(),
  log: z.string().optional().default(""),
  status: z.enum(["running", "completed", "failed"]),
  exitCode: z.number().nullable(),
  durationMs: z.number().nonnegative().optional(),
});

export const WorktreeSetupDetailPayloadSchema = z.object({
  type: z.literal("worktree_setup"),
  worktreePath: z.string(),
  branchName: z.string(),
  log: z.string(),
  commands: z.array(WorktreeSetupCommandSnapshotSchema),
  truncated: z.boolean().optional(),
});

export const WorkspaceStateBucketSchema = z.enum([
  "needs_input",
  "failed",
  "running",
  "attention",
  "done",
]);

export const FetchWorkspacesRequestMessageSchema = z.object({
  type: z.literal("fetch_workspaces_request"),
  requestId: z.string(),
  filter: z
    .object({
      query: z.string().optional(),
      projectId: z.string().optional(),
      idPrefix: z.string().optional(),
    })
    .optional(),
  sort: z
    .array(
      z.object({
        key: z.enum(["status_priority", "activity_at", "name", "project_id"]),
        direction: z.enum(["asc", "desc"]),
      }),
    )
    .optional(),
  page: z
    .object({
      limit: z.number().int().positive().max(200),
      cursor: z.string().min(1).optional(),
    })
    .optional(),
  subscribe: z
    .object({
      subscriptionId: z.string().optional(),
    })
    .optional(),
});

export const DirectorySuggestionsRequestSchema = z.object({
  type: z.literal("directory_suggestions_request"),
  query: z.string(),
  cwd: z.string().optional(),
  includeFiles: z.boolean().optional(),
  includeDirectories: z.boolean().optional(),
  matchMode: z.enum(["fuzzy", "suffix"]).optional(),
  limit: z.number().int().min(1).max(100).optional(),
  requestId: z.string(),
});

export const ChisaCodeWorktreeListRequestSchema = z.object({
  type: z.literal("chisacode_worktree_list_request"),
  cwd: z.string().optional(),
  repoRoot: z.string().optional(),
  requestId: z.string(),
});

export const ChisaCodeWorktreeArchiveRequestSchema = z.object({
  type: z.literal("chisacode_worktree_archive_request"),
  worktreePath: z.string().optional(),
  repoRoot: z.string().optional(),
  branchName: z.string().optional(),
  requestId: z.string(),
});

export const FirstAgentContextSchema = z.object({
  prompt: z.string().optional(),
  attachments: AgentAttachmentsSchema,
});

export const CreateChisaCodeWorktreeRequestSchema = z.object({
  type: z.literal("create_chisacode_worktree_request"),
  cwd: z.string(),
  projectId: z.string().optional(),
  worktreeSlug: z.string().optional(),
  nameContext: z.string().optional(),
  attachments: AgentAttachmentsSchema.optional(),
  firstAgentContext: FirstAgentContextSchema.optional(),
  refName: z.string().min(1).optional(),
  action: z.enum(["branch-off", "checkout"]).optional(),
  githubPrNumber: z.number().int().positive().optional(),
  requestId: z.string(),
});

export const WorkspaceSetupStatusRequestSchema = z.object({
  type: z.literal("workspace_setup_status_request"),
  workspaceId: z.string(),
  requestId: z.string(),
});

// TODO(2026-07): Remove once most clients are on >=0.1.50 and support arbitrary editor ids.
export const LEGACY_EDITOR_TARGET_IDS = [
  "cursor",
  "vscode",
  "zed",
  "finder",
  "explorer",
  "file-manager",
] as const;

export const KNOWN_EDITOR_TARGET_IDS = [...LEGACY_EDITOR_TARGET_IDS, "webstorm"] as const;

export const KnownEditorTargetIdSchema = z.enum(KNOWN_EDITOR_TARGET_IDS);
export const LegacyEditorTargetIdSchema = z.enum(LEGACY_EDITOR_TARGET_IDS);
export const EditorTargetIdSchema = z.string().trim().min(1);

const KNOWN_EDITOR_TARGET_ID_SET = new Set<string>(KNOWN_EDITOR_TARGET_IDS);
const LEGACY_EDITOR_TARGET_ID_SET = new Set<string>(LEGACY_EDITOR_TARGET_IDS);

export function isKnownEditorTargetId(value: string): value is KnownEditorTargetId {
  return KNOWN_EDITOR_TARGET_ID_SET.has(value);
}

export function isLegacyEditorTargetId(value: string): value is LegacyEditorTargetId {
  return LEGACY_EDITOR_TARGET_ID_SET.has(value);
}

export const EditorTargetDescriptorPayloadSchema = z.object({
  id: EditorTargetIdSchema,
  label: z.string(),
});

export const ListAvailableEditorsRequestSchema = z.object({
  type: z.literal("list_available_editors_request"),
  requestId: z.string(),
});

export const OpenInEditorRequestSchema = z.object({
  type: z.literal("open_in_editor_request"),
  path: z.string(),
  editorId: EditorTargetIdSchema,
  requestId: z.string(),
});

export const OpenProjectRequestSchema = z.object({
  type: z.literal("open_project_request"),
  cwd: z.string(),
  requestId: z.string(),
});

export const ArchiveWorkspaceRequestSchema = z.object({
  type: z.literal("archive_workspace_request"),
  workspaceId: z.string(),
  requestId: z.string(),
});

export const WorkspaceCreateRequestSchema = z.object({
  type: z.literal("workspace.create.request"),
  requestId: z.string(),
  title: z.string().optional(),
  firstAgentContext: FirstAgentContextSchema.optional(),
  source: z.discriminatedUnion("kind", [
    z.object({
      kind: z.literal("directory"),
      path: z.string(),
      projectId: z.string().optional(),
    }),
    z.object({
      kind: z.literal("worktree"),
      cwd: z.string().optional(),
      projectId: z.string().optional(),
      action: z.enum(["branch-off", "checkout"]).optional(),
      refName: z.string().min(1).optional(),
      baseBranch: z.string().optional(),
      githubPrNumber: z.number().int().positive().optional(),
      worktreeSlug: z.string().optional(),
    }),
  ]),
});

const FileExplorerEntrySchema = z.object({
  name: z.string(),
  path: z.string(),
  kind: z.enum(["file", "directory"]),
  size: z.number(),
  modifiedAt: z.string(),
});

const FileExplorerFileSchema = z.object({
  path: z.string(),
  kind: z.enum(["text", "image", "binary"]),
  encoding: z.enum(["utf-8", "base64", "none"]),
  content: z.string().optional(),
  mimeType: z.string().optional(),
  size: z.number(),
  modifiedAt: z.string(),
});

const FileExplorerDirectorySchema = z.object({
  path: z.string(),
  entries: z.array(FileExplorerEntrySchema),
});

export const FileExplorerRequestSchema = z.object({
  type: z.literal("file_explorer_request"),
  cwd: z.string(),
  path: z.string().optional(),
  mode: z.enum(["list", "file"]),
  requestId: z.string(),
  acceptBinary: z.boolean().optional(),
});

export const ProjectIconRequestSchema = z.object({
  type: z.literal("project_icon_request"),
  cwd: z.string(),
  requestId: z.string(),
});

export const FileDownloadTokenRequestSchema = z.object({
  type: z.literal("file_download_token_request"),
  cwd: z.string(),
  path: z.string(),
  requestId: z.string(),
});

export const ProjectCheckoutLiteNotGitPayloadSchema = z
  .object({
    cwd: z.string(),
    isGit: z.literal(false),
    currentBranch: z.null(),
    remoteUrl: z.null(),
    worktreeRoot: z.null().optional(),
    isChisaCodeOwnedWorktree: z.literal(false),
    mainRepoRoot: z.null(),
  })
  .transform((value) => ({
    ...value,
    worktreeRoot: null,
  }));

export const ProjectCheckoutLiteGitNonChisaCodePayloadSchema = z
  .object({
    cwd: z.string(),
    isGit: z.literal(true),
    currentBranch: z.string().nullable(),
    remoteUrl: z.string().nullable(),
    worktreeRoot: z.string().optional(),
    isChisaCodeOwnedWorktree: z.literal(false),
    mainRepoRoot: z.string().nullable().optional().default(null),
  })
  .transform((value) => ({
    ...value,
    worktreeRoot: value.worktreeRoot ?? value.cwd,
  }));

export const ProjectCheckoutLiteGitChisaCodePayloadSchema = z
  .object({
    cwd: z.string(),
    isGit: z.literal(true),
    currentBranch: z.string().nullable(),
    remoteUrl: z.string().nullable(),
    worktreeRoot: z.string().optional(),
    isChisaCodeOwnedWorktree: z.literal(true),
    mainRepoRoot: z.string(),
  })
  .transform((value) => ({
    ...value,
    worktreeRoot: value.worktreeRoot ?? value.cwd,
  }));

export const ProjectCheckoutLitePayloadSchema = z.union([
  ProjectCheckoutLiteNotGitPayloadSchema,
  ProjectCheckoutLiteGitNonChisaCodePayloadSchema,
  ProjectCheckoutLiteGitChisaCodePayloadSchema,
]);

export const ProjectPlacementPayloadSchema = z.object({
  projectKey: z.string(),
  projectName: z.string(),
  checkout: ProjectCheckoutLitePayloadSchema,
});

export const WorkspaceScriptLifecycleSchema = z.enum(["running", "stopped"]);
export const WorkspaceScriptHealthSchema = z.enum(["healthy", "unhealthy"]);

export const WorkspaceScriptPayloadSchema = z.object({
  scriptName: z.string(),
  type: z.enum(["script", "service"]).optional().default("service"),
  hostname: z.string(),
  port: z.number().int().positive().nullable(),
  proxyUrl: z.string().nullable().optional().default(null),
  lifecycle: WorkspaceScriptLifecycleSchema,
  health: WorkspaceScriptHealthSchema.nullable(),
  exitCode: z.number().nullable().optional().default(null),
  terminalId: z.string().nullable().optional().default(null),
});

const WorkspaceGitRuntimePayloadSchema = z
  .object({
    currentBranch: z.string().nullable().optional(),
    remoteUrl: z.string().nullable().optional(),
    isChisaCodeOwnedWorktree: z.boolean().optional(),
    isDirty: z.boolean().nullable().optional(),
    aheadBehind: z
      .object({
        ahead: z.number(),
        behind: z.number(),
      })
      .nullable()
      .optional(),
    aheadOfOrigin: z.number().nullable().optional(),
    behindOfOrigin: z.number().nullable().optional(),
  })
  .optional()
  .nullable();

const WorkspaceGitHubRuntimePayloadSchema = z
  .object({
    featuresEnabled: z.boolean().optional(),
    pullRequest: z
      .object({
        number: z.number().optional(),
        url: z.string(),
        title: z.string(),
        state: z.string(),
        baseRefName: z.string(),
        headRefName: z.string(),
        isMerged: z.boolean(),
        isDraft: z.boolean().optional(),
        mergeable: z.enum(["MERGEABLE", "CONFLICTING", "UNKNOWN"]).catch("UNKNOWN").optional(),
        checks: z
          .array(
            z.object({
              name: z.string(),
              status: z.enum(["success", "failure", "pending", "skipped", "cancelled"]),
              url: z.string().nullable(),
              workflow: z.string().optional(),
              duration: z.string().optional(),
            }),
          )
          .optional(),
        checksStatus: z.enum(["none", "pending", "success", "failure"]).optional(),
        reviewDecision: z.enum(["approved", "changes_requested", "pending"]).nullable().optional(),
        repoOwner: z.string().optional(),
        repoName: z.string().optional(),
        github: z.unknown().optional(),
      })
      .nullable()
      .optional(),
    error: z
      .object({
        message: z.string(),
      })
      .nullable()
      .optional(),
    refreshedAt: z.string().nullable().optional(),
  })
  .optional()
  .nullable();

export const WorkspaceDescriptorPayloadSchema = z
  .object({
    id: z.string(),
    projectId: z.string(),
    projectDisplayName: z.string(),
    // COMPAT(projectCustomName): added in v0.1.76, drop the optional gate when floor >= v0.1.76.
    // When the user has renamed a project, projectDisplayName carries the resolved
    // value (customName) and projectCustomName mirrors the raw override so the
    // settings UI can prefill its input and offer a "reset" action.
    projectCustomName: z.string().nullable().optional(),
    projectRootPath: z.string(),
    workspaceDirectory: z.string().optional(),
    projectKind: z.enum(["git", "non_git", "directory"]),
    // COMPAT(workspaces): keep legacy directory workspace kind parseable.
    workspaceKind: z.enum(["directory", "local_checkout", "checkout", "worktree"]),
    name: z.string(),
    archivingAt: z.string().nullable().optional().default(null),
    status: WorkspaceStateBucketSchema,
    activityAt: z.string().nullable(),
    diffStat: z
      .object({
        additions: z.number(),
        deletions: z.number(),
      })
      .nullable()
      .optional(),
    scripts: z.array(WorkspaceScriptPayloadSchema).default([]),
    gitRuntime: WorkspaceGitRuntimePayloadSchema,
    githubRuntime: WorkspaceGitHubRuntimePayloadSchema,
    project: ProjectPlacementPayloadSchema.optional(),
  })
  .transform((workspace) => ({
    ...workspace,
    workspaceDirectory: workspace.workspaceDirectory ?? workspace.projectRootPath,
  }));

export const FetchWorkspacesResponseMessageSchema = z.object({
  type: z.literal("fetch_workspaces_response"),
  payload: z.object({
    requestId: z.string(),
    subscriptionId: z.string().nullable().optional(),
    entries: z.array(WorkspaceDescriptorPayloadSchema),
    pageInfo: z.object({
      nextCursor: z.string().nullable(),
      prevCursor: z.string().nullable(),
      hasMore: z.boolean(),
    }),
  }),
});

export const WorkspaceUpdateMessageSchema = z.object({
  type: z.literal("workspace_update"),
  payload: z.discriminatedUnion("kind", [
    z.object({
      kind: z.literal("upsert"),
      workspace: WorkspaceDescriptorPayloadSchema,
    }),
    z.object({
      kind: z.literal("remove"),
      id: z.string(),
    }),
  ]),
});

export const ScriptStatusUpdateMessageSchema = z.object({
  type: z.literal("script_status_update"),
  payload: z.object({
    workspaceId: z.string(),
    scripts: z.array(WorkspaceScriptPayloadSchema),
  }),
});

export const WorkspaceSetupProgressMessageSchema = z.object({
  type: z.literal("workspace_setup_progress"),
  payload: z.object({
    workspaceId: z.string(),
    status: z.enum(["running", "completed", "failed"]),
    detail: WorktreeSetupDetailPayloadSchema,
    error: z.string().nullable(),
  }),
});

export const WorkspaceSetupSnapshotSchema = z.object({
  status: z.enum(["running", "completed", "failed"]),
  detail: WorktreeSetupDetailPayloadSchema,
  error: z.string().nullable(),
});

export const WorkspaceSetupStatusResponseMessageSchema = z.object({
  type: z.literal("workspace_setup_status_response"),
  payload: z.object({
    requestId: z.string(),
    workspaceId: z.string(),
    snapshot: WorkspaceSetupSnapshotSchema.nullable(),
  }),
});

export const OpenProjectResponseMessageSchema = z.object({
  type: z.literal("open_project_response"),
  payload: z.object({
    requestId: z.string(),
    workspace: WorkspaceDescriptorPayloadSchema.nullable(),
    error: z.string().nullable(),
  }),
});

export const StartWorkspaceScriptResponseMessageSchema = z.object({
  type: z.literal("start_workspace_script_response"),
  payload: z.object({
    requestId: z.string(),
    workspaceId: z.string(),
    scriptName: z.string(),
    terminalId: z.string().nullable(),
    error: z.string().nullable(),
  }),
});

export const ListAvailableEditorsResponseMessageSchema = z.object({
  type: z.literal("list_available_editors_response"),
  payload: z.object({
    requestId: z.string(),
    editors: z.array(EditorTargetDescriptorPayloadSchema),
    error: z.string().nullable(),
  }),
});

export const OpenInEditorResponseMessageSchema = z.object({
  type: z.literal("open_in_editor_response"),
  payload: z.object({
    requestId: z.string(),
    error: z.string().nullable(),
  }),
});

export const ArchiveWorkspaceResponseMessageSchema = z.object({
  type: z.literal("archive_workspace_response"),
  payload: z.object({
    requestId: z.string(),
    workspaceId: z.string(),
    archivedAt: z.string().nullable(),
    error: z.string().nullable(),
  }),
});

export const WorkspaceCreateResponseSchema = z.object({
  type: z.literal("workspace.create.response"),
  payload: z.object({
    workspace: WorkspaceDescriptorPayloadSchema.nullable(),
    setupTerminalId: z.string().nullable(),
    error: z.string().nullable(),
    errorCode: z.string().optional(),
    requestId: z.string(),
  }),
});

export const DirectorySuggestionsResponseSchema = z.object({
  type: z.literal("directory_suggestions_response"),
  payload: z.object({
    directories: z.array(z.string()),
    entries: z
      .array(
        z.object({
          path: z.string(),
          kind: z.enum(["file", "directory"]),
        }),
      )
      .optional()
      .default([]),
    error: z.string().nullable(),
    requestId: z.string(),
  }),
});

const ChisaCodeWorktreeSchema = z.object({
  worktreePath: z.string(),
  createdAt: z.string(),
  branchName: z.string().nullable().optional(),
  head: z.string().nullable().optional(),
});

export const ChisaCodeWorktreeListResponseSchema = z.object({
  type: z.literal("chisacode_worktree_list_response"),
  payload: z.object({
    worktrees: z.array(ChisaCodeWorktreeSchema),
    error: CheckoutErrorSchema.nullable(),
    requestId: z.string(),
  }),
});

export const ChisaCodeWorktreeArchiveResponseSchema = z.object({
  type: z.literal("chisacode_worktree_archive_response"),
  payload: z.object({
    success: z.boolean(),
    removedAgents: z.array(z.string()).optional(),
    error: CheckoutErrorSchema.nullable(),
    requestId: z.string(),
  }),
});

export const CreateChisaCodeWorktreeResponseSchema = z.object({
  type: z.literal("create_chisacode_worktree_response"),
  payload: z.object({
    workspace: WorkspaceDescriptorPayloadSchema.nullable(),
    error: z.string().nullable(),
    errorCode: z.string().optional(),
    setupTerminalId: z.string().nullable(),
    requestId: z.string(),
  }),
});

export const FileExplorerResponseSchema = z.object({
  type: z.literal("file_explorer_response"),
  payload: z.object({
    cwd: z.string(),
    path: z.string(),
    mode: z.enum(["list", "file"]),
    directory: FileExplorerDirectorySchema.nullable(),
    file: FileExplorerFileSchema.nullable(),
    error: z.string().nullable(),
    requestId: z.string(),
  }),
});

export const ProjectIconSchema = z.object({
  data: z.string(),
  mimeType: z.string(),
});

export const ProjectIconResponseSchema = z.object({
  type: z.literal("project_icon_response"),
  payload: z.object({
    cwd: z.string(),
    icon: ProjectIconSchema.nullable(),
    error: z.string().nullable(),
    requestId: z.string(),
  }),
});

export const FileDownloadTokenResponseSchema = z.object({
  type: z.literal("file_download_token_response"),
  payload: z.object({
    cwd: z.string(),
    path: z.string(),
    token: z.string().nullable(),
    fileName: z.string().nullable(),
    mimeType: z.string().nullable(),
    size: z.number().nullable(),
    error: z.string().nullable(),
    requestId: z.string(),
  }),
});

export const WorkspaceInboundMessageSchemas = [
  FetchWorkspacesRequestMessageSchema,
  DirectorySuggestionsRequestSchema,
  ChisaCodeWorktreeListRequestSchema,
  ChisaCodeWorktreeArchiveRequestSchema,
  CreateChisaCodeWorktreeRequestSchema,
  WorkspaceSetupStatusRequestSchema,
  ListAvailableEditorsRequestSchema,
  OpenInEditorRequestSchema,
  OpenProjectRequestSchema,
  ArchiveWorkspaceRequestSchema,
  WorkspaceCreateRequestSchema,
  FileExplorerRequestSchema,
  ProjectIconRequestSchema,
  FileDownloadTokenRequestSchema,
] as const;

export const WorkspaceOutboundMessageSchemas = [
  WorkspaceUpdateMessageSchema,
  ScriptStatusUpdateMessageSchema,
  WorkspaceSetupProgressMessageSchema,
  WorkspaceSetupStatusResponseMessageSchema,
  FetchWorkspacesResponseMessageSchema,
  OpenProjectResponseMessageSchema,
  StartWorkspaceScriptResponseMessageSchema,
  ListAvailableEditorsResponseMessageSchema,
  OpenInEditorResponseMessageSchema,
  ArchiveWorkspaceResponseMessageSchema,
  WorkspaceCreateResponseSchema,
  DirectorySuggestionsResponseSchema,
  ChisaCodeWorktreeListResponseSchema,
  ChisaCodeWorktreeArchiveResponseSchema,
  CreateChisaCodeWorktreeResponseSchema,
  FileExplorerResponseSchema,
  ProjectIconResponseSchema,
  FileDownloadTokenResponseSchema,
] as const;

export type WorktreeSetupDetailPayload = z.infer<typeof WorktreeSetupDetailPayloadSchema>;
export type WorkspaceSetupProgressMessage = z.infer<typeof WorkspaceSetupProgressMessageSchema>;
export type WorkspaceSetupSnapshot = z.infer<typeof WorkspaceSetupSnapshotSchema>;
export type WorkspaceSetupStatusResponseMessage = z.infer<
  typeof WorkspaceSetupStatusResponseMessageSchema
>;
export type ProjectCheckoutLitePayload = z.infer<typeof ProjectCheckoutLitePayloadSchema>;
export type ProjectPlacementPayload = z.infer<typeof ProjectPlacementPayloadSchema>;
export type WorkspaceStateBucket = z.infer<typeof WorkspaceStateBucketSchema>;
export type WorkspaceDescriptorPayload = z.infer<typeof WorkspaceDescriptorPayloadSchema>;
export type WorkspaceScriptLifecycle = z.infer<typeof WorkspaceScriptLifecycleSchema>;
export type WorkspaceScriptHealth = z.infer<typeof WorkspaceScriptHealthSchema>;
export type WorkspaceScriptPayload = z.infer<typeof WorkspaceScriptPayloadSchema>;
export type KnownEditorTargetId = z.infer<typeof KnownEditorTargetIdSchema>;
export type LegacyEditorTargetId = z.infer<typeof LegacyEditorTargetIdSchema>;
export type EditorTargetId = LiteralUnion<KnownEditorTargetId, string>;
export type EditorTargetDescriptorPayload = z.infer<typeof EditorTargetDescriptorPayloadSchema>;
export type FetchWorkspacesResponseMessage = z.infer<typeof FetchWorkspacesResponseMessageSchema>;
export type ScriptStatusUpdateMessage = z.infer<typeof ScriptStatusUpdateMessageSchema>;
export type OpenProjectResponseMessage = z.infer<typeof OpenProjectResponseMessageSchema>;
export type StartWorkspaceScriptResponseMessage = z.infer<
  typeof StartWorkspaceScriptResponseMessageSchema
>;
export type StartWorkspaceScriptResponse = StartWorkspaceScriptResponseMessage;
export type ListAvailableEditorsResponseMessage = z.infer<
  typeof ListAvailableEditorsResponseMessageSchema
>;
export type OpenInEditorResponseMessage = z.infer<typeof OpenInEditorResponseMessageSchema>;
export type ArchiveWorkspaceResponseMessage = z.infer<typeof ArchiveWorkspaceResponseMessageSchema>;
export type WorkspaceCreateResponse = z.infer<typeof WorkspaceCreateResponseSchema>;
export type FetchWorkspacesRequestMessage = z.infer<typeof FetchWorkspacesRequestMessageSchema>;
export type FirstAgentContext = z.infer<typeof FirstAgentContextSchema>;
export type CreateChisaCodeWorktreeRequest = z.infer<typeof CreateChisaCodeWorktreeRequestSchema>;
export type CreateChisaCodeWorktreeResponse = z.infer<typeof CreateChisaCodeWorktreeResponseSchema>;
export type DirectorySuggestionsRequest = z.infer<typeof DirectorySuggestionsRequestSchema>;
export type DirectorySuggestionsResponse = z.infer<typeof DirectorySuggestionsResponseSchema>;
export type ChisaCodeWorktreeListRequest = z.infer<typeof ChisaCodeWorktreeListRequestSchema>;
export type ChisaCodeWorktreeListResponse = z.infer<typeof ChisaCodeWorktreeListResponseSchema>;
export type ChisaCodeWorktreeArchiveRequest = z.infer<typeof ChisaCodeWorktreeArchiveRequestSchema>;
export type ChisaCodeWorktreeArchiveResponse = z.infer<
  typeof ChisaCodeWorktreeArchiveResponseSchema
>;
export type WorkspaceSetupStatusRequest = z.infer<typeof WorkspaceSetupStatusRequestSchema>;
export type ListAvailableEditorsRequest = z.infer<typeof ListAvailableEditorsRequestSchema>;
export type OpenInEditorRequest = z.infer<typeof OpenInEditorRequestSchema>;
export type OpenProjectRequest = z.infer<typeof OpenProjectRequestSchema>;
export type ArchiveWorkspaceRequest = z.infer<typeof ArchiveWorkspaceRequestSchema>;
export type WorkspaceCreateRequest = z.infer<typeof WorkspaceCreateRequestSchema>;
export type FileExplorerRequest = z.infer<typeof FileExplorerRequestSchema>;
export type FileExplorerResponse = z.infer<typeof FileExplorerResponseSchema>;
export type ProjectIconRequest = z.infer<typeof ProjectIconRequestSchema>;
export type ProjectIconResponse = z.infer<typeof ProjectIconResponseSchema>;
export type ProjectIcon = z.infer<typeof ProjectIconSchema>;
export type FileDownloadTokenRequest = z.infer<typeof FileDownloadTokenRequestSchema>;
export type FileDownloadTokenResponse = z.infer<typeof FileDownloadTokenResponseSchema>;
