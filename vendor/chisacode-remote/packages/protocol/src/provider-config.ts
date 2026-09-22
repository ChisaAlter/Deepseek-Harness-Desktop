import { z } from "zod/v3";
import type { AgentProvider } from "./agent-types.js";
import {
  AGENT_PROVIDER_DEFINITIONS,
  AgentProviderSchema,
  DEV_AGENT_PROVIDER_DEFINITIONS,
} from "./provider-manifest.js";

const ProviderCommandDefaultSchema = z
  .object({
    mode: z.literal("default"),
  })
  .strict();

const ProviderCommandAppendSchema = z
  .object({
    mode: z.literal("append"),
    args: z.array(z.string()).optional(),
  })
  .strict();

const ProviderCommandReplaceSchema = z
  .object({
    mode: z.literal("replace"),
    argv: z.array(z.string().min(1)).min(1),
  })
  .strict();

export const ProviderCommandSchema = z.discriminatedUnion("mode", [
  ProviderCommandDefaultSchema,
  ProviderCommandAppendSchema,
  ProviderCommandReplaceSchema,
]);

export const ProviderRuntimeSettingsSchema = z
  .object({
    command: ProviderCommandSchema.optional(),
    env: z.record(z.string()).optional(),
    disallowedTools: z.array(z.string()).optional(),
  })
  .strict();

const ProviderProfileThinkingOptionSchema = z
  .object({
    id: z.string(),
    label: z.string(),
    description: z.string().optional(),
    isDefault: z.boolean().optional(),
  })
  .strict();

export const ProviderProfileModelSchema = z
  .object({
    id: z.string().min(1),
    label: z.string().min(1),
    description: z.string().optional(),
    isDefault: z.boolean().optional(),
    contextWindowMaxTokens: z.number().int().positive().optional(),
    supportsImages: z.boolean().optional(),
    supportsTools: z.boolean().optional(),
    thinkingOptions: z.array(ProviderProfileThinkingOptionSchema).optional(),
  })
  .strict();

export const ProviderSSHConfigSchema = z
  .object({
    host: z.string().min(1),
    user: z.string().optional(),
    port: z.number().int().positive().optional(),
    identityFile: z.string().optional(),
    sshOptions: z.array(z.string()).optional(),
  })
  .strict();

export const ProviderOverrideSchema = z
  .object({
    extends: z.string().optional(),
    label: z.string().optional(),
    description: z.string().optional(),
    command: z.array(z.string().min(1)).min(1).optional(),
    env: z.record(z.string()).optional(),
    models: z.array(ProviderProfileModelSchema).optional(),
    additionalModels: z.array(ProviderProfileModelSchema).optional(),
    disallowedTools: z.array(z.string()).optional(),
    enabled: z.boolean().optional(),
    order: z.number().optional(),
    ssh: ProviderSSHConfigSchema.optional(),
  })
  .strict();

export const ModelGatewayUpstreamSchema = z
  .object({
    enabled: z.boolean().default(false),
    baseUrl: z.string().default(""),
    apiKey: z.string().default(""),
  })
  .strict();

export const SyntheticModelReferenceSchema = z
  .object({
    model: z.string().min(1),
  })
  .strict();

export const SyntheticModelParametersSchema = z
  .object({
    temperature: z.number().min(0).max(2).optional(),
    maxTokens: z.number().int().positive().optional(),
    systemPrompt: z.string().optional(),
  })
  .strict();

export const SyntheticModelNodeSchema = z
  .object({
    id: z.string().min(1).optional(),
    model: z.string().min(1),
    label: z.string().optional(),
    parameters: SyntheticModelParametersSchema.optional(),
  })
  .strict();

export const SyntheticModelLayerSchema = z
  .object({
    id: z.string().min(1),
    label: z.string().optional(),
    nodes: z.array(SyntheticModelNodeSchema),
    parameters: SyntheticModelParametersSchema.optional(),
  })
  .strict();

export const SyntheticModelAggregatorSchema = z
  .object({
    model: z.string().min(1),
    parameters: SyntheticModelParametersSchema.optional(),
  })
  .strict();

export const SyntheticModelMoaSchema = z
  .object({
    defaults: SyntheticModelParametersSchema.optional(),
    layers: z.array(SyntheticModelLayerSchema).min(1),
    aggregator: SyntheticModelAggregatorSchema,
  })
  .strict();

export const SyntheticModelConfigSchema = z
  .object({
    id: z.string().min(1),
    label: z.string().min(1),
    description: z.string().optional(),
    references: z.array(SyntheticModelReferenceSchema).min(1),
    aggregatorModel: z.string().min(1),
    rounds: z.number().int().positive().max(4).default(1),
    moa: SyntheticModelMoaSchema.optional(),
  })
  .strict();

/**
 * Primary protocol face for a model gateway.
 * - claude: Anthropic Messages → only `{id}-claude`
 * - codex: OpenAI Responses → only `{id}-codex`
 * - openai: Chat Completions → OpenAI-family agents (opencode/pi/kimi/grokbuild/dsh)
 * - all: materialize every agent face (legacy / multi-upstream)
 */
export const ModelGatewayProtocolPresetSchema = z.enum(["claude", "codex", "openai", "all"]);

/**
 * Which agent faces a gateway supplies models to.
 * - all: materialize every agent face (gateway format conversion bridges the rest)
 * - matched: narrow faces to the protocols covered by `protocolPreset`
 *
 * Closed-set semantics (single source of truth lives in
 * `resolveGatewayAgentFaces` on the server):
 * - `supplyScope === "all"` → all 7 faces, regardless of preset/attachToAllAgents
 * - `supplyScope === "matched"` → narrowed by protocolPreset
 *   (claude → 1, codex → 1, openai → 5, all → 7); without a preset, falls back
 *   to legacy upstream inference
 * - `supplyScope` omitted → legacy behavior: `attachToAllAgents === true` or
 *   `protocolPreset === "all"` → all 7 faces; preset narrows; no preset infers
 *   from enabled upstreams
 * - When both `supplyScope` and `attachToAllAgents` are present, `supplyScope`
 *   wins.
 */
export const ModelGatewaySupplyScopeSchema = z.enum(["all", "matched"]);

export const ModelGatewayConfigSchema = z
  .object({
    id: z.string().min(1),
    label: z.string().min(1),
    models: z.array(ProviderProfileModelSchema).default([]),
    syntheticModels: z.array(SyntheticModelConfigSchema).default([]),
    enabled: z.boolean().default(true),
    /**
     * Preferred agent attachment / upstream preset. Optional for backward
     * compatibility; when omitted the registry infers from enabled upstreams.
     */
    protocolPreset: ModelGatewayProtocolPresetSchema.optional(),
    /**
     * Explicit supply scope for this gateway. Optional for backward
     * compatibility; when omitted the registry derives the scope from
     * `attachToAllAgents` / `protocolPreset` / enabled upstreams.
     */
    supplyScope: ModelGatewaySupplyScopeSchema.optional(),
    /**
     * When true, generate every agent face even if protocolPreset is a single
     * protocol (gateway format conversion bridges the rest).
     * @deprecated Prefer `supplyScope: "all"`; kept for backward compatibility
     * with configs written by older clients. When both are present, supplyScope
     * takes precedence.
     */
    attachToAllAgents: z.boolean().optional(),
    upstreams: z
      .object({
        anthropic: ModelGatewayUpstreamSchema.default({}),
        chatCompletions: ModelGatewayUpstreamSchema.default({}),
        responses: ModelGatewayUpstreamSchema.default({}),
      })
      .strict(),
    generatedProviderIds: z
      .object({
        claude: z.string().min(1),
        codex: z.string().min(1),
        opencode: z.string().min(1),
        pi: z.string().min(1).optional(),
        kimi: z.string().min(1).optional(),
        grokbuild: z.string().min(1).optional(),
        dsh: z.string().min(1).optional(),
      })
      .strict()
      .optional(),
    generatedModels: z
      .object({
        opencode: z.array(ProviderProfileModelSchema).optional(),
        pi: z.array(ProviderProfileModelSchema).optional(),
        kimi: z.array(ProviderProfileModelSchema).optional(),
        grokbuild: z.array(ProviderProfileModelSchema).optional(),
        dsh: z.array(ProviderProfileModelSchema).optional(),
      })
      .strict()
      .optional(),
  })
  .strict();

const MODEL_GATEWAY_ID_PATTERN = /^[a-z][a-z0-9-]*$/;

export const ModelGatewayConfigsSchema = z
  .record(ModelGatewayConfigSchema)
  .superRefine((gateways, ctx) => {
    for (const [gatewayId, gateway] of Object.entries(gateways)) {
      if (!MODEL_GATEWAY_ID_PATTERN.test(gatewayId)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [gatewayId],
          message: `Model gateway ID "${gatewayId}" must match ${MODEL_GATEWAY_ID_PATTERN}.`,
        });
      }
      if (gateway.id !== gatewayId) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [gatewayId, "id"],
          message: `Model gateway "${gatewayId}" must repeat the same id in its config.`,
        });
      }

      const hasEnabledUpstream = Object.values(gateway.upstreams).some(
        (upstream) => upstream.enabled === true,
      );
      if (gateway.enabled !== false && !hasEnabledUpstream) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [gatewayId, "upstreams"],
          message: `Model gateway "${gatewayId}" must enable at least one upstream.`,
        });
      }
    }
  });

const BUILTIN_PROVIDER_IDS = [
  ...AGENT_PROVIDER_DEFINITIONS.map((definition) => definition.id),
  ...DEV_AGENT_PROVIDER_DEFINITIONS.map((definition) => definition.id),
];
const PROVIDER_ID_PATTERN = /^[a-z][a-z0-9-]*$/;

export const ProviderOverridesSchema = z
  .record(ProviderOverrideSchema)
  .superRefine((providers, ctx) => {
    const builtinProviderIdSet = new Set<string>(BUILTIN_PROVIDER_IDS);
    const validExtendsValues = new Set<string>([...BUILTIN_PROVIDER_IDS, "acp"]);

    for (const [providerId, provider] of Object.entries(providers)) {
      if (!PROVIDER_ID_PATTERN.test(providerId)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [providerId],
          message: `Provider ID "${providerId}" must match ${PROVIDER_ID_PATTERN}.`,
        });
      }

      const isBuiltinProvider = builtinProviderIdSet.has(providerId);
      if (!isBuiltinProvider && !provider.extends) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [providerId, "extends"],
          message: `Custom provider "${providerId}" must declare extends.`,
        });
      }

      if (!isBuiltinProvider && !provider.label) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [providerId, "label"],
          message: `Custom provider "${providerId}" must declare label.`,
        });
      }

      if (provider.extends && !validExtendsValues.has(provider.extends)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [providerId, "extends"],
          message: `Provider "${providerId}" extends unknown provider "${provider.extends}".`,
        });
      }

      if (provider.extends === "acp" && (!provider.command || provider.command.length === 0)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [providerId, "command"],
          message: `ACP provider "${providerId}" must declare command.`,
        });
      }
    }
  });

export const AgentProviderRuntimeSettingsMapSchema = z
  .record(ProviderRuntimeSettingsSchema)
  .superRefine((providers, ctx) => {
    for (const providerId of Object.keys(providers)) {
      const parsedProviderId = AgentProviderSchema.safeParse(providerId);
      if (!parsedProviderId.success) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [providerId],
          message: `Invalid agent provider "${providerId}".`,
        });
      }
    }
  });

export type ProviderCommand = z.infer<typeof ProviderCommandSchema>;
export type ProviderRuntimeSettings = z.infer<typeof ProviderRuntimeSettingsSchema>;
export type ProviderProfileModel = z.infer<typeof ProviderProfileModelSchema>;
export type ProviderOverride = z.infer<typeof ProviderOverrideSchema>;
export type ProviderOverrides = z.infer<typeof ProviderOverridesSchema>;
export type ModelGatewayUpstream = z.infer<typeof ModelGatewayUpstreamSchema>;
export type SyntheticModelParameters = z.infer<typeof SyntheticModelParametersSchema>;
export type SyntheticModelNode = z.infer<typeof SyntheticModelNodeSchema>;
export type SyntheticModelLayer = z.infer<typeof SyntheticModelLayerSchema>;
export type SyntheticModelMoa = z.infer<typeof SyntheticModelMoaSchema>;
export type SyntheticModelConfig = z.infer<typeof SyntheticModelConfigSchema>;
export type ModelGatewayProtocolPreset = z.infer<typeof ModelGatewayProtocolPresetSchema>;
export type ModelGatewaySupplyScope = z.infer<typeof ModelGatewaySupplyScopeSchema>;
export type ModelGatewayConfig = z.infer<typeof ModelGatewayConfigSchema>;
export type ModelGatewayConfigs = z.infer<typeof ModelGatewayConfigsSchema>;
export type AgentProviderRuntimeSettingsMap = Partial<
  Record<AgentProvider, ProviderRuntimeSettings>
>;
