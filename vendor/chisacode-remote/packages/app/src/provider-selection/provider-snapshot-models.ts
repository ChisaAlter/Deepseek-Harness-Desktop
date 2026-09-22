import type { AgentModelDefinition, ProviderSnapshotEntry } from "@chisacode/protocol/agent-types";

export function resolveProviderSnapshotModels(input: {
  runtimeProvider?: string | null;
  runtimeEntry: ProviderSnapshotEntry | null;
  selectedEntry: ProviderSnapshotEntry | null;
}): AgentModelDefinition[] | null {
  const selectedProvider = input.selectedEntry?.provider ?? null;
  const runtimeProvider = input.runtimeProvider?.trim() || null;
  if (runtimeProvider && runtimeProvider !== selectedProvider) {
    return input.runtimeEntry?.models ?? null;
  }
  return input.selectedEntry?.models ?? input.runtimeEntry?.models ?? null;
}
