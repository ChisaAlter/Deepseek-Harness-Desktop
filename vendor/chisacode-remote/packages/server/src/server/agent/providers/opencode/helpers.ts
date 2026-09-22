import { z } from "zod/v3";

import type {
  AgentFeature,
  AgentPermissionAction,
  AgentPermissionResponse,
  AgentSessionConfig,
  AgentStreamEvent,
  McpServerConfig,
  ResolveAgentCreateConfigInput,
  ResolveAgentCreateConfigResult,
} from "../../agent-sdk-types.js";
import {
  isDefaultAgentCreateConfigUnattended,
  resolveDefaultAgentCreateConfig,
} from "../../create-agent-mode.js";
import { toDiagnosticErrorMessage } from "../diagnostic-utils.js";
import {
  MCP_ALREADY_PRESENT_ERROR_TOKENS,
  OPENCODE_AUTO_ACCEPT_FEATURE_ID,
  OPENCODE_BUILD_MODE_ID,
  OPENCODE_HEADERS_TIMEOUT_TOKENS,
  OPENCODE_LEGACY_FULL_ACCESS_MODE_ID,
  OPENCODE_PERMISSION_ACTION_ALLOW_ALWAYS,
  OPENCODE_PERMISSION_ACTION_ALLOW_ONCE,
} from "./constants.js";
import { mapOpencodeToolCall } from "./tool-call-mapper.js";

export function isOpenCodeAutoAcceptEnabled(config: AgentSessionConfig): boolean {
  return config.featureValues?.[OPENCODE_AUTO_ACCEPT_FEATURE_ID] === true;
}

export function withOpenCodeAutoAcceptFeature(
  featureValues: Record<string, unknown> | undefined,
  enabled: boolean,
): Record<string, unknown> {
  return {
    ...featureValues,
    [OPENCODE_AUTO_ACCEPT_FEATURE_ID]: enabled,
  };
}

export function resolveOpenCodeCreateConfig(
  input: ResolveAgentCreateConfigInput,
): ResolveAgentCreateConfigResult {
  const legacyFullAccess = input.requestedMode === OPENCODE_LEGACY_FULL_ACCESS_MODE_ID;
  const inheritsUnattended =
    input.requestedMode === undefined && input.parent?.isUnattended === true;
  const requestedMode = legacyFullAccess ? OPENCODE_BUILD_MODE_ID : input.requestedMode;
  const featureValues =
    legacyFullAccess ||
    (inheritsUnattended && input.featureValues?.[OPENCODE_AUTO_ACCEPT_FEATURE_ID] === undefined)
      ? withOpenCodeAutoAcceptFeature(input.featureValues, true)
      : input.featureValues;

  if (inheritsUnattended && requestedMode === undefined) {
    return { modeId: OPENCODE_BUILD_MODE_ID, featureValues };
  }

  const resolved = resolveDefaultAgentCreateConfig({
    ...input,
    requestedMode,
    featureValues,
  });
  return { ...resolved, featureValues };
}

export function isOpenCodeCreateConfigUnattended(
  input: Parameters<typeof isDefaultAgentCreateConfigUnattended>[0],
): boolean {
  return (
    isDefaultAgentCreateConfigUnattended(input) ||
    input.config.featureValues?.[OPENCODE_AUTO_ACCEPT_FEATURE_ID] === true ||
    input.features?.some(
      (feature) =>
        feature.id === OPENCODE_AUTO_ACCEPT_FEATURE_ID &&
        (feature.value === true || feature.value === "true"),
    ) === true
  );
}

export function buildOpenCodeAutoAcceptFeature(config: AgentSessionConfig): AgentFeature {
  return {
    type: "toggle",
    id: OPENCODE_AUTO_ACCEPT_FEATURE_ID,
    label: "Auto Accept",
    description: "Automatically approves OpenCode tool permission prompts.",
    tooltip: "Auto accept permission prompts",
    icon: "shield-check",
    value: isOpenCodeAutoAcceptEnabled(config),
  };
}

export function buildOpenCodePermissionActions(): AgentPermissionAction[] {
  return [
    {
      id: "deny",
      label: "Deny",
      behavior: "deny",
      variant: "danger",
      intent: "dismiss",
    },
    {
      id: OPENCODE_PERMISSION_ACTION_ALLOW_ALWAYS,
      label: "Allow always",
      behavior: "allow",
      variant: "secondary",
    },
    {
      id: OPENCODE_PERMISSION_ACTION_ALLOW_ONCE,
      label: "Allow once",
      behavior: "allow",
      variant: "primary",
    },
  ];
}

export function resolveOpenCodePermissionReply(
  response: AgentPermissionResponse,
): "once" | "always" | "reject" {
  if (response.behavior === "deny") {
    return "reject";
  }

  if (response.selectedActionId === OPENCODE_PERMISSION_ACTION_ALLOW_ALWAYS) {
    return "always";
  }

  return "once";
}

export type OpenCodeMcpConfig =
  | {
      type: "local";
      command: string[];
      environment?: Record<string, string>;
      enabled?: boolean;
    }
  | {
      type: "remote";
      url: string;
      headers?: Record<string, string>;
      enabled?: boolean;
    };

const OpencodeToolStateSchema = z
  .object({
    status: z.string().optional(),
    input: z.unknown().optional(),
    output: z.unknown().optional(),
    error: z.unknown().optional(),
  })
  .passthrough();

const OpencodeToolPartBaseSchema = z
  .object({
    tool: z.string().trim().min(1),
    state: OpencodeToolStateSchema.optional(),
  })
  .passthrough();

const OpencodeToolPartWithCallIdSchema = OpencodeToolPartBaseSchema.extend({
  callID: z.string().trim().min(1),
  id: z.string().optional(),
}).transform((part) => ({
  toolName: part.tool,
  callId: part.callID,
  status: part.state?.status,
  input: part.state?.input,
  output: part.state?.output,
  error: part.state?.error,
}));

const OpencodeToolPartWithIdSchema = OpencodeToolPartBaseSchema.extend({
  id: z.string().trim().min(1),
  callID: z.string().optional(),
}).transform((part) => ({
  toolName: part.tool,
  callId: part.id,
  status: part.state?.status,
  input: part.state?.input,
  output: part.state?.output,
  error: part.state?.error,
}));

const OpencodeToolPartWithoutIdSchema = OpencodeToolPartBaseSchema.extend({
  id: z.string().optional(),
  callID: z.string().optional(),
}).transform((part) => ({
  toolName: part.tool,
  callId: undefined,
  status: part.state?.status,
  input: part.state?.input,
  output: part.state?.output,
  error: part.state?.error,
}));

export const OpencodeToolPartSchema = z.union([
  OpencodeToolPartWithCallIdSchema,
  OpencodeToolPartWithIdSchema,
  OpencodeToolPartWithoutIdSchema,
]);

export const OpencodeToolPartTimelineEnvelopeSchema = OpencodeToolPartSchema.transform((part) => ({
  toolName: part.toolName,
  callId: part.callId,
  status: part.status,
  input: part.input,
  output: part.output,
  error: part.error,
}));

export const OpencodeToolPartToTimelineItemSchema =
  OpencodeToolPartTimelineEnvelopeSchema.transform((part) =>
    mapOpencodeToolCall({
      toolName: part.toolName,
      callId: part.callId,
      status: part.status,
      input: part.input,
      output: part.output,
      error: part.error,
    }),
  );

export function toOpenCodeMcpConfig(config: McpServerConfig): OpenCodeMcpConfig {
  if (config.type === "stdio") {
    return {
      type: "local",
      command: [config.command, ...(config.args ?? [])],
      ...(config.env ? { environment: config.env } : {}),
      enabled: true,
    };
  }

  return {
    type: "remote",
    url: config.url,
    ...(config.headers ? { headers: config.headers } : {}),
    enabled: true,
  };
}

export type TerminalTurnEvent = Extract<
  AgentStreamEvent,
  { type: "turn_completed" | "turn_failed" | "turn_canceled" }
>;

export function toTerminalTurnEvent(event: AgentStreamEvent): TerminalTurnEvent | null {
  if (event.type === "turn_failed") {
    return {
      type: "turn_failed",
      provider: "opencode",
      error: toDiagnosticErrorMessage(event.error),
    };
  }
  if (event.type === "turn_completed" || event.type === "turn_canceled") {
    return event;
  }
  return null;
}

export function isOpenCodeNotFoundError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "name" in error &&
    (error as { name?: unknown }).name === "NotFoundError"
  );
}

export function isOpenCodeHeadersTimeoutFailure(error: unknown): boolean {
  const diagnostics = new Set<string>();
  const queue: unknown[] = [error];

  while (queue.length > 0) {
    const current = queue.shift();
    if (!current) {
      continue;
    }

    const normalized = toDiagnosticErrorMessage(current).trim().toLowerCase();
    if (normalized) {
      diagnostics.add(normalized);
    }

    if (typeof current === "object") {
      const record = current as {
        message?: unknown;
        code?: unknown;
        name?: unknown;
        cause?: unknown;
      };

      for (const value of [record.message, record.code, record.name]) {
        if (typeof value !== "string") {
          continue;
        }
        const diagnostic = value.trim().toLowerCase();
        if (diagnostic) {
          diagnostics.add(diagnostic);
        }
      }

      if (record.cause) {
        queue.push(record.cause);
      }
    }
  }

  return [...diagnostics].some((diagnostic) =>
    OPENCODE_HEADERS_TIMEOUT_TOKENS.some((token) => diagnostic.includes(token)),
  );
}

export function isAlreadyPresentMcpError(error: unknown): boolean {
  const normalized = toDiagnosticErrorMessage(error).toLowerCase();
  return MCP_ALREADY_PRESENT_ERROR_TOKENS.some((token) => normalized.includes(token));
}
