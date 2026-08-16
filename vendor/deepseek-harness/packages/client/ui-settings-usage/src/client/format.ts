/** Number and calendar helpers for the usage settings page. */

/** One heatmap cell after Sunday-leading padding. */
export interface HeatmapCell {
  /** Civil date, or null for a pad cell before the window starts. */
  date: string | null
  /** Token total for that day. */
  tokens: number
}

function trimFixed(value: number): string {
  const text = value.toFixed(1)
  return text.endsWith('.0') ? text.slice(0, -2) : text
}

/**
 * Compact display for large counts. Chinese uses 万/亿; English uses k/M.
 * @param value - non-negative integer.
 * @param locale - product locale.
 * @returns display text.
 */
export function formatCompactNumber(value: number, locale: 'zh' | 'en'): string {
  if (!Number.isFinite(value) || value < 0) return '0'
  if (locale === 'zh') {
    if (value < 10_000) return String(Math.round(value))
    if (value < 100_000_000) return trimFixed(value / 10_000) + '万'
    return trimFixed(value / 100_000_000) + '亿'
  }
  if (value < 1_000) return String(Math.round(value))
  if (value < 1_000_000) return trimFixed(value / 1_000) + 'k'
  return trimFixed(value / 1_000_000) + 'M'
}

/**
 * Sunday-based weekday of a timezone-less civil date.
 * @param dateKey - YYYY-MM-DD.
 * @returns 0 (Sunday) through 6 (Saturday).
 */
export function civilWeekday(dateKey: string): number {
  return new Date(dateKey + 'T12:00:00Z').getUTCDay()
}

/**
 * Pad a trailing-window heatmap so the first column starts on Sunday.
 * @param cells - oldest-first daily totals.
 * @returns Sunday-leading cells, including leading null pads.
 */
export function padHeatmap(cells: readonly { date: string; tokens: number }[]): HeatmapCell[] {
  if (cells.length === 0) return []
  const lead = civilWeekday(cells[0]!.date)
  const padded: HeatmapCell[] = []
  for (let i = 0; i < lead; i += 1) padded.push({ date: null, tokens: 0 })
  for (const cell of cells) padded.push(cell)
  return padded
}

/**
 * Heatmap intensity 0..4 from a day's tokens versus the window max.
 * @param tokens - day total.
 * @param max - window max, or 0 when empty.
 * @returns discrete level.
 */
export function heatLevel(tokens: number, max: number): 0 | 1 | 2 | 3 | 4 {
  if (tokens <= 0 || max <= 0) return 0
  const ratio = tokens / max
  if (ratio <= 0.25) return 1
  if (ratio <= 0.5) return 2
  if (ratio <= 0.75) return 3
  return 4
}
