import type {
  ClientSideConnection,
  SessionConfigOption,
  SessionMode,
  SessionModelState,
} from "@agentclientprotocol/sdk";
import type { Logger } from "pino";

import type { AgentMetadata, AgentMode, AgentModelDefinition } from "../../agent-sdk-types.js";

interface ConfigOptionSelector {
  id: string;
  label: string;
  description?: string;
  isDefault?: boolean;
  metadata?: AgentMetadata;
}

type SelectConfigOption = Extract<SessionConfigOption, { type: "select" }>;

interface SelectConfigChoice {
  value: string;
  name: string;
  description?: string | null;
  group?: string;
}

/** ACP model descriptor exposed by the session model state. */
export type AvailableACPModel = NonNullable<SessionModelState["availableModels"]>[number];

/** Resolved ACP mode selection across native modes and config options. */
export interface ACPModeSelection {
  availableMode: AgentMode | null;
  configOption: SelectConfigOption | null;
  configChoice: SelectConfigChoice | null;
  hasAvailableModes: boolean;
}

/** Resolved ACP model selection across native models and config options. */
export interface ACPModelSelection {
  availableModel: AvailableACPModel | null;
  configOption: SelectConfigOption | null;
  configChoice: SelectConfigChoice | null;
  hasAvailableModels: boolean;
}

/** Context passed to provider-specific ACP mode writers. */
export interface ACPProviderModeWriterContext {
  connection: ClientSideConnection;
  sessionId: string;
  requestedModeId: string;
  currentModeId: string | null;
  selection: ACPModeSelection;
  configOptions: SessionConfigOption[];
  logger: Logger;
}

/** Result returned by a provider-specific ACP mode writer. */
export interface ACPProviderModeWriteResult {
  handled: boolean;
  currentModeId?: string;
  configOptions?: SessionConfigOption[];
}

/** Result returned before the default ACP mode writer runs. */
export interface ACPBeforeModeWriteResult {
  configOptions?: SessionConfigOption[];
}

/**
 * Resolves a requested mode against native ACP modes and select config choices.
 * @param input Mode id and the currently advertised ACP configuration
 * @returns The matching native mode and config choice state
 */
export function resolveACPModeSelection({
  modeId,
  availableModes,
  configOptions,
}: {
  modeId: string;
  availableModes: AgentMode[];
  configOptions: SessionConfigOption[] | null | undefined;
}): ACPModeSelection {
  const configOption = findSelectConfigOption({ configOptions, category: "mode" });
  return {
    availableMode: availableModes.find((mode) => mode.id === modeId) ?? null,
    configOption,
    configChoice: findSelectConfigChoice({ option: configOption, value: modeId }),
    hasAvailableModes: availableModes.length > 0,
  };
}

/**
 * Resolves a requested model against native ACP models and select config choices.
 * @param input Model id and the currently advertised ACP configuration
 * @returns The matching native model and config choice state
 */
export function resolveACPModelSelection({
  modelId,
  availableModels,
  configOptions,
}: {
  modelId: string;
  availableModels: AvailableACPModel[] | null | undefined;
  configOptions: SessionConfigOption[] | null | undefined;
}): ACPModelSelection {
  const configOption = findSelectConfigOption({ configOptions, category: "model" });
  return {
    availableModel: availableModels?.find((model) => model.modelId === modelId) ?? null,
    configOption,
    configChoice: findSelectConfigChoice({ option: configOption, value: modelId }),
    hasAvailableModels: Boolean(availableModels?.length),
  };
}

/**
 * Derives ChisaCode modes from native ACP mode state or config options.
 * @param fallbackModes Provider fallback modes
 * @param modeState Native ACP mode state
 * @param configOptions ACP session config options
 * @returns Available modes and current mode id
 */
export function deriveModesFromACP(
  fallbackModes: AgentMode[],
  modeState?: { availableModes?: SessionMode[] | null; currentModeId?: string | null } | null,
  configOptions?: SessionConfigOption[] | null,
): { modes: AgentMode[]; currentModeId: string | null } {
  if (modeState?.availableModes?.length) {
    return {
      modes: modeState.availableModes.map((mode) => ({
        id: mode.id,
        label: mode.name,
        description: mode.description ?? undefined,
      })),
      currentModeId: modeState.currentModeId ?? null,
    };
  }

  const modeOption = findSelectConfigOption({ configOptions, category: "mode" });
  if (modeOption) {
    const flatOptions = flattenSelectOptions(modeOption.options);
    return {
      modes: flatOptions.map((option) => ({
        id: option.value,
        label: option.name,
        description: option.description ?? undefined,
      })),
      currentModeId: modeOption.currentValue,
    };
  }

  return {
    modes: fallbackModes,
    currentModeId: null,
  };
}

/**
 * Derives ChisaCode model definitions from ACP model state or config options.
 * @param provider Provider id attached to model definitions
 * @param models Native ACP model state
 * @param configOptions ACP session config options
 * @returns Provider-neutral model definitions
 */
export function deriveModelDefinitionsFromACP(
  provider: string,
  models: SessionModelState | null | undefined,
  configOptions?: SessionConfigOption[] | null,
): AgentModelDefinition[] {
  const thinkingOptions = deriveSelectorOptions(configOptions, "thought_level");
  const defaultThinkingOptionId = thinkingOptions.find((option) => option.isDefault)?.id ?? null;

  if (models?.availableModels?.length) {
    return models.availableModels.map((model) => ({
      provider,
      id: model.modelId,
      label: model.name,
      description: model.description ?? undefined,
      isDefault: model.modelId === models.currentModelId,
      thinkingOptions: thinkingOptions.length > 0 ? thinkingOptions : undefined,
      defaultThinkingOptionId: defaultThinkingOptionId ?? undefined,
    }));
  }

  const modelOptions = deriveSelectorOptions(configOptions, "model");
  return modelOptions.map((option) => ({
    provider,
    id: option.id,
    label: option.label,
    description: option.description,
    isDefault: option.isDefault,
    thinkingOptions: thinkingOptions.length > 0 ? thinkingOptions : undefined,
    defaultThinkingOptionId: defaultThinkingOptionId ?? undefined,
    metadata: option.metadata,
  }));
}

/**
 * Finds a select config option by category and optional id.
 * @param input ACP config options and selector criteria
 * @returns The matching select option, or null
 */
export function findSelectConfigOption({
  configOptions,
  category,
  id,
}: {
  configOptions: SessionConfigOption[] | null | undefined;
  category: string;
  id?: string;
}): SelectConfigOption | null {
  const option = configOptions?.find(
    (entry): entry is SelectConfigOption =>
      entry.type === "select" && entry.category === category && (!id || entry.id === id),
  );
  return option ?? null;
}

/**
 * Flattens grouped ACP select options while preserving their group metadata.
 * @param options ACP select option entries
 * @returns Flat config choices
 */
export function flattenSelectOptions(options: SelectConfigOption["options"]): SelectConfigChoice[] {
  const flattened: SelectConfigChoice[] = [];
  for (const option of options) {
    if ("value" in option) {
      flattened.push(option);
      continue;
    }
    for (const groupOption of option.options) {
      flattened.push({ ...groupOption, group: option.group });
    }
  }
  return flattened;
}

/**
 * Reads the current select value for an ACP config category.
 * @param configOptions ACP session config options
 * @param category Config category to inspect
 * @returns Current value, or null when unavailable
 */
export function deriveCurrentConfigValue(
  configOptions: SessionConfigOption[] | null | undefined,
  category: string,
): string | null {
  const option = configOptions?.find(
    (entry): entry is SelectConfigOption => entry.type === "select" && entry.category === category,
  );
  return option?.currentValue ?? null;
}

function findSelectConfigChoice({
  option,
  value,
}: {
  option: SelectConfigOption | null;
  value: string;
}): SelectConfigChoice | null {
  if (!option) {
    return null;
  }
  return flattenSelectOptions(option.options).find((choice) => choice.value === value) ?? null;
}

function deriveSelectorOptions(
  configOptions: SessionConfigOption[] | null | undefined,
  category: string,
): ConfigOptionSelector[] {
  const option = findSelectConfigOption({ configOptions, category });
  if (!option) {
    return [];
  }

  return flattenSelectOptions(option.options).map((value) => ({
    id: value.value,
    label: value.name,
    description: value.description ?? undefined,
    isDefault: value.value === option.currentValue,
    metadata: value.group ? { group: value.group } : undefined,
  }));
}
