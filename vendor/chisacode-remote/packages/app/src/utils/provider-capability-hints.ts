/** Identifies a product capability that may vary by agent provider */
export type ProviderCapabilityHintId =
  | "resume"
  | "permissions"
  | "sandbox"
  | "subagents"
  | "mcp"
  | "headless";

/** A single capability hint paired with its support flag for a provider */
export interface ProviderCapabilityHint {
  id: ProviderCapabilityHintId;
  supported: boolean;
}

/** Aggregate counts describing how many capability hints are supported */
export interface ProviderCapabilityHintSummary {
  supportedCount: number;
  unsupportedCount: number;
  totalCount: number;
}

/** Localized labels and formatters used to render a capability hint summary */
export interface ProviderCapabilityHintSummaryLabels {
  title: string;
  supportedLabel: string;
  limitedLabel: string;
  formatCount: (input: { supported: number; total: number }) => string;
  labelForHint: (id: ProviderCapabilityHintId) => string;
}

const DEFAULT_HINTS: readonly ProviderCapabilityHint[] = [
  { id: "resume", supported: true },
  { id: "permissions", supported: true },
  { id: "sandbox", supported: true },
  { id: "subagents", supported: false },
  { id: "mcp", supported: false },
  { id: "headless", supported: true },
];

const PROVIDER_HINT_OVERRIDES: Record<
  string,
  Partial<Record<ProviderCapabilityHintId, boolean>>
> = {
  claude: {
    subagents: true,
    mcp: true,
  },
  codex: {
    mcp: true,
    subagents: true,
  },
  opencode: {
    mcp: true,
  },
  // dsh's ACP transport advertises no session/load; resume stays unsupported.
  dsh: {
    resume: false,
  },
};

const PROVIDER_HINT_ALIASES: Record<string, readonly string[]> = {
  claude: ["claude", "claude-code"],
  codex: ["codex", "codex-cli"],
  opencode: ["opencode", "open-code"],
  goose: ["goose"],
  cline: ["cline"],
  cursor: ["cursor"],
  dsh: ["dsh", "deepseek-harness"],
};

function normalizeProviderId(provider: string | null | undefined): string {
  return (provider ?? "")
    .trim()
    .toLowerCase()
    .replace(/[_\s]+/g, "-");
}

function resolveProviderHintKey(provider: string | null | undefined): string | null {
  const normalized = normalizeProviderId(provider);
  if (!normalized) {
    return null;
  }
  if (PROVIDER_HINT_OVERRIDES[normalized]) {
    return normalized;
  }
  const tokens = normalized.split(/[^a-z0-9]+/).filter(Boolean);
  for (const [providerKey, aliases] of Object.entries(PROVIDER_HINT_ALIASES)) {
    if (aliases.some((alias) => matchesProviderAlias(tokens, alias))) {
      return providerKey;
    }
  }
  return null;
}

function matchesProviderAlias(tokens: readonly string[], alias: string): boolean {
  const aliasTokens = alias.split(/[^a-z0-9]+/).filter(Boolean);
  if (aliasTokens.length === 0 || aliasTokens.length > tokens.length) {
    return false;
  }
  for (let start = 0; start <= tokens.length - aliasTokens.length; start += 1) {
    if (aliasTokens.every((aliasToken, index) => tokens[start + index] === aliasToken)) {
      return true;
    }
  }
  return false;
}

/**
 * Resolves the capability hints for a provider, applying known per-provider overrides on top of the defaults
 * @param provider Provider id or display name to match against known aliases
 * @returns The capability hint list with per-capability support flags
 */
export function getProviderCapabilityHints(provider: string | null | undefined) {
  const providerHintKey = resolveProviderHintKey(provider);
  const overrides = providerHintKey ? PROVIDER_HINT_OVERRIDES[providerHintKey] : {};
  return DEFAULT_HINTS.map((hint) => ({
    id: hint.id,
    supported: overrides[hint.id] ?? hint.supported,
  }));
}

/**
 * Counts supported and unsupported hints in a capability hint list
 * @param hints The capability hints to summarize
 * @returns The supported, unsupported, and total hint counts
 */
export function summarizeProviderCapabilityHints(
  hints: readonly ProviderCapabilityHint[],
): ProviderCapabilityHintSummary {
  let supportedCount = 0;
  for (const hint of hints) {
    if (hint.supported) {
      supportedCount += 1;
    }
  }
  return {
    supportedCount,
    unsupportedCount: hints.length - supportedCount,
    totalCount: hints.length,
  };
}

/**
 * Builds a human-readable summary label listing supported and limited capabilities
 * @param hints The capability hints to describe
 * @param labels Localized labels and formatters used to compose the summary text
 * @returns The composed summary label
 */
export function buildProviderCapabilityHintSummaryLabel(
  hints: readonly ProviderCapabilityHint[],
  labels: ProviderCapabilityHintSummaryLabels,
): string {
  const summary = summarizeProviderCapabilityHints(hints);
  const supported = hints
    .filter((hint) => hint.supported)
    .map((hint) => labels.labelForHint(hint.id));
  const limited = hints
    .filter((hint) => !hint.supported)
    .map((hint) => labels.labelForHint(hint.id));
  const parts = [
    `${labels.title} ${labels.formatCount({
      supported: summary.supportedCount,
      total: summary.totalCount,
    })}`,
  ];
  if (supported.length > 0) {
    parts.push(`${labels.supportedLabel}: ${supported.join(", ")}`);
  }
  if (limited.length > 0) {
    parts.push(`${labels.limitedLabel}: ${limited.join(", ")}`);
  }
  return parts.join(". ");
}
