/**
 * PriceCalculator: the pure pricing face of the session-cost row.
 *
 * The official DeepSeek table carries each period's own published prices —
 * one idle and one peak column per bucket per model — and billing reads the
 * column of the bucket's period directly; the two columns are independent
 * official numbers, not one derived from the other. User-edited prices
 * describe a model's peak column (the panel's three inputs); for a
 * user-priced model that has no official idle column, the panel derives its
 * idle hint from the entered peak values so the convention stays visible
 * without claiming it as an official rule. All money math stays in integers:
 * rates convert to integer micro-yuan per million tokens (1e-6 CNY
 * granularity, far below the table's 0.01 step), products with token counts
 * stay exact well inside the float64 integer range, and the single rounding
 * step lands on whole cents at the very end.
 *
 * @module price-calculator
 */

import type { BilledUsageBuckets, BilledUsageProjection } from '@deepseek-ai/dsh-token-meter/client'
import type { SessionCostModelPrice, SessionCostPrices } from '../submission-settings.ts'

export type { SessionCostModelPrice, SessionCostPrices }

/** One bucket's official published prices, idle and peak, CNY per million tokens. */
export interface BucketPricePair {
  /** Off-peak (idle) hours. */
  readonly idle: number
  /** Peak hours. */
  readonly peak: number
}

/** One official model column: each bucket's idle/peak pair. */
export interface OfficialModelPrice {
  readonly inputCacheHit: BucketPricePair
  readonly inputCacheMiss: BucketPricePair
  readonly output: BucketPricePair
}

/** One official price column. */
export interface OfficialPriceEntry {
  /** Exact official model id. */
  readonly model: string
  /** Idle/peak CNY prices per million tokens for every bucket. */
  readonly price: OfficialModelPrice
}

/**
 * DeepSeek official price table (CNY per million tokens), both periods as
 * published. The first entry is the default column for models the table does
 * not name: flash 0.05/0.10 hit, 1.5/3.0 miss, 4.5/9.0 output; pro 0.15/0.30,
 * 4.5/9.0, 13.5/27.0; vision-exp matches flash.
 */
export const DEEPSEEK_OFFICIAL_PRICES: readonly OfficialPriceEntry[] = [
  {
    model: 'deepseek-v4-flash',
    price: {
      inputCacheHit: { idle: 0.05, peak: 0.1 },
      inputCacheMiss: { idle: 1.5, peak: 3.0 },
      output: { idle: 4.5, peak: 9.0 },
    },
  },
  {
    model: 'deepseek-v4-pro',
    price: {
      inputCacheHit: { idle: 0.15, peak: 0.3 },
      inputCacheMiss: { idle: 4.5, peak: 9.0 },
      output: { idle: 13.5, peak: 27.0 },
    },
  },
  {
    model: 'deepseek-v4-flash-vision-exp',
    price: {
      inputCacheHit: { idle: 0.05, peak: 0.1 },
      inputCacheMiss: { idle: 1.5, peak: 3.0 },
      output: { idle: 4.5, peak: 9.0 },
    },
  },
]

/** Where a resolved price came from, shown by the price panel. */
export type PriceSource = 'official' | 'custom' | 'default'

/** A resolved model price: the peak column and the idle column it bills with. */
export interface ResolvedModelPrice {
  /** CNY prices per million tokens billed during peak hours. */
  readonly peak: SessionCostModelPrice
  /** CNY prices per million tokens billed during off-peak hours. */
  readonly idle: SessionCostModelPrice
  /**
   * Whether the idle column is an explicit price (official column or the
   * user's peak/valley entry) rather than derived from the peaks for a
   * single-priced model.
   */
  readonly idleExplicit: boolean
  /** How the price was chosen: user-edited, official column, or first-column fallback. */
  readonly source: PriceSource
}

/**
 * Whether a provider route id names a DeepSeek API route. The built-in adapter
 * registers `deepseek-official` and the catalog provider `deepseek`; matching
 * on the substring keeps both (and any future DeepSeek route id) covered
 * without a hardcoded enumeration in the presentation layer. A custom relay
 * whose route id contains "deepseek" is likewise treated as a DeepSeek route,
 * the same convention the peak/valley row uses.
 * @param provider - provider route id; null never matches.
 * @returns true when the route is a DeepSeek API provider.
 */
export function isDeepSeekProvider(provider: string | null): boolean {
  return provider !== null && provider.toLowerCase().includes('deepseek')
}

/**
 * Case-insensitive official column lookup.
 * @param model - the model id to look up.
 * @returns the model's published idle/peak prices, or undefined when the table does not name it.
 */
export function officialPriceFor(model: string): OfficialModelPrice | undefined {
  const needle = model.toLowerCase()
  return DEEPSEEK_OFFICIAL_PRICES.find(entry => entry.model.toLowerCase() === needle)?.price
}

/** Split one official pair into the billing shapes the row and panel consume. */
function asPeriodPrices(price: OfficialModelPrice): {
  peak: SessionCostModelPrice
  idle: SessionCostModelPrice
  idleExplicit: true
} {
  return {
    peak: { inputCacheHit: price.inputCacheHit.peak, inputCacheMiss: price.inputCacheMiss.peak, output: price.output.peak },
    idle: { inputCacheHit: price.inputCacheHit.idle, inputCacheMiss: price.inputCacheMiss.idle, output: price.output.idle },
    idleExplicit: true,
  }
}

/**
 * One persistent price key: `${provider}/${model}`. A provider route id never
 * contains a `/` (the custom-provider route pattern rejects it), so the first
 * `/` splits the key back into provider and model unambiguously even when the
 * model id itself contains a `/`.
 * @param provider - provider route id.
 * @param model - provider-owned model id.
 * @returns the composite record key.
 */
export function compositePriceKey(provider: string, model: string): string {
  return `${provider}/${model}`
}

/**
 * Resolve one model's billing prices: a user-edited peak entry wins (its idle
 * column derives from the entered peaks for the panel hint, since no official
 * idle column exists), then the official column, then the table's first
 * column. A custom price is looked up per (provider, model) first — two
 * providers may serve the same model id with different real-world prices —
 * then by the bare model id for a record written before provider-scoped keys.
 * @param provider - the session's provider route id; null/unknown reads the bare-model fallback only.
 * @param model - the session's current model id; null/empty always falls back to the default column.
 * @param customPrices - user-edited peak prices keyed by `provider/model` (or bare model id for legacy records).
 * @returns the peak and idle columns plus their origin.
 */
export function resolveModelPrice(
  provider: string | null | undefined,
  model: string | null | undefined,
  customPrices: SessionCostPrices,
): ResolvedModelPrice {
  const custom = model === null || model === undefined || model === ''
    ? undefined
    : provider === null || provider === undefined || provider === ''
      ? customPrices[model]
      : customPrices[compositePriceKey(provider, model)] ?? customPrices[model]
  if (custom !== undefined) {
    const peak = custom
    return {
      peak,
      idle: custom.idle ?? {
        inputCacheHit: peak.inputCacheHit / 2,
        inputCacheMiss: peak.inputCacheMiss / 2,
        output: peak.output / 2,
      },
      idleExplicit: custom.idle !== undefined,
      source: 'custom',
    }
  }
  const needle = model?.toLowerCase()
  const official = needle === undefined || needle === ''
    ? undefined
    : officialPriceFor(needle)
  if (official !== undefined) return { ...asPeriodPrices(official), source: 'official' }
  return { ...asPeriodPrices(DEEPSEEK_OFFICIAL_PRICES[0]!.price), idleExplicit: false, source: 'default' }
}

/**
 * Every model the price panel can offer: the official table's columns plus
 * each user-added model, official order first. The record is read only for
 * its keys, so the panel can pass its string-valued draft too.
 * @param customPrices - keyed record (values unused).
 * @returns model ids in display order.
 */
export function knownModelNames(customPrices: Readonly<Record<string, unknown>>): string[] {
  const names = DEEPSEEK_OFFICIAL_PRICES.map(entry => entry.model)
  for (const name of Object.keys(customPrices)) {
    if (!names.some(official => official.toLowerCase() === name.toLowerCase())) names.push(name)
  }
  return names
}

/**
 * One rate as integer micro-yuan per million tokens. Micro-yuan (1e-6 CNY)
 * keeps every official and typical user price exact while the subsequent
 * token products stay inside exact float64 integer range.
 * @param yuanPerMillion - CNY per million tokens for one period.
 * @returns integer micro-yuan per million tokens.
 */
function microRate(yuanPerMillion: number): number {
  return Math.round(yuanPerMillion * 1_000_000)
}

/** Micro-yuan cost of one bucket set at its period's rates. */
function bucketMicro(buckets: BilledUsageBuckets, hit: number, miss: number, out: number): number {
  return buckets.missInputTokens * miss + buckets.cacheReadTokens * hit + buckets.outputTokens * out
}

/**
 * Whole-session cost in integer cents: peak buckets bill at the resolved
 * peak column, off-peak buckets at the resolved idle column — each period's
 * own published prices, no derived ratio. Input cache misses and cache
 * writes bill at the miss rate; cache reads at the hit rate. Micro-yuan
 * products with token counts carry a 1e-6 tokens/1e-6 CNY scale, so the
 * micro-yuan sum divides by 1e6 (per-million) x 1e4 (cents per yuan).
 * @param usage - the session's period-bucketed billable usage.
 * @param price - the resolved peak and idle columns.
 * @returns the cost in cents (fen), rounded half up.
 */
export function billedCostCents(
  usage: BilledUsageProjection,
  price: ResolvedModelPrice,
): number {
  const peakMicro = bucketMicro(
    usage.peak,
    microRate(price.peak.inputCacheHit),
    microRate(price.peak.inputCacheMiss),
    microRate(price.peak.output),
  )
  const offPeakMicro = bucketMicro(
    usage.offPeak,
    microRate(price.idle.inputCacheHit),
    microRate(price.idle.inputCacheMiss),
    microRate(price.idle.output),
  )
  return Math.round((peakMicro + offPeakMicro) / 10_000_000_000)
}

/**
 * Render a cost as `¥X.XX` from integer cents.
 * @param cents - cost in cents (fen).
 * @returns the display text, two decimals, never negative.
 */
export function formatCost(cents: number): string {
  return `¥${(Math.max(0, cents) / 100).toFixed(2)}`
}

/**
 * Render one price value as the compact panel hint text.
 * @param yuanPerMillion - CNY per million tokens.
 * @returns the compact price text, e.g. `1.5`.
 */
export function priceText(yuanPerMillion: number): string {
  return String(yuanPerMillion)
}
