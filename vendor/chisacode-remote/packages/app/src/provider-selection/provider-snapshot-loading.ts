import type { ProviderSnapshotEntry } from "@chisacode/protocol/agent-types";

export function isProviderEntryLoading(input: {
  runtimeProvider?: string | null;
  runtimeEntry: ProviderSnapshotEntry | null;
  selectedEntry: ProviderSnapshotEntry | null;
}): boolean {
  const selectedProvider = input.selectedEntry?.provider ?? null;
  const runtimeProvider = input.runtimeProvider?.trim() || null;
  if (runtimeProvider && runtimeProvider !== selectedProvider) {
    return input.runtimeEntry?.status === "loading";
  }
  if (input.selectedEntry) {
    return input.selectedEntry.status === "loading";
  }
  return input.runtimeEntry?.status === "loading";
}

export function resolveProviderSnapshotLoadingState(input: {
  snapshotIsLoading: boolean;
  snapshotEntries: ProviderSnapshotEntry[] | undefined;
  selectedProviderIsLoading: boolean;
}): { isAllModelsLoading: boolean; isModelLoading: boolean } {
  const hasSnapshotEntries = (input.snapshotEntries?.length ?? 0) > 0;
  const isInitialSnapshotLoading = input.snapshotIsLoading && !hasSnapshotEntries;
  return {
    isAllModelsLoading: isInitialSnapshotLoading,
    isModelLoading: isInitialSnapshotLoading || input.selectedProviderIsLoading,
  };
}
