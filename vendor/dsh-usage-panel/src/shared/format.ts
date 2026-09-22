// dsh-usage-panel · pure formatting helpers (client-side, locale-aware).
// zh keeps the v0.1.0 亿/万 magnitudes; en uses K/M/B.
import type { Buckets } from './contract.ts'
import { parseDayKeyUTC } from './usage.ts'

export type Locale = 'zh-CN' | 'en-US'

export function isZh(locale: Locale): boolean {
  return locale === 'zh-CN'
}

/** Full token display: zh uses 亿, then 万 from 10万; below that, integer. */
export function fmtTokens(n: number, locale: Locale): string {
  const v = Math.round(n || 0)
  if (locale === 'zh-CN') {
    if (v >= 1e8) return (v / 1e8).toFixed(2).replace(/\.?0+$/, '') + ' 亿'
    if (v >= 1e5) return (v / 1e4).toFixed(1).replace(/\.0$/, '') + ' 万'
    return String(v)
  }
  if (v >= 1e9) return (v / 1e9).toFixed(2).replace(/\.?0+$/, '') + 'B'
  if (v >= 1e6) return (v / 1e6).toFixed(1).replace(/\.0$/, '') + 'M'
  if (v >= 1e3) return (v / 1e3).toFixed(1).replace(/\.0$/, '') + 'K'
  return String(v)
}

/** Compact axis label: zh 亿/万 (v0.1.0), en K/M/B. */
export function fmtCompact(n: number, locale: Locale): string {
  const v = Math.round(n || 0)
  if (locale === 'zh-CN') {
    if (v >= 1e8) return (v / 1e8).toFixed(1).replace(/\.0$/, '') + '亿'
    if (v >= 1e4) return (v / 1e4).toFixed(0) + '万'
    return String(v)
  }
  if (v >= 1e9) return (v / 1e9).toFixed(1).replace(/\.0$/, '') + 'B'
  if (v >= 1e6) return (v / 1e6).toFixed(1).replace(/\.0$/, '') + 'M'
  if (v >= 1e3) return (v / 1e3).toFixed(0) + 'K'
  return String(v)
}

/** Percent with one decimal (v0.1.0 semantic). */
export function pctOf(v: number, total: number): string {
  if (!total) return '0.0'
  return ((v / total) * 100).toFixed(1)
}

/** Nice axis ceiling: 1/2/5 × power of ten (v0.1.0 semantic). */
export function niceCeil(v: number): number {
  if (!(v > 0)) return 1
  const p = Math.pow(10, Math.floor(Math.log10(v)))
  const d = v / p
  const m = d <= 1 ? 1 : d <= 2 ? 2 : d <= 5 ? 5 : 10
  return m * p
}

/** Quartile thresholds over non-zero day totals (v0.1.0 heatmap semantic). */
export function quartileThresholds(nonzero: number[]): { q1: number; q2: number; q3: number } {
  const sorted = [...nonzero].sort((a, b) => a - b)
  const q = (p: number) =>
    sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(p * (sorted.length - 1)))]! : Infinity
  return { q1: q(0.25), q2: q(0.5), q3: q(0.75) }
}

/** Heatmap level 0..4 for a day total (v0.1.0 semantic). */
export function heatLevel(total: number, q: { q1: number; q2: number; q3: number }): number {
  if (total <= 0) return 0
  return total <= q.q1 ? 1 : total <= q.q2 ? 2 : total <= q.q3 ? 3 : 4
}

/** Axis date label: "MM/DD" (v0.1.0). */
export function dateLabel(key: string): string {
  const p = key.split('-')
  return p[1] + '/' + p[2]
}

/** Tooltip date label: zh "M月D日" (v0.1.0), en "M/D". */
export function dateCN(key: string, locale: Locale): string {
  const p = key.split('-')
  const m = Number(p[1])
  const d = Number(p[2])
  return locale === 'zh-CN' ? m + '月' + d + '日' : m + '/' + d
}

const EN_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const

/** Month picker label from YYYY-MM: zh "YYYY年M月", en "Mon YYYY". */
export function monthLabel(monthKey: string, locale: Locale): string {
  const p = monthKey.split('-')
  const y = p[0]!
  const m = Number(p[1])
  if (locale === 'zh-CN') return y + '年' + m + '月'
  return EN_MONTHS[m - 1]! + ' ' + y
}

/** Monday-first weekday index 0..6 for a UTC day key. */
export function weekdayIndexUTC(key: string): number {
  return (parseDayKeyUTC(key).getUTCDay() + 6) % 7
}

/** Time-of-day label for "updated at" (UTC, matching the day-key declaration). */
export function formatClock(ts: number, locale: Locale): string {
  const d = new Date(ts)
  const h = String(d.getUTCHours()).padStart(2, '0')
  const m = String(d.getUTCMinutes()).padStart(2, '0')
  return h + ':' + m + (locale === 'zh-CN' ? '' : ' UTC')
}

/** Fraction 0..1 → percent string for the hit-rate card. */
export function pctFull(v: number): string {
  return ((v || 0) * 100).toFixed(1)
}

export function isNonEmpty(b: Buckets | undefined | null): boolean {
  return !!b && (b.input > 0 || b.output > 0 || b.cacheRead > 0 || b.cacheWrite > 0)
}
