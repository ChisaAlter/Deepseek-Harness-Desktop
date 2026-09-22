/**
 * Unified model catalog — aggregates model definitions from all providers
 * into a single queryable list.
 *
 * Static models (Claude) come from hardcoded definitions; dynamic models
 * (Codex, OpenCode) are fetched at runtime via each provider's listModels().
 * This module provides the aggregation layer so consumers (WebSocket snapshot,
 * model selector, usage tracking) don't need to know per-provider details.
 */

import type { AgentModelDefinition, ModelCost } from "./agent-sdk-types.js";

export interface CatalogModelEntry extends AgentModelDefinition {
  /** Which provider runtime this model belongs to. */
  provider: string;
}

export interface ModelCatalogSnapshot {
  /** All known models across providers, deduplicated by (provider, id). */
  models: CatalogModelEntry[];
  /** Unix ms when this snapshot was assembled. */
  assembledAt: number;
}

/**
 * Merge model lists from multiple providers into a unified catalog.
 * Later providers' models are appended; duplicates within the same provider
 * are removed (first-wins by id).
 */
export function buildModelCatalog(
  providerModels: ReadonlyArray<{ provider: string; models: AgentModelDefinition[] }>,
): ModelCatalogSnapshot {
  const seen = new Set<string>();
  const models: CatalogModelEntry[] = [];

  for (const { provider, models: defs } of providerModels) {
    for (const def of defs) {
      const key = `${provider}\0${def.id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      models.push({ ...def, provider });
    }
  }

  return { models, assembledAt: Date.now() };
}

/** Look up a model by (provider, id). Case-insensitive on the id to tolerate
 * provider drift (e.g. "Claude-Opus-4-8" vs "claude-opus-4-8"). Returns undefined
 * when not found — callers MUST handle the miss explicitly instead of relying
 * on a silent fallback, which could pick the most expensive model in the catalog. */
export function findCatalogModel(
  catalog: ModelCatalogSnapshot,
  provider: string,
  modelId: string,
): CatalogModelEntry | undefined {
  const needle = modelId.toLowerCase();
  return catalog.models.find((m) => m.provider === provider && m.id.toLowerCase() === needle);
}

/** All models for a specific provider. */
export function modelsForProvider(
  catalog: ModelCatalogSnapshot,
  provider: string,
): CatalogModelEntry[] {
  return catalog.models.filter((m) => m.provider === provider);
}

/** The default model for a provider. Returns the first model flagged isDefault.
 * Returns undefined when no model is flagged and there are no provider models —
 * callers must handle the undefined case explicitly rather than silently falling
 * back to an arbitrary (potentially expensive) first-listed model. */
export function defaultModelForProvider(
  catalog: ModelCatalogSnapshot,
  provider: string,
): CatalogModelEntry | undefined {
  const providerModels = modelsForProvider(catalog, provider);
  return providerModels.find((m) => m.isDefault) ?? providerModels[0];
}

/**
 * Format a context window token count for display: "1M", "200K", "8192".
 * Shared utility so server and clients format consistently.
 */
export function formatContextWindow(tokens: number): string {
  if (tokens >= 1_000_000) {
    const m = tokens / 1_000_000;
    return `${Number.isInteger(m) ? m : Number(m.toFixed(1))}M`;
  }
  if (tokens >= 1000) {
    const k = tokens / 1000;
    return `${Number.isInteger(k) ? k : Number(k.toFixed(0))}K`;
  }
  return String(tokens);
}

/**
 * Estimate the cost of a turn in USD given token counts and model pricing.
 * Returns null when the model has no cost data.
 */
export function estimateTurnCost(
  cost: ModelCost | undefined,
  tokens: { input: number; output: number; cacheRead?: number; cacheWrite?: number },
): number | null {
  // A cost object that exists but has no numeric fields (e.g. `{}`) means
  // "unknown pricing", not "free". Return null so the UI shows "—" instead of $0.00.
  if (
    !cost ||
    (cost.input == null && cost.output == null && cost.cacheRead == null && cost.cacheWrite == null)
  ) {
    return null;
  }
  const input = Math.max(0, tokens.input);
  const output = Math.max(0, tokens.output);
  const cacheRead = Math.max(0, tokens.cacheRead ?? 0);
  const cacheWrite = Math.max(0, tokens.cacheWrite ?? 0);
  let total = 0;
  if (cost.input) total += (input / 1_000_000) * cost.input;
  if (cost.output) total += (output / 1_000_000) * cost.output;
  // Use != null so a literal 0 rate (free cache reads) is still applied rather
  // than silently skipped by a truthy check.
  if (cost.cacheRead != null && cacheRead > 0) total += (cacheRead / 1_000_000) * cost.cacheRead;
  if (cost.cacheWrite != null && cacheWrite > 0)
    total += (cacheWrite / 1_000_000) * cost.cacheWrite;
  return total;
}
