import type { Buckets, PhaseBuckets } from './contract.ts';
import { type ResolvedModelPrice, type SessionCostPrices } from './pricing.ts';
export type { PhaseBuckets } from './contract.ts';
/** The four disjoint token buckets (projection currency). */
export type FourBuckets = Buckets;
/** The three billable token sums of one period. */
export interface BilledBuckets {
    missInputTokens: number;
    cacheReadTokens: number;
    outputTokens: number;
}
/** Period-classified billable usage, the input of {@link computeBilledCost}. */
export interface BilledUsage {
    peak: BilledBuckets;
    offPeak: BilledBuckets;
}
/**
 * Whole-session cost in integer cents: peak buckets bill at the resolved
 * peak column, off-peak buckets at the resolved idle column.
 * @param usage - the session's period-bucketed billable usage.
 * @param price - the resolved peak and idle columns (never null at call sites that bill).
 * @returns the cost in cents (fen), rounded half up.
 */
export declare function computeBilledCost(usage: BilledUsage, price: ResolvedModelPrice): number;
/**
 * Split a period-classified four-bucket set into a price's peak/off-peak
 * cost pair (the UI's peak/valley breakdown).
 * @param buckets - period-classified token buckets.
 * @param price - the resolved peak and idle columns.
 * @returns the two cents figures, each independently rounded.
 */
export declare function splitCostCents(buckets: PhaseBuckets, price: ResolvedModelPrice): {
    peak: number;
    offPeak: number;
};
/**
 * Convert one period's four disjoint buckets into the three billable sums.
 * @param b - projection buckets (input is UNCACHED input).
 * @returns billable sums: miss = uncached input + cache writes, read = cache reads.
 */
export declare function billedBucketsOf(b: FourBuckets): BilledBuckets;
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
export declare function costCentsFor(buckets: PhaseBuckets, provider: string | null | undefined, model: string | null | undefined, customPrices: SessionCostPrices, peakValley?: boolean): number | null;
/** Sum several rows' costs: null when every row is unpriced, else the total. */
export declare function sumCostCents(rows: ReadonlyArray<number | null>): number | null;
/**
 * Total cost of a model-row list (sessions/projects), null when unpriced.
 * @param rows - per-model rows with their provider and period buckets.
 * @param prices - user-edited prices (composite or bare keys).
 * @param peakValley - global peak/valley switch.
 * @returns cents, or null when no row resolves a price.
 */
export declare function totalCostCents(rows: ReadonlyArray<{
    model: string;
    provider: string;
    cost: PhaseBuckets;
}>, prices: SessionCostPrices, peakValley: boolean): number | null;
/** One cost line of the composition breakdown (input hit / input miss / output). */
export interface CostComposition {
    hit: number;
    miss: number;
    output: number;
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
export declare function costCompositionCents(rows: ReadonlyArray<{
    model: string;
    provider: string;
    cost: PhaseBuckets;
}>, prices: SessionCostPrices, peakValley: boolean): CostComposition | null;
