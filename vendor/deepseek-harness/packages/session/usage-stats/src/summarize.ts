/**
 * Pure cut of timestamped session usage views into one trailing local-calendar
 * window. No I/O — the service collects views, then calls this.
 */

import type {
  SessionUsageView,
  UsageModelShare,
  UsageRangeDays,
  UsageSummary,
  UsageSummaryRequest,
} from './types.ts'

const UTC = 'UTC'

/**
 * Local civil date `YYYY-MM-DD` of an instant in an IANA time zone.
 * @param time - Unix epoch milliseconds.
 * @param timeZone - IANA zone; invalid zones throw from Intl.
 * @returns ISO calendar date in that zone.
 */
export function localDateKey(time: number, timeZone: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(time))
}

/**
 * Shift a timezone-less civil date by a whole-day delta.
 * @param dateKey - `YYYY-MM-DD`.
 * @param delta - days to add (may be negative).
 * @returns the shifted civil date.
 */
export function addCivilDays(dateKey: string, delta: number): string {
  const parts = dateKey.split('-')
  const year = Number(parts[0])
  const month = Number(parts[1])
  const day = Number(parts[2])
  return new Date(Date.UTC(year, month - 1, day + delta)).toISOString().slice(0, 10)
}

/**
 * Inclusive civil dates from oldest to today for a trailing window.
 * @param now - clock instant.
 * @param rangeDays - window length including today.
 * @param timeZone - IANA zone for "today".
 * @returns `rangeDays` date keys.
 */
export function enumerateDays(now: number, rangeDays: number, timeZone: string): string[] {
  const today = localDateKey(now, timeZone)
  const days: string[] = []
  for (let offset = rangeDays - 1; offset >= 0; offset -= 1) {
    days.push(addCivilDays(today, -offset))
  }
  return days
}

function resolveTimeZone(timeZone: string | undefined): string {
  if (timeZone === undefined || timeZone.length === 0) return UTC
  return timeZone
}

function shareOf(tokens: number, total: number): number {
  if (total <= 0) return 0
  return Math.round((tokens / total) * 100)
}

function modelShares(totals: Map<string, number>, totalTokens: number): UsageModelShare[] {
  return [...totals.entries()]
    .filter(([, tokens]) => tokens > 0)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([model, tokens]) => ({ model, tokens, share: shareOf(tokens, totalTokens) }))
}

/**
 * Cut session usage views into one settings-page DTO.
 * @param sessions - per-session samples already collected by the service.
 * @param request - window and time zone.
 * @returns the summary DTO.
 */
export function foldSummary(
  sessions: readonly SessionUsageView[],
  request: UsageSummaryRequest,
): UsageSummary {
  const rangeDays: UsageRangeDays = request.rangeDays
  const timeZone = resolveTimeZone(request.timeZone)
  const now = request.now ?? Date.now()
  const days = enumerateDays(now, rangeDays, timeZone)
  const start = days[0]!
  const inWindow = (time: number): boolean => {
    const key = localDateKey(time, timeZone)
    return key >= start && key <= days[days.length - 1]!
  }

  const tokensByDay = new Map<string, number>(days.map(day => [day, 0]))
  const messagesByDay = new Map<string, number>(days.map(day => [day, 0]))
  const modelsByDay = new Map<string, Map<string, number>>(days.map(day => [day, new Map()]))
  const models = new Map<string, number>()
  let totalTokens = 0
  let messageCount = 0
  let sessionCount = 0

  for (const session of sessions) {
    let prompted = false
    for (const time of session.userMessageTimes) {
      if (!inWindow(time)) continue
      messageCount += 1
      prompted = true
      const day = localDateKey(time, timeZone)
      messagesByDay.set(day, (messagesByDay.get(day) ?? 0) + 1)
    }
    if (prompted && session.origin !== 'subagent') sessionCount += 1

    for (const sample of session.samples) {
      if (!inWindow(sample.time) || sample.tokens <= 0) continue
      totalTokens += sample.tokens
      const day = localDateKey(sample.time, timeZone)
      tokensByDay.set(day, (tokensByDay.get(day) ?? 0) + sample.tokens)
      const dayModels = modelsByDay.get(day)!
      dayModels.set(sample.model, (dayModels.get(sample.model) ?? 0) + sample.tokens)
      models.set(sample.model, (models.get(sample.model) ?? 0) + sample.tokens)
    }
  }

  const heatmap = days.map(date => ({ date, tokens: tokensByDay.get(date) ?? 0 }))
  const daily = days.map(date => {
    const dayModels = modelsByDay.get(date) ?? new Map<string, number>()
    const byModel = [...dayModels.entries()]
      .filter(([, tokens]) => tokens > 0)
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .map(([model, tokens]) => ({ model, tokens }))
    return { date, byModel }
  })
  const modelRows = modelShares(models, totalTokens)
  const top = modelRows[0]
  const active = days.filter(date => (tokensByDay.get(date) ?? 0) > 0 || (messagesByDay.get(date) ?? 0) > 0)
  const activeSet = new Set(active)

  let currentStreak = 0
  let index = days.length - 1
  if (!activeSet.has(days[index]!)) {
    if (days.length >= 2 && activeSet.has(days[index - 1]!)) index -= 1
    else index = -1
  }
  while (index >= 0 && activeSet.has(days[index]!)) {
    currentStreak += 1
    index -= 1
  }

  return {
    rangeDays,
    totalTokens,
    sessionCount,
    messageCount,
    activeDays: active.length,
    currentStreak,
    topModel: top === undefined ? null : { name: top.model, share: top.share },
    heatmap,
    daily,
    models: modelRows,
  }
}
