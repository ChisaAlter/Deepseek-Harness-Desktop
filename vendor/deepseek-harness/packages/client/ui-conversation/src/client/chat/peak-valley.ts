/**
 * Official DeepSeek peak/valley window math for the composer-dock status row.
 *
 * The schedule is defined on Beijing wall time (UTC+8) and is DST-free
 * (Asia/Shanghai has had no daylight saving since 1991), so shifting the
 * instant by the fixed offset and reading UTC accessors is an exact wall-clock
 * conversion on every host timezone. Peak windows: Monday–Friday 09:00–12:00
 * and 14:00–18:00 Beijing. Every other instant — weekends, weekday evenings
 * and nights, and the 12:00–14:00 break — is off-peak and bills at the
 * official idle column's own prices; neither period's rate derives from the
 * other. Presentation only: the row renders the phase; nothing here prices a
 * request.
 */

/** The two billing windows the status row distinguishes. */
export type PeakValleyPhase = 'peak' | 'off-peak'

/** One evaluation of the schedule at an instant. */
export interface PeakValleyState {
  /** Window the instant falls in. */
  phase: PeakValleyPhase
  /** Epoch milliseconds of the next phase switch, strictly after `now`. */
  nextSwitchMs: number
  /** `nextSwitchMs - now`, floored at zero (a same-second boundary read). */
  msRemaining: number
}

/** Fixed offset of Beijing wall time from UTC. */
const BEIJING_UTC_OFFSET_MS = 8 * 60 * 60 * 1000

/** Beijing minutes-of-day where a weekday peak window opens or closes. */
const PEAK_BOUNDARY_MINUTES: readonly number[] = [9 * 60, 12 * 60, 14 * 60, 18 * 60]

/** Milliseconds in one day. */
const DAY_MS = 24 * 60 * 60 * 1000

/**
 * Classify one instant against the official peak schedule.
 * @param now - the instant to classify.
 * @returns the current phase, the next switch instant, and the time left.
 */
export function peakValleyState(now: Date): PeakValleyState {
  // Shift so the UTC accessors read Beijing wall clock; getUTCDay: 0=Sun…6=Sat.
  const wall = new Date(now.getTime() + BEIJING_UTC_OFFSET_MS)
  const weekday = wall.getUTCDay() >= 1 && wall.getUTCDay() <= 5
  const minuteOfDay = wall.getUTCHours() * 60 + wall.getUTCMinutes()
  const morningPeak = minuteOfDay >= 9 * 60 && minuteOfDay < 12 * 60
  const afternoonPeak = minuteOfDay >= 14 * 60 && minuteOfDay < 18 * 60
  const phase: PeakValleyPhase = weekday && (morningPeak || afternoonPeak) ? 'peak' : 'off-peak'
  // Candidate switches live only on weekdays (weekends are off-peak through
  // out, so they contribute no boundary). Every candidate listed here is a
  // genuine transition, so the first strictly-future one is the next switch.
  const dayStartUtc = Date.UTC(wall.getUTCFullYear(), wall.getUTCMonth(), wall.getUTCDate())
  for (let dayOffset = 0; dayOffset < 8; dayOffset += 1) {
    const candidateWeekday = (wall.getUTCDay() + dayOffset) % 7
    if (candidateWeekday < 1 || candidateWeekday > 5) continue
    const candidateDay = dayStartUtc + dayOffset * DAY_MS
    for (const minute of PEAK_BOUNDARY_MINUTES) {
      const candidate = candidateDay + minute * 60_000 - BEIJING_UTC_OFFSET_MS
      if (candidate <= now.getTime()) continue
      return { phase, nextSwitchMs: candidate, msRemaining: candidate - now.getTime() }
    }
  }
  /* v8 ignore next -- unreachable: any 8-day span contains a weekday boundary. */
  throw new Error('peak-valley: no schedule boundary within 8 days')
}

/**
 * Render a remaining time as `HH:MM:SS`. Hours are the unbounded leading
 * field, so a Friday-evening switch (up to 63h away) reads `63:00:00`.
 * @param ms - remaining milliseconds; negative values clamp to zero.
 * @returns the zero-padded clock text.
 */
export function formatPeakValleyCountdown(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1_000))
  const hours = String(Math.floor(totalSeconds / 3_600)).padStart(2, '0')
  const minutes = String(Math.floor(totalSeconds / 60) % 60).padStart(2, '0')
  const seconds = String(totalSeconds % 60).padStart(2, '0')
  return `${hours}:${minutes}:${seconds}`
}

/**
 * Whether a model-route provider fact names a DeepSeek API route. Lives in the
 * shared price module so the price panel and this status row agree on which
 * routes are official; re-exported here for the row's existing import.
 */
export { isDeepSeekProvider } from '../price-calculator.ts'
