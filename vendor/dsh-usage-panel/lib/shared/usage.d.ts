import type { Buckets, DayRecord, ModelItem, Overview, PhaseBuckets, UsageTotals } from './contract.ts';
export declare const HEAT_DAYS = 182;
export declare const RECENT_DAYS = 30;
export declare function emptyBuckets(): Buckets;
export declare function emptyTotals(): UsageTotals;
/** Add a raw (possibly partial/null) TokenUsage-like value into a bucket set. */
export declare function addBuckets(target: Buckets, usage: Partial<Buckets> | null | undefined): void;
/** Merge one bucket set into another (values already normalized). */
export declare function mergeInto(target: Buckets, src: Buckets): void;
export declare function totalsFrom(b: Buckets): UsageTotals;
/** Sorted model ranking, most usage first (v0.1.0 semantic; cost/provider added). */
export declare function sortedModels(map: Record<string, Buckets>, costs?: Record<string, PhaseBuckets>, providers?: Record<string, string>): ModelItem[];
export declare function totalsFromModels(models: ModelItem[]): UsageTotals;
/** UTC day key for a timestamp: YYYY-MM-DD (explicit timezone declaration). */
export declare function dayKeyUTC(ts: number): string;
/** Parse a UTC YYYY-MM-DD key into a Date at UTC midnight (never local). */
export declare function parseDayKeyUTC(key: string): Date;
/** Format a Date's UTC calendar day as a day key. */
export declare function keyOfDateUTC(d: Date): string;
export declare function todayKeyUTC(now: number): string;
/** UTC calendar month key (YYYY-MM) from a day key. */
export declare function monthKeyUTC(dayKey: string): string;
/**
 * Distinct UTC months covered by a day window, in ascending order.
 * Used by the client heatmap month picker (still bounded by HEAT_DAYS).
 */
export declare function listMonthKeys(days: ReadonlyArray<{
    date: string;
}>): string[];
/**
 * Build the 182-day heatmap window ending today (UTC). Days with no usage get
 * zero-filled records, preserving the v0.1.0 grid shape (fixed-length array).
 * @param byDay - per-day per-model token buckets.
 * @param now - the window's end instant.
 * @param costByDay - per-day per-model period buckets, optional (zero-filled when absent).
 */
export declare function buildDayWindow(byDay: Record<string, Record<string, Buckets>>, now: number, costByDay?: Record<string, Record<string, PhaseBuckets>>): DayRecord[];
/** Cache hit rate over the four disjoint buckets: read / (uncached + read + write). */
export declare function hitRate(b: Buckets): number | null;
/** Billed input (uncached + cache read + cache write) — the v0.1.0 "输入" number. */
export declare function billedInput(b: Buckets): number;
/** Empty UI only when no billed-usage sessions and the scan did not fail. */
export declare function isUsageEmpty(overview: Pick<Overview, 'allTime' | 'coverage'>): boolean;
