import type { OpencodeClient } from "@opencode-ai/sdk/v2/client";

import type {
  AgentMode,
  AgentModelDefinition,
  AgentSessionConfig,
  AgentSlashCommand,
} from "../../agent-sdk-types.js";
import type { ProviderRuntimeSettings } from "../../provider-launch-config.js";
import {
  OPENCODE_AGENT_HEX_COLOR_PATTERN,
  OPENCODE_AUTO_ACCEPT_FEATURE_ID,
  OPENCODE_BUILD_MODE_ID,
  OPENCODE_LEGACY_FULL_ACCESS_MODE_ID,
} from "./constants.js";

export const DEFAULT_MODES: AgentMode[] = [
  {
    id: OPENCODE_BUILD_MODE_ID,
    label: "Build",
    description: "Allows edits and tool execution for implementation work",
  },
  {
    id: "plan",
    label: "Plan",
    description: "Read-only planning mode that avoids file edits",
  },
];

export type OpenCodeAgentConfig = AgentSessionConfig & { provider: "opencode" };

const OPENCODE_HANDLED_BUILTIN_SLASH_COMMANDS: AgentSlashCommand[] = [
  { name: "compact", description: "Compact the current session", argumentHint: "" },
  { name: "summarize", description: "Compact the current session", argumentHint: "" },
];

export function normalizeOpenCodeModeId(modeId: string | null | undefined): string {
  const trimmed = typeof modeId === "string" ? modeId.trim() : "";
  if (!trimmed || trimmed === "default") {
    return OPENCODE_BUILD_MODE_ID;
  }
  return trimmed;
}

export function resolveOpenCodeRuntimeAgentId(modeId: string | null | undefined): string {
  const normalizedModeId = normalizeOpenCodeModeId(modeId);
  return normalizedModeId === OPENCODE_LEGACY_FULL_ACCESS_MODE_ID
    ? OPENCODE_BUILD_MODE_ID
    : normalizedModeId;
}

export function normalizeOpenCodeConfig(config: OpenCodeAgentConfig): OpenCodeAgentConfig {
  if (normalizeOpenCodeModeId(config.modeId) !== OPENCODE_LEGACY_FULL_ACCESS_MODE_ID) {
    return { ...config };
  }

  return {
    ...config,
    modeId: OPENCODE_BUILD_MODE_ID,
    featureValues: {
      ...config.featureValues,
      [OPENCODE_AUTO_ACCEPT_FEATURE_ID]: true,
    },
  };
}

export function isSelectableOpenCodeAgent(agent: { mode?: string; hidden?: boolean }): boolean {
  return (agent.mode === "primary" || agent.mode === "all") && agent.hidden !== true;
}

function readOpenCodeAgentHexColor(agent: { color?: unknown }): string | undefined {
  return typeof agent.color === "string" && OPENCODE_AGENT_HEX_COLOR_PATTERN.test(agent.color)
    ? agent.color
    : undefined;
}

function formatOpenCodeAgentModeLabel(name: string): string {
  if (name.startsWith("chisacode")) {
    return `ChisaCode${name.slice("chisacode".length)}`;
  }
  return name.charAt(0).toUpperCase() + name.slice(1);
}

export function mapOpenCodeAgentToMode(agent: {
  name: string;
  description?: unknown;
  color?: unknown;
}): AgentMode {
  const colorTier = readOpenCodeAgentHexColor(agent);
  return {
    id: agent.name,
    label: formatOpenCodeAgentModeLabel(agent.name),
    icon: "Bot",
    description:
      typeof agent.description === "string" && agent.description.trim().length > 0
        ? agent.description.trim()
        : DEFAULT_MODES.find((mode) => mode.id === agent.name)?.description,
    ...(colorTier ? { colorTier } : {}),
  };
}

export function mergeOpenCodeModes(discoveredModes: AgentMode[]): AgentMode[] {
  const modesById = new Map(DEFAULT_MODES.map((mode) => [mode.id, mode]));
  for (const mode of discoveredModes) {
    if (mode.id === OPENCODE_LEGACY_FULL_ACCESS_MODE_ID) {
      continue;
    }
    modesById.set(mode.id, mode);
  }
  return sortOpenCodeModes(Array.from(modesById.values()));
}

function sortOpenCodeModes(modes: AgentMode[]): AgentMode[] {
  const order = new Map(DEFAULT_MODES.map((mode, index) => [mode.id, index]));
  return [...modes].sort((left, right) => {
    const leftOrder = order.get(left.id) ?? Number.MAX_SAFE_INTEGER;
    const rightOrder = order.get(right.id) ?? Number.MAX_SAFE_INTEGER;
    if (leftOrder !== rightOrder) {
      return leftOrder - rightOrder;
    }
    return left.label.localeCompare(right.label);
  });
}

export function readPositiveFiniteNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : undefined;
}

export function buildOpenCodeModelLookupKey(providerId: string, modelId: string): string {
  return `${providerId}/${modelId}`;
}

export function parseOpenCodeModelLookupKey(
  modelId: string | null | undefined,
): string | undefined {
  if (typeof modelId !== "string" || modelId.trim().length === 0) {
    return undefined;
  }

  const slashIndex = modelId.indexOf("/");
  if (slashIndex <= 0 || slashIndex === modelId.length - 1) {
    return undefined;
  }

  const providerId = modelId.slice(0, slashIndex).trim();
  const providerModelId = modelId.slice(slashIndex + 1).trim();
  if (!providerId || !providerModelId) {
    return undefined;
  }

  return buildOpenCodeModelLookupKey(providerId, providerModelId);
}

export function extractOpenCodeModelContextWindow(model: unknown): number | undefined {
  if (!model || typeof model !== "object") {
    return undefined;
  }
  const limit = (model as { limit?: { context?: unknown } }).limit;
  return readPositiveFiniteNumber(limit?.context);
}

export function buildOpenCodeModelDefinition(
  provider: {
    id: string;
    name: string;
  },
  modelId: string,
  model: {
    name: string;
    family?: string;
    release_date?: string;
    attachment?: boolean;
    reasoning?: boolean;
    tool_call?: boolean;
    cost?: unknown;
    limit?: { context?: number; input?: number; output?: number };
    variants?: Record<string, unknown>;
  },
): AgentModelDefinition {
  const rawVariants = model.variants ? Object.keys(model.variants) : [];
  const thinkingOptions = rawVariants.map((id, index) => ({
    id,
    label: id,
    isDefault: index === 0,
  }));

  return {
    provider: "opencode",
    id: `${provider.id}/${modelId}`,
    label: model.name,
    description: `${provider.name} - ${model.family ?? ""}`.trim(),
    thinkingOptions: thinkingOptions.length > 0 ? thinkingOptions : undefined,
    defaultThinkingOptionId: thinkingOptions[0]?.id,
    metadata: {
      providerId: provider.id,
      providerName: provider.name,
      modelId,
      family: model.family,
      releaseDate: model.release_date,
      supportsAttachments: model.attachment,
      supportsReasoning: model.reasoning,
      supportsToolCall: model.tool_call,
      cost: model.cost,
      contextWindowMaxTokens: extractOpenCodeModelContextWindow(model),
      ...(model.limit ? { limit: model.limit } : {}),
    },
  };
}

export function resolveOpenCodeSelectedModelContextWindow(
  providers:
    | {
        connected?: string[];
        all?: Array<{
          id: string;
          models?: Record<string, unknown>;
        }>;
      }
    | null
    | undefined,
  modelId: string | null | undefined,
): number | undefined {
  if (!providers) {
    return undefined;
  }
  const modelLookupKey = parseOpenCodeModelLookupKey(modelId);
  if (!modelLookupKey) {
    return undefined;
  }
  const lookup = buildOpenCodeModelContextWindowLookup(providers);
  return lookup.get(modelLookupKey);
}

export function buildOpenCodeModelContextWindowLookup(
  providers:
    | {
        connected?: string[];
        all?: Array<{
          id: string;
          source?: string;
          models?: Record<string, unknown>;
        }>;
      }
    | null
    | undefined,
): Map<string, number> {
  const lookup = new Map<string, number>();
  if (!providers) {
    return lookup;
  }

  const connectedProviderIds = new Set(providers.connected ?? []);
  for (const provider of providers.all ?? []) {
    // Providers with source "api" are managed by the OpenCode console/subscription and are
    // usable even though they don't appear in `connected` (which only lists env/config providers).
    if (!connectedProviderIds.has(provider.id) && provider.source !== "api") {
      continue;
    }
    for (const [modelId, modelDefinition] of Object.entries(provider.models ?? {})) {
      const contextWindow = extractOpenCodeModelContextWindow(modelDefinition);
      if (contextWindow === undefined) {
        continue;
      }
      lookup.set(buildOpenCodeModelLookupKey(provider.id, modelId), contextWindow);
    }
  }

  return lookup;
}

const CHISACODE_MODEL_PREFIX_ENV = "CHISACODE_MODEL_PREFIX";

export function readRuntimeModelPrefix(
  runtimeSettings: ProviderRuntimeSettings | undefined,
): string | null {
  const prefix = runtimeSettings?.env?.[CHISACODE_MODEL_PREFIX_ENV]?.trim();
  return prefix ? prefix : null;
}

export function applyRuntimeModelPrefix(
  model: string | undefined,
  prefix: string | null,
): string | undefined {
  if (!model || !prefix || model.includes("/")) {
    return model;
  }
  return `${prefix}/${model}`;
}

export async function listOpenCodeCommandsFromSdk(
  client: Pick<OpencodeClient, "command">,
  directory: string,
): Promise<AgentSlashCommand[]> {
  const result = await client.command.list({ directory });
  const commandsByName = new Map(
    OPENCODE_HANDLED_BUILTIN_SLASH_COMMANDS.map((command) => [command.name, command]),
  );
  if (result.error || !result.data) {
    return Array.from(commandsByName.values());
  }

  for (const cmd of result.data) {
    commandsByName.set(cmd.name, {
      name: cmd.name,
      description: cmd.description ?? "",
      argumentHint: cmd.hints?.length ? cmd.hints.join(" ") : "",
    });
  }

  return Array.from(commandsByName.values());
}
