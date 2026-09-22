// dsh-usage-panel · billing windows: the single copy of the official peak
// schedule and its countdown math.
//
// PURE (no IO), browser + host shared. The schedule is defined on Beijing
// wall time (UTC+8) and is DST-free (Asia/Shanghai has had no daylight
// saving since 1991), so shifting the instant by the fixed offset and reading
// UTC accessors is an exact wall-clock conversion on every host timezone.
// Official windows (effective 2026-08-17): Monday–Friday 09:00–12:00 and
// 14:00–18:00 Beijing are PEAK; every other instant — weekends, weekday
// evenings and nights, and the 12:00–14:00 break — is off-peak and bills at
// the official idle column.

/** The two billing windows the cost UI distinguishes. */
export type PeakValleyPhase = 'peak' | 'off-peak'

/** One evaluation of the schedule at an instant. */
export interface PeakValleyState {
  /** Window the instant falls in. */
  phase: PeakValleyPhase
  /** Epoch milliseconds of the next phase switch, strictly after `now`. */
  nextSwitchMs: number
  /** `nextSwitchMs - now`, floored at zero. */
  msRemaining: number
}

/** Fixed UTC offset of Beijing wall time (no DST since 1991). */
const BEIJING_UTC_OFFSET_MS = 8 * 60 * 60 * 1000

const DAY_MS = 24 * 60 * 60 * 1000

/** Peak window minutes of day, Beijing wall time: 09:00–12:00 and 14:00–18:00. */
const PEAK_WINDOWS: readonly { open: number; close: number }[] = [
  { open: 9 * 60, close: 12 * 60 },
  { open: 14 * 60, close: 18 * 60 },
]

const WEEKDAY_MAX = 5 // getUTCDay(): 1..5 are Monday–Friday

/**
 * Whether an instant falls in an official peak billing window.
 * @param epochMs - Unix epoch milliseconds to classify.
 * @returns true inside a weekday peak window, false for every off-peak instant.
 */
export function isPeakBillingTime(epochMs: number): boolean {
  const wall = new Date(epochMs + BEIJING_UTC_OFFSET_MS)
  const day = wall.getUTCDay()
  if (day < 1 || day > WEEKDAY_MAX) return false
  const minuteOfDay = wall.getUTCHours() * 60 + wall.getUTCMinutes()
  return PEAK_WINDOWS.some((w) => minuteOfDay >= w.open && minuteOfDay < w.close)
}

/**
 * The epoch milliseconds of the next phase switch, strictly after `now`
 * (weekday-morning open after the evening close, Monday 09:00 after a
 * weekend). Scans at most 8 days, so it always terminates.
 * @param epochMs - the instant to classify.
 * @returns the next boundary in epoch ms, always `> epochMs`.
 */
export function nextPeakSwitchMs(epochMs: number): number {
  const wall = new Date(epochMs + BEIJING_UTC_OFFSET_MS)
  const dayStartUtc = Date.UTC(wall.getUTCFullYear(), wall.getUTCMonth(), wall.getUTCDate())
  for (let dayOffset = 0; dayOffset < 8; dayOffset += 1) {
    const candidateWeekday = (wall.getUTCDay() + dayOffset) % 7
    if (candidateWeekday < 1 || candidateWeekday > WEEKDAY_MAX) continue
    const candidateDay = dayStartUtc + dayOffset * DAY_MS
    for (const window of PEAK_WINDOWS) {
      // Off-peak → peak at the window open; peak → off-peak at the window close.
      const candidates = [window.open, window.close]
      for (const minute of candidates) {
        const candidate = candidateDay + minute * 60_000 - BEIJING_UTC_OFFSET_MS
        if (candidate > epochMs) return candidate
      }
    }
  }
  return -1
}

/**
 * Classify one instant against the official peak schedule.
 * @param now - the instant to classify.
 * @returns the current phase, the next switch instant, and the time left.
 */
export function peakValleyState(now: Date): PeakValleyState {
  const ms = now.getTime()
  const next = nextPeakSwitchMs(ms)
  return {
    phase: isPeakBillingTime(ms) ? 'peak' : 'off-peak',
    nextSwitchMs: next,
    msRemaining: Math.max(0, next - ms),
  }
}

/**
 * Render a remaining time as `HH:MM:SS`. Hours are the unbounded leading
 * field, so a Friday-evening switch (up to 63h away) reads `63:00:00`.
 * @param ms - remaining milliseconds; negative values clamp to zero.
 * @returns the zero-padded clock text.
 */
export function formatPeakValleyCountdown(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000))
  const hours = Math.floor(total / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  const seconds = total % 60
  const pad = (n: number): string => String(n).padStart(2, '0')
  return pad(hours) + ':' + pad(minutes) + ':' + pad(seconds)
}
