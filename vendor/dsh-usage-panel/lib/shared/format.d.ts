import type { Buckets } from './contract.ts';
export type Locale = 'zh-CN' | 'en-US';
export declare function isZh(locale: Locale): boolean;
/** Full token display: zh uses 亿, then 万 from 10万; below that, integer. */
export declare function fmtTokens(n: number, locale: Locale): string;
/** Compact axis label: zh 亿/万 (v0.1.0), en K/M/B. */
export declare function fmtCompact(n: number, locale: Locale): string;
/** Percent with one decimal (v0.1.0 semantic). */
export declare function pctOf(v: number, total: number): string;
/** Nice axis ceiling: 1/2/5 × power of ten (v0.1.0 semantic). */
export declare function niceCeil(v: number): number;
/** Quartile thresholds over non-zero day totals (v0.1.0 heatmap semantic). */
export declare function quartileThresholds(nonzero: number[]): {
    q1: number;
    q2: number;
    q3: number;
};
/** Heatmap level 0..4 for a day total (v0.1.0 semantic). */
export declare function heatLevel(total: number, q: {
    q1: number;
    q2: number;
    q3: number;
}): number;
/** Axis date label: "MM/DD" (v0.1.0). */
export declare function dateLabel(key: string): string;
/** Tooltip date label: zh "M月D日" (v0.1.0), en "M/D". */
export declare function dateCN(key: string, locale: Locale): string;
/** Month picker label from YYYY-MM: zh "YYYY年M月", en "Mon YYYY". */
export declare function monthLabel(monthKey: string, locale: Locale): string;
/** Monday-first weekday index 0..6 for a UTC day key. */
export declare function weekdayIndexUTC(key: string): number;
/** Time-of-day label for "updated at" (UTC, matching the day-key declaration). */
export declare function formatClock(ts: number, locale: Locale): string;
/** Fraction 0..1 → percent string for the hit-rate card. */
export declare function pctFull(v: number): string;
export declare function isNonEmpty(b: Buckets | undefined | null): boolean;
