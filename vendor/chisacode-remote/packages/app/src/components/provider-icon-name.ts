export type BuiltinProviderIconName =
  | "claude"
  | "codex"
  | "kimi"
  | "opencode"
  | "pi"
  | "grokbuild"
  | "dsh";

export type ProviderIconName = { kind: "builtin"; id: BuiltinProviderIconName } | { kind: "bot" };

const BUILTIN_PROVIDER_IDS: ReadonlySet<BuiltinProviderIconName> = new Set([
  "claude",
  "codex",
  "kimi",
  "opencode",
  "pi",
  "grokbuild",
  "dsh",
]);

// Provider tokens with varied lengths first (opencode/grokbuild outrank shorter ids); "dsh" likewise wins any dsh-branded face.
const BUILTIN_PROVIDER_ICON_MATCHERS: readonly BuiltinProviderIconName[] = [
  "opencode",
  "grokbuild",
  "dsh",
  "claude",
  "codex",
  "kimi",
  "pi",
];

function matchesBuiltinProviderFamily(
  normalizedProvider: string,
  builtinId: BuiltinProviderIconName,
): boolean {
  if (normalizedProvider === builtinId) {
    return true;
  }
  // Custom / gateway providers often look like "deepseek-codex", "codex-work", or
  // "custom-codex-profile". Match whole-token boundaries only.
  const token = builtinId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?:^|[-_./])${token}(?:$|[-_./])`).test(normalizedProvider);
}

/**
 * Resolves which sidebar/composer provider icon to show for an agent provider id.
 * Exact built-ins win; custom providers that extend a family (e.g. `deepseek-codex`)
 * inherit that family's icon.
 */
export function resolveProviderIconName(provider: string): ProviderIconName {
  const normalized = provider.trim().toLowerCase();
  if (!normalized) {
    return { kind: "bot" };
  }
  if (BUILTIN_PROVIDER_IDS.has(normalized as BuiltinProviderIconName)) {
    return { kind: "builtin", id: normalized as BuiltinProviderIconName };
  }
  for (const builtinId of BUILTIN_PROVIDER_ICON_MATCHERS) {
    if (matchesBuiltinProviderFamily(normalized, builtinId)) {
      return { kind: "builtin", id: builtinId };
    }
  }
  return { kind: "bot" };
}
