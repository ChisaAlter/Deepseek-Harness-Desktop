import type { ProviderSnapshotEntry } from "@chisacode/protocol/agent-types";
import type { MutableDaemonConfig, MutableDaemonConfigPatch } from "@chisacode/protocol/messages";

type ProviderConfig = MutableDaemonConfig["providers"][string];
type ProviderModel = NonNullable<ProviderConfig["additionalModels"]>[number];

export interface CustomModelEntry {
  id: string;
  label: string;
  providerIds: string[];
  providers: SelectableCustomModelProvider[];
}

export interface SelectableCustomModelProvider {
  id: string;
  label: string;
}

export interface SaveCustomModelInput {
  currentProviders: MutableDaemonConfig["providers"] | undefined;
  previousId?: string | null;
  id: string;
  label?: string | null;
  providerIds: string[];
}

function normalizeModelId(value: string | null | undefined): string {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeModelLabel(label: string | null | undefined, id: string): string {
  const trimmed = typeof label === "string" ? label.trim() : "";
  return trimmed || id;
}

function buildProviderLabelMap(entries: ProviderSnapshotEntry[] | undefined): Map<string, string> {
  return new Map((entries ?? []).map((entry) => [entry.provider, entry.label ?? entry.provider]));
}

function sortByLabel<T extends { label: string; id: string }>(items: T[]): T[] {
  return [...items].sort((a, b) => {
    const labelCompare = a.label.localeCompare(b.label);
    if (labelCompare !== 0) return labelCompare;
    return a.id.localeCompare(b.id);
  });
}

function dedupeModels(models: ProviderModel[], model: ProviderModel): ProviderModel[] {
  return [...models.filter((entry) => entry.id !== model.id), model];
}

function removeModelIds(models: ProviderModel[], modelIds: Set<string>): ProviderModel[] {
  if (modelIds.size === 0) return models;
  return models.filter((model) => !modelIds.has(model.id));
}

function modelArraysEqual(a: ProviderModel[], b: ProviderModel[]): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

function addProviderPatchIfChanged(
  patchProviders: NonNullable<MutableDaemonConfigPatch["providers"]>,
  providerId: string,
  currentModels: ProviderModel[],
  nextModels: ProviderModel[],
): void {
  if (modelArraysEqual(currentModels, nextModels)) return;
  patchProviders[providerId] = { additionalModels: nextModels };
}

export function getSelectableCustomModelProviders(
  entries: ProviderSnapshotEntry[] | undefined,
): SelectableCustomModelProvider[] {
  return sortByLabel(
    (entries ?? [])
      .filter((entry) => entry.enabled !== false && entry.status !== "unavailable")
      .map((entry) => ({ id: entry.provider, label: entry.label ?? entry.provider })),
  );
}

export function collectCustomModels(input: {
  providers: MutableDaemonConfig["providers"] | undefined;
  snapshotEntries?: ProviderSnapshotEntry[] | undefined;
}): CustomModelEntry[] {
  const labelByProvider = buildProviderLabelMap(input.snapshotEntries);
  const modelsById = new Map<string, CustomModelEntry>();

  for (const [providerId, providerConfig] of Object.entries(input.providers ?? {})) {
    const providerLabel = labelByProvider.get(providerId) ?? providerId;
    for (const model of providerConfig.additionalModels ?? []) {
      const id = normalizeModelId(model.id);
      if (!id) continue;
      const label = normalizeModelLabel(model.label, id);
      const existing = modelsById.get(id);
      if (!existing) {
        modelsById.set(id, {
          id,
          label,
          providerIds: [providerId],
          providers: [{ id: providerId, label: providerLabel }],
        });
        continue;
      }
      if (existing.label === existing.id && label !== id) {
        existing.label = label;
      }
      if (!existing.providerIds.includes(providerId)) {
        existing.providerIds.push(providerId);
        existing.providers.push({ id: providerId, label: providerLabel });
      }
    }
  }

  return sortByLabel(
    Array.from(modelsById.values()).map((model) => {
      const providers = sortByLabel(model.providers);
      return {
        id: model.id,
        label: model.label,
        providerIds: providers.map((provider) => provider.id),
        providers,
      };
    }),
  );
}

export function buildSaveCustomModelPatch(input: SaveCustomModelInput): MutableDaemonConfigPatch {
  const id = normalizeModelId(input.id);
  if (!id) {
    throw new Error("Model ID is required");
  }

  const selectedProviderIds = Array.from(new Set(input.providerIds.map(normalizeModelId))).filter(
    Boolean,
  );
  if (selectedProviderIds.length === 0) {
    throw new Error("Select at least one provider");
  }

  const previousId = normalizeModelId(input.previousId);
  const idsToRemove = new Set([id, previousId].filter(Boolean));
  const model = { id, label: normalizeModelLabel(input.label, id) };
  const currentProviders = input.currentProviders ?? {};
  const providerIds = new Set([...Object.keys(currentProviders), ...selectedProviderIds]);
  const patchProviders: NonNullable<MutableDaemonConfigPatch["providers"]> = {};

  for (const providerId of providerIds) {
    const currentModels = currentProviders[providerId]?.additionalModels ?? [];
    const withoutEditedModel = removeModelIds(currentModels, idsToRemove);
    const nextModels = selectedProviderIds.includes(providerId)
      ? dedupeModels(withoutEditedModel, model)
      : withoutEditedModel;
    addProviderPatchIfChanged(patchProviders, providerId, currentModels, nextModels);
  }

  return { providers: patchProviders };
}

export function buildDeleteCustomModelPatch(input: {
  currentProviders: MutableDaemonConfig["providers"] | undefined;
  id: string;
}): MutableDaemonConfigPatch {
  const id = normalizeModelId(input.id);
  if (!id) {
    throw new Error("Model ID is required");
  }

  const patchProviders: NonNullable<MutableDaemonConfigPatch["providers"]> = {};
  for (const [providerId, providerConfig] of Object.entries(input.currentProviders ?? {})) {
    const currentModels = providerConfig.additionalModels ?? [];
    const nextModels = currentModels.filter((model) => model.id !== id);
    addProviderPatchIfChanged(patchProviders, providerId, currentModels, nextModels);
  }

  return { providers: patchProviders };
}

export function buildAddCustomModelToProviderPatch(input: {
  currentProviders: MutableDaemonConfig["providers"] | undefined;
  providerId: string;
  id: string;
  label?: string | null;
}): MutableDaemonConfigPatch {
  const id = normalizeModelId(input.id);
  if (!id) {
    throw new Error("Model ID is required");
  }

  const model = { id, label: normalizeModelLabel(input.label, id) };
  const currentModels = input.currentProviders?.[input.providerId]?.additionalModels ?? [];
  const nextModels = dedupeModels(currentModels, model);
  const patchProviders: NonNullable<MutableDaemonConfigPatch["providers"]> = {};
  addProviderPatchIfChanged(patchProviders, input.providerId, currentModels, nextModels);
  return { providers: patchProviders };
}

export function buildDeleteCustomModelFromProviderPatch(input: {
  currentProviders: MutableDaemonConfig["providers"] | undefined;
  providerId: string;
  id: string;
}): MutableDaemonConfigPatch {
  const id = normalizeModelId(input.id);
  if (!id) {
    throw new Error("Model ID is required");
  }

  const currentModels = input.currentProviders?.[input.providerId]?.additionalModels ?? [];
  const nextModels = currentModels.filter((model) => model.id !== id);
  const patchProviders: NonNullable<MutableDaemonConfigPatch["providers"]> = {};
  addProviderPatchIfChanged(patchProviders, input.providerId, currentModels, nextModels);
  return { providers: patchProviders };
}
