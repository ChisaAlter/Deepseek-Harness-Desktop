import type {
  ProviderSelectionModelRow,
  ProviderSelectorProvider,
} from "@/provider-selection/provider-selection";

export type SelectorView =
  | { kind: "all" }
  | { kind: "provider"; providerId: string; providerLabel: string };

export function resolveSingleProviderView(
  providers: ProviderSelectorProvider[],
): SelectorView | null {
  if (providers.length !== 1) return null;
  const provider = providers[0];
  if (!provider) return null;
  return { kind: "provider", providerId: provider.id, providerLabel: provider.label };
}

export function resolveInitialSelectorView(input: {
  providers: ProviderSelectorProvider[];
  selectedProvider: string;
  selectedModel: string;
  favoriteKeys: Set<string>;
}): SelectorView {
  const singleProviderView = resolveSingleProviderView(input.providers);
  if (singleProviderView) return singleProviderView;

  return { kind: "all" };
}

export function resolveTopLevelFavoriteRows(input: {
  providers: ProviderSelectorProvider[];
  favoriteKeys: Set<string>;
}): ProviderSelectionModelRow[] {
  if (input.favoriteKeys.size === 0) return [];
  return [];
}
