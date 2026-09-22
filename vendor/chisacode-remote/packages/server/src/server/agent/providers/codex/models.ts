import type { Logger } from "pino";
import { z } from "zod/v3";

import type { AgentModelDefinition } from "../../agent-sdk-types.js";
import { normalizeCodexThinkingOptionId } from "./turn-config.js";

interface CodexModelClient {
  request(method: string, params?: unknown): Promise<unknown>;
}

export interface CodexConfiguredDefaults {
  model?: string;
  thinkingOptionId?: string;
}

interface CodexReasoningEffortEntry {
  reasoningEffort?: string;
  description?: string;
}

interface CodexModel {
  id: string;
  displayName?: string;
  description?: string;
  isDefault?: boolean;
  model?: string;
  defaultReasoningEffort?: string;
  supportedReasoningEfforts?: CodexReasoningEffortEntry[];
}

const CodexModelListResponseSchema = z.object({
  data: z
    .array(
      z.object({
        id: z.string(),
        displayName: z.string().optional(),
        description: z.string().optional(),
        isDefault: z.boolean().optional(),
        model: z.string().optional(),
        defaultReasoningEffort: z.string().optional(),
        supportedReasoningEfforts: z
          .array(
            z.object({
              reasoningEffort: z.string().optional(),
              description: z.string().optional(),
            }),
          )
          .optional(),
      }),
    )
    .optional(),
});

function isRecord(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === "object" && !Array.isArray(value);
}

function toObjectRecord(value: unknown): Record<string, unknown> | undefined {
  return isRecord(value) ? value : undefined;
}

function normalizeCodexModelId(modelId: string | null | undefined): string | undefined {
  if (typeof modelId !== "string") return undefined;
  const normalized = modelId.trim();
  return normalized || undefined;
}

function normalizeCodexModelLabel(displayName: string): string {
  return displayName.replace(/\bgpt\b/gi, "GPT");
}

function mergeCodexConfiguredDefaults(
  primary: CodexConfiguredDefaults,
  fallback: CodexConfiguredDefaults,
): CodexConfiguredDefaults {
  return {
    model: primary.model ?? fallback.model,
    thinkingOptionId: primary.thinkingOptionId ?? fallback.thinkingOptionId,
  };
}

export async function readCodexConfiguredDefaults(
  client: CodexModelClient,
  logger: Logger,
): Promise<CodexConfiguredDefaults> {
  let savedConfigDefaults: CodexConfiguredDefaults = {};
  try {
    const response = toObjectRecord(await client.request("getUserSavedConfig", {}));
    const config = toObjectRecord(response?.config);
    const modelValue = typeof config?.model === "string" ? config.model : undefined;
    const thinkingOptionValue =
      typeof config?.modelReasoningEffort === "string" ? config.modelReasoningEffort : null;
    savedConfigDefaults = {
      model: normalizeCodexModelId(modelValue),
      thinkingOptionId: normalizeCodexThinkingOptionId(thinkingOptionValue),
    };
  } catch (error) {
    logger.debug({ error }, "Failed to read Codex saved config defaults");
  }

  if (savedConfigDefaults.model && savedConfigDefaults.thinkingOptionId) {
    return savedConfigDefaults;
  }

  let configReadDefaults: CodexConfiguredDefaults = {};
  try {
    const response = toObjectRecord(await client.request("config/read", {}));
    const config = toObjectRecord(response?.config);
    const modelValue = typeof config?.model === "string" ? config.model : undefined;
    const thinkingOptionValue =
      typeof config?.model_reasoning_effort === "string" ? config.model_reasoning_effort : null;
    configReadDefaults = {
      model: normalizeCodexModelId(modelValue),
      thinkingOptionId: normalizeCodexThinkingOptionId(thinkingOptionValue),
    };
  } catch (error) {
    logger.debug({ error }, "Failed to read Codex config defaults");
  }

  return mergeCodexConfiguredDefaults(savedConfigDefaults, configReadDefaults);
}

export function buildCodexModelDefinitions(
  response: unknown,
  configuredDefaults: CodexConfiguredDefaults,
): AgentModelDefinition[] {
  const parsedResponse = CodexModelListResponseSchema.safeParse(response);
  const models = parsedResponse.success ? (parsedResponse.data.data ?? []) : [];
  const hasConfiguredDefaultModel = configuredDefaults.model
    ? models.some((model) => model.id === configuredDefaults.model)
    : false;
  return models.map((model) =>
    buildCodexModelDefinition(model, {
      configuredDefaultModelId: configuredDefaults.model,
      configuredDefaultThinkingOptionId: configuredDefaults.thinkingOptionId,
      hasConfiguredDefaultModel,
    }),
  );
}

export async function loadCodexModelDefinitions(
  client: CodexModelClient,
  logger: Logger,
): Promise<AgentModelDefinition[]> {
  const response = await client.request("model/list", {});
  const configuredDefaults = await readCodexConfiguredDefaults(client, logger);
  return buildCodexModelDefinitions(response, configuredDefaults);
}

interface CodexModelBuildContext {
  configuredDefaultModelId: string | undefined;
  configuredDefaultThinkingOptionId: string | undefined;
  hasConfiguredDefaultModel: boolean;
}

function buildCodexModelDefinition(
  model: CodexModel,
  context: CodexModelBuildContext,
): AgentModelDefinition {
  const defaultReasoningEffort = normalizeCodexThinkingOptionId(
    typeof model.defaultReasoningEffort === "string" ? model.defaultReasoningEffort : null,
  );
  const resolvedDefaultReasoningEffort =
    context.configuredDefaultThinkingOptionId ?? defaultReasoningEffort;
  const thinkingById = buildCodexThinkingOptionMap(
    model.supportedReasoningEfforts,
    resolvedDefaultReasoningEffort,
    context.configuredDefaultThinkingOptionId,
  );
  const thinkingOptions = Array.from(thinkingById.values()).map((option) =>
    Object.assign({}, option, {
      isDefault: option.id === resolvedDefaultReasoningEffort,
    }),
  );
  const defaultThinkingOptionId =
    resolvedDefaultReasoningEffort ??
    thinkingOptions.find((option) => option.isDefault)?.id ??
    thinkingOptions[0]?.id;
  const isDefaultModel = context.hasConfiguredDefaultModel
    ? model.id === context.configuredDefaultModelId
    : model.isDefault;

  return {
    provider: "codex",
    id: model.id,
    label: normalizeCodexModelLabel(model.displayName ?? ""),
    description: model.description,
    isDefault: isDefaultModel,
    thinkingOptions: thinkingOptions.length > 0 ? thinkingOptions : undefined,
    defaultThinkingOptionId,
    metadata: {
      model: model.model,
      defaultReasoningEffort: model.defaultReasoningEffort,
      supportedReasoningEfforts: model.supportedReasoningEfforts,
    },
  };
}

function buildCodexThinkingOptionMap(
  supportedReasoningEfforts: CodexReasoningEffortEntry[] | undefined,
  resolvedDefaultReasoningEffort: string | undefined,
  configuredDefaultThinkingOptionId: string | undefined,
): Map<string, { id: string; label: string; description?: string }> {
  const thinkingById = new Map<string, { id: string; label: string; description?: string }>();
  if (Array.isArray(supportedReasoningEfforts)) {
    for (const entry of supportedReasoningEfforts) {
      const id = normalizeCodexThinkingOptionId(
        typeof entry?.reasoningEffort === "string" ? entry.reasoningEffort : null,
      );
      if (!id) continue;
      const description =
        typeof entry?.description === "string" && entry.description.trim().length > 0
          ? entry.description
          : undefined;
      thinkingById.set(id, { id, label: id, description });
    }
  }

  if (resolvedDefaultReasoningEffort && !thinkingById.has(resolvedDefaultReasoningEffort)) {
    thinkingById.set(resolvedDefaultReasoningEffort, {
      id: resolvedDefaultReasoningEffort,
      label: resolvedDefaultReasoningEffort,
      description:
        configuredDefaultThinkingOptionId === resolvedDefaultReasoningEffort
          ? "Configured default reasoning effort"
          : "Model default reasoning effort",
    });
  }
  return thinkingById;
}
