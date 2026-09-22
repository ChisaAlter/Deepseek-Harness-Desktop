import type { ProviderSnapshotEntry } from "@chisacode/protocol/agent-types";
import {
  AGENT_PROVIDER_DEFINITIONS,
  DEV_AGENT_PROVIDER_DEFINITIONS,
  type AgentModeColorTier,
  type AgentModeIcon,
  type AgentProviderDefinition,
  type AgentProviderModeDefinition,
} from "@chisacode/protocol/provider-manifest";

const BUILT_IN_PROVIDER_DEFINITION_MAP = new Map(
  [...AGENT_PROVIDER_DEFINITIONS, ...DEV_AGENT_PROVIDER_DEFINITIONS].map((definition) => [
    definition.id,
    definition,
  ]),
);

function resolveBuiltInProviderDefinition(
  entry: ProviderSnapshotEntry,
): AgentProviderDefinition | undefined {
  return BUILT_IN_PROVIDER_DEFINITION_MAP.get(entry.provider);
}

function buildProviderModes(entry: ProviderSnapshotEntry): AgentProviderModeDefinition[] {
  const builtInDefinition = resolveBuiltInProviderDefinition(entry);
  const entryModes = entry.modes?.length ? entry.modes : (builtInDefinition?.modes ?? []);

  return entryModes.map((mode) =>
    Object.assign({}, mode, {
      icon: (mode.icon ?? "ShieldCheck") as AgentModeIcon,
      colorTier: (mode.colorTier ?? "moderate") as AgentModeColorTier,
    }),
  );
}

/**
 * Builds UI provider definitions from daemon provider snapshot entries
 * @param snapshotEntries Provider entries from server_info/providers, if any
 * @returns Provider definitions with labels, modes, and defaults filled from builtins
 */
export function buildProviderDefinitions(
  snapshotEntries: ProviderSnapshotEntry[] | undefined,
): AgentProviderDefinition[] {
  if (!snapshotEntries?.length) {
    return [];
  }

  return snapshotEntries.map((entry) => {
    const builtInDefinition = resolveBuiltInProviderDefinition(entry);
    return {
      id: entry.provider,
      label: entry.label ?? builtInDefinition?.label ?? entry.provider,
      description: entry.description ?? builtInDefinition?.description ?? "",
      defaultModeId: entry.defaultModeId ?? builtInDefinition?.defaultModeId ?? null,
      modes: buildProviderModes(entry),
    };
  });
}

/**
 * Resolves a display label for a provider id from snapshot entries
 * @param provider Provider id to label
 * @param snapshotEntries Provider entries from the daemon snapshot, if any
 * @returns Snapshot label when present, otherwise the raw provider id
 */
export function resolveProviderLabel(
  provider: string,
  snapshotEntries: ProviderSnapshotEntry[] | undefined,
): string {
  return snapshotEntries?.find((entry) => entry.provider === provider)?.label ?? provider;
}

/**
 * Resolves a full provider definition for a provider id
 * @param provider Provider id to resolve
 * @param snapshotEntries Provider entries from the daemon snapshot, if any
 * @returns Matching definition, or undefined when the provider is unknown
 */
export function resolveProviderDefinition(
  provider: string,
  snapshotEntries: ProviderSnapshotEntry[] | undefined,
): AgentProviderDefinition | undefined {
  return buildProviderDefinitions(snapshotEntries).find((definition) => definition.id === provider);
}
