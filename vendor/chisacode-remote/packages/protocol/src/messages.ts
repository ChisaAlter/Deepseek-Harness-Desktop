import { z } from "zod/v3";
import { CLIENT_CAPS } from "./client-capabilities.js";
import { SyntheticModelConfigSchema } from "@chisacode/protocol/provider-config";
import {
  AutomationInboundMessageSchemas,
  AutomationOutboundMessageSchemas,
} from "./automation/messages.js";
import {
  GenerativeUiActionRequestSchema,
  GenerativeUiActionResponseSchema,
  LegacyGenerativeUiActionRequestSchema,
} from "@chisacode/protocol/generative-ui/rpc-schemas";
import {
  TerminalInboundMessageSchemas,
  TerminalOutboundMessageSchemas,
} from "./terminal/messages.js";
import {
  CheckoutInboundMessageSchemas,
  CheckoutOutboundMessageSchemas,
} from "./checkout/messages.js";
import {
  WorkspaceInboundMessageSchemas,
  WorkspaceOutboundMessageSchemas,
} from "./workspace/messages.js";
import {
  ProviderInboundMessageSchemas,
  ProviderOutboundMessageSchemas,
} from "./provider/messages.js";
import {
  AgentExtensionInboundMessageSchemas,
  AgentExtensionOutboundMessageSchemas,
} from "./agent/extensions.js";
import {
  DaemonInboundMessageSchemas,
  DaemonOutboundMessageSchemas,
  DaemonStatusPayloadSchemas,
} from "./daemon/messages.js";
import { UsageInboundMessageSchemas, UsageOutboundMessageSchemas } from "./usage/messages.js";
import { CindyInboundMessageSchemas, CindyOutboundMessageSchemas } from "./cindy/messages.js";
import {
  ServerVoiceCapabilitiesSchema,
  VoiceInboundMessageSchemas,
  VoiceOutboundMessageSchemas,
} from "./voice/messages.js";
import {
  AgentInboundMessageSchemas,
  AgentOutboundMessageSchemas,
  AgentStatusPayloadSchemas,
} from "./agent/messages.js";
import {
  DshdInboundMessageSchemas,
  DshdOutboundMessageSchemas,
} from "./dshd-desktop-rpc.js";
export * from "./agent/attachments.js";
export * from "./automation/messages.js";
export * from "./agent/extensions.js";
export * from "./agent/messages.js";
export * from "./agent/state.js";
export * from "./daemon/messages.js";
export * from "./provider/messages.js";
export * from "./terminal/messages.js";
export * from "./usage/messages.js";
export * from "./voice/messages.js";
export * from "./checkout/messages.js";
export * from "./workspace/messages.js";
export * from "./cindy/messages.js";
import {
  ChisaCodeConfigRawSchema,
  ChisaCodeLifecycleCommandRawSchema,
  ChisaCodeMetadataGenerationEntrySchema,
  ChisaCodeMetadataGenerationSchema,
  ChisaCodeScriptEntryRawSchema,
  ChisaCodeWorktreeConfigRawSchema,
  type ChisaCodeConfigRaw,
  type ChisaCodeConfigRevision,
  type ChisaCodeMetadataGeneration,
  type ChisaCodeMetadataGenerationEntry,
  type ChisaCodeScriptEntryRaw,
  type ProjectConfigRpcError,
} from "@chisacode/protocol/chisacode-config-schema";
export {
  ChisaCodeConfigRawSchema,
  ChisaCodeLifecycleCommandRawSchema,
  ChisaCodeMetadataGenerationEntrySchema,
  ChisaCodeMetadataGenerationSchema,
  ChisaCodeScriptEntryRawSchema,
  ChisaCodeWorktreeConfigRawSchema,
  type ChisaCodeConfigRaw,
  type ChisaCodeConfigRevision,
  type ChisaCodeMetadataGeneration,
  type ChisaCodeMetadataGenerationEntry,
  type ChisaCodeScriptEntryRaw,
  type ProjectConfigRpcError,
};
// ============================================================================
// Session Inbound Messages (Session receives these)
// ============================================================================

export const AbortRequestMessageSchema = z.object({
  type: z.literal("abort_request"),
});

export const CloseItemsRequestMessageSchema = z.object({
  type: z.literal("close_items_request"),
  agentIds: z.array(z.string()).default([]),
  terminalIds: z.array(z.string()).default([]),
  requestId: z.string(),
});

export const ProjectRenameRequestSchema = z.object({
  type: z.literal("project.rename.request"),
  projectId: z.string(),
  // Null or empty string clears the override and reverts to the derived name.
  customName: z.string().nullable(),
  requestId: z.string(),
});

export const ModelGatewayMoaTestRequestMessageSchema = z.object({
  type: z.literal("model_gateway.moa.test.request"),
  requestId: z.string(),
  gatewayId: z.string().min(1),
  syntheticModel: SyntheticModelConfigSchema,
  prompt: z.string().min(1),
});

export const ModelGatewayTestRequestMessageSchema = z.object({
  type: z.literal("model_gateway.test.request"),
  requestId: z.string(),
  gatewayId: z.string().min(1),
  modelId: z.string().min(1),
  // Optional format hint lets saved multi-protocol rows test their intended upstream.
  targetFormat: z.enum(["anthropic", "chatCompletions", "responses"]).optional(),
});

export const ProjectRenameResponsePayloadSchema = z.object({
  requestId: z.string(),
  projectId: z.string(),
  accepted: z.boolean(),
  customName: z.string().nullable(),
  error: z.string().nullable(),
});

export const ProjectRenameResponseSchema = z.object({
  type: z.literal("project.rename.response"),
  payload: ProjectRenameResponsePayloadSchema,
});

export const ClientHeartbeatMessageSchema = z.object({
  type: z.literal("client_heartbeat"),
  deviceType: z.enum(["web", "mobile"]),
  focusedAgentId: z.string().nullable(),
  lastActivityAt: z.string(),
  appVisible: z.boolean(),
  appVisibilityChangedAt: z.string().optional(),
});

export const PingMessageSchema = z.object({
  type: z.literal("ping"),
  requestId: z.string(),
  clientSentAt: z.number().int().optional(),
});

export const RegisterPushTokenMessageSchema = z.object({
  type: z.literal("register_push_token"),
  token: z.string(),
});

export const SessionInboundMessageSchema = z.discriminatedUnion("type", [
  ...VoiceInboundMessageSchemas,
  AbortRequestMessageSchema,
  ...AgentInboundMessageSchemas,
  ...UsageInboundMessageSchemas,
  CloseItemsRequestMessageSchema,
  ProjectRenameRequestSchema,
  ...DaemonInboundMessageSchemas,
  ...AgentExtensionInboundMessageSchemas,
  ModelGatewayMoaTestRequestMessageSchema,
  ModelGatewayTestRequestMessageSchema,
  ...CheckoutInboundMessageSchemas,
  ...WorkspaceInboundMessageSchemas,
  ...ProviderInboundMessageSchemas,
  ClientHeartbeatMessageSchema,
  PingMessageSchema,
  RegisterPushTokenMessageSchema,
  ...TerminalInboundMessageSchemas,
  ...AutomationInboundMessageSchemas,
  ...CindyInboundMessageSchemas,
  GenerativeUiActionRequestSchema,
  // COMPAT(generativeUiActionFlatRpc): added in v0.1.101; remove after 2027-01-11 once the client floor is >= v0.1.101.
  LegacyGenerativeUiActionRequestSchema,
  ...DshdInboundMessageSchemas,
]);

export type SessionInboundMessage = z.infer<typeof SessionInboundMessageSchema>;

// ============================================================================
// Session Outbound Messages (Session emits these)
// ============================================================================

export const ActivityLogPayloadSchema = z.object({
  id: z.string(),
  timestamp: z.coerce.date(),
  type: z.enum(["transcript", "assistant", "tool_call", "tool_result", "error", "system"]),
  content: z.string(),
  metadata: z.record(z.unknown()).optional(),
});

export const ActivityLogMessageSchema = z.object({
  type: z.literal("activity_log"),
  payload: ActivityLogPayloadSchema,
});

export const AssistantChunkMessageSchema = z.object({
  type: z.literal("assistant_chunk"),
  payload: z.object({
    chunk: z.string(),
  }),
});

export const ServerCapabilitiesSchema = z
  .object({
    voice: ServerVoiceCapabilitiesSchema.optional(),
  })
  .passthrough();

const ServerInfoHostnameSchema = z.unknown().transform((value): string | null => {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
});

const ServerInfoVersionSchema = z.unknown().transform((value): string | null => {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
});

const ServerCapabilitiesFromUnknownSchema = z
  .unknown()
  .optional()
  .transform((value): z.infer<typeof ServerCapabilitiesSchema> | undefined => {
    if (value === undefined) {
      return undefined;
    }
    const parsed = ServerCapabilitiesSchema.safeParse(value);
    if (!parsed.success) {
      return undefined;
    }
    return parsed.data;
  });

const SourceCodeOfferSchema = z.object({
  license: z.literal("AGPL-3.0-or-later"),
  repositoryUrl: z.string().url(),
  noticePath: z.string().min(1),
  originalProjectUrl: z.string().url(),
  offerPath: z.string().min(1),
  correspondingSourceRequired: z.boolean(),
});

export const ServerInfoStatusPayloadSchema = z
  .object({
    status: z.literal("server_info"),
    serverId: z.string().trim().min(1),
    hostname: ServerInfoHostnameSchema.optional(),
    version: ServerInfoVersionSchema.optional(),
    sourceCode: SourceCodeOfferSchema.optional(),
    capabilities: ServerCapabilitiesFromUnknownSchema,
    // COMPAT(providersSnapshot): added in v0.1.48, remove gating when all clients use snapshot
    features: z
      .object({
        providersSnapshot: z.boolean().optional(),
        checkoutGithubSetAutoMerge: z.boolean().optional(),
        // COMPAT(daemonStatusRpc): added in v0.1.76, remove gate after 2026-11-18.
        daemonStatusRpc: z.boolean().optional(),
        // COMPAT(terminalRestoreModes): added in v0.1.81, remove gate after 2026-11-23.
        "terminal-restore-modes": z.boolean().optional(),
        // COMPAT(rewind): added in v0.1.X, drop the gate when floor >= v0.1.X.
        rewind: z.boolean().optional(),
        // COMPAT(checkoutRefresh): added in v0.1.86, remove gate after 2026-11-29.
        checkoutRefresh: z.boolean().optional(),
        // COMPAT(agentSkillManagement): added in v0.1.X, remove gate when all clients support it.
        agentSkillManagement: z.boolean().optional(),
        // COMPAT(agentMcpServerManagement): added in v0.1.X, remove gate when all clients support it.
        agentMcpServerManagement: z.boolean().optional(),
        // COMPAT(providerUsageList): added in v0.1.98, drop the gate when daemon floor >= v0.1.98.
        providerUsageList: z.boolean().optional(),
        // COMPAT(daemonDiagnostics): added in v0.1.100, remove gate after 2026-12-25 once daemon floor >= v0.1.100.
        daemonDiagnostics: z.boolean().optional(),
        // COMPAT(generativeUiWireCapability): added in v0.1.101; remove the gate no earlier than 2027-01-11 when client/daemon floor >= v0.1.101.
        generativeUi: z.boolean().optional(),
        // COMPAT(cindyModules): added in v0.1.102, remove no earlier than 2027-07-29 when client/daemon floor >= v0.1.102.
        cindyModules: z.boolean().optional(),
        // COMPAT(modelGatewaySupplyScope): added in v0.1.103; remove the gate when daemon floor >= the version that persists supplyScope.
        modelGatewaySupplyScope: z.boolean().optional(),
      })
      .optional(),
  })
  .passthrough()
  .transform((payload) => ({
    ...payload,
    hostname: payload.hostname ?? null,
    version: payload.version ?? null,
  }));

export const StatusMessageSchema = z.object({
  type: z.literal("status"),
  payload: z
    .object({
      status: z.string(),
    })
    .passthrough(), // Allow additional fields
});

export const PongMessageSchema = z.object({
  type: z.literal("pong"),
  payload: z.object({
    requestId: z.string(),
    clientSentAt: z.number().int().optional(),
    serverReceivedAt: z.number().int(),
    serverSentAt: z.number().int(),
  }),
});

export const RpcErrorMessageSchema = z.object({
  type: z.literal("rpc_error"),
  payload: z.object({
    requestId: z.string(),
    requestType: z.string().optional(),
    error: z.string(),
    code: z.string().optional(),
  }),
});

export const KnownStatusPayloadSchema = z.discriminatedUnion("status", [
  ...AgentStatusPayloadSchemas,
  ...DaemonStatusPayloadSchemas,
]);

export type KnownStatusPayload = z.infer<typeof KnownStatusPayloadSchema>;

export const ArtifactMessageSchema = z.object({
  type: z.literal("artifact"),
  payload: z.object({
    type: z.enum(["markdown", "diff", "image", "code"]),
    id: z.string(),
    title: z.string(),
    content: z.string(),
    isBase64: z.boolean(),
  }),
});

const CloseItemsAgentResultSchema = z.object({
  agentId: z.string(),
  archivedAt: z.string(),
});

const CloseItemsTerminalResultSchema = z.object({
  terminalId: z.string(),
  success: z.boolean(),
});

export const CloseItemsResponseSchema = z.object({
  type: z.literal("close_items_response"),
  payload: z.object({
    agents: z.array(CloseItemsAgentResultSchema),
    terminals: z.array(CloseItemsTerminalResultSchema),
    requestId: z.string(),
  }),
});

const ModelGatewayMoaNodeTraceSchema = z.object({
  id: z.string().nullable(),
  model: z.string(),
  status: z.enum(["success", "error"]),
  output: z.string().nullable(),
  error: z.string().nullable(),
  durationMs: z.number(),
});

const ModelGatewayMoaLayerTraceSchema = z.object({
  id: z.string(),
  label: z.string().nullable(),
  nodes: z.array(ModelGatewayMoaNodeTraceSchema),
});

const ModelGatewayMoaAggregatorTraceSchema = z.object({
  model: z.string(),
  status: z.enum(["success", "error"]),
  output: z.string().nullable(),
  error: z.string().nullable(),
  durationMs: z.number(),
});

const ModelGatewayMoaTestResultSchema = z.object({
  finalText: z.string(),
  durationMs: z.number(),
  layers: z.array(ModelGatewayMoaLayerTraceSchema),
  aggregator: ModelGatewayMoaAggregatorTraceSchema,
});

const ModelGatewayTestResultSchema = z.object({
  ok: z.boolean(),
  durationMs: z.number().nonnegative(),
  status: z.number().int().nullable(),
  error: z.string().nullable(),
});

export const ModelGatewayTestResponseMessageSchema = z.object({
  type: z.literal("model_gateway.test.response"),
  payload: z.object({
    requestId: z.string(),
    gatewayId: z.string(),
    modelId: z.string(),
    result: ModelGatewayTestResultSchema.nullable(),
    error: z.string().nullable(),
  }),
});

export const ModelGatewayMoaTestResponseMessageSchema = z.object({
  type: z.literal("model_gateway.moa.test.response"),
  payload: z.object({
    requestId: z.string(),
    gatewayId: z.string(),
    result: ModelGatewayMoaTestResultSchema.nullable(),
    error: z.string().nullable(),
  }),
});

type SessionOutboundMessageSchemaOptions = [
  typeof ActivityLogMessageSchema,
  typeof AssistantChunkMessageSchema,
  ...typeof VoiceOutboundMessageSchemas,
  typeof StatusMessageSchema,
  typeof PongMessageSchema,
  typeof RpcErrorMessageSchema,
  typeof ArtifactMessageSchema,
  ...typeof AgentOutboundMessageSchemas,
  ...typeof WorkspaceOutboundMessageSchemas,
  ...typeof ProviderOutboundMessageSchemas,
  ...typeof UsageOutboundMessageSchemas,
  ...typeof DaemonOutboundMessageSchemas,
  typeof ProjectRenameResponseSchema,
  typeof CloseItemsResponseSchema,
  ...typeof CheckoutOutboundMessageSchemas,
  typeof ModelGatewayMoaTestResponseMessageSchema,
  typeof ModelGatewayTestResponseMessageSchema,
  ...typeof AgentExtensionOutboundMessageSchemas,
  ...typeof TerminalOutboundMessageSchemas,
  ...typeof AutomationOutboundMessageSchemas,
  ...typeof CindyOutboundMessageSchemas,
  typeof GenerativeUiActionResponseSchema,
  ...typeof DshdOutboundMessageSchemas,
];

export const SessionOutboundMessageSchema: z.ZodDiscriminatedUnion<
  "type",
  SessionOutboundMessageSchemaOptions
> = z.discriminatedUnion("type", [
  ActivityLogMessageSchema,
  AssistantChunkMessageSchema,
  ...VoiceOutboundMessageSchemas,
  StatusMessageSchema,
  PongMessageSchema,
  RpcErrorMessageSchema,
  ArtifactMessageSchema,
  ...AgentOutboundMessageSchemas,
  ...WorkspaceOutboundMessageSchemas,
  ...ProviderOutboundMessageSchemas,
  ...UsageOutboundMessageSchemas,
  ...DaemonOutboundMessageSchemas,
  ProjectRenameResponseSchema,
  CloseItemsResponseSchema,
  ...CheckoutOutboundMessageSchemas,
  ModelGatewayMoaTestResponseMessageSchema,
  ModelGatewayTestResponseMessageSchema,
  ...AgentExtensionOutboundMessageSchemas,
  ...TerminalOutboundMessageSchemas,
  ...AutomationOutboundMessageSchemas,
  ...CindyOutboundMessageSchemas,
  GenerativeUiActionResponseSchema,
  ...DshdOutboundMessageSchemas,
]);

export type SessionOutboundMessage = z.infer<typeof SessionOutboundMessageSchema>;

// Type exports for individual message types
export type ActivityLogMessage = z.infer<typeof ActivityLogMessageSchema>;
export type AssistantChunkMessage = z.infer<typeof AssistantChunkMessageSchema>;
export type StatusMessage = z.infer<typeof StatusMessageSchema>;
export type ServerCapabilities = z.infer<typeof ServerCapabilitiesSchema>;
export type ServerInfoStatusPayload = z.infer<typeof ServerInfoStatusPayloadSchema>;
export type RpcErrorMessage = z.infer<typeof RpcErrorMessageSchema>;
export type ArtifactMessage = z.infer<typeof ArtifactMessageSchema>;
export type ProjectRenameResponse = z.infer<typeof ProjectRenameResponseSchema>;
export type ProjectRenameResponsePayload = z.infer<typeof ProjectRenameResponsePayloadSchema>;
export type ModelGatewayMoaTestResponseMessage = z.infer<
  typeof ModelGatewayMoaTestResponseMessageSchema
>;
export type ModelGatewayTestResponseMessage = z.infer<typeof ModelGatewayTestResponseMessageSchema>;

// Type exports for payload types
export type ActivityLogPayload = z.infer<typeof ActivityLogPayloadSchema>;

// Type exports for inbound message types
export type ModelGatewayMoaTestRequestMessage = z.infer<
  typeof ModelGatewayMoaTestRequestMessageSchema
>;
export type ModelGatewayTestRequestMessage = z.infer<typeof ModelGatewayTestRequestMessageSchema>;

export type ProjectRenameRequest = z.infer<typeof ProjectRenameRequestSchema>;
export type ClientHeartbeatMessage = z.infer<typeof ClientHeartbeatMessageSchema>;
export type RegisterPushTokenMessage = z.infer<typeof RegisterPushTokenMessageSchema>;

// Cross-domain terminal-related message types retained in this module.
export type CloseItemsRequest = z.infer<typeof CloseItemsRequestMessageSchema>;
export type CloseItemsResponse = z.infer<typeof CloseItemsResponseSchema>;

// ============================================================================
// WebSocket Level Messages (wraps session messages)
// ============================================================================

// WebSocket-only messages (not session messages)
export const WSPingMessageSchema = z.object({
  type: z.literal("ping"),
});

export const WSPongMessageSchema = z.object({
  type: z.literal("pong"),
});

export const WSHelloMessageSchema = z.object({
  type: z.literal("hello"),
  clientId: z.string().min(1),
  clientType: z.enum(["mobile", "browser", "cli", "mcp"]),
  protocolVersion: z.number().int(),
  appVersion: z.string().optional(),
  capabilities: z
    .object({
      voice: z.boolean().optional(),
      pushNotifications: z.boolean().optional(),
      [CLIENT_CAPS.reasoningMergeEnum]: z.boolean().optional(),
      [CLIENT_CAPS.customModeIcons]: z.boolean().optional(),
      [CLIENT_CAPS.generativeUi]: z.boolean().optional(),
    })
    .passthrough()
    .optional(),
  /**
   * Optional relay device-auth material. Append-only: old daemons ignore this field.
   * New daemons require it for transport=relay unless legacy offer-only mode is enabled.
   */
  relayDeviceAuth: z
    .object({
      version: z.literal(1),
      deviceId: z.string().min(8).max(128),
      proof: z.string().min(16).max(256).optional(),
      pairingToken: z.string().min(16).max(256).optional(),
      clientPublicKeyB64: z.string().min(1).optional(),
      challenge: z.string().min(16).max(256).optional(),
      /**
       * Client-reported operator label, stored as the device label on first
       * pairing. Old daemons ignore it. Trimmed; 1-120 chars.
       */
      deviceName: z.string().trim().min(1).max(120).optional(),
    })
    .optional(),
});

export const WSRecordingStateMessageSchema = z.object({
  type: z.literal("recording_state"),
  isRecording: z.boolean(),
});

// Wrapped session message
export const WSSessionInboundSchema: z.ZodObject<{
  type: z.ZodLiteral<"session">;
  message: typeof SessionInboundMessageSchema;
}> = z.object({
  type: z.literal("session"),
  message: SessionInboundMessageSchema,
});

export const WSSessionOutboundSchema: z.ZodObject<{
  type: z.ZodLiteral<"session">;
  message: typeof SessionOutboundMessageSchema;
}> = z.object({
  type: z.literal("session"),
  message: SessionOutboundMessageSchema,
});

// Complete WebSocket message schemas
export const WSInboundMessageSchema = z.discriminatedUnion("type", [
  WSPingMessageSchema,
  WSHelloMessageSchema,
  WSRecordingStateMessageSchema,
  WSSessionInboundSchema,
]);

export const WSRelayDeviceAuthResultMessageSchema = z.object({
  type: z.literal("relay_device_auth_result"),
  version: z.literal(1),
  ok: z.boolean(),
  deviceId: z.string().min(8).max(128).optional(),
  deviceSecret: z.string().min(32).max(256).optional(),
  reason: z.string().max(200).optional(),
  securityLevel: z.enum(["v2", "legacy"]).optional(),
});

export const WSOutboundMessageSchema = z.discriminatedUnion("type", [
  WSPongMessageSchema,
  WSRelayDeviceAuthResultMessageSchema,
  WSSessionOutboundSchema,
]);

export type WSInboundMessage = z.infer<typeof WSInboundMessageSchema>;
export type WSOutboundMessage = z.infer<typeof WSOutboundMessageSchema>;
export type WSHelloMessage = z.infer<typeof WSHelloMessageSchema>;

// ============================================================================
// Helper functions for message conversion
// ============================================================================

/**
 * Extract session message from WebSocket message
 * Returns null if message should be handled at WS level only
 */
export function extractSessionMessage(wsMsg: WSInboundMessage): SessionInboundMessage | null {
  if (wsMsg.type === "session") {
    return wsMsg.message;
  }
  // Ping and recording_state are WS-level only
  return null;
}

/**
 * Wrap session message in WebSocket envelope
 */
export function wrapSessionMessage(sessionMsg: SessionOutboundMessage): WSOutboundMessage {
  return {
    type: "session",
    message: sessionMsg,
  };
}

export function parseServerInfoStatusPayload(payload: unknown): ServerInfoStatusPayload | null {
  const parsed = ServerInfoStatusPayloadSchema.safeParse(payload);
  if (!parsed.success) {
    return null;
  }
  return parsed.data;
}
