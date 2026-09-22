// dsh-usage-panel · cost math over the period-bucketed projection.
//
// PURE (no IO), browser + host shared. All money math stays in integers:
// rates convert to integer micro-yuan per million tokens (1e-6 CNY
// granularity, far below the table's 0.01 step), products with token counts
// stay exact well inside the float64 integer range, and the single rounding
// step lands on whole cents at the very end.
//
// The buckets are price-independent (host-classified at step start), so
// applying a price table is this module's job and never requires a log
// refold — changing a price re-multiplies, nothing refolds.
//
// Billing buckets split the four disjoint token buckets into the three
// billable rates: uncached input AND cache writes bill at the miss rate,
// cache reads at the hit rate, output at the output rate. Compaction tokens
// never enter these buckets (recorded separately), so a figure here matches
// the chat row's token accounting by construction.
import type { Buckets, PhaseBuckets } from './contract.ts'
import { resolveModelPrice, type ResolvedModelPrice, type SessionCostPrices } from './pricing.ts'

export type { PhaseBuckets } from './contract.ts'

/** The four disjoint token buckets (projection currency). */
export type FourBuckets = Buckets

/** The three billable token sums of one period. */
export interface BilledBuckets {
  missInputTokens: number
  cacheReadTokens: number
  outputTokens: number
}

/** Period-classified billable usage, the input of {@link computeBilledCost}. */
export interface BilledUsage {
  peak: BilledBuckets
  offPeak: BilledBuckets
}

const MICRO_SCALE = 1_000_000 // yuanPerMillion → integer micro-yuan-per-token units (×1e-6 CNY each)
const CENTS_DIVISOR = 1e10 // micro products carry 1e-6 tokens × 1e-6 CNY = 1e-12 yuan; per cent = 1e-2 yuan

/**
 * Rate in micro-yuan per token, from CNY per million tokens: 1 CNY/M tokens
 * = 1e-6 CNY per token; the ×1e6 keeps sub-cent prices exact in integers.
 */
function microRate(yuanPerMillion: number): number {
  return Math.round(yuanPerMillion * MICRO_SCALE)
}

/** Micro-yuan sum of one period's billable buckets. */
function bucketMicro(b: BilledBuckets, hit: number, miss: number, out: number): number {
  return b.missInputTokens * miss + b.cacheReadTokens * hit + b.outputTokens * out
}

/**
 * One period's cost in cents: products carry the 1e-6 tokens × 1e-6 CNY
 * scale (1e-12 yuan per unit), so the sum divides by 1e10 directly into
 * cents; the ONE rounding step lands on whole cents, half up.
 */
function periodCostCents(b: BilledBuckets, rate: { inputCacheHit: number; inputCacheMiss: number; output: number }): number {
  const micro = bucketMicro(b, microRate(rate.inputCacheHit), microRate(rate.inputCacheMiss), microRate(rate.output))
  return Math.round(micro / CENTS_DIVISOR)
}

/**
 * Whole-session cost in integer cents: peak buckets bill at the resolved
 * peak column, off-peak buckets at the resolved idle column.
 * @param usage - the session's period-bucketed billable usage.
 * @param price - the resolved peak and idle columns (never null at call sites that bill).
 * @returns the cost in cents (fen), rounded half up.
 */
export function computeBilledCost(usage: BilledUsage, price: ResolvedModelPrice): number {
  return periodCostCents(usage.peak, price.peak) + periodCostCents(usage.offPeak, price.idle)
}

/**
 * Split a period-classified four-bucket set into a price's peak/off-peak
 * cost pair (the UI's peak/valley breakdown).
 * @param buckets - period-classified token buckets.
 * @param price - the resolved peak and idle columns.
 * @returns the two cents figures, each independently rounded.
 */
export function splitCostCents(buckets: PhaseBuckets, price: ResolvedModelPrice): { peak: number; offPeak: number } {
  return {
    peak: periodCostCents(billedBucketsOf(buckets.peak), price.peak),
    offPeak: periodCostCents(billedBucketsOf(buckets.offPeak), price.idle),
  }
}

/**
 * Convert one period's four disjoint buckets into the three billable sums.
 * @param b - projection buckets (input is UNCACHED input).
 * @returns billable sums: miss = uncached input + cache writes, read = cache reads.
 */
export function billedBucketsOf(b: FourBuckets): BilledBuckets {
  return {
    missInputTokens: b.input + b.cacheWrite,
    cacheReadTokens: b.cacheRead,
    outputTokens: b.output,
  }
}

/**
 * One model+provider row's cost, or null when it is not priced (the UI then
 * prompts for a price instead of guessing).
 * @param buckets - the row's period-classified token buckets.
 * @param provider - the row's provider route id.
 * @param model - the row's model id.
 * @param customPrices - user-edited prices (composite or bare keys).
 * @param peakValley - global peak/valley switch; false bills BOTH periods at
 * the resolved peak column (flat single price).
 * @returns cents, or null when `resolveModelPrice` cannot price it.
 */
export function costCentsFor(
  buckets: PhaseBuckets,
  provider: string | null | undefined,
  model: string | null | undefined,
  customPrices: SessionCostPrices,
  peakValley = true,
): number | null {
  const price = resolveModelPrice(provider, model, customPrices)
  if (price === null) return null
  const effective = peakValley ? price : { ...price, idle: price.peak }
  return computeBilledCost(
    { peak: billedBucketsOf(buckets.peak), offPeak: billedBucketsOf(buckets.offPeak) },
    effective,
  )
}

/** Sum several rows' costs: null when every row is unpriced, else the total. */
export function sumCostCents(rows: ReadonlyArray<number | null>): number | null {
  let any = false
  let sum = 0
  for (const cents of rows) {
    if (cents === null) continue
    any = true
    sum += cents
  }
  return any ? sum : null
}

/**
 * Total cost of a model-row list (sessions/projects), null when unpriced.
 * @param rows - per-model rows with their provider and period buckets.
 * @param prices - user-edited prices (composite or bare keys).
 * @param peakValley - global peak/valley switch.
 * @returns cents, or null when no row resolves a price.
 */
export function totalCostCents(
  rows: ReadonlyArray<{ model: string; provider: string; cost: PhaseBuckets }>,
  prices: SessionCostPrices,
  peakValley: boolean,
): number | null {
  return sumCostCents(rows.map((row) => costCentsFor(row.cost, row.provider, row.model, prices, peakValley)))
}

/** One cost line of the composition breakdown (input hit / input miss / output). */
export interface CostComposition {
  hit: number
  miss: number
  output: number
}

const ZERO_BILLED = { missInputTokens: 0, cacheReadTokens: 0, outputTokens: 0 }

/** One bucket's cents under its own period column (the other buckets zeroed). */
function bucketCents(
  b: FourBuckets,
  price: ResolvedModelPrice,
  which: 'hit' | 'miss' | 'output',
  phase: 'peak' | 'offPeak',
): number {
  const filled = which === 'hit'
    ? { missInputTokens: 0, cacheReadTokens: b.cacheRead, outputTokens: 0 }
    : which === 'miss'
      ? { missInputTokens: b.input + b.cacheWrite, cacheReadTokens: 0, outputTokens: 0 }
      : { missInputTokens: 0, cacheReadTokens: 0, outputTokens: b.output }
  const usage = phase === 'peak'
    ? { peak: filled, offPeak: ZERO_BILLED }
    : { peak: ZERO_BILLED, offPeak: filled }
  return computeBilledCost(usage, price)
}

/**
 * Cost composition of a model-row list: cache-hit input, cache-miss input
 * (uncached input + cache writes) and output, each summed across rows and
 * billed at its own period column. The tooltip's "费用组成" source.
 * @param rows - per-model rows with their provider and period buckets.
 * @param prices - user-edited prices (composite or bare keys).
 * @param peakValley - global peak/valley switch.
 * @returns the three cents figures, or null when every row is unpriced.
 */
export function costCompositionCents(
  rows: ReadonlyArray<{ model: string; provider: string; cost: PhaseBuckets }>,
  prices: SessionCostPrices,
  peakValley: boolean,
): CostComposition | null {
  let hit = 0
  let miss = 0
  let output = 0
  let any = false
  for (const row of rows) {
    const price = resolveModelPrice(row.provider, row.model, prices)
    if (price === null) continue
    any = true
    const effective = peakValley ? price : { ...price, idle: price.peak }
    hit += bucketCents(row.cost.peak, effective, 'hit', 'peak') + bucketCents(row.cost.offPeak, effective, 'hit', 'offPeak')
    miss += bucketCents(row.cost.peak, effective, 'miss', 'peak') + bucketCents(row.cost.offPeak, effective, 'miss', 'offPeak')
    output += bucketCents(row.cost.peak, effective, 'output', 'peak') + bucketCents(row.cost.offPeak, effective, 'output', 'offPeak')
  }
  return any ? { hit, miss, output } : null
}
