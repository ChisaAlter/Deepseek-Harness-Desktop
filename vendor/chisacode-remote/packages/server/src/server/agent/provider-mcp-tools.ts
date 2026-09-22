import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  resolveProviderToolingStatus,
  type ProviderSnapshotEntry,
  type ProviderToolingStatus,
} from "@chisacode/protocol/agent-types";
import { z } from "zod/v3";

import { ensureValidJson } from "../json-utils.js";
import { AgentFeatureSchema } from "../messages.js";
import type { AgentMode, AgentProvider } from "./agent-sdk-types.js";
import type { AgentManager } from "./agent-manager.js";
import {
  AgentModelSchema,
  AgentProviderEnum,
  ProviderModeSchema,
  ProviderSummarySchema,
  resolveProviderAndOptionalModel,
  resolveRequiredProviderModel,
} from "./mcp-shared.js";
import type { ProviderSnapshotManager } from "./provider-snapshot-manager.js";

const ProviderOrProviderModelInputSchema = AgentProviderEnum.trim()
  .min(1, "provider is required")
  .refine(
    (value) => {
      if (!value.includes("/")) {
        return true;
      }
      try {
        resolveRequiredProviderModel(value);
        return true;
      } catch {
        return false;
      }
    },
    { message: "provider must be provider or provider/model, for example codex/gpt-5.4" },
  );

const InspectProviderSettingsInputSchema = z
  .object({
    modeId: z.string().optional().describe("Draft session mode ID."),
    model: z.string().optional().describe("Draft model ID."),
    thinkingOptionId: z.string().optional().describe("Draft thinking option ID."),
    features: z.record(z.unknown()).optional().describe("Draft provider feature values."),
  })
  .strict();

const inspectProviderInputSchema = {
  provider: ProviderOrProviderModelInputSchema.describe(
    "Provider ID, optionally with a model ID (for example codex or codex/gpt-5.4).",
  ),
  cwd: z
    .string()
    .optional()
    .describe("Working directory used to resolve provider feature availability."),
  settings: InspectProviderSettingsInputSchema.optional().describe(
    "Draft provider settings used to compute available features.",
  ),
};

interface ProviderSummary {
  id: AgentProvider;
  label: string;
  description: string;
  enabled: boolean;
  modes: AgentMode[];
  status: string;
  installedVersion: string | null;
  latestVersion: string | null;
  toolingStatus: ProviderToolingStatus;
  checkedAt: string | null;
  error?: string;
}

/** Dependencies required to register provider discovery and inspection MCP tools. */
export interface RegisterProviderMcpToolsOptions {
  registerTool: McpServer["registerTool"];
  agentManager: Pick<AgentManager, "listDraftFeatures">;
  providerSnapshotManager: ProviderSnapshotManager;
  resolveProviderDiscoveryCwd(requestedCwd?: string): string;
  resolveScopedCwd(requestedCwd?: string, options?: { required?: boolean }): string;
}

/** Registers provider listing, model discovery, and draft configuration inspection tools. */
export function registerProviderMcpTools(options: RegisterProviderMcpToolsOptions): void {
  options.registerTool(
    "list_providers",
    {
      title: "List providers",
      description: "List configured agent providers, availability, and their modes.",
      inputSchema: {
        cwd: z.string().optional().describe("Working directory used to resolve provider state."),
      },
      outputSchema: {
        providers: z.array(ProviderSummarySchema),
      },
    },
    async ({ cwd }) => {
      const resolvedCwd = options.resolveProviderDiscoveryCwd(cwd);
      const providers = (
        await options.providerSnapshotManager.listProviders({ cwd: resolvedCwd, wait: true })
      ).map(toProviderSummary);
      return {
        content: [],
        structuredContent: ensureValidJson({ providers }),
      };
    },
  );

  options.registerTool(
    "list_models",
    {
      title: "List models",
      description: "List models for an agent provider.",
      inputSchema: {
        provider: AgentProviderEnum,
        cwd: z.string().optional().describe("Working directory used to resolve provider models."),
      },
      outputSchema: {
        provider: z.string(),
        models: z.array(AgentModelSchema),
      },
    },
    async ({ provider, cwd }) => {
      const resolvedCwd = options.resolveProviderDiscoveryCwd(cwd);
      const models = await options.providerSnapshotManager.listModels({
        cwd: resolvedCwd,
        provider,
        wait: true,
      });
      return {
        content: [],
        structuredContent: ensureValidJson({ provider, models }),
      };
    },
  );

  options.registerTool(
    "inspect_provider",
    {
      title: "Inspect provider",
      description:
        "Inspect compact provider capabilities for orchestration, including modes and draft feature settings. Use list_models for the full model list.",
      inputSchema: inspectProviderInputSchema,
      outputSchema: {
        provider: AgentProviderEnum,
        label: z.string().nullable().optional(),
        description: z.string().nullable().optional(),
        enabled: z.boolean(),
        status: z.string(),
        modes: z.array(ProviderModeSchema).nullish(),
        selectedModel: z.string().nullable(),
        installedVersion: z.string().nullable(),
        latestVersion: z.string().nullable(),
        toolingStatus: z.enum(["install", "update", "current", "unknown", "not-checked"]),
        checkedAt: z.string().nullable(),
        features: z.array(AgentFeatureSchema),
      },
    },
    async ({ provider, cwd, settings }) => {
      const resolvedProviderModel = resolveProviderAndOptionalModel(provider, provider);
      const providerId = resolvedProviderModel.provider;
      const resolvedCwd = options.resolveScopedCwd(cwd, { required: true });
      const entry = await options.providerSnapshotManager.getProvider({
        cwd: resolvedCwd,
        provider: providerId,
        wait: true,
      });
      const summary = toProviderSummary(entry);
      if (!entry.enabled) {
        throw new Error(`Provider '${providerId}' is disabled`);
      }
      if (entry.status !== "ready") {
        throw new Error(entry.error ?? `Provider '${providerId}' is unavailable`);
      }
      const selectedModel = settings?.model ?? resolvedProviderModel.model;
      const features = await options.agentManager.listDraftFeatures({
        provider: providerId,
        cwd: resolvedCwd,
        ...(settings?.modeId ? { modeId: settings.modeId } : {}),
        ...(selectedModel ? { model: selectedModel } : {}),
        ...(settings?.thinkingOptionId ? { thinkingOptionId: settings.thinkingOptionId } : {}),
        ...(settings?.features ? { featureValues: settings.features } : {}),
      });
      return {
        content: [],
        structuredContent: ensureValidJson({
          provider: providerId,
          label: summary.label,
          description: summary.description,
          enabled: summary.enabled,
          status: summary.status,
          modes: summary.modes,
          selectedModel: selectedModel ?? null,
          installedVersion: summary.installedVersion,
          latestVersion: summary.latestVersion,
          toolingStatus: summary.toolingStatus,
          checkedAt: summary.checkedAt,
          features,
        }),
      };
    },
  );
}

function normalizeProviderVersion(version: string | null | undefined): string | null {
  const trimmed = version?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : null;
}

function toProviderSummary(entry: ProviderSnapshotEntry): ProviderSummary {
  return {
    id: entry.provider,
    label: entry.label ?? entry.provider,
    description: entry.description ?? "",
    enabled: entry.enabled,
    modes: entry.modes ?? [],
    status: entry.status === "ready" ? "available" : entry.status,
    installedVersion: normalizeProviderVersion(entry.installedVersion),
    latestVersion: normalizeProviderVersion(entry.latestVersion),
    toolingStatus: resolveProviderToolingStatus(entry),
    checkedAt: entry.checkedAt ?? null,
    ...(entry.error ? { error: entry.error } : {}),
  };
}
