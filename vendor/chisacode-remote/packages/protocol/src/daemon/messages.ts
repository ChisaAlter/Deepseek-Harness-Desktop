import { z } from "zod/v3";

import {
  McpServerManagementConfigSchema,
  SkillManagementConfigSchema,
} from "../agent/extensions.js";
import {
  ChisaCodeConfigRawSchema,
  ChisaCodeConfigRevisionSchema,
  ProjectConfigRpcErrorSchema,
} from "../chisacode-config-schema.js";
import { ModelGatewayConfigSchema, ModelGatewayConfigsSchema } from "../provider-config.js";

const MutableDaemonProviderModelSchema = z
  .object({
    id: z.string().min(1),
    label: z.string().min(1),
    description: z.string().optional(),
    isDefault: z.boolean().optional(),
  })
  .passthrough();

const MutableDaemonProviderConfigSchema = z
  .object({
    enabled: z.boolean().optional(),
    additionalModels: z.array(MutableDaemonProviderModelSchema).optional(),
  })
  .passthrough();

const MutableStructuredGenerationProviderSchema = z
  .object({
    provider: z.string().min(1),
    model: z.string().min(1).optional(),
    thinkingOptionId: z.string().min(1).optional(),
  })
  .passthrough();

const MutableMetadataGenerationConfigSchema = z
  .object({
    providers: z.array(MutableStructuredGenerationProviderSchema).default([]),
  })
  .passthrough();

/** Global secondary vision model used when the primary model cannot see images. */
export const VisionFallbackModelSchema = z
  .object({
    provider: z.string().min(1),
    modelId: z.string().min(1),
  })
  .strict();

export const MutableDaemonConfigSchema = z
  .object({
    mcp: z
      .object({
        injectIntoAgents: z.boolean(),
      })
      .passthrough(),
    providers: z.record(z.string(), MutableDaemonProviderConfigSchema).default({}),
    modelGateways: ModelGatewayConfigsSchema.default({}),
    /**
     * When set, prompts that attach images while the main model has
     * `supportsImages !== true` are preprocessed: the vision model describes
     * each image and the descriptions are injected as text for the main model.
     */
    visionFallbackModel: VisionFallbackModelSchema.nullable().default(null),
    metadataGeneration: MutableMetadataGenerationConfigSchema.default({ providers: [] }),
    autoArchiveAfterMerge: z.boolean().default(false),
    appendSystemPrompt: z.string().default(""),
    skills: SkillManagementConfigSchema.default({
      global: { disabledSkillNames: [] },
      providers: {},
      agents: {},
      installedSources: {},
    }),
    mcpServers: McpServerManagementConfigSchema.default({
      servers: {},
      global: { disabledServerNames: [] },
      providers: {},
      agents: {},
    }),
  })
  .passthrough();

export const MutableDaemonConfigPatchSchema = z
  .object({
    mcp: MutableDaemonConfigSchema.shape.mcp.partial().optional(),
    providers: z
      .record(z.string(), MutableDaemonProviderConfigSchema.partial().passthrough())
      .optional(),
    modelGateways: z.record(z.string(), ModelGatewayConfigSchema.partial()).optional(),
    visionFallbackModel: VisionFallbackModelSchema.nullable().optional(),
    metadataGeneration: MutableMetadataGenerationConfigSchema.partial().optional(),
    autoArchiveAfterMerge: z.boolean().optional(),
    appendSystemPrompt: z.string().optional(),
    skills: SkillManagementConfigSchema.partial().optional(),
    mcpServers: McpServerManagementConfigSchema.partial().optional(),
  })
  .partial()
  .passthrough();

export const DaemonGetStatusRequestSchema = z.object({
  type: z.literal("daemon.get_status.request"),
  requestId: z.string(),
});

export const DaemonGetPairingOfferRequestSchema = z.object({
  type: z.literal("daemon.get_pairing_offer.request"),
  requestId: z.string(),
});

export const GetDaemonConfigRequestMessageSchema = z.object({
  type: z.literal("get_daemon_config_request"),
  requestId: z.string(),
});

export const SetDaemonConfigRequestMessageSchema = z.object({
  type: z.literal("set_daemon_config_request"),
  requestId: z.string(),
  config: MutableDaemonConfigPatchSchema,
});

export const ReadProjectConfigRequestMessageSchema = z.object({
  type: z.literal("read_project_config_request"),
  requestId: z.string(),
  repoRoot: z.string(),
});

export const WriteProjectConfigRequestMessageSchema = z.object({
  type: z.literal("write_project_config_request"),
  requestId: z.string(),
  repoRoot: z.string(),
  config: ChisaCodeConfigRawSchema,
  expectedRevision: ChisaCodeConfigRevisionSchema.nullable(),
});

export const RestartServerRequestMessageSchema = z.object({
  type: z.literal("restart_server_request"),
  reason: z.string().optional(),
  requestId: z.string(),
});

export const ShutdownServerRequestMessageSchema = z.object({
  type: z.literal("shutdown_server_request"),
  requestId: z.string(),
});

export const RestartRequestedStatusPayloadSchema = z.object({
  status: z.literal("restart_requested"),
  clientId: z.string(),
  reason: z.string().optional(),
  requestId: z.string(),
});

export const ShutdownRequestedStatusPayloadSchema = z.object({
  status: z.literal("shutdown_requested"),
  clientId: z.string(),
  requestId: z.string(),
});

export const DaemonConfigChangedStatusPayloadSchema = z
  .object({
    status: z.literal("daemon_config_changed"),
    config: MutableDaemonConfigSchema,
  })
  .passthrough();

export const GetDaemonConfigResponseMessageSchema = z.object({
  type: z.literal("get_daemon_config_response"),
  payload: z
    .object({
      requestId: z.string(),
      config: MutableDaemonConfigSchema,
    })
    .passthrough(),
});

export const DaemonGetStatusResponseSchema = z.object({
  type: z.literal("daemon.get_status.response"),
  payload: z
    .object({
      requestId: z.string(),
      serverId: z.string(),
      version: z.string().nullable().optional(),
      pid: z.number(),
      nodePath: z.string(),
      startedAt: z.string().nullable().optional(),
      listen: z.string().nullable(),
      relay: z
        .object({
          enabled: z.boolean(),
          endpoint: z.string(),
          publicEndpoint: z.string(),
          useTls: z.boolean(),
          publicUseTls: z.boolean(),
        })
        .nullable()
        .optional(),
      providers: z.array(
        z.object({
          provider: z.string(),
          available: z.boolean(),
          error: z.string().nullable().optional(),
        }),
      ),
    })
    .passthrough(),
});

export const DaemonGetPairingOfferResponseSchema = z.object({
  type: z.literal("daemon.get_pairing_offer.response"),
  payload: z
    .object({
      requestId: z.string(),
      url: z.string(),
      qr: z.string().nullable().optional(),
      relayEnabled: z.boolean(),
    })
    .passthrough(),
});

export const SetDaemonConfigResponseMessageSchema = z.object({
  type: z.literal("set_daemon_config_response"),
  payload: z
    .object({
      requestId: z.string(),
      config: MutableDaemonConfigSchema,
    })
    .passthrough(),
});

export const ReadProjectConfigResponseMessageSchema = z.object({
  type: z.literal("read_project_config_response"),
  payload: z.discriminatedUnion("ok", [
    z.object({
      requestId: z.string(),
      repoRoot: z.string(),
      ok: z.literal(true),
      config: ChisaCodeConfigRawSchema.nullable(),
      revision: ChisaCodeConfigRevisionSchema.nullable(),
    }),
    z.object({
      requestId: z.string(),
      repoRoot: z.string(),
      ok: z.literal(false),
      error: ProjectConfigRpcErrorSchema,
    }),
  ]),
});

export const WriteProjectConfigResponseMessageSchema = z.object({
  type: z.literal("write_project_config_response"),
  payload: z.discriminatedUnion("ok", [
    z.object({
      requestId: z.string(),
      repoRoot: z.string(),
      ok: z.literal(true),
      config: ChisaCodeConfigRawSchema,
      revision: ChisaCodeConfigRevisionSchema,
    }),
    z.object({
      requestId: z.string(),
      repoRoot: z.string(),
      ok: z.literal(false),
      error: ProjectConfigRpcErrorSchema,
    }),
  ]),
});

export const DaemonInboundMessageSchemas = [
  DaemonGetStatusRequestSchema,
  DaemonGetPairingOfferRequestSchema,
  GetDaemonConfigRequestMessageSchema,
  SetDaemonConfigRequestMessageSchema,
  ReadProjectConfigRequestMessageSchema,
  WriteProjectConfigRequestMessageSchema,
  RestartServerRequestMessageSchema,
  ShutdownServerRequestMessageSchema,
] as const;

type DaemonOutboundMessageSchemaTuple = readonly [
  typeof DaemonGetStatusResponseSchema,
  typeof DaemonGetPairingOfferResponseSchema,
  typeof GetDaemonConfigResponseMessageSchema,
  typeof SetDaemonConfigResponseMessageSchema,
  typeof ReadProjectConfigResponseMessageSchema,
  typeof WriteProjectConfigResponseMessageSchema,
];

export const DaemonOutboundMessageSchemas: DaemonOutboundMessageSchemaTuple = [
  DaemonGetStatusResponseSchema,
  DaemonGetPairingOfferResponseSchema,
  GetDaemonConfigResponseMessageSchema,
  SetDaemonConfigResponseMessageSchema,
  ReadProjectConfigResponseMessageSchema,
  WriteProjectConfigResponseMessageSchema,
] as const;

export const DaemonStatusPayloadSchemas = [
  ShutdownRequestedStatusPayloadSchema,
  RestartRequestedStatusPayloadSchema,
  DaemonConfigChangedStatusPayloadSchema,
] as const;

export type MutableDaemonConfig = z.infer<typeof MutableDaemonConfigSchema>;
export type MutableDaemonConfigPatch = z.infer<typeof MutableDaemonConfigPatchSchema>;
export type VisionFallbackModel = z.infer<typeof VisionFallbackModelSchema>;
export type DaemonGetStatusRequest = z.infer<typeof DaemonGetStatusRequestSchema>;
export type DaemonGetPairingOfferRequest = z.infer<typeof DaemonGetPairingOfferRequestSchema>;
export type GetDaemonConfigRequestMessage = z.infer<typeof GetDaemonConfigRequestMessageSchema>;
export type SetDaemonConfigRequestMessage = z.infer<typeof SetDaemonConfigRequestMessageSchema>;
export type ReadProjectConfigRequestMessage = z.infer<typeof ReadProjectConfigRequestMessageSchema>;
export type WriteProjectConfigRequestMessage = z.infer<
  typeof WriteProjectConfigRequestMessageSchema
>;
export type RestartServerRequestMessage = z.infer<typeof RestartServerRequestMessageSchema>;
export type ShutdownServerRequestMessage = z.infer<typeof ShutdownServerRequestMessageSchema>;
export type RestartRequestedStatusPayload = z.infer<typeof RestartRequestedStatusPayloadSchema>;
export type ShutdownRequestedStatusPayload = z.infer<typeof ShutdownRequestedStatusPayloadSchema>;
export type DaemonConfigChangedStatusPayload = z.infer<
  typeof DaemonConfigChangedStatusPayloadSchema
>;
export type GetDaemonConfigResponseMessage = z.infer<typeof GetDaemonConfigResponseMessageSchema>;
export type DaemonGetStatusResponse = z.infer<typeof DaemonGetStatusResponseSchema>;
export type DaemonGetPairingOfferResponse = z.infer<typeof DaemonGetPairingOfferResponseSchema>;
export type SetDaemonConfigResponseMessage = z.infer<typeof SetDaemonConfigResponseMessageSchema>;
export type ReadProjectConfigResponseMessage = z.infer<
  typeof ReadProjectConfigResponseMessageSchema
>;
export type WriteProjectConfigResponseMessage = z.infer<
  typeof WriteProjectConfigResponseMessageSchema
>;
