import { z } from "zod/v3";

import { AgentProviderSchema } from "../provider-manifest.js";
import { normalizeAgentModelDefinition } from "../agent-types.js";
import type { AgentModelDefinition, AgentMode, ProviderStatus } from "../agent-types.js";

export const AgentModeSchema: z.ZodType<AgentMode> = z.object({
  id: z.string(),
  label: z.string(),
  description: z.string().optional(),
  icon: z.string().optional(),
  colorTier: z.string().optional(),
});

export const ProviderStatusSchema: z.ZodType<ProviderStatus> = z.enum([
  "ready",
  "loading",
  "error",
  "unavailable",
]);

const AgentSelectOptionSchema = z.object({
  id: z.string(),
  label: z.string(),
  description: z.string().optional(),
  isDefault: z.boolean().optional(),
  metadata: z.record(z.unknown()).optional(),
});

export const AgentFeatureToggleSchema = z.object({
  type: z.literal("toggle"),
  id: z.string(),
  label: z.string(),
  description: z.string().optional(),
  tooltip: z.string().optional(),
  icon: z.string().optional(),
  value: z.boolean(),
});

export const AgentFeatureSelectSchema = z.object({
  type: z.literal("select"),
  id: z.string(),
  label: z.string(),
  description: z.string().optional(),
  tooltip: z.string().optional(),
  icon: z.string().optional(),
  value: z.string().nullable(),
  options: z.array(AgentSelectOptionSchema),
});

export const AgentFeatureSchema = z.discriminatedUnion("type", [
  AgentFeatureToggleSchema,
  AgentFeatureSelectSchema,
]);

export const AgentModelDefinitionSchema: z.ZodType<AgentModelDefinition> = z
  .object({
    provider: AgentProviderSchema,
    id: z.string(),
    label: z.string(),
    description: z.string().optional(),
    isDefault: z.boolean().optional(),
    metadata: z.record(z.unknown()).optional(),
    thinkingOptions: z.array(AgentSelectOptionSchema).optional(),
    defaultThinkingOptionId: z.string().optional(),
  })
  .transform(normalizeAgentModelDefinition);

export const ProviderSnapshotEntrySchema = z.object({
  provider: AgentProviderSchema,
  status: ProviderStatusSchema,
  statusReason: z
    .enum([
      "disabled",
      "command_unavailable",
      "runtime_unavailable",
      "model_discovery_failed",
      "refresh_failed",
      "configuration_changed",
    ])
    .optional(),
  enabled: z.boolean().optional().default(true),
  error: z.string().optional(),
  models: z.array(AgentModelDefinitionSchema).optional(),
  modes: z.array(AgentModeSchema).optional(),
  fetchedAt: z.string().optional(),
  label: z.string().optional(),
  description: z.string().optional(),
  defaultModeId: z.string().nullable().optional(),
  derivedFromProviderId: AgentProviderSchema.nullable().optional(),
  modelGatewayId: z.string().nullable().optional(),
  installedVersion: z.string().nullable().optional(),
  latestVersion: z.string().nullable().optional(),
  versionStatus: z.enum(["unknown", "not-installed", "current", "outdated"]).optional(),
  packageName: z.string().optional(),
  checkedAt: z.string().optional(),
  installAvailable: z.boolean().optional(),
  updateAvailable: z.boolean().optional(),
});

const ProviderDiagnosticDetailsSchema = z.object({
  provider: AgentProviderSchema,
  effectiveCommand: z
    .object({
      argv: z.array(z.string()),
      source: z.enum(["default", "append", "override", "custom", "unknown"]),
      resolvedPath: z.string().nullable(),
      available: z.boolean(),
    })
    .optional(),
  cwd: z.string().optional(),
  env: z
    .array(
      z.object({
        name: z.string(),
        present: z.boolean(),
        source: z.enum(["process", "provider-config"]),
      }),
    )
    .optional(),
  mcpInjection: z
    .object({
      supported: z.boolean(),
      enabled: z.boolean(),
      reason: z.string(),
    })
    .optional(),
  tooling: ProviderSnapshotEntrySchema.pick({
    installedVersion: true,
    latestVersion: true,
    versionStatus: true,
    packageName: true,
    installAvailable: true,
    updateAvailable: true,
    checkedAt: true,
  })
    .partial()
    .optional(),
});

export const RecentProviderSessionDescriptorPayloadSchema = z.object({
  providerId: z.string(),
  providerLabel: z.string(),
  providerHandleId: z.string(),
  cwd: z.string(),
  title: z.string().nullable(),
  firstPromptPreview: z.string().nullable(),
  lastPromptPreview: z.string().nullable(),
  lastActivityAt: z.string(),
});

export type RecentProviderSessionDescriptorPayload = z.infer<
  typeof RecentProviderSessionDescriptorPayloadSchema
>;

export const FetchRecentProviderSessionsRequestMessageSchema = z.object({
  type: z.literal("fetch_recent_provider_sessions_request"),
  requestId: z.string(),
  cwd: z.string().optional(),
  providers: z.array(z.string()).optional(),
  since: z.string().optional(),
  limit: z.number().int().positive().max(200).optional(),
});

export const ListProviderModelsRequestMessageSchema = z.object({
  type: z.literal("list_provider_models_request"),
  provider: AgentProviderSchema,
  cwd: z.string().optional(),
  requestId: z.string(),
});

export const ListProviderModesRequestMessageSchema = z.object({
  type: z.literal("list_provider_modes_request"),
  provider: AgentProviderSchema,
  cwd: z.string().optional(),
  requestId: z.string(),
});

export const ListAvailableProvidersRequestMessageSchema = z.object({
  type: z.literal("list_available_providers_request"),
  requestId: z.string(),
});

export const GetProvidersSnapshotRequestMessageSchema = z.object({
  type: z.literal("get_providers_snapshot_request"),
  cwd: z.string().optional(),
  requestId: z.string(),
});

export const RefreshProvidersSnapshotRequestMessageSchema = z.object({
  type: z.literal("refresh_providers_snapshot_request"),
  cwd: z.string().optional(),
  providers: z.array(AgentProviderSchema).optional(),
  requestId: z.string(),
});

export const ProviderDiagnosticRequestMessageSchema = z.object({
  type: z.literal("provider_diagnostic_request"),
  provider: AgentProviderSchema,
  requestId: z.string(),
});

export const ProviderUsageListRequestMessageSchema = z.object({
  type: z.literal("provider.usage.list.request"),
  requestId: z.string(),
});

export const DiagnosticsRequestSchema = z.object({
  type: z.literal("diagnostics.request"),
  requestId: z.string(),
  includeLogs: z.boolean().optional(),
  maxLogLines: z.number().int().positive().max(200).optional(),
});

export const ProviderToolingActionRequestMessageSchema = z.object({
  type: z.literal("provider.tooling.run.request"),
  provider: AgentProviderSchema,
  action: z.enum(["install", "update", "reinstall"]),
  requestId: z.string(),
});

export const ListCommandsDraftConfigSchema = z.object({
  provider: AgentProviderSchema,
  cwd: z.string(),
  modeId: z.string().optional(),
  model: z.string().optional(),
  thinkingOptionId: z.string().optional(),
  featureValues: z.record(z.unknown()).optional(),
});

export const ListProviderFeaturesRequestMessageSchema = z.object({
  type: z.literal("list_provider_features_request"),
  draftConfig: ListCommandsDraftConfigSchema,
  requestId: z.string(),
});

export const FetchRecentProviderSessionsResponseMessageSchema = z.object({
  type: z.literal("fetch_recent_provider_sessions_response"),
  payload: z.object({
    requestId: z.string(),
    entries: z.array(RecentProviderSessionDescriptorPayloadSchema),
    filteredAlreadyImportedCount: z.number().int().nonnegative().optional(),
  }),
});

export const DiagnosticsResponseSchema = z.object({
  type: z.literal("diagnostics.response"),
  payload: z
    .object({
      requestId: z.string(),
      diagnostic: z.string(),
    })
    .passthrough(),
});

export const ListProviderModelsResponseMessageSchema = z.object({
  type: z.literal("list_provider_models_response"),
  payload: z.object({
    provider: AgentProviderSchema,
    models: z.array(AgentModelDefinitionSchema).optional(),
    error: z.string().nullable().optional(),
    fetchedAt: z.string(),
    requestId: z.string(),
  }),
});

export const ListProviderModesResponseMessageSchema = z.object({
  type: z.literal("list_provider_modes_response"),
  payload: z.object({
    provider: AgentProviderSchema,
    modes: z.array(AgentModeSchema).optional(),
    error: z.string().nullable().optional(),
    fetchedAt: z.string(),
    requestId: z.string(),
  }),
});

export const ListProviderFeaturesResponseMessageSchema = z.object({
  type: z.literal("list_provider_features_response"),
  payload: z.object({
    provider: AgentProviderSchema,
    features: z.array(AgentFeatureSchema).optional(),
    error: z.string().nullable().optional(),
    fetchedAt: z.string(),
    requestId: z.string(),
  }),
});

const ProviderAvailabilitySchema = z.object({
  provider: AgentProviderSchema,
  available: z.boolean(),
  error: z.string().nullable().optional(),
});

export const ListAvailableProvidersResponseSchema = z.object({
  type: z.literal("list_available_providers_response"),
  payload: z.object({
    providers: z.array(ProviderAvailabilitySchema),
    error: z.string().nullable().optional(),
    fetchedAt: z.string(),
    requestId: z.string(),
  }),
});

// COMPAT(providersSnapshot): added in v0.1.48, remove gating when all clients use snapshot
export const GetProvidersSnapshotResponseMessageSchema = z.object({
  type: z.literal("get_providers_snapshot_response"),
  payload: z.object({
    cwd: z.string().optional(),
    entries: z.array(ProviderSnapshotEntrySchema),
    generatedAt: z.string(),
    requestId: z.string(),
  }),
});

// COMPAT(providersSnapshot): added in v0.1.48, remove gating when all clients use snapshot
export const ProvidersSnapshotUpdateMessageSchema = z.object({
  type: z.literal("providers_snapshot_update"),
  payload: z.object({
    cwd: z.string().optional(),
    entries: z.array(ProviderSnapshotEntrySchema),
    generatedAt: z.string(),
  }),
});

// COMPAT(providersSnapshot): added in v0.1.48, remove gating when all clients use snapshot
export const RefreshProvidersSnapshotResponseMessageSchema = z.object({
  type: z.literal("refresh_providers_snapshot_response"),
  payload: z.object({
    requestId: z.string(),
    acknowledged: z.boolean(),
  }),
});

// COMPAT(providersSnapshot): added in v0.1.48, remove gating when all clients use snapshot
export const ProviderDiagnosticResponseMessageSchema = z.object({
  type: z.literal("provider_diagnostic_response"),
  payload: z.object({
    provider: AgentProviderSchema,
    diagnostic: z.string(),
    details: ProviderDiagnosticDetailsSchema.optional(),
    requestId: z.string(),
  }),
});

export const ProviderUsageToneSchema = z.enum(["default", "ok", "warning", "danger"]);
export const ProviderUsageStatusSchema = z.enum(["available", "unavailable", "error"]);

export const ProviderUsageWindowSchema = z.object({
  id: z.string(),
  label: z.string(),
  usedPct: z.number().nullable().optional(),
  remainingPct: z.number().nullable().optional(),
  resetsAt: z.string().nullable().optional(),
  runsOutAt: z.string().nullable().optional(),
  shortfallPct: z.number().nullable().optional(),
  tone: ProviderUsageToneSchema.optional(),
});

export const ProviderUsageBalanceSchema = z.object({
  id: z.string(),
  label: z.string(),
  used: z.number().nullable().optional(),
  remaining: z.number().nullable().optional(),
  limit: z.number().nullable().optional(),
  unit: z.enum(["usd", "credits", "requests", "tokens"]),
  resetsAt: z.string().nullable().optional(),
  tone: ProviderUsageToneSchema.optional(),
});

export const ProviderUsageDetailSchema = z.object({
  id: z.string(),
  label: z.string(),
  value: z.string(),
  tone: ProviderUsageToneSchema.optional(),
});

export const ProviderUsageSchema = z.object({
  providerId: z.string(),
  displayName: z.string(),
  status: ProviderUsageStatusSchema,
  planLabel: z.string().nullable(),
  sourceLabel: z.string().nullable().optional(),
  fetchedAt: z.string().nullable().optional(),
  nextRefreshAt: z.string().nullable().optional(),
  windows: z.array(ProviderUsageWindowSchema),
  balances: z.array(ProviderUsageBalanceSchema).optional(),
  details: z.array(ProviderUsageDetailSchema).optional(),
  error: z.string().nullable().optional(),
});

export const ProviderUsageListResponseMessageSchema = z.object({
  type: z.literal("provider.usage.list.response"),
  payload: z.object({
    requestId: z.string(),
    fetchedAt: z.string(),
    providers: z.array(ProviderUsageSchema),
  }),
});

export const ProviderToolingActionResponseMessageSchema = z.object({
  type: z.literal("provider.tooling.run.response"),
  payload: z.object({
    provider: AgentProviderSchema,
    action: z.enum(["install", "update", "reinstall"]),
    exitCode: z.number().nullable(),
    stdout: z.string(),
    stderr: z.string(),
    success: z.boolean(),
    requestId: z.string(),
  }),
});

export const ProviderInboundMessageSchemas = [
  FetchRecentProviderSessionsRequestMessageSchema,
  ListProviderModelsRequestMessageSchema,
  ListProviderModesRequestMessageSchema,
  ListProviderFeaturesRequestMessageSchema,
  ListAvailableProvidersRequestMessageSchema,
  GetProvidersSnapshotRequestMessageSchema,
  RefreshProvidersSnapshotRequestMessageSchema,
  ProviderDiagnosticRequestMessageSchema,
  ProviderUsageListRequestMessageSchema,
  DiagnosticsRequestSchema,
  ProviderToolingActionRequestMessageSchema,
] as const;

export const ProviderOutboundMessageSchemas = [
  FetchRecentProviderSessionsResponseMessageSchema,
  ListProviderModelsResponseMessageSchema,
  ListProviderModesResponseMessageSchema,
  ListProviderFeaturesResponseMessageSchema,
  ListAvailableProvidersResponseSchema,
  GetProvidersSnapshotResponseMessageSchema,
  ProvidersSnapshotUpdateMessageSchema,
  RefreshProvidersSnapshotResponseMessageSchema,
  ProviderDiagnosticResponseMessageSchema,
  ProviderUsageListResponseMessageSchema,
  DiagnosticsResponseSchema,
  ProviderToolingActionResponseMessageSchema,
] as const;

export type FetchRecentProviderSessionsRequestMessage = z.infer<
  typeof FetchRecentProviderSessionsRequestMessageSchema
>;
export type FetchRecentProviderSessionsResponseMessage = z.infer<
  typeof FetchRecentProviderSessionsResponseMessageSchema
>;
export type ListProviderModelsRequestMessage = z.infer<
  typeof ListProviderModelsRequestMessageSchema
>;
export type ListProviderModesRequestMessage = z.infer<typeof ListProviderModesRequestMessageSchema>;
export type ListProviderFeaturesRequestMessage = z.infer<
  typeof ListProviderFeaturesRequestMessageSchema
>;
export type ListAvailableProvidersRequestMessage = z.infer<
  typeof ListAvailableProvidersRequestMessageSchema
>;
export type GetProvidersSnapshotRequestMessage = z.infer<
  typeof GetProvidersSnapshotRequestMessageSchema
>;
export type RefreshProvidersSnapshotRequestMessage = z.infer<
  typeof RefreshProvidersSnapshotRequestMessageSchema
>;
export type ProviderDiagnosticRequestMessage = z.infer<
  typeof ProviderDiagnosticRequestMessageSchema
>;
export type ProviderToolingActionRequestMessage = z.infer<
  typeof ProviderToolingActionRequestMessageSchema
>;
export type ProviderUsageListRequest = z.infer<typeof ProviderUsageListRequestMessageSchema>;
export type DiagnosticsRequest = z.infer<typeof DiagnosticsRequestSchema>;
export type ListProviderModelsResponseMessage = z.infer<
  typeof ListProviderModelsResponseMessageSchema
>;
export type ListProviderModesResponseMessage = z.infer<
  typeof ListProviderModesResponseMessageSchema
>;
export type ListProviderFeaturesResponseMessage = z.infer<
  typeof ListProviderFeaturesResponseMessageSchema
>;
export type ListAvailableProvidersResponse = z.infer<typeof ListAvailableProvidersResponseSchema>;
export type GetProvidersSnapshotResponseMessage = z.infer<
  typeof GetProvidersSnapshotResponseMessageSchema
>;
export type ProvidersSnapshotUpdateMessage = z.infer<typeof ProvidersSnapshotUpdateMessageSchema>;
export type RefreshProvidersSnapshotResponseMessage = z.infer<
  typeof RefreshProvidersSnapshotResponseMessageSchema
>;
export type ProviderDiagnosticResponseMessage = z.infer<
  typeof ProviderDiagnosticResponseMessageSchema
>;
export type ProviderToolingActionResponseMessage = z.infer<
  typeof ProviderToolingActionResponseMessageSchema
>;
export type ProviderUsageTone = z.infer<typeof ProviderUsageToneSchema>;
export type ProviderUsageStatus = z.infer<typeof ProviderUsageStatusSchema>;
export type ProviderUsageWindow = z.infer<typeof ProviderUsageWindowSchema>;
export type ProviderUsageBalance = z.infer<typeof ProviderUsageBalanceSchema>;
export type ProviderUsageDetail = z.infer<typeof ProviderUsageDetailSchema>;
export type ProviderUsage = z.infer<typeof ProviderUsageSchema>;
export type ProviderUsageListResponse = z.infer<typeof ProviderUsageListResponseMessageSchema>;
export type DiagnosticsResponse = z.infer<typeof DiagnosticsResponseSchema>;
