import type {
  AgentMode,
  AgentModelDefinition,
  AgentProvider,
  ProviderSnapshotEntry,
} from "@chisacode/protocol/agent-types";
import type { AgentProviderDefinition } from "@chisacode/protocol/provider-manifest";
import type { DraftCommandConfig } from "@/hooks/use-agent-commands-query";
import { buildFavoriteModelKey, type FavoriteModelRow } from "@/hooks/use-form-preferences";
import { compareMatchScores, scoreTextFields } from "@/utils/score-match";

export type ProviderSelectionModelRow = FavoriteModelRow & {
  agentProvider: string;
  runtimeProvider: string;
  isDefault?: boolean;
};

export type ProviderModelSelection =
  | { kind: "models"; rows: ProviderSelectionModelRow[] }
  | { kind: "loading" }
  | { kind: "error"; message: string };

export interface ProviderSelectorProvider {
  id: string;
  label: string;
  modelSelection: ProviderModelSelection;
  /** Snapshot status of the entry backing this row (absent for static definitions). */
  status?: ProviderSnapshotEntry["status"];
  /** Snapshot error message when status is "error" — feeds warning strips. */
  error?: string | null;
}

export interface ProviderSelectionCopy {
  defaultModelLabel?: string;
  selectModel?: string;
  loading?: string;
  error?: string;
  unavailable?: string;
  unknownError?: string;
  initialPromptRequired?: string;
  noProviders?: string;
  modelRequired?: string;
  modelLoading?: string;
  providerNoModels?: string;
  workspaceDirectoryMissing?: string;
  hostDisconnected?: string;
}

type SelectableProviderEntry = ProviderSnapshotEntry & {
  derivedFromProviderId?: string | null;
  modelGatewayId?: string | null;
};

export interface ProviderSelectionState {
  provider: AgentProvider | null;
  runtimeProvider?: AgentProvider | null;
  modelId: string;
  modeId: string;
  thinkingOptionId: string;
  availableModels: AgentModelDefinition[];
  modeOptions: AgentMode[];
}

export interface ProviderModelSelectionValue {
  agentProvider: AgentProvider;
  runtimeProvider: AgentProvider;
  modelId: string;
}

export interface ProviderSelectionReadiness {
  ok: boolean;
  reason?: string;
}

const DEFAULT_PROVIDER_SELECTION_COPY: Required<ProviderSelectionCopy> = {
  defaultModelLabel: "Default",
  selectModel: "Select model",
  loading: "Loading...",
  error: "Error",
  unavailable: "Unavailable",
  unknownError: "Unknown error",
  initialPromptRequired: "Enter an initial prompt",
  noProviders: "The selected host has no available providers",
  modelRequired: "Select a model",
  modelLoading: "Model defaults are still loading",
  providerNoModels: "No model is available for the selected provider",
  workspaceDirectoryMissing: "Workspace directory not found",
  hostDisconnected: "Host is not connected",
};

function resolveProviderSelectionCopy(copy?: ProviderSelectionCopy) {
  return { ...DEFAULT_PROVIDER_SELECTION_COPY, ...copy };
}

function buildModelRows(
  provider: string,
  providerLabel: string,
  models: AgentModelDefinition[],
  options?: { agentProvider?: string },
): ProviderSelectionModelRow[] {
  const agentProvider = options?.agentProvider ?? provider;
  return models.map((model) => ({
    favoriteKey: buildFavoriteModelKey({ provider, modelId: model.id }),
    provider,
    agentProvider,
    runtimeProvider: provider,
    providerLabel,
    modelId: model.id,
    modelLabel: model.label,
    description: model.description,
    isDefault: model.isDefault,
  }));
}

function buildSyntheticDefaultRow(
  provider: string,
  providerLabel: string,
  copy?: ProviderSelectionCopy,
  options?: { agentProvider?: string },
): ProviderSelectionModelRow {
  const labels = resolveProviderSelectionCopy(copy);
  const agentProvider = options?.agentProvider ?? provider;
  return {
    favoriteKey: buildFavoriteModelKey({ provider, modelId: "" }),
    provider,
    agentProvider,
    runtimeProvider: provider,
    providerLabel,
    modelId: "",
    modelLabel: labels.defaultModelLabel,
    description: undefined,
    isDefault: true,
  };
}

function buildModelSelection(
  provider: string,
  providerLabel: string,
  models: AgentModelDefinition[] | null,
  copy?: ProviderSelectionCopy,
  options?: { agentProvider?: string },
): ProviderModelSelection {
  if (models === null) {
    return { kind: "loading" };
  }
  if (models.length === 0) {
    return {
      kind: "models",
      rows: [buildSyntheticDefaultRow(provider, providerLabel, copy, options)],
    };
  }
  return { kind: "models", rows: buildModelRows(provider, providerLabel, models, options) };
}

function buildEntryModelSelection(
  entry: ProviderSnapshotEntry,
  label: string,
  copy?: ProviderSelectionCopy,
  options?: { agentProvider?: string },
): ProviderModelSelection {
  if ((entry.models?.length ?? 0) > 0) {
    return buildModelSelection(entry.provider, label, entry.models ?? null, copy, options);
  }
  if (entry.status === "ready") {
    return buildModelSelection(entry.provider, label, entry.models ?? null, copy, options);
  }
  if (entry.status === "loading") {
    return { kind: "loading" };
  }
  const labels = resolveProviderSelectionCopy(copy);
  return {
    kind: "error",
    message:
      entry.error ?? (entry.status === "unavailable" ? labels.unavailable : labels.unknownError),
  };
}

export function buildProviderSelectorProviders(input: {
  providerDefinitions: AgentProviderDefinition[];
  modelsByProvider: Map<string, AgentModelDefinition[]>;
  copy?: ProviderSelectionCopy;
}): ProviderSelectorProvider[] {
  return input.providerDefinitions.map((definition) => ({
    id: definition.id,
    label: definition.label,
    modelSelection: buildModelSelection(
      definition.id,
      definition.label,
      input.modelsByProvider.has(definition.id)
        ? (input.modelsByProvider.get(definition.id) ?? [])
        : null,
      input.copy,
    ),
  }));
}

export function buildSelectableProviderSelectorProviders(
  entries: ProviderSnapshotEntry[] | undefined,
  copy?: ProviderSelectionCopy,
): ProviderSelectorProvider[] {
  const enabledEntries = (entries ?? []).filter((entry) => entry.enabled);
  const selectorProviders: ProviderSelectorProvider[] = [];
  const selectorProviderById = new Map<string, ProviderSelectorProvider>();
  const gatewayEntries: SelectableProviderEntry[] = [];

  for (const entry of enabledEntries) {
    const selectableEntry = entry as SelectableProviderEntry;
    if (selectableEntry.modelGatewayId && selectableEntry.derivedFromProviderId) {
      gatewayEntries.push(selectableEntry);
      continue;
    }

    const label = entry.label ?? entry.provider;
    const provider = {
      id: entry.provider,
      label,
      modelSelection: buildEntryModelSelection(entry, label, copy),
      status: entry.status,
      error: entry.error ?? null,
    };
    selectorProviders.push(provider);
    selectorProviderById.set(provider.id, provider);
  }

  for (const entry of gatewayEntries) {
    const label = entry.label ?? entry.provider;
    const targetProvider = selectorProviderById.get(entry.derivedFromProviderId ?? "");
    if (!targetProvider) {
      // Base provider is missing (or this snapshot only has the gateway entry).
      // Surface the gateway as its own selectable provider so running sessions whose
      // agent.provider is the generated id (e.g. "grok-4-5-codex") still list models.
      const standalone = {
        id: entry.provider,
        label,
        modelSelection: buildEntryModelSelection(entry, label, copy),
        status: entry.status,
        error: entry.error ?? null,
      };
      selectorProviders.push(standalone);
      selectorProviderById.set(standalone.id, standalone);
      continue;
    }
    const gatewayModelSelection = buildEntryModelSelection(entry, label, copy, {
      agentProvider: targetProvider.id,
    });
    if (gatewayModelSelection.kind !== "models" || gatewayModelSelection.rows.length === 0) {
      continue;
    }
    if (targetProvider.modelSelection.kind !== "models") {
      targetProvider.modelSelection = {
        kind: "models",
        rows: gatewayModelSelection.rows,
      };
      continue;
    }
    targetProvider.modelSelection = {
      kind: "models",
      rows: [...targetProvider.modelSelection.rows, ...gatewayModelSelection.rows],
    };
  }

  return selectorProviders;
}

export function filterProviderSelectorProvidersByRuntimeProvider(
  providers: ProviderSelectorProvider[],
  runtimeProvider: AgentProvider | string | null | undefined,
): ProviderSelectorProvider[] {
  const normalizedRuntimeProvider = runtimeProvider?.trim();
  if (!normalizedRuntimeProvider) {
    return providers;
  }

  return providers
    .map((provider) => {
      if (provider.modelSelection.kind !== "models") {
        return provider;
      }
      const rows = provider.modelSelection.rows.filter(
        (row) => row.runtimeProvider === normalizedRuntimeProvider,
      );
      if (rows.length === provider.modelSelection.rows.length) {
        return provider;
      }
      return {
        ...provider,
        modelSelection: {
          kind: "models" as const,
          rows,
        },
      };
    })
    .filter(
      (provider) =>
        provider.modelSelection.kind !== "models" || provider.modelSelection.rows.length > 0,
    );
}

export function getProviderModelRows(
  provider: ProviderSelectorProvider,
): ProviderSelectionModelRow[] {
  return provider.modelSelection.kind === "models" ? provider.modelSelection.rows : [];
}

export function getAllProviderModelRows(
  providers: ProviderSelectorProvider[],
): ProviderSelectionModelRow[] {
  return providers.flatMap(getProviderModelRows);
}

/**
 * Returns the snapshot-backed selector row for the given provider when that
 * provider is currently in error. Used by the composer to decorate the
 * selected-model trigger without introducing extra cbar height.
 */
export function findErrorSelectorProvider(
  providers: ProviderSelectorProvider[],
  selectedProvider: string | null | undefined,
): ProviderSelectorProvider | null {
  const providerId = selectedProvider?.trim();
  if (!providerId) {
    return null;
  }
  const provider = providers.find((entry) => entry.id === providerId);
  if (!provider || provider.status !== "error") {
    return null;
  }
  return provider;
}

export function resolveSelectedModelLabel(input: {
  providers: ProviderSelectorProvider[];
  selectedProvider: string;
  selectedRuntimeProvider?: string | null;
  selectedModel: string;
  isLoading: boolean;
  copy?: ProviderSelectionCopy;
}): string {
  const labels = resolveProviderSelectionCopy(input.copy);
  const selectedModel = input.selectedModel.trim();
  const selectedProvider = input.selectedProvider.trim();
  if (!selectedProvider) {
    return labels.selectModel;
  }

  const provider = input.providers.find((entry) => entry.id === selectedProvider);
  const selectedRuntimeProvider = (
    input.selectedRuntimeProvider?.trim() || selectedProvider
  ).trim();
  if (!provider) {
    const groupedModel = getAllProviderModelRows(input.providers).find(
      (entry) =>
        entry.runtimeProvider === selectedProvider &&
        entry.provider === selectedProvider &&
        entry.modelId === selectedModel,
    );
    return (
      groupedModel?.modelLabel ??
      (input.isLoading ? labels.loading : selectedModel || labels.selectModel)
    );
  }
  if (provider.modelSelection.kind === "loading") {
    return input.isLoading ? labels.loading : selectedModel || labels.loading;
  }
  if (provider.modelSelection.kind === "error") {
    return labels.error;
  }
  if (provider.modelSelection.kind !== "models") {
    return labels.selectModel;
  }

  const model = provider.modelSelection.rows.find(
    (entry) => entry.modelId === selectedModel && entry.runtimeProvider === selectedRuntimeProvider,
  );
  const defaultModel = provider.modelSelection.rows.find((row) => row.isDefault);
  return (
    model?.modelLabel ??
    defaultModel?.modelLabel ??
    provider.modelSelection.rows[0]?.modelLabel ??
    labels.selectModel
  );
}

export function buildSelectedTriggerLabel(modelLabel: string): string {
  return modelLabel;
}

export function matchesModelSearch(
  row: ProviderSelectionModelRow,
  normalizedQuery: string,
): boolean {
  return scoreModelRow(row, normalizedQuery) !== null;
}

function getModelRowSearchFields(row: ProviderSelectionModelRow): string[] {
  return [row.modelLabel, row.modelId, row.providerLabel, row.description ?? ""];
}

export function scoreModelRow(row: ProviderSelectionModelRow, normalizedQuery: string) {
  return scoreTextFields(normalizedQuery, getModelRowSearchFields(row));
}

export function filterAndRankModelRows(
  rows: ProviderSelectionModelRow[],
  normalizedQuery: string,
): ProviderSelectionModelRow[] {
  if (!normalizedQuery) return rows;
  const scored = rows
    .map((row) => ({ row, score: scoreModelRow(row, normalizedQuery) }))
    .filter(
      (
        entry,
      ): entry is { row: ProviderSelectionModelRow; score: NonNullable<typeof entry.score> } =>
        Boolean(entry.score),
    );

  scored.sort((a, b) => {
    const cmp = compareMatchScores(a.score, b.score);
    if (cmp !== 0) return cmp;
    return a.row.modelLabel.localeCompare(b.row.modelLabel);
  });

  return scored.map((entry) => entry.row);
}

export function resolveEffectiveComposerModelId(selection: ProviderSelectionState): string {
  return selection.modelId.trim();
}

export function resolveEffectiveComposerThinkingOptionId(
  selection: ProviderSelectionState,
  effectiveModelId: string,
): string {
  const selectedThinkingOptionId = selection.thinkingOptionId.trim();
  if (selectedThinkingOptionId) {
    return selectedThinkingOptionId;
  }

  const selectedModelDefinition =
    selection.availableModels.find((model) => model.id === effectiveModelId) ?? null;
  return selectedModelDefinition?.defaultThinkingOptionId ?? "";
}

export function buildDraftCommandConfig(input: {
  selection: ProviderSelectionState;
  cwd: string;
  effectiveModelId: string;
  effectiveThinkingOptionId: string;
  featureValues?: Record<string, unknown>;
}): DraftCommandConfig | undefined {
  const cwd = input.cwd.trim();
  if (!input.selection.provider || !cwd) {
    return undefined;
  }

  return {
    provider: input.selection.provider,
    ...(input.selection.runtimeProvider &&
    input.selection.runtimeProvider !== input.selection.provider
      ? { runtimeProvider: input.selection.runtimeProvider }
      : {}),
    cwd,
    ...(input.selection.modeOptions.length > 0 && input.selection.modeId !== ""
      ? { modeId: input.selection.modeId }
      : {}),
    ...(input.effectiveModelId ? { model: input.effectiveModelId } : {}),
    ...(input.effectiveThinkingOptionId
      ? { thinkingOptionId: input.effectiveThinkingOptionId }
      : {}),
    ...(input.featureValues ? { featureValues: input.featureValues } : {}),
  };
}

export function resolveSubmissionReadiness(input: {
  text: string;
  allowsEmptyAutoSubmit: boolean;
  providerCount: number;
  selection: {
    provider: AgentProvider | string | null;
    modelId: string;
    availableModels: readonly unknown[];
    isModelLoading: boolean;
  };
  autoSubmitConfig: { provider: string; model: string | null } | null;
  workspaceDirectory: string | null;
  hasClient: boolean;
  copy?: ProviderSelectionCopy;
}): ProviderSelectionReadiness {
  const labels = resolveProviderSelectionCopy(input.copy);
  if (!input.allowsEmptyAutoSubmit && !input.text.trim()) {
    return { ok: false, reason: labels.initialPromptRequired };
  }
  if (input.providerCount === 0) {
    return { ok: false, reason: labels.noProviders };
  }
  if (!(input.autoSubmitConfig?.provider ?? input.selection.provider)) {
    return { ok: false, reason: labels.modelRequired };
  }
  const hasExplicitAutoSubmitModel = Boolean(input.autoSubmitConfig?.model);
  const hasSelectedModel = Boolean(input.autoSubmitConfig?.model ?? input.selection.modelId);
  if (input.selection.isModelLoading && !hasExplicitAutoSubmitModel && !hasSelectedModel) {
    return { ok: false, reason: labels.modelLoading };
  }
  if (!hasSelectedModel && input.selection.availableModels.length > 0) {
    return { ok: false, reason: labels.providerNoModels };
  }
  if (!input.workspaceDirectory) {
    return { ok: false, reason: labels.workspaceDirectoryMissing };
  }
  if (!input.hasClient) {
    return { ok: false, reason: labels.hostDisconnected };
  }
  return { ok: true };
}
