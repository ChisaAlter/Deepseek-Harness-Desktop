import { z } from "zod/v3";

import { AGENT_LIFECYCLE_STATUSES } from "../agent-lifecycle.js";
import { AGENT_RELATION_KINDS, AGENT_RELATION_SOURCES } from "../agent-labels.js";
import { AgentPresetSchema } from "../agent-presets.js";
import {
  TOOL_CALL_ICON_NAMES,
  type AgentCapabilityFlags,
  type AgentPermissionRequest,
  type AgentPermissionResponse,
  type AgentPersistenceHandle,
  type AgentRuntimeInfo,
  type AgentTimelineItem,
  type AgentUsage,
  type ToolCallDetail,
  type ToolCallTimelineItem,
} from "../agent-types.js";
import { AgentProviderSchema } from "../provider-manifest.js";
import { AgentFeatureSchema, AgentModeSchema } from "../provider/messages.js";
import { WorktreeSetupDetailPayloadSchema } from "../workspace/messages.js";

export const AgentStatusSchema = z.enum(AGENT_LIFECYCLE_STATUSES);

const AgentCapabilityFlagsSchema: z.ZodType<AgentCapabilityFlags> = z.object({
  supportsStreaming: z.boolean(),
  supportsSessionPersistence: z.boolean(),
  supportsDynamicModes: z.boolean(),
  supportsMcpServers: z.boolean(),
  supportsReasoningStream: z.boolean(),
  supportsToolInvocations: z.boolean(),
  // COMPAT(rewind): added in v0.1.X, drop when floor >= v0.1.X.
  supportsRewindConversation: z.boolean().optional().default(false),
  // COMPAT(rewind): added in v0.1.X, drop when floor >= v0.1.X.
  supportsRewindFiles: z.boolean().optional().default(false),
  // COMPAT(rewind): added in v0.1.X, drop when floor >= v0.1.X.
  supportsRewindBoth: z.boolean().optional().default(false),
});

const AgentUsageSchema: z.ZodType<AgentUsage> = z.object({
  inputTokens: z.number().optional(),
  cachedInputTokens: z.number().optional(),
  outputTokens: z.number().optional(),
  totalCostUsd: z.number().optional(),
  contextWindowMaxTokens: z.number().optional(),
  contextWindowUsedTokens: z.number().optional(),
});

const AgentPermissionUpdateSchema = z.record(z.unknown());
const AgentPermissionActionSchema = z.object({
  id: z.string(),
  label: z.string(),
  behavior: z.enum(["allow", "deny"]),
  variant: z.enum(["primary", "secondary", "danger"]).optional(),
  intent: z.enum(["implement", "implement_resume", "dismiss"]).optional(),
});

export const AgentPermissionResponseSchema: z.ZodType<AgentPermissionResponse> = z.union([
  z.object({
    behavior: z.literal("allow"),
    selectedActionId: z.string().optional(),
    updatedInput: z.record(z.unknown()).optional(),
    updatedPermissions: z.array(AgentPermissionUpdateSchema).optional(),
  }),
  z.object({
    behavior: z.literal("deny"),
    selectedActionId: z.string().optional(),
    message: z.string().optional(),
    interrupt: z.boolean().optional(),
  }),
]);

export const AgentPermissionRequestPayloadSchema: z.ZodType<
  AgentPermissionRequest,
  z.ZodTypeDef,
  unknown
> = z.object({
  id: z.string(),
  provider: AgentProviderSchema,
  name: z.string(),
  kind: z.enum(["tool", "plan", "question", "mode", "other"]),
  title: z.string().optional(),
  description: z.string().optional(),
  input: z.record(z.unknown()).optional(),
  detail: z.lazy(() => ToolCallDetailPayloadSchema).optional(),
  suggestions: z.array(AgentPermissionUpdateSchema).optional(),
  actions: z.array(AgentPermissionActionSchema).optional(),
  metadata: z.record(z.unknown()).optional(),
});

const UnknownValueSchema = z.union([
  z.null(),
  z.boolean(),
  z.number(),
  z.string(),
  z.array(z.unknown()),
  z.object({}).passthrough(),
]);

const NonNullUnknownSchema = z.union([
  z.boolean(),
  z.number(),
  z.string(),
  z.array(z.unknown()),
  z.object({}).passthrough(),
]);

const ToolCallDetailPayloadSchema: z.ZodType<ToolCallDetail, z.ZodTypeDef, unknown> =
  z.discriminatedUnion("type", [
    WorktreeSetupDetailPayloadSchema,
    z.object({
      type: z.literal("shell"),
      command: z.string(),
      cwd: z.string().optional(),
      output: z.string().optional(),
      exitCode: z.number().nullable().optional(),
    }),
    z.object({
      type: z.literal("read"),
      filePath: z.string(),
      content: z.string().optional(),
      offset: z.number().optional(),
      limit: z.number().optional(),
    }),
    z.object({
      type: z.literal("edit"),
      filePath: z.string(),
      oldString: z.string().optional(),
      newString: z.string().optional(),
      unifiedDiff: z.string().optional(),
    }),
    z.object({
      type: z.literal("write"),
      filePath: z.string(),
      content: z.string().optional(),
    }),
    z.object({
      type: z.literal("search"),
      query: z.string(),
      toolName: z.enum(["search", "grep", "glob", "web_search"]).optional(),
      content: z.string().optional(),
      filePaths: z.array(z.string()).optional(),
      webResults: z
        .array(
          z.object({
            title: z.string(),
            url: z.string(),
          }),
        )
        .optional(),
      annotations: z.array(z.string()).optional(),
      numFiles: z.number().optional(),
      numMatches: z.number().optional(),
      durationMs: z.number().optional(),
      durationSeconds: z.number().optional(),
      truncated: z.boolean().optional(),
      mode: z.enum(["content", "files_with_matches", "count"]).optional(),
    }),
    z.object({
      type: z.literal("fetch"),
      url: z.string(),
      prompt: z.string().optional(),
      result: z.string().optional(),
      code: z.number().optional(),
      codeText: z.string().optional(),
      bytes: z.number().optional(),
      durationMs: z.number().optional(),
    }),
    z.object({
      type: z.literal("sub_agent"),
      subAgentType: z.string().optional(),
      description: z.string().optional(),
      childSessionId: z.string().optional(),
      log: z.string(),
      // Compat cruft for clients <= 0.1.65-beta.3 that required this field. Producers still
      // emit `[]`; nothing reads it. Drop the field (and the `[]` emissions) once those
      // clients are no longer in the field.
      actions: z
        .array(
          z.object({
            index: z.number().int().positive(),
            toolName: z.string(),
            summary: z.string().optional(),
          }),
        )
        .optional(),
    }),
    z.object({
      type: z.literal("plain_text"),
      label: z.string().optional(),
      text: z.string().optional(),
      icon: z.enum(TOOL_CALL_ICON_NAMES).optional(),
    }),
    z.object({
      type: z.literal("plan"),
      text: z.string(),
    }),
    z.object({
      type: z.literal("unknown"),
      input: UnknownValueSchema,
      output: UnknownValueSchema,
    }),
  ]);

const ToolCallBasePayloadSchema = z
  .object({
    type: z.literal("tool_call"),
    callId: z.string(),
    name: z.string(),
    detail: ToolCallDetailPayloadSchema,
    metadata: z.record(z.string(), z.unknown()).optional(),
  })
  .strict();

const ToolCallRunningPayloadSchema = ToolCallBasePayloadSchema.extend({
  status: z.literal("running"),
  error: z.null(),
});

const ToolCallCompletedPayloadSchema = ToolCallBasePayloadSchema.extend({
  status: z.literal("completed"),
  error: z.null(),
});

const ToolCallFailedPayloadSchema = ToolCallBasePayloadSchema.extend({
  status: z.literal("failed"),
  error: NonNullUnknownSchema,
});

const ToolCallCanceledPayloadSchema = ToolCallBasePayloadSchema.extend({
  status: z.literal("canceled"),
  error: z.null(),
});

const ToolCallTimelineItemPayloadSchema: z.ZodType<ToolCallTimelineItem, z.ZodTypeDef, unknown> =
  z.union([
    ToolCallRunningPayloadSchema,
    ToolCallCompletedPayloadSchema,
    ToolCallFailedPayloadSchema,
    ToolCallCanceledPayloadSchema,
  ]);

export const GenerativeUiTimelineItemPayloadSchema = z.object({
  type: z.literal("generative_ui"),
  instanceId: z.string(),
  componentId: z.string(),
  props: z.record(z.string(), z.unknown()),
  title: z.string().optional(),
  source: z.enum(["tool_call", "fence"]),
  status: z.enum(["rendering", "interactive", "error"]),
});

export const AgentTimelineItemPayloadSchema: z.ZodType<AgentTimelineItem, z.ZodTypeDef, unknown> =
  z.union([
    z.object({
      type: z.literal("user_message"),
      text: z.string(),
      messageId: z.string().optional(),
    }),
    z.object({
      type: z.literal("assistant_message"),
      text: z.string(),
      messageId: z.string().optional(),
    }),
    z.object({
      type: z.literal("reasoning"),
      text: z.string(),
    }),
    ToolCallTimelineItemPayloadSchema,
    GenerativeUiTimelineItemPayloadSchema,
    z.object({
      type: z.literal("todo"),
      items: z.array(
        z.object({
          text: z.string(),
          completed: z.boolean(),
        }),
      ),
    }),
    z.object({
      type: z.literal("error"),
      message: z.string(),
    }),
    z.object({
      type: z.literal("compaction"),
      status: z.enum(["loading", "completed", "failed"]),
      error: z.string().optional(),
      trigger: z.enum(["auto", "manual"]).optional(),
      preTokens: z.number().optional(),
    }),
    z.object({
      type: z.literal("turn_changes"),
      changeSummary: z.string(),
      changedFiles: z.array(
        z.object({
          path: z.string(),
          additions: z.number().optional(),
          deletions: z.number().optional(),
        }),
      ),
      checkpointRef: z.string().optional(),
    }),
  ]);

export const AgentStreamEventPayloadSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("thread_started"),
    sessionId: z.string(),
    provider: AgentProviderSchema,
  }),
  z.object({
    type: z.literal("turn_started"),
    provider: AgentProviderSchema,
  }),
  z.object({
    type: z.literal("turn_completed"),
    provider: AgentProviderSchema,
    usage: AgentUsageSchema.optional(),
  }),
  z.object({
    type: z.literal("turn_failed"),
    provider: AgentProviderSchema,
    error: z.string(),
    code: z.string().optional(),
    diagnostic: z.string().optional(),
  }),
  z.object({
    type: z.literal("turn_canceled"),
    provider: AgentProviderSchema,
    reason: z.string(),
  }),
  z.object({
    type: z.literal("timeline"),
    provider: AgentProviderSchema,
    item: AgentTimelineItemPayloadSchema,
  }),
  z.object({
    type: z.literal("permission_requested"),
    provider: AgentProviderSchema,
    request: AgentPermissionRequestPayloadSchema,
  }),
  z.object({
    type: z.literal("permission_resolved"),
    provider: AgentProviderSchema,
    requestId: z.string(),
    resolution: AgentPermissionResponseSchema,
  }),
  z.object({
    type: z.literal("attention_required"),
    provider: AgentProviderSchema,
    reason: z.enum(["finished", "error", "permission"]),
    timestamp: z.string(),
    shouldNotify: z.boolean(),
    notification: z
      .object({
        title: z.string(),
        body: z.string(),
        data: z.object({
          serverId: z.string(),
          agentId: z.string(),
          reason: z.enum(["finished", "error", "permission"]),
        }),
      })
      .optional(),
  }),
  z.object({
    type: z.literal("generative_ui_update"),
    instanceId: z.string(),
    props: z.record(z.string(), z.unknown()),
    status: z.enum(["rendering", "interactive", "error"]).optional(),
    timestamp: z.string().optional(),
  }),
  z.object({
    type: z.literal("generative_ui_remove"),
    instanceId: z.string(),
    timestamp: z.string().optional(),
  }),
]);

export const AgentPersistenceHandleSchema: z.ZodType<AgentPersistenceHandle | null> = z
  .object({
    provider: AgentProviderSchema,
    sessionId: z.string(),
    nativeHandle: z.string().optional(),
    metadata: z.record(z.string(), z.unknown()).optional(),
  })
  .nullable();

const AgentRuntimeInfoSchema: z.ZodType<AgentRuntimeInfo> = z.object({
  provider: AgentProviderSchema,
  sessionId: z.string().nullable(),
  model: z.string().nullable().optional(),
  thinkingOptionId: z.string().nullable().optional(),
  modeId: z.string().nullable().optional(),
  extra: z.record(z.string(), z.unknown()).optional(),
});

export const AgentRelationSchema = z.object({
  kind: z.enum(AGENT_RELATION_KINDS),
  parentAgentId: z.string().optional(),
  taskId: z.string().optional(),
  source: z.enum(AGENT_RELATION_SOURCES).optional(),
});

export const AgentSnapshotPayloadSchema = z.object({
  id: z.string(),
  provider: AgentProviderSchema,
  cwd: z.string(),
  model: z.string().nullable(),
  features: z.array(AgentFeatureSchema).optional(),
  thinkingOptionId: z.string().nullable().optional(),
  effectiveThinkingOptionId: z.string().nullable().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
  lastUserMessageAt: z.string().nullable(),
  status: AgentStatusSchema,
  capabilities: AgentCapabilityFlagsSchema,
  currentModeId: z.string().nullable(),
  availableModes: z.array(AgentModeSchema),
  pendingPermissions: z.array(AgentPermissionRequestPayloadSchema),
  persistence: AgentPersistenceHandleSchema.nullable(),
  runtimeInfo: AgentRuntimeInfoSchema.optional(),
  lastUsage: AgentUsageSchema.optional(),
  lastError: z.string().optional(),
  title: z.string().nullable(),
  labels: z.record(z.string(), z.string()).default({}),
  relation: AgentRelationSchema.optional(),
  requiresAttention: z.boolean().optional(),
  attentionReason: z.enum(["finished", "error", "permission"]).nullable().optional(),
  attentionTimestamp: z.string().nullable().optional(),
  archivedAt: z.string().nullable().optional(),
  providerUnavailable: z.boolean().optional(),
});

export const AgentListItemPayloadSchema = z.object({
  id: z.string(),
  shortId: z.string(),
  title: z.string().nullable(),
  provider: AgentProviderSchema,
  model: z.string().nullable(),
  thinkingOptionId: z.string().nullable().optional(),
  effectiveThinkingOptionId: z.string().nullable().optional(),
  status: AgentStatusSchema,
  cwd: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
  lastUserMessageAt: z.string().nullable(),
  archivedAt: z.string().nullable().optional(),
  requiresAttention: z.boolean().optional(),
  attentionReason: z.enum(["finished", "error", "permission"]).nullable().optional(),
  attentionTimestamp: z.string().nullable().optional(),
  labels: z.record(z.string(), z.string()).default({}),
  providerUnavailable: z.boolean().optional(),
});

export const AgentPresetPayloadSchema = AgentPresetSchema;

/** Complete agent state exposed over the wire. */
export type AgentSnapshotPayload = z.infer<typeof AgentSnapshotPayloadSchema>;
/** Compact agent state used in directory listings. */
export type AgentListItemPayload = z.infer<typeof AgentListItemPayloadSchema>;
/** Runtime event emitted by an agent session. */
export type AgentStreamEventPayload = z.infer<typeof AgentStreamEventPayloadSchema>;
