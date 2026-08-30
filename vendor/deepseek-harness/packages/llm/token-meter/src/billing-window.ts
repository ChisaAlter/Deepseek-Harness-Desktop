/**
 * Official DeepSeek billing-window predicate, host side.
 *
 * The schedule is defined on Beijing wall time (UTC+8, DST-free since 1991),
 * so shifting the instant by the fixed offset and reading UTC accessors is an
 * exact wall-clock classification on every host. Peak windows: Monday–Friday
 * 09:00–12:00 and 14:00–18:00 Beijing; every other instant bills at the
 * official idle column. The two periods carry their own published prices —
 * the classification never derives one rate from the other. The browser
 * presentation layer keeps its own copy
 * (ui-conversation `peak-valley.ts`) because the client bundle cannot import
 * host capability packages; the two must change together.
 *
 * @module @deepseek-ai/dsh-token-meter/billing-window
 */

/** Fixed offset of Beijing wall time from UTC. */
const BEIJING_UTC_OFFSET_MS = 8 * 60 * 60 * 1000

/** Beijing minute-of-day where the morning peak window opens (09:00). */
const MORNING_OPEN = 540
/** Beijing minute-of-day where the morning peak window closes (12:00). */
const MORNING_CLOSE = 720
/** Beijing minute-of-day where the afternoon peak window opens (14:00). */
const AFTERNOON_OPEN = 840
/** Beijing minute-of-day where the afternoon peak window closes (18:00). */
const AFTERNOON_CLOSE = 1080

/**
 * Whether an instant falls in an official peak billing window.
 * @param epochMs - Unix epoch milliseconds to classify.
 * @returns true inside a weekday peak window, false for every off-peak instant.
 */
export function isPeakBillingTime(epochMs: number): boolean {
  const wall = new Date(epochMs + BEIJING_UTC_OFFSET_MS)
  const minuteOfDay = wall.getUTCHours() * 60 + wall.getUTCMinutes()
  const weekday = wall.getUTCDay() >= 1 && wall.getUTCDay() <= 5
  const inMorningWindow = minuteOfDay >= MORNING_OPEN && minuteOfDay < MORNING_CLOSE
  const inAfternoonWindow = minuteOfDay >= AFTERNOON_OPEN && minuteOfDay < AFTERNOON_CLOSE
  return weekday && (inMorningWindow || inAfternoonWindow)
}
