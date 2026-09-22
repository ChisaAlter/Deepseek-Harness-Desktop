import { z } from "zod/v3";

import { AGENT_RELATION_KINDS } from "../agent-labels.js";
import { AgentPresetsPayloadSchema } from "../agent-presets.js";
import { MAX_EXPLICIT_AGENT_TITLE_CHARS } from "../agent-title-limits.js";
import { AgentProviderSchema } from "../provider-manifest.js";
import { ListCommandsDraftConfigSchema } from "../provider/messages.js";
import { ProjectPlacementPayloadSchema } from "../workspace/messages.js";
import { AgentAttachmentsSchema } from "./attachments.js";
import { McpServerConfigSchema } from "./extensions.js";
import {
  AgentPermissionRequestPayloadSchema,
  AgentPermissionResponseSchema,
  AgentPersistenceHandleSchema,
  AgentSnapshotPayloadSchema,
  AgentStatusSchema,
  AgentStreamEventPayloadSchema,
  AgentTimelineItemPayloadSchema,
} from "./state.js";

const AgentSessionConfigSchema = z.object({
  provider: AgentProviderSchema,
  runtimeProvider: AgentProviderSchema.optional(),
  cwd: z.string(),
  modeId: z.string().optional(),
  model: z.string().optional(),
  thinkingOptionId: z.string().optional(),
  featureValues: z.record(z.unknown()).optional(),
  title: z.string().trim().min(1).max(MAX_EXPLICIT_AGENT_TITLE_CHARS).optional().nullable(),
  approvalPolicy: z.string().optional(),
  sandboxMode: z.string().optional(),
  networkAccess: z.boolean().optional(),
  webSearch: z.boolean().optional(),
  extra: z
    .object({
      codex: z.record(z.unknown()).optional(),
      claude: z.record(z.unknown()).optional(),
    })
    .partial()
    .optional(),
  systemPrompt: z.string().optional(),
  mcpServers: z.record(McpServerConfigSchema).optional(),
});

const AgentDirectoryFilterSchema = z.object({
  labels: z.record(z.string()).optional(),
  projectKeys: z.array(z.string()).optional(),
  statuses: z.array(AgentStatusSchema).optional(),
  includeArchived: z.boolean().optional(),
  requiresAttention: z.boolean().optional(),
  thinkingOptionId: z.string().nullable().optional(),
});

export const DeleteAgentRequestMessageSchema = z.object({
  type: z.literal("delete_agent_request"),
  agentId: z.string(),
  requestId: z.string(),
});

export const ArchiveAgentRequestMessageSchema = z.object({
  type: z.literal("archive_agent_request"),
  agentId: z.string(),
  requestId: z.string(),
});

export const UpdateAgentRequestMessageSchema = z.object({
  type: z.literal("update_agent_request"),
  agentId: z.string(),
  name: z.string().optional(),
  labels: z.record(z.string()).optional(),
  /** Force-regenerate title from the first user message. Optional for wire compat. */
  regenerateTitle: z.boolean().optional(),
  requestId: z.string(),
});

const ImageAttachmentSchema = z.object({
  data: z.string(), // base64 encoded image
  mimeType: z.string(), // e.g., "image/jpeg", "image/png"
});

export const SendAgentMessageSchema = z.object({
  type: z.literal("send_agent_message"),
  agentId: z.string(),
  text: z.string(),
  messageId: z.string().max(256).optional(), // Client-provided ID for deduplication
  images: z.array(ImageAttachmentSchema).optional(),
  attachments: AgentAttachmentsSchema,
});

export const FetchAgentsRequestMessageSchema = z.object({
  type: z.literal("fetch_agents_request"),
  requestId: z.string(),
  scope: z.enum(["active"]).optional(),
  filter: AgentDirectoryFilterSchema.optional(),
  sort: z
    .array(
      z.object({
        key: z.enum(["status_priority", "created_at", "updated_at", "title"]),
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

export const FetchAgentHistoryRequestMessageSchema = z.object({
  type: z.literal("fetch_agent_history_request"),
  requestId: z.string(),
  filter: AgentDirectoryFilterSchema.optional(),
  sort: z
    .array(
      z.object({
        key: z.enum(["status_priority", "created_at", "updated_at", "title"]),
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
});

export const FetchAgentRequestMessageSchema = z.object({
  type: z.literal("fetch_agent_request"),
  requestId: z.string(),
  /** Accepts full ID, unique prefix, or exact full title (server resolves). */
  agentId: z.string(),
});

export const SendAgentMessageRequestSchema = z.object({
  type: z.literal("send_agent_message_request"),
  requestId: z.string(),
  /** Accepts full ID, unique prefix, or exact full title (server resolves). */
  agentId: z.string(),
  text: z.string(),
  messageId: z.string().max(256).optional(), // Client-provided ID for deduplication
  images: z.array(ImageAttachmentSchema).optional(),
  attachments: AgentAttachmentsSchema,
});

export const WaitForFinishRequestSchema = z.object({
  type: z.literal("wait_for_finish_request"),
  requestId: z.string(),
  /** Accepts full ID, unique prefix, or exact full title (server resolves). */
  agentId: z.string(),
  timeoutMs: z.number().int().positive().optional(),
});

const GitSetupOptionsSchema = z.object({
  baseBranch: z.string().optional(),
  createNewBranch: z.boolean().optional(),
  newBranchName: z.string().optional(),
  createWorktree: z.boolean().optional(),
  worktreeSlug: z.string().optional(),
  refName: z.string().min(1).optional(),
  action: z.enum(["branch-off", "checkout"]).optional(),
  githubPrNumber: z.number().int().positive().optional(),
});

export const CreateAgentWorktreeTargetSchema = z.discriminatedUnion("mode", [
  z.object({
    mode: z.literal("branch-off"),
    newBranch: z.string().min(1),
    base: z.string().min(1).optional(),
  }),
  z.object({
    mode: z.literal("checkout-branch"),
    branch: z.string().min(1),
  }),
  z.object({
    mode: z.literal("checkout-pr"),
    prNumber: z.number().int().positive(),
  }),
]);

export const CreateAgentRequestMessageSchema = z.object({
  type: z.literal("create_agent_request"),
  config: AgentSessionConfigSchema,
  env: z.record(z.string()).optional(),
  workspaceId: z.string().optional(),
  worktreeName: z.string().optional(),
  initialPrompt: z.string().optional(),
  clientMessageId: z.string().optional(),
  /**
   * Client-minted agent id. The daemon adopts it verbatim so the optimistic
   * sidebar row (keyed by the same id) and the authoritative agent share one
   * key. Optional for wire compatibility: older clients omit it and the daemon
   * mints its own UUID.
   */
  agentId: z.string().uuid().optional(),
  outputSchema: z.record(z.unknown()).optional(),
  images: z.array(ImageAttachmentSchema).optional(),
  attachments: AgentAttachmentsSchema,
  git: GitSetupOptionsSchema.optional(),
  worktree: CreateAgentWorktreeTargetSchema.optional(),
  autoArchive: z.boolean().optional(),
  labels: z.record(z.string()).default({}),
  relationKind: z.enum(AGENT_RELATION_KINDS).optional(),
  requestId: z.string(),
});

export const AgentPresetsListRequestMessageSchema = z.object({
  type: z.literal("agent.presets.list.request"),
  requestId: z.string(),
});

export const ResumeAgentRequestMessageSchema = z.object({
  type: z.literal("resume_agent_request"),
  handle: AgentPersistenceHandleSchema,
  overrides: AgentSessionConfigSchema.partial().optional(),
  requestId: z.string(),
});

export const ImportAgentRequestMessageSchema = z.object({
  type: z.literal("import_agent_request"),
  provider: AgentProviderSchema.optional(),
  providerId: z.string().optional(),
  sessionId: z.string().optional(),
  providerHandleId: z.string().optional(),
  cwd: z.string().optional(),
  labels: z.record(z.string()).optional(),
  requestId: z.string(),
});

export const RefreshAgentRequestMessageSchema = z.object({
  type: z.literal("refresh_agent_request"),
  agentId: z.string(),
  requestId: z.string(),
});

export const CancelAgentRequestMessageSchema = z.object({
  type: z.literal("cancel_agent_request"),
  agentId: z.string(),
  requestId: z.string().optional(),
});

export const AgentTimelineCursorSchema = z.object({
  epoch: z.string(),
  seq: z.number().int().nonnegative(),
});

export const FetchAgentTimelineRequestMessageSchema = z.object({
  type: z.literal("fetch_agent_timeline_request"),
  agentId: z.string(),
  requestId: z.string(),
  direction: z.enum(["tail", "before", "after"]).optional(),
  cursor: AgentTimelineCursorSchema.optional(),
  // 0 means "all matching rows for this query window".
  limit: z.number().int().nonnegative().optional(),
  // Default should be projected for app timeline loading.
  projection: z.enum(["projected", "canonical"]).optional(),
});

export const SetAgentModeRequestMessageSchema = z.object({
  type: z.literal("set_agent_mode_request"),
  agentId: z.string(),
  modeId: z.string(),
  requestId: z.string(),
});

const AgentActionResponsePayloadSchema = z.object({
  requestId: z.string(),
  agentId: z.string(),
  accepted: z.boolean(),
  error: z.string().nullable(),
});

export const SetAgentModeResponseMessageSchema = z.object({
  type: z.literal("set_agent_mode_response"),
  payload: AgentActionResponsePayloadSchema,
});

export const SetAgentModelRequestMessageSchema = z.object({
  type: z.literal("set_agent_model_request"),
  agentId: z.string(),
  modelId: z.string().nullable(),
  runtimeProvider: AgentProviderSchema.nullable().optional(),
  requestId: z.string(),
});

export const SetAgentModelResponseMessageSchema = z.object({
  type: z.literal("set_agent_model_response"),
  payload: AgentActionResponsePayloadSchema,
});

export const SetAgentThinkingRequestMessageSchema = z.object({
  type: z.literal("set_agent_thinking_request"),
  agentId: z.string(),
  thinkingOptionId: z.string().nullable(),
  requestId: z.string(),
});

export const SetAgentThinkingResponseMessageSchema = z.object({
  type: z.literal("set_agent_thinking_response"),
  payload: AgentActionResponsePayloadSchema,
});

export const SetAgentFeatureRequestMessageSchema = z.object({
  type: z.literal("set_agent_feature_request"),
  agentId: z.string(),
  featureId: z.string(),
  value: z.unknown(),
  requestId: z.string(),
});

export const SetAgentFeatureResponseMessageSchema = z.object({
  type: z.literal("set_agent_feature_response"),
  payload: AgentActionResponsePayloadSchema,
});

export const AgentRewindModeSchema = z.enum(["conversation", "files", "both"]);

export const AgentRewindRequestMessageSchema = z.object({
  type: z.literal("agent.rewind.request"),
  agentId: z.string(),
  messageId: z.string(),
  mode: AgentRewindModeSchema,
  requestId: z.string(),
});

export const AgentRewindResponseMessageSchema = z.object({
  type: z.literal("agent.rewind.response"),
  payload: z.object({
    requestId: z.string(),
    agentId: z.string(),
    ok: z.boolean(),
    error: z.string().nullable(),
  }),
});

export const UpdateAgentResponseMessageSchema = z.object({
  type: z.literal("update_agent_response"),
  payload: AgentActionResponsePayloadSchema,
});

export const AgentPermissionResponseMessageSchema = z.object({
  type: z.literal("agent_permission_response"),
  agentId: z.string(),
  requestId: z.string(),
  response: AgentPermissionResponseSchema,
});

export const ClearAgentAttentionMessageSchema = z.object({
  type: z.literal("clear_agent_attention"),
  agentId: z.union([z.string(), z.array(z.string())]),
  requestId: z.string().optional(),
});

export const ListCommandsRequestSchema = z.object({
  type: z.literal("list_commands_request"),
  agentId: z.string(),
  draftConfig: ListCommandsDraftConfigSchema.optional(),
  requestId: z.string(),
});

/** Agent request schemas included in the session inbound union. */
export const AgentInboundMessageSchemas = [
  FetchAgentsRequestMessageSchema,
  FetchAgentHistoryRequestMessageSchema,
  FetchAgentRequestMessageSchema,
  DeleteAgentRequestMessageSchema,
  ArchiveAgentRequestMessageSchema,
  UpdateAgentRequestMessageSchema,
  SendAgentMessageRequestSchema,
  WaitForFinishRequestSchema,
  CreateAgentRequestMessageSchema,
  AgentPresetsListRequestMessageSchema,
  ResumeAgentRequestMessageSchema,
  ImportAgentRequestMessageSchema,
  RefreshAgentRequestMessageSchema,
  CancelAgentRequestMessageSchema,
  FetchAgentTimelineRequestMessageSchema,
  SetAgentModeRequestMessageSchema,
  SetAgentModelRequestMessageSchema,
  SetAgentThinkingRequestMessageSchema,
  SetAgentFeatureRequestMessageSchema,
  AgentRewindRequestMessageSchema,
  AgentPermissionResponseMessageSchema,
  ClearAgentAttentionMessageSchema,
  ListCommandsRequestSchema,
] as const;

const AgentStatusWithRequestSchema = z.object({
  agentId: z.string(),
  requestId: z.string(),
});

const AgentStatusWithTimelineSchema = AgentStatusWithRequestSchema.extend({
  timelineSize: z.number().optional(),
});

export const AgentCreatedStatusPayloadSchema = z
  .object({
    status: z.literal("agent_created"),
    agent: AgentSnapshotPayloadSchema,
    /**
     * Project placement for the created agent's workspace. Optional so older
     * daemons/clients remain wire-compatible; the client falls back to the
     * workspace descriptor or a cwd-derived placement when absent.
     */
    project: ProjectPlacementPayloadSchema.nullable().optional(),
    /**
     * When true, the agent session was constructed and the initial prompt (if any)
     * was dispatched asynchronously. Optional for wire compatibility.
     */
    pendingRun: z.boolean().optional(),
  })
  .extend(AgentStatusWithRequestSchema.shape);

export const AgentCreateFailedStatusPayloadSchema = z.object({
  status: z.literal("agent_create_failed"),
  requestId: z.string(),
  error: z.string(),
  errorCode: z.string().optional(),
});

export const AgentResumedStatusPayloadSchema = z
  .object({
    status: z.literal("agent_resumed"),
    agent: AgentSnapshotPayloadSchema,
  })
  .extend(AgentStatusWithTimelineSchema.shape);

export const AgentRefreshedStatusPayloadSchema = z
  .object({
    status: z.literal("agent_refreshed"),
  })
  .extend(AgentStatusWithTimelineSchema.shape);

/** Agent lifecycle status payloads included in the aggregate status union. */
export const AgentStatusPayloadSchemas = [
  AgentCreatedStatusPayloadSchema,
  AgentCreateFailedStatusPayloadSchema,
  AgentResumedStatusPayloadSchema,
  AgentRefreshedStatusPayloadSchema,
] as const;

export const AgentUpdateMessageSchema = z.object({
  type: z.literal("agent_update"),
  payload: z.discriminatedUnion("kind", [
    z.object({
      kind: z.literal("upsert"),
      agent: AgentSnapshotPayloadSchema,
      project: ProjectPlacementPayloadSchema.nullable().optional(),
    }),
    z.object({
      kind: z.literal("remove"),
      agentId: z.string(),
    }),
  ]),
});

export const AgentStreamMessageSchema = z.object({
  type: z.literal("agent_stream"),
  payload: z.object({
    agentId: z.string(),
    event: AgentStreamEventPayloadSchema,
    timestamp: z.string(),
    // Present for timeline events. Maps 1:1 to canonical in-memory timeline rows.
    seq: z.number().int().nonnegative().optional(),
    epoch: z.string().optional(),
  }),
});

export const AgentStatusMessageSchema = z.object({
  type: z.literal("agent_status"),
  payload: z.object({
    agentId: z.string(),
    status: z.string(),
    info: AgentSnapshotPayloadSchema,
  }),
});

export const AgentListMessageSchema = z.object({
  type: z.literal("agent_list"),
  payload: z.object({
    agents: z.array(AgentSnapshotPayloadSchema),
  }),
});

const AgentDirectoryResponseEntrySchema = z.object({
  agent: AgentSnapshotPayloadSchema,
  project: ProjectPlacementPayloadSchema,
});

const AgentDirectoryPageInfoSchema = z.object({
  nextCursor: z.string().nullable(),
  prevCursor: z.string().nullable(),
  hasMore: z.boolean(),
});

export const FetchAgentsResponseMessageSchema = z.object({
  type: z.literal("fetch_agents_response"),
  payload: z.object({
    requestId: z.string(),
    subscriptionId: z.string().nullable().optional(),
    entries: z.array(AgentDirectoryResponseEntrySchema),
    pageInfo: AgentDirectoryPageInfoSchema,
  }),
});

export const FetchAgentHistoryResponseMessageSchema = z.object({
  type: z.literal("fetch_agent_history_response"),
  payload: z.object({
    requestId: z.string(),
    entries: z.array(AgentDirectoryResponseEntrySchema),
    pageInfo: AgentDirectoryPageInfoSchema,
  }),
});

export const FetchAgentResponseMessageSchema = z.object({
  type: z.literal("fetch_agent_response"),
  payload: z.object({
    requestId: z.string(),
    agent: AgentSnapshotPayloadSchema.nullable(),
    project: ProjectPlacementPayloadSchema.nullable().optional(),
    error: z.string().nullable(),
  }),
});

const AgentTimelineSeqRangeSchema = z.object({
  startSeq: z.number().int().nonnegative(),
  endSeq: z.number().int().nonnegative(),
});

export const AgentTimelineEntryPayloadSchema = z.object({
  provider: AgentProviderSchema,
  item: AgentTimelineItemPayloadSchema,
  timestamp: z.string(),
  seqStart: z.number().int().nonnegative(),
  seqEnd: z.number().int().nonnegative(),
  sourceSeqRanges: z.array(AgentTimelineSeqRangeSchema),
  collapsed: z.array(z.enum(["assistant_merge", "reasoning_merge", "tool_lifecycle"])),
});

export const FetchAgentTimelineResponseMessageSchema = z.object({
  type: z.literal("fetch_agent_timeline_response"),
  payload: z.object({
    requestId: z.string(),
    agentId: z.string(),
    agent: AgentSnapshotPayloadSchema.nullable(),
    direction: z.enum(["tail", "before", "after"]),
    projection: z.enum(["projected", "canonical"]),
    epoch: z.string(),
    reset: z.boolean(),
    staleCursor: z.boolean(),
    gap: z.boolean(),
    window: z.object({
      minSeq: z.number().int().nonnegative(),
      maxSeq: z.number().int().nonnegative(),
      nextSeq: z.number().int().nonnegative(),
    }),
    startCursor: AgentTimelineCursorSchema.nullable(),
    endCursor: AgentTimelineCursorSchema.nullable(),
    hasOlder: z.boolean(),
    hasNewer: z.boolean(),
    entries: z.array(AgentTimelineEntryPayloadSchema),
    error: z.string().nullable(),
    /**
     * When true, provider history is still seeding into the in-memory timeline.
     * Optional for wire compatibility; old clients ignore the field.
     */
    hydrating: z.boolean().optional(),
  }),
});

export const CancelAgentResponseMessageSchema = z.object({
  type: z.literal("cancel_agent_response"),
  payload: z.object({
    requestId: z.string(),
    agentId: z.string(),
    agent: AgentSnapshotPayloadSchema.nullable(),
  }),
});

export const ClearAgentAttentionResponseMessageSchema = z.object({
  type: z.literal("clear_agent_attention_response"),
  payload: z.object({
    requestId: z.string(),
    agentId: z.string().or(z.array(z.string())),
    agents: z.array(AgentSnapshotPayloadSchema),
  }),
});

export const SendAgentMessageResponseMessageSchema = z.object({
  type: z.literal("send_agent_message_response"),
  payload: z.object({
    requestId: z.string(),
    agentId: z.string(),
    accepted: z.boolean(),
    error: z.string().nullable(),
    /**
     * When true, the prompt was dispatched but the run has not necessarily
     * started yet. Failures after acceptance arrive as stream/state events.
     * Optional for wire compatibility.
     */
    pendingRun: z.boolean().optional(),
  }),
});

export const WaitForFinishResponseMessageSchema = z.object({
  type: z.literal("wait_for_finish_response"),
  payload: z.object({
    requestId: z.string(),
    status: z.enum(["idle", "error", "permission", "timeout"]),
    final: AgentSnapshotPayloadSchema.nullable(),
    error: z.string().nullable(),
    lastMessage: z.string().nullable(),
  }),
});

export const AgentPermissionRequestMessageSchema = z.object({
  type: z.literal("agent_permission_request"),
  payload: z.object({
    agentId: z.string(),
    request: AgentPermissionRequestPayloadSchema,
  }),
});

export const AgentPermissionResolvedMessageSchema = z.object({
  type: z.literal("agent_permission_resolved"),
  payload: z.object({
    agentId: z.string(),
    requestId: z.string(),
    resolution: AgentPermissionResponseSchema,
  }),
});

export const AgentDeletedMessageSchema = z.object({
  type: z.literal("agent_deleted"),
  payload: z.object({
    agentId: z.string(),
    requestId: z.string(),
  }),
});

export const AgentArchivedMessageSchema = z.object({
  type: z.literal("agent_archived"),
  payload: z.object({
    agentId: z.string(),
    archivedAt: z.string(),
    requestId: z.string(),
  }),
});

export const AgentPresetsListResponseMessageSchema = z.object({
  type: z.literal("agent.presets.list.response"),
  payload: AgentPresetsPayloadSchema.extend({
    requestId: z.string(),
  }),
});

const AgentSlashCommandSchema = z.object({
  name: z.string(),
  description: z.string(),
  argumentHint: z.string(),
});

export const ListCommandsResponseSchema = z.object({
  type: z.literal("list_commands_response"),
  payload: z.object({
    agentId: z.string(),
    commands: z.array(AgentSlashCommandSchema),
    error: z.string().nullable(),
    requestId: z.string(),
  }),
});

/** Agent response and event schemas included in the session outbound union. */
export const AgentOutboundMessageSchemas = [
  AgentUpdateMessageSchema,
  AgentStreamMessageSchema,
  AgentStatusMessageSchema,
  FetchAgentsResponseMessageSchema,
  FetchAgentHistoryResponseMessageSchema,
  FetchAgentResponseMessageSchema,
  FetchAgentTimelineResponseMessageSchema,
  CancelAgentResponseMessageSchema,
  ClearAgentAttentionResponseMessageSchema,
  SendAgentMessageResponseMessageSchema,
  SetAgentModeResponseMessageSchema,
  SetAgentModelResponseMessageSchema,
  SetAgentThinkingResponseMessageSchema,
  SetAgentFeatureResponseMessageSchema,
  AgentRewindResponseMessageSchema,
  UpdateAgentResponseMessageSchema,
  WaitForFinishResponseMessageSchema,
  AgentPermissionRequestMessageSchema,
  AgentPermissionResolvedMessageSchema,
  AgentDeletedMessageSchema,
  AgentArchivedMessageSchema,
  AgentPresetsListResponseMessageSchema,
  ListCommandsResponseSchema,
] as const;

/** Legacy git setup options accepted during agent creation. */
export type GitSetupOptions = z.infer<typeof GitSetupOptionsSchema>;
/** Explicit worktree target selected during agent creation. */
export type CreateAgentWorktreeTarget = z.infer<typeof CreateAgentWorktreeTargetSchema>;
/** Response containing the active agent directory. */
export type FetchAgentsResponseMessage = z.infer<typeof FetchAgentsResponseMessageSchema>;
/** Response containing archived or historical agents. */
export type FetchAgentHistoryResponseMessage = z.infer<
  typeof FetchAgentHistoryResponseMessageSchema
>;
/** Response containing one resolved agent. */
export type FetchAgentResponseMessage = z.infer<typeof FetchAgentResponseMessageSchema>;
/** Response containing an agent timeline window. */
export type FetchAgentTimelineResponseMessage = z.infer<
  typeof FetchAgentTimelineResponseMessageSchema
>;
/** Response emitted after canceling an agent turn. */
export type CancelAgentResponseMessage = z.infer<typeof CancelAgentResponseMessageSchema>;
/** Response emitted after accepting or rejecting an agent message. */
export type SendAgentMessageResponseMessage = z.infer<typeof SendAgentMessageResponseMessageSchema>;
/** Response emitted after changing the agent mode. */
export type SetAgentModeResponseMessage = z.infer<typeof SetAgentModeResponseMessageSchema>;
/** Response emitted after changing the agent model. */
export type SetAgentModelResponseMessage = z.infer<typeof SetAgentModelResponseMessageSchema>;
/** Response emitted after changing the agent thinking option. */
export type SetAgentThinkingResponseMessage = z.infer<typeof SetAgentThinkingResponseMessageSchema>;
/** Response emitted after changing an agent feature. */
export type SetAgentFeatureResponseMessage = z.infer<typeof SetAgentFeatureResponseMessageSchema>;
/** Response emitted after rewinding an agent. */
export type AgentRewindResponseMessage = z.infer<typeof AgentRewindResponseMessageSchema>;
/** Response emitted after updating agent metadata. */
export type UpdateAgentResponseMessage = z.infer<typeof UpdateAgentResponseMessageSchema>;
/** Response emitted when waiting for an agent reaches a terminal condition. */
export type WaitForFinishResponseMessage = z.infer<typeof WaitForFinishResponseMessageSchema>;
/** Permission request emitted by an agent. */
export type AgentPermissionRequestMessage = z.infer<typeof AgentPermissionRequestMessageSchema>;
/** Permission resolution emitted by an agent. */
export type AgentPermissionResolvedMessage = z.infer<typeof AgentPermissionResolvedMessageSchema>;
/** Event emitted after deleting an agent. */
export type AgentDeletedMessage = z.infer<typeof AgentDeletedMessageSchema>;
/** Response containing configured agent presets. */
export type AgentPresetsListResponseMessage = z.infer<typeof AgentPresetsListResponseMessageSchema>;
/** Live agent state update event. */
export type AgentUpdateMessage = z.infer<typeof AgentUpdateMessageSchema>;
/** Agent runtime stream event envelope. */
export type AgentStreamMessage = z.infer<typeof AgentStreamMessageSchema>;
/** Agent status snapshot event. */
export type AgentStatusMessage = z.infer<typeof AgentStatusMessageSchema>;
/** Request to list active agents. */
export type FetchAgentsRequestMessage = z.infer<typeof FetchAgentsRequestMessageSchema>;
/** Request to list historical agents. */
export type FetchAgentHistoryRequestMessage = z.infer<typeof FetchAgentHistoryRequestMessageSchema>;
/** Request to resolve one agent. */
export type FetchAgentRequestMessage = z.infer<typeof FetchAgentRequestMessageSchema>;
/** Request to send a message to an agent. */
export type SendAgentMessageRequest = z.infer<typeof SendAgentMessageRequestSchema>;
/** Request to wait for an agent terminal state. */
export type WaitForFinishRequest = z.infer<typeof WaitForFinishRequestSchema>;
/** Request to create an agent. */
export type CreateAgentRequestMessage = z.infer<typeof CreateAgentRequestMessageSchema>;
/** Request to list agent presets. */
export type AgentPresetsListRequestMessage = z.infer<typeof AgentPresetsListRequestMessageSchema>;
/** Request to resume a persisted agent. */
export type ResumeAgentRequestMessage = z.infer<typeof ResumeAgentRequestMessageSchema>;
/** Request to delete an agent. */
export type DeleteAgentRequestMessage = z.infer<typeof DeleteAgentRequestMessageSchema>;
/** Request to update agent metadata. */
export type UpdateAgentRequestMessage = z.infer<typeof UpdateAgentRequestMessageSchema>;
/** Request to change the agent mode. */
export type SetAgentModeRequestMessage = z.infer<typeof SetAgentModeRequestMessageSchema>;
/** Request to change the agent model. */
export type SetAgentModelRequestMessage = z.infer<typeof SetAgentModelRequestMessageSchema>;
/** Request to change the agent thinking option. */
export type SetAgentThinkingRequestMessage = z.infer<typeof SetAgentThinkingRequestMessageSchema>;
/** Request to change an agent feature. */
export type SetAgentFeatureRequestMessage = z.infer<typeof SetAgentFeatureRequestMessageSchema>;
/** Client response to an agent permission request. */
export type AgentPermissionResponseMessage = z.infer<typeof AgentPermissionResponseMessageSchema>;
/** Request to clear attention state for one or more agents. */
export type ClearAgentAttentionMessage = z.infer<typeof ClearAgentAttentionMessageSchema>;
/** Response containing refreshed attention state. */
export type ClearAgentAttentionResponseMessage = z.infer<
  typeof ClearAgentAttentionResponseMessageSchema
>;
/** Request to list slash commands for an agent or draft. */
export type ListCommandsRequest = z.infer<typeof ListCommandsRequestSchema>;
/** Response containing slash commands. */
export type ListCommandsResponse = z.infer<typeof ListCommandsResponseSchema>;
