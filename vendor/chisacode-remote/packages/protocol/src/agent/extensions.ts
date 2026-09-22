import { z } from "zod/v3";

import { AgentProviderSchema } from "../provider-manifest.js";

export const McpStdioServerConfigSchema = z.object({
  type: z.literal("stdio"),
  command: z.string(),
  args: z.array(z.string()).optional(),
  env: z.record(z.string()).optional(),
});

export const McpHttpServerConfigSchema = z.object({
  type: z.literal("http"),
  url: z.string(),
  headers: z.record(z.string()).optional(),
});

export const McpSseServerConfigSchema = z.object({
  type: z.literal("sse"),
  url: z.string(),
  headers: z.record(z.string()).optional(),
});

export const McpServerConfigSchema = z.discriminatedUnion("type", [
  McpStdioServerConfigSchema,
  McpHttpServerConfigSchema,
  McpSseServerConfigSchema,
]);

export const SkillPolicyGlobalConfigSchema = z
  .object({
    disabledSkillNames: z.array(z.string().min(1)).default([]),
  })
  .passthrough();

export const SkillPolicyAgentConfigSchema = z
  .object({
    enabledSkillNames: z.array(z.string().min(1)).default([]),
    disabledSkillNames: z.array(z.string().min(1)).default([]),
  })
  .passthrough();

export const SkillPolicyProviderConfigSchema = SkillPolicyAgentConfigSchema;

export const InstalledSkillSourceSchema = z
  .object({
    id: z.string().min(1),
    type: z.enum(["github", "local"]),
    url: z.string().min(1).optional(),
    localPath: z.string().min(1).optional(),
    installedAt: z.string().min(1),
    skillNames: z.array(z.string().min(1)).default([]),
  })
  .passthrough();

export const SkillManagementConfigSchema = z
  .object({
    global: SkillPolicyGlobalConfigSchema.default({ disabledSkillNames: [] }),
    providers: z.record(z.string(), SkillPolicyProviderConfigSchema).default({}),
    agents: z.record(z.string(), SkillPolicyAgentConfigSchema).default({}),
    installedSources: z.record(z.string(), InstalledSkillSourceSchema).default({}),
  })
  .passthrough();

export const McpServerPolicyGlobalConfigSchema = z
  .object({
    disabledServerNames: z.array(z.string().min(1)).default([]),
  })
  .passthrough();

export const McpServerPolicyAgentConfigSchema = z
  .object({
    enabledServerNames: z.array(z.string().min(1)).default([]),
    disabledServerNames: z.array(z.string().min(1)).default([]),
  })
  .passthrough();

export const McpServerPolicyProviderConfigSchema = McpServerPolicyAgentConfigSchema;

export const ManagedMcpServerConfigSchema = z
  .object({
    name: z.string().min(1),
    label: z.string().min(1).optional(),
    description: z.string().optional(),
    config: McpServerConfigSchema,
    createdAt: z.string().min(1).optional(),
    updatedAt: z.string().min(1).optional(),
  })
  .passthrough();

export const McpServerManagementConfigSchema = z
  .object({
    servers: z.record(z.string(), ManagedMcpServerConfigSchema).default({}),
    global: McpServerPolicyGlobalConfigSchema.default({ disabledServerNames: [] }),
    providers: z.record(z.string(), McpServerPolicyProviderConfigSchema).default({}),
    agents: z.record(z.string(), McpServerPolicyAgentConfigSchema).default({}),
  })
  .passthrough();

export const AgentSkillManagementScopeSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("global"),
  }),
  z.object({
    type: z.literal("agent"),
    agentId: z.string().min(1),
  }),
  z.object({
    type: z.literal("provider"),
    provider: AgentProviderSchema,
  }),
]);

export const AgentSkillsListRequestSchema = z.object({
  type: z.literal("agent.skills.list.request"),
  requestId: z.string(),
});

export const AgentSkillsPolicyPatchRequestSchema = z.object({
  type: z.literal("agent.skills.policy.patch.request"),
  requestId: z.string(),
  scope: AgentSkillManagementScopeSchema,
  policy: z
    .object({
      disabledSkillNames: z.array(z.string().min(1)).optional(),
      enabledSkillNames: z.array(z.string().min(1)).optional(),
    })
    .passthrough(),
});

export const AgentSkillsInstallSourceSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("github"),
    value: z.string().min(1),
  }),
  z.object({
    type: z.literal("local"),
    path: z.string().min(1),
  }),
]);

export const AgentSkillsInstallRequestSchema = z.object({
  type: z.literal("agent.skills.install.request"),
  requestId: z.string(),
  source: AgentSkillsInstallSourceSchema,
  replace: z.boolean().optional().default(false),
});

export const AgentSkillsUninstallRequestSchema = z.object({
  type: z.literal("agent.skills.uninstall.request"),
  requestId: z.string(),
  sourceId: z.string().min(1),
});

export const AgentMcpServerManagementScopeSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("global"),
  }),
  z.object({
    type: z.literal("agent"),
    agentId: z.string().min(1),
  }),
  z.object({
    type: z.literal("provider"),
    provider: AgentProviderSchema,
  }),
]);

export const AgentMcpServersListRequestSchema = z.object({
  type: z.literal("agent.mcp_servers.list.request"),
  requestId: z.string(),
});

export const AgentMcpServersUpsertRequestSchema = z.object({
  type: z.literal("agent.mcp_servers.upsert.request"),
  requestId: z.string(),
  server: ManagedMcpServerConfigSchema,
  originalName: z.string().min(1).optional(),
});

export const AgentMcpServersPolicyPatchRequestSchema = z.object({
  type: z.literal("agent.mcp_servers.policy.patch.request"),
  requestId: z.string(),
  scope: AgentMcpServerManagementScopeSchema,
  policy: z
    .object({
      disabledServerNames: z.array(z.string().min(1)).optional(),
      enabledServerNames: z.array(z.string().min(1)).optional(),
    })
    .passthrough(),
});

export const AgentMcpServersDeleteRequestSchema = z.object({
  type: z.literal("agent.mcp_servers.delete.request"),
  requestId: z.string(),
  name: z.string().min(1),
});

export const AgentSkillSourcePayloadSchema = z
  .object({
    id: z.string(),
    type: z.enum(["project", "agents-home", "codex-home", "claude-home", "bundled", "unknown"]),
    path: z.string(),
    installedSourceId: z.string().optional(),
    removable: z.boolean().default(false),
  })
  .passthrough();

export const AgentSkillStatusSchema = z.enum([
  "enabled",
  "global-disabled",
  "agent-enabled",
  "agent-disabled",
]);

export const AgentSkillPayloadSchema = z
  .object({
    name: z.string(),
    description: z.string().optional(),
    sources: z.array(AgentSkillSourcePayloadSchema),
    statusByScope: z.object({
      global: AgentSkillStatusSchema,
      providers: z.record(z.string(), AgentSkillStatusSchema).default({}),
      agents: z.record(z.string(), AgentSkillStatusSchema).default({}),
    }),
    errors: z.array(z.string()).default([]),
  })
  .passthrough();

export const AgentSkillScopePayloadSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("global"),
    label: z.string(),
  }),
  z.object({
    type: z.literal("agent"),
    agentId: z.string(),
    label: z.string(),
    status: z.string().optional(),
  }),
  z.object({
    type: z.literal("provider"),
    provider: AgentProviderSchema,
    label: z.string(),
    status: z.string().optional(),
  }),
]);

export const AgentSkillsListResponseSchema = z.object({
  type: z.literal("agent.skills.list.response"),
  payload: z.object({
    requestId: z.string(),
    scopes: z.array(AgentSkillScopePayloadSchema),
    skills: z.array(AgentSkillPayloadSchema),
    policy: SkillManagementConfigSchema,
    errors: z.array(z.string()).default([]),
  }),
});

export const AgentSkillsPolicyPatchResponseSchema = z.object({
  type: z.literal("agent.skills.policy.patch.response"),
  payload: z.object({
    requestId: z.string(),
    ok: z.boolean(),
    policy: SkillManagementConfigSchema,
    error: z.string().nullable(),
  }),
});

export const AgentSkillsInstallResponseSchema = z.object({
  type: z.literal("agent.skills.install.response"),
  payload: z.object({
    requestId: z.string(),
    ok: z.boolean(),
    installedSource: InstalledSkillSourceSchema.nullable(),
    skills: z.array(z.string()).default([]),
    error: z.string().nullable(),
  }),
});

export const AgentSkillsUninstallResponseSchema = z.object({
  type: z.literal("agent.skills.uninstall.response"),
  payload: z.object({
    requestId: z.string(),
    ok: z.boolean(),
    removedSkillNames: z.array(z.string()).default([]),
    policy: SkillManagementConfigSchema,
    error: z.string().nullable(),
  }),
});

export const AgentMcpServerStatusSchema = z.enum([
  "enabled",
  "global-disabled",
  "provider-enabled",
  "provider-disabled",
  "agent-enabled",
  "agent-disabled",
]);

export const AgentMcpServerSourceSchema = z.enum(["system", "user"]);

export const AgentMcpServerScopePayloadSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("global"),
    label: z.string(),
    status: z.string().optional(),
  }),
  z.object({
    type: z.literal("agent"),
    agentId: z.string(),
    label: z.string(),
    provider: AgentProviderSchema.optional(),
    status: z.string().optional(),
  }),
  z.object({
    type: z.literal("provider"),
    provider: AgentProviderSchema,
    label: z.string(),
    status: z.string().optional(),
  }),
]);

export const AgentMcpServerPayloadSchema = z.object({
  name: z.string(),
  label: z.string().optional(),
  description: z.string().optional(),
  source: AgentMcpServerSourceSchema,
  removable: z.boolean(),
  editable: z.boolean(),
  config: McpServerConfigSchema,
  statusByScope: z.object({
    global: AgentMcpServerStatusSchema,
    providers: z.record(z.string(), AgentMcpServerStatusSchema).default({}),
    agents: z.record(z.string(), AgentMcpServerStatusSchema).default({}),
  }),
  errors: z.array(z.string()).default([]),
});

export const AgentMcpServersListResponseSchema = z.object({
  type: z.literal("agent.mcp_servers.list.response"),
  payload: z.object({
    requestId: z.string(),
    scopes: z.array(AgentMcpServerScopePayloadSchema),
    servers: z.array(AgentMcpServerPayloadSchema),
    policy: McpServerManagementConfigSchema,
    errors: z.array(z.string()).default([]),
  }),
});

export const AgentMcpServersUpsertResponseSchema = z.object({
  type: z.literal("agent.mcp_servers.upsert.response"),
  payload: z.object({
    requestId: z.string(),
    ok: z.boolean(),
    server: ManagedMcpServerConfigSchema.nullable(),
    policy: McpServerManagementConfigSchema,
    error: z.string().nullable(),
  }),
});

export const AgentMcpServersPolicyPatchResponseSchema = z.object({
  type: z.literal("agent.mcp_servers.policy.patch.response"),
  payload: z.object({
    requestId: z.string(),
    ok: z.boolean(),
    policy: McpServerManagementConfigSchema,
    error: z.string().nullable(),
  }),
});

export const AgentMcpServersDeleteResponseSchema = z.object({
  type: z.literal("agent.mcp_servers.delete.response"),
  payload: z.object({
    requestId: z.string(),
    ok: z.boolean(),
    removedServerName: z.string().nullable(),
    policy: McpServerManagementConfigSchema,
    error: z.string().nullable(),
  }),
});

export const AgentExtensionInboundMessageSchemas = [
  AgentSkillsListRequestSchema,
  AgentSkillsPolicyPatchRequestSchema,
  AgentSkillsInstallRequestSchema,
  AgentSkillsUninstallRequestSchema,
  AgentMcpServersListRequestSchema,
  AgentMcpServersUpsertRequestSchema,
  AgentMcpServersPolicyPatchRequestSchema,
  AgentMcpServersDeleteRequestSchema,
] as const;

export const AgentExtensionOutboundMessageSchemas = [
  AgentSkillsListResponseSchema,
  AgentSkillsPolicyPatchResponseSchema,
  AgentSkillsInstallResponseSchema,
  AgentSkillsUninstallResponseSchema,
  AgentMcpServersListResponseSchema,
  AgentMcpServersUpsertResponseSchema,
  AgentMcpServersPolicyPatchResponseSchema,
  AgentMcpServersDeleteResponseSchema,
] as const;

export type AgentSkillManagementScope = z.infer<typeof AgentSkillManagementScopeSchema>;
export type AgentSkillsListRequest = z.infer<typeof AgentSkillsListRequestSchema>;
export type AgentSkillsListResponse = z.infer<typeof AgentSkillsListResponseSchema>;
export type AgentSkillsPolicyPatchRequest = z.infer<typeof AgentSkillsPolicyPatchRequestSchema>;
export type AgentSkillsPolicyPatchResponse = z.infer<typeof AgentSkillsPolicyPatchResponseSchema>;
export type AgentSkillsInstallRequest = z.infer<typeof AgentSkillsInstallRequestSchema>;
export type AgentSkillsInstallResponse = z.infer<typeof AgentSkillsInstallResponseSchema>;
export type AgentSkillsUninstallRequest = z.infer<typeof AgentSkillsUninstallRequestSchema>;
export type AgentSkillsUninstallResponse = z.infer<typeof AgentSkillsUninstallResponseSchema>;
export type AgentSkillPayload = z.infer<typeof AgentSkillPayloadSchema>;
export type AgentSkillScopePayload = z.infer<typeof AgentSkillScopePayloadSchema>;
export type AgentSkillSourcePayload = z.infer<typeof AgentSkillSourcePayloadSchema>;
export type AgentSkillStatus = z.infer<typeof AgentSkillStatusSchema>;
export type InstalledSkillSource = z.infer<typeof InstalledSkillSourceSchema>;
export type SkillManagementConfig = z.infer<typeof SkillManagementConfigSchema>;
export type AgentMcpServerManagementScope = z.infer<typeof AgentMcpServerManagementScopeSchema>;
export type AgentMcpServersListRequest = z.infer<typeof AgentMcpServersListRequestSchema>;
export type AgentMcpServersListResponse = z.infer<typeof AgentMcpServersListResponseSchema>;
export type AgentMcpServersUpsertRequest = z.infer<typeof AgentMcpServersUpsertRequestSchema>;
export type AgentMcpServersUpsertResponse = z.infer<typeof AgentMcpServersUpsertResponseSchema>;
export type AgentMcpServersPolicyPatchRequest = z.infer<
  typeof AgentMcpServersPolicyPatchRequestSchema
>;
export type AgentMcpServersPolicyPatchResponse = z.infer<
  typeof AgentMcpServersPolicyPatchResponseSchema
>;
export type AgentMcpServersDeleteRequest = z.infer<typeof AgentMcpServersDeleteRequestSchema>;
export type AgentMcpServersDeleteResponse = z.infer<typeof AgentMcpServersDeleteResponseSchema>;
export type AgentMcpServerPayload = z.infer<typeof AgentMcpServerPayloadSchema>;
export type AgentMcpServerScopePayload = z.infer<typeof AgentMcpServerScopePayloadSchema>;
export type AgentMcpServerStatus = z.infer<typeof AgentMcpServerStatusSchema>;
export type ManagedMcpServerConfig = z.infer<typeof ManagedMcpServerConfigSchema>;
export type McpServerManagementConfig = z.infer<typeof McpServerManagementConfigSchema>;
