// Locks the aggregation semantics shared by the host scan path (v0.1.0
// behavior) and the projection path: disjoint buckets, UTC day keys, model
// ranking, hit rate, day window.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  buildDayWindow,
  dayKeyUTC,
  emptyBuckets,
  emptyTotals,
  hitRate,
  listMonthKeys,
  mergeInto,
  monthKeyUTC,
  parseDayKeyUTC,
  sortedModels,
  totalsFrom,
  totalsFromModels,
  isUsageEmpty,
  HEAT_DAYS,
} from '../src/shared/usage.ts'
import type { CoverageStats, Overview } from '../src/shared/contract.ts'

test('dayKeyUTC buckets by UTC calendar day', () => {
  // 2026-08-15T23:59:00 UTC+8 is 2026-08-15T15:59:00Z — same UTC day, but a
  // different LOCAL day for UTC+8. The key must follow UTC.
  const ts = Date.UTC(2026, 7, 15, 15, 59, 0) // 15:59Z = 23:59 UTC+8
  assert.equal(dayKeyUTC(ts), '2026-08-15')
  assert.equal(dayKeyUTC(Date.UTC(2026, 7, 15, 16, 0, 0)), '2026-08-15')
  assert.equal(dayKeyUTC(Date.UTC(2026, 7, 16, 0, 0, 0)), '2026-08-16')
  assert.equal(dayKeyUTC(Date.UTC(2026, 0, 2, 3, 4, 5)), '2026-01-02')
})

test('parseDayKeyUTC round-trips through UTC midnight', () => {
  const d = parseDayKeyUTC('2026-08-15')
  assert.equal(d.getUTCFullYear(), 2026)
  assert.equal(d.getUTCMonth(), 7)
  assert.equal(d.getUTCDate(), 15)
  assert.equal(d.getUTCHours(), 0)
})

test('totalsFrom sums the four disjoint buckets', () => {
  // DSH TokenUsage buckets are disjoint: input is uncached only, so the total
  // is a plain sum (v0.1.0 semantic, now backed by the documented contract).
  const t = totalsFrom({ input: 10, output: 20, cacheRead: 30, cacheWrite: 5 })
  assert.deepEqual(t, { input: 10, output: 20, cacheRead: 30, cacheWrite: 5, total: 65 })
})

test('emptyTotals and mergeInto are additive and idempotent', () => {
  const a = emptyTotals()
  const b = { input: 1, output: 2, cacheRead: 3, cacheWrite: 4 }
  mergeInto(a, b)
  mergeInto(a, b)
  assert.deepEqual(a, { input: 2, output: 4, cacheRead: 6, cacheWrite: 8, total: 0 })
})

test('sortedModels ranks by total desc and preserves buckets', () => {
  const map = {
    'model-b': { input: 5, output: 5, cacheRead: 5, cacheWrite: 5 },
    'model-a': { input: 100, output: 0, cacheRead: 0, cacheWrite: 0 },
    unknown: emptyBuckets(),
  }
  const rows = sortedModels(map)
  assert.deepEqual(
    rows.map((r) => r.model),
    ['model-a', 'model-b', 'unknown'],
  )
  assert.equal(rows[0]!.total, 100)
  assert.equal(rows[1]!.total, 20)
  assert.equal(rows[2]!.total, 0)
})

test('totalsFromModels aggregates a ranking back into totals', () => {
  const rows = sortedModels({
    a: { input: 10, output: 10, cacheRead: 10, cacheWrite: 10 },
    b: { input: 1, output: 1, cacheRead: 1, cacheWrite: 1 },
  })
  assert.equal(totalsFromModels(rows).total, 44)
  assert.equal(totalsFromModels(rows).input, 11)
})

test('hitRate = read / (uncached + read + write); null when nothing billed', () => {
  assert.equal(hitRate({ input: 80, output: 0, cacheRead: 20, cacheWrite: 0 }), 0.2)
  assert.equal(hitRate({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }), null)
  assert.equal(hitRate({ input: 0, output: 100, cacheRead: 0, cacheWrite: 10 }), 0)
  assert.equal(hitRate({ input: 100, output: 0, cacheRead: 900, cacheWrite: 0 }), 0.9)
})

test('buildDayWindow produces HEAT_DAYS zero-filled records ending today (UTC)', () => {
  const now = Date.UTC(2026, 7, 15, 12, 0, 0)
  const days = buildDayWindow({}, now)
  assert.equal(days.length, HEAT_DAYS)
  assert.equal(days[HEAT_DAYS - 1]!.date, '2026-08-15')
  assert.equal(days[HEAT_DAYS - 2]!.date, '2026-08-14')
  assert.equal(days[0]!.date, '2026-02-15')
  for (const d of days) {
    assert.equal(d.total, 0)
    assert.deepEqual(d.models, {})
  }
})

test('buildDayWindow merges per-model buckets into the right day', () => {
  const byDay = {
    '2026-08-14': { 'model-a': { input: 3, output: 4, cacheRead: 5, cacheWrite: 6 } },
    '2026-07-01': { 'model-a': { input: 1, output: 0, cacheRead: 0, cacheWrite: 0 } },
  }
  const now = Date.UTC(2026, 7, 15, 12, 0, 0)
  const days = buildDayWindow(byDay, now)
  const d14 = days.find((d) => d.date === '2026-08-14')!
  assert.equal(d14.total, 18)
  assert.deepEqual(d14.models['model-a'], { input: 3, output: 4, cacheRead: 5, cacheWrite: 6, total: 18 })
  const d1 = days.find((d) => d.date === '2026-07-01')!
  assert.equal(d1.total, 1)
})

test('monthKeyUTC and listMonthKeys walk the heatmap window', () => {
  assert.equal(monthKeyUTC('2026-08-15'), '2026-08')
  const now = Date.UTC(2026, 7, 15, 12, 0, 0)
  const days = buildDayWindow({}, now)
  const months = listMonthKeys(days)
  assert.equal(months[0], '2026-02')
  assert.equal(months[months.length - 1], '2026-08')
  assert.ok(months.includes('2026-05'))
})

test('mergeInto handles zero buckets without NaN', () => {
  const t = emptyTotals()
  mergeInto(t, { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 })
  assert.equal(t.total, 0)
  assert.ok(Number.isFinite(t.input))
})

function overviewForEmpty(sessionCount: number, sessionsFailed: number, sessionsTotal = sessionCount): Pick<Overview, 'allTime' | 'coverage'> {
  const coverage: CoverageStats = {
    mode: 'projection',
    timezone: 'UTC',
    sessionsTotal,
    sessionsOk: 0,
    sessionsFailed,
    sessionsPending: 0,
    eventsCounted: 0,
    retries: 0,
    compactionTokens: 0,
    from: null,
    to: null,
    usageSessionsMain: sessionCount,
    usageSessionsSubagent: 0,
  }
  return {
    allTime: { totals: emptyTotals(), sessionCount, byModel: [] },
    coverage,
  }
}

test('isUsageEmpty is true when there is no billed usage and no scan failure', () => {
  assert.equal(isUsageEmpty(overviewForEmpty(0, 0, 0)), true)
  assert.equal(isUsageEmpty(overviewForEmpty(0, 0, 3)), true)
})

test('isUsageEmpty is false when billed-usage sessions exist', () => {
  assert.equal(isUsageEmpty(overviewForEmpty(1, 0, 1)), false)
})

test('isUsageEmpty is false when the scan failed even with zero billed usage', () => {
  assert.equal(isUsageEmpty(overviewForEmpty(0, 1, 1)), false)
})
