/** The two billing windows the cost UI distinguishes. */
export type PeakValleyPhase = 'peak' | 'off-peak';
/** One evaluation of the schedule at an instant. */
export interface PeakValleyState {
    /** Window the instant falls in. */
    phase: PeakValleyPhase;
    /** Epoch milliseconds of the next phase switch, strictly after `now`. */
    nextSwitchMs: number;
    /** `nextSwitchMs - now`, floored at zero. */
    msRemaining: number;
}
/**
 * Whether an instant falls in an official peak billing window.
 * @param epochMs - Unix epoch milliseconds to classify.
 * @returns true inside a weekday peak window, false for every off-peak instant.
 */
export declare function isPeakBillingTime(epochMs: number): boolean;
/**
 * The epoch milliseconds of the next phase switch, strictly after `now`
 * (weekday-morning open after the evening close, Monday 09:00 after a
 * weekend). Scans at most 8 days, so it always terminates.
 * @param epochMs - the instant to classify.
 * @returns the next boundary in epoch ms, always `> epochMs`.
 */
export declare function nextPeakSwitchMs(epochMs: number): number;
/**
 * Classify one instant against the official peak schedule.
 * @param now - the instant to classify.
 * @returns the current phase, the next switch instant, and the time left.
 */
export declare function peakValleyState(now: Date): PeakValleyState;
/**
 * Render a remaining time as `HH:MM:SS`. Hours are the unbounded leading
 * field, so a Friday-evening switch (up to 63h away) reads `63:00:00`.
 * @param ms - remaining milliseconds; negative values clamp to zero.
 * @returns the zero-padded clock text.
 */
export declare function formatPeakValleyCountdown(ms: number): string;
