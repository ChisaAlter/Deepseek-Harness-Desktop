import { useMemo } from "react";
import type { AgentModelDefinition, ProviderSnapshotEntry } from "@chisacode/protocol/agent-types";
import type { AgentProviderDefinition } from "@chisacode/protocol/provider-manifest";

import {
  buildProviderSelectorProviders,
  buildSelectableProviderSelectorProviders,
  filterProviderSelectorProvidersByRuntimeProvider,
  type ProviderSelectorProvider,
} from "@/provider-selection/provider-selection";
import { resolveRunningAgentModelLoading } from "@/composer/agent-controls/model-loading";
import {
  formatThinkingOptionLabel,
  resolveAgentModelSelection,
} from "@/composer/agent-controls/utils";
import { buildFavoriteModelKey } from "@/hooks/use-form-preferences";
import { resolveProviderDefinition } from "@/utils/provider-definitions";

interface RunningAgentModelAgent {
  provider: string;
  runtimeProvider: string | null;
  runtimeModelId: string | null;
  model: string | null | undefined;
  thinkingOptionId: string | null | undefined;
}

interface RunningAgentModelControlsInput {
  agent: RunningAgentModelAgent | null;
  snapshotEntries: ProviderSnapshotEntry[] | undefined;
  defaultModelLabel: string;
  unavailable: string;
  unknownError: string;
}

function resolveSnapshotSelectedEntry(
  snapshotEntries: ProviderSnapshotEntry[] | undefined,
  agentProvider: string | undefined,
) {
  if (!snapshotEntries || !agentProvider) {
    return null;
  }
  return snapshotEntries.find((entry) => entry.provider === agentProvider) ?? null;
}

function buildAgentProviderDefinitions(
  agentProvider: string | undefined,
  snapshotEntries: ProviderSnapshotEntry[] | undefined,
): AgentProviderDefinition[] {
  const definition = agentProvider
    ? resolveProviderDefinition(agentProvider, snapshotEntries)
    : undefined;
  return definition ? [definition] : [];
}

function buildAgentProviderModels(
  agentProvider: string | undefined,
  models: AgentModelDefinition[] | null,
): Map<string, AgentModelDefinition[]> {
  const map = new Map<string, AgentModelDefinition[]>();
  if (agentProvider && models) {
    map.set(agentProvider, models);
  }
  return map;
}

function resolveAgentRuntimeProvider(agent: RunningAgentModelAgent | null): string | null {
  return agent?.runtimeProvider ?? agent?.provider ?? null;
}

function resolveProviderModels(input: {
  runtimeEntry: ProviderSnapshotEntry | null;
  selectedEntry: ProviderSnapshotEntry | null;
}): AgentModelDefinition[] | null {
  return input.runtimeEntry?.models ?? input.selectedEntry?.models ?? null;
}

function resolveProviderFamilyId(
  agentProvider: string | undefined,
  snapshotEntries: ProviderSnapshotEntry[] | undefined,
): string | undefined {
  if (!agentProvider) {
    return undefined;
  }
  return (
    snapshotEntries?.find((entry) => entry.provider === agentProvider)?.derivedFromProviderId ??
    agentProvider
  );
}

function remapSelectorProviderForAgent(
  provider: ProviderSelectorProvider,
  agentProvider: string,
): ProviderSelectorProvider {
  if (provider.modelSelection.kind !== "models") {
    return { ...provider, id: agentProvider };
  }
  return {
    ...provider,
    id: agentProvider,
    modelSelection: {
      kind: "models",
      rows: provider.modelSelection.rows.map((row) => ({ ...row, agentProvider })),
    },
  };
}

/**
 * Resolves the provider family for a running agent before projecting selectable rows.
 * Derived provider ids are runtime identities, not separate model families.
 */
function filterProvidersForRunningAgent(
  providers: ProviderSelectorProvider[],
  agentProvider: string | undefined,
  snapshotEntries?: ProviderSnapshotEntry[],
): ProviderSelectorProvider[] {
  if (!agentProvider) {
    return providers;
  }

  const familyProviderId = resolveProviderFamilyId(agentProvider, snapshotEntries);
  const familyProvider = providers.find((provider) => provider.id === familyProviderId);
  const exactProvider = providers.find((provider) => provider.id === agentProvider);
  if (familyProvider && exactProvider && familyProvider !== exactProvider) {
    if (
      familyProvider.modelSelection.kind === "models" &&
      exactProvider.modelSelection.kind === "models"
    ) {
      return [
        remapSelectorProviderForAgent(
          {
            ...familyProvider,
            modelSelection: {
              kind: "models",
              rows: [...familyProvider.modelSelection.rows, ...exactProvider.modelSelection.rows],
            },
          },
          agentProvider,
        ),
      ];
    }
    return [remapSelectorProviderForAgent(familyProvider, agentProvider)];
  }
  if (familyProvider) {
    return [remapSelectorProviderForAgent(familyProvider, agentProvider)];
  }

  const exact = exactProvider;
  if (exact) {
    return [exact];
  }

  const matched: ProviderSelectorProvider[] = [];
  for (const provider of providers) {
    if (provider.modelSelection.kind !== "models") {
      continue;
    }
    const rows = provider.modelSelection.rows.filter(
      (row) =>
        row.runtimeProvider === agentProvider ||
        row.provider === agentProvider ||
        row.agentProvider === agentProvider,
    );
    if (rows.length === 0) {
      continue;
    }
    matched.push(
      remapSelectorProviderForAgent(
        {
          ...provider,
          modelSelection: { kind: "models", rows },
        },
        agentProvider,
      ),
    );
  }
  return matched;
}

function buildStandaloneGatewayModelSelection(
  entry: ProviderSnapshotEntry,
  label: string,
  copy: {
    unavailable: string;
    unknownError: string;
  },
): ProviderSelectorProvider["modelSelection"] {
  const models = entry.models ?? [];
  if (models.length > 0) {
    return {
      kind: "models",
      rows: models.map((model) => ({
        favoriteKey: buildFavoriteModelKey({
          provider: entry.provider,
          modelId: model.id,
        }),
        provider: entry.provider,
        agentProvider: entry.provider,
        runtimeProvider: entry.provider,
        providerLabel: label,
        modelId: model.id,
        modelLabel: model.label,
        description: model.description,
        isDefault: model.isDefault,
      })),
    };
  }
  if (entry.status === "loading") {
    return { kind: "loading" };
  }
  return {
    kind: "error",
    message: entry.error ?? (entry.status === "unavailable" ? copy.unavailable : copy.unknownError),
  };
}

function buildStandaloneGatewaySelectorProviders(
  entry: ProviderSnapshotEntry,
  copy: {
    defaultModelLabel: string;
    unavailable: string;
    unknownError: string;
  },
): ProviderSelectorProvider[] {
  const selectableEntry = entry as ProviderSnapshotEntry & {
    derivedFromProviderId?: string | null;
    modelGatewayId?: string | null;
  };
  // When the only matching entry is a gateway, buildSelectable drops it unless
  // its base is also present. Force a top-level provider for the running agent.
  if (selectableEntry.modelGatewayId && selectableEntry.derivedFromProviderId) {
    const label = entry.label ?? entry.provider;
    return [
      {
        id: entry.provider,
        label,
        modelSelection: buildStandaloneGatewayModelSelection(entry, label, copy),
      },
    ];
  }
  return buildSelectableProviderSelectorProviders([entry], copy);
}

function buildRunningAgentModelSelectorProviders(input: {
  agentProvider: string | undefined;
  agentRuntimeProvider: string | null;
  snapshotEntries: ProviderSnapshotEntry[] | undefined;
  selectedEntry: ProviderSnapshotEntry | null;
  providerDefinitions: AgentProviderDefinition[];
  modelsByProvider: Map<string, AgentModelDefinition[]>;
  copy: {
    defaultModelLabel: string;
    unavailable: string;
    unknownError: string;
  };
}): ProviderSelectorProvider[] {
  // Running sessions may have runtimeProvider set to a gateway id (e.g.
  // grok-4-5-codex) while agent.provider stays the base family (codex). The
  // model picker must still list every model under that base provider so the
  // user can switch back to native GPT models; do not filter the list down to
  // only the currently active runtime gateway.
  const selectorProviders = buildSelectableProviderSelectorProviders(input.snapshotEntries, {
    defaultModelLabel: input.copy.defaultModelLabel,
    unavailable: input.copy.unavailable,
    unknownError: input.copy.unknownError,
  });
  const groupedProviders = filterProvidersForRunningAgent(
    selectorProviders,
    input.agentProvider,
    input.snapshotEntries,
  );
  if (groupedProviders.length > 0) {
    return groupedProviders;
  }

  // Gateway-only agent.provider (agent.provider === generated id): fall back to
  // runtime-scoped rows, then the selected gateway entry alone.
  if (input.agentRuntimeProvider && input.agentRuntimeProvider !== input.agentProvider) {
    const runtimeScoped = filterProviderSelectorProvidersByRuntimeProvider(
      buildSelectableProviderSelectorProviders(input.snapshotEntries, {
        defaultModelLabel: input.copy.defaultModelLabel,
        unavailable: input.copy.unavailable,
        unknownError: input.copy.unknownError,
      }),
      input.agentRuntimeProvider,
    );
    if (runtimeScoped.length > 0) {
      return runtimeScoped;
    }
  }

  if (input.selectedEntry) {
    return buildStandaloneGatewaySelectorProviders(input.selectedEntry, {
      defaultModelLabel: input.copy.defaultModelLabel,
      unavailable: input.copy.unavailable,
      unknownError: input.copy.unknownError,
    });
  }
  return buildProviderSelectorProviders({
    providerDefinitions: input.providerDefinitions,
    modelsByProvider: input.modelsByProvider,
    copy: {
      defaultModelLabel: input.copy.defaultModelLabel,
    },
  });
}

export function resolveRunningAgentModelControls(input: RunningAgentModelControlsInput) {
  const { agent, snapshotEntries } = input;
  const agentProvider = agent?.provider;
  const agentRuntimeProvider = resolveAgentRuntimeProvider(agent);
  const snapshotSelectedEntry = resolveSnapshotSelectedEntry(snapshotEntries, agentProvider);
  const snapshotRuntimeEntry = resolveSnapshotSelectedEntry(
    snapshotEntries,
    agentRuntimeProvider ?? undefined,
  );
  const models = resolveProviderModels({
    runtimeEntry: snapshotRuntimeEntry,
    selectedEntry: snapshotSelectedEntry,
  });
  const selectedProviderIsLoading = resolveRunningAgentModelLoading({
    configuredModelId: agent?.model,
    runtimeModelId: agent?.runtimeModelId,
    runtimeProvider: agentRuntimeProvider,
    runtimeEntry: snapshotRuntimeEntry,
    selectedEntry: snapshotSelectedEntry,
  });
  const providerDefinitions = buildAgentProviderDefinitions(agentProvider, snapshotEntries);
  const modelsByProvider = buildAgentProviderModels(agentProvider, models);
  const agentModelSelectorProviders = buildRunningAgentModelSelectorProviders({
    agentProvider,
    agentRuntimeProvider,
    snapshotEntries,
    selectedEntry: snapshotSelectedEntry,
    providerDefinitions,
    modelsByProvider,
    copy: {
      defaultModelLabel: input.defaultModelLabel,
      unavailable: input.unavailable,
      unknownError: input.unknownError,
    },
  });
  const modelSelection = resolveAgentModelSelection({
    models,
    runtimeModelId: agent?.runtimeModelId,
    configuredModelId: agent?.model,
    explicitThinkingOptionId: agent?.thinkingOptionId,
  });
  const modelOptions = (models ?? []).map((model) => ({ id: model.id, label: model.label }));
  const thinkingOptions = (modelSelection.thinkingOptions ?? []).map((option) => ({
    id: option.id,
    label: formatThinkingOptionLabel(option),
  }));

  return {
    agentProvider,
    agentRuntimeProvider,
    agentModelSelectorProviders,
    modelOptions,
    modelSelection,
    selectedProviderIsLoading,
    thinkingOptions,
  };
}

export function useRunningAgentModelControls(input: RunningAgentModelControlsInput) {
  const { agent, defaultModelLabel, snapshotEntries, unavailable, unknownError } = input;
  return useMemo(
    () =>
      resolveRunningAgentModelControls({
        agent,
        defaultModelLabel,
        snapshotEntries,
        unavailable,
        unknownError,
      }),
    [agent, defaultModelLabel, snapshotEntries, unavailable, unknownError],
  );
}
