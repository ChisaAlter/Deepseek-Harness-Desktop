// Locks the period-bucketed cost folding: step/start classification, the
// provisional→authoritative replacement semantics, compaction exclusion,
// seed-boundary gating, and per-model/day/provider cost consistency.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import { applyEvent, foldEvents, initState } from '../src/host/projection.ts'
import { PROJECTION_STATE_VERSION } from '../src/host/projection-unit.ts'

const MON = Date.UTC(2026, 7, 24) // Monday 2026-08-24 00:00 UTC = 08:00 Beijing
/** A Beijing-peak instant (10:00 Beijing = 02:00 UTC). */
const PEAK_MS = MON + 2 * 3600 * 1000
/** A Beijing-off-peak instant (20:00 Beijing = 12:00 UTC). */
const OFF_MS = MON + 12 * 3600 * 1000

function ev(type: string, seq: number, time: number, data: Record<string, unknown>): SessionEvent {
  return { type, seq, time, data } as SessionEvent
}

function usage(input = 0, output = 0, cacheRead = 0, cacheWrite = 0): Record<string, number> {
  return { inputTokens: input, outputTokens: output, cacheReadTokens: cacheRead, cacheWriteTokens: cacheWrite }
}

function withMarker(events: SessionEvent[]): SessionEvent[] {
  const marker = ev('session/end-seed', 1, 0, {})
  return [marker, ...events.map((e) => ({ ...e, seq: e.seq + 1 }))]
}

test('stateVersion bump invalidates old persisted rows (cold refold once)', () => {
  assert.equal(PROJECTION_STATE_VERSION, 2)
})

test('a step straddling a phase boundary bills at its step/start instant', () => {
  const events = [
    ev('step/start', 1, OFF_MS, { turn: 1, step: 1 }),
    ev('assistant/message', 2, PEAK_MS + 3 * 3600 * 1000, { turn: 1, step: 1, usage: usage(10, 5) }),
    ev('step/end', 3, PEAK_MS + 3 * 3600 * 1000, { turn: 1, step: 1 }),
    ev('step/start', 4, PEAK_MS, { turn: 2, step: 1 }),
    ev('assistant/message', 5, PEAK_MS, { turn: 2, step: 1, usage: usage(7) }),
    ev('step/end', 6, PEAK_MS, { turn: 2, step: 1 }),
  ]
  const state = foldEvents(withMarker(events))
  assert.equal(state.costTotals.offPeak.input, 10)
  assert.equal(state.costTotals.offPeak.output, 5)
  assert.equal(state.costTotals.peak.input, 7)
  assert.equal(state.totals.input, 17)
})

test('without a step/start event the step classifies at its message time', () => {
  const events = [
    ev('assistant/message', 1, PEAK_MS, { turn: 1, step: 1, usage: usage(7) }),
    ev('step/end', 2, PEAK_MS, { turn: 1, step: 1 }),
    ev('assistant/message', 3, OFF_MS, { turn: 2, step: 1, usage: usage(9) }),
    ev('step/end', 4, OFF_MS, { turn: 2, step: 1 }),
  ]
  const state = foldEvents(withMarker(events))
  assert.equal(state.costTotals.peak.input, 7)
  assert.equal(state.costTotals.offPeak.input, 9)
})

test('provisional accumulation is replaced by the authoritative message, peak kept', () => {
  const events = [
    ev('step/start', 1, PEAK_MS, { turn: 1, step: 1 }),
    ev('assistant/chunk', 2, PEAK_MS, { turn: 1, step: 1, chunk: { type: 'usage', usage: usage(3, 0, 1, 0) } }),
    ev('assistant/chunk', 3, PEAK_MS, { turn: 1, step: 1, chunk: { type: 'usage', usage: usage(2, 0, 0, 0) } }),
    ev('step/start', 4, OFF_MS, { turn: 1, step: 2 }),
    // The message lands after the NEXT step's start: the snapshot must survive.
    ev('assistant/message', 5, OFF_MS, { turn: 1, step: 1, usage: usage(10, 5) }),
    ev('step/end', 6, OFF_MS, { turn: 1, step: 1 }),
    ev('assistant/message', 7, OFF_MS, { turn: 1, step: 2, usage: usage(4) }),
    ev('step/end', 8, OFF_MS, { turn: 1, step: 2 }),
  ]
  const state = foldEvents(withMarker(events))
  assert.equal(state.totals.input, 14)
  assert.equal(state.costTotals.peak.input, 10)
  assert.equal(state.costTotals.peak.output, 5)
  assert.equal(state.costTotals.offPeak.input, 4)
  // No provisional double count anywhere.
  assert.equal(state.costTotals.peak.input + state.costTotals.offPeak.input, 14)
})

test('compaction never enters the cost buckets but stays in token totals', () => {
  const events = [
    ev('compaction/summary', 1, PEAK_MS, {
      compactionId: 'c',
      summary: [],
      shadowedRange: { start: 1, end: 2 },
      shadowedSeqs: [1, 2],
      shadowedTokenCount: 90,
      provider: 'p',
      model: 'compactor',
      usage: usage(6, 1, 2, 3),
    }),
    ev('assistant/message', 2, PEAK_MS, { turn: 1, step: 1, usage: usage(4) }),
    ev('step/end', 3, PEAK_MS, { turn: 1, step: 1 }),
  ]
  const state = foldEvents(withMarker(events))
  assert.equal(state.compactionTokens, 12)
  assert.equal(state.totals.input, 10)
  assert.equal(state.costTotals.peak.input, 4)
  assert.equal(state.costTotals.peak.input + state.costTotals.offPeak.input, 4)
})

test('retry events count as retries and never as tokens or cost', () => {
  const events = [
    ev('llm/retry', 1, PEAK_MS, { provider: 'p', model: 'm', attempt: 1 }),
    ev('assistant/message', 2, PEAK_MS, { turn: 1, step: 1, usage: usage(4) }),
    ev('step/end', 3, PEAK_MS, { turn: 1, step: 1 }),
  ]
  const state = foldEvents(withMarker(events))
  assert.equal(state.retries, 1)
  assert.equal(state.totals.input, 4)
  assert.equal(state.costTotals.peak.input, 4)
})

test('seed history is never counted: markers arm counting only afterwards', () => {
  const marker = ev('session/end-seed', 3, 0, {})
  const events = [
    ev('step/start', 1, PEAK_MS, { turn: 1, step: 1 }),
    ev('assistant/message', 2, PEAK_MS, { turn: 1, step: 1, usage: usage(100) }),
    ev('step/end', 3, PEAK_MS, { turn: 1, step: 1 }),
    marker,
    ev('step/start', 4, PEAK_MS, { turn: 1, step: 1 }),
    ev('assistant/message', 5, PEAK_MS, { turn: 1, step: 1, usage: usage(7) }),
    ev('step/end', 6, PEAK_MS, { turn: 1, step: 1 }),
  ]
  const state = foldEvents(events)
  assert.equal(state.totals.input, 7)
  assert.equal(state.costTotals.peak.input, 7)
})

test('a seed step/start with the same turn/step never arms the live step', () => {
  const marker = ev('session/end-seed', 3, 0, {})
  const events = [
    // Seed history uses turn 1 step 1 at peak; the live session restarts it at off-peak.
    ev('step/start', 1, PEAK_MS, { turn: 1, step: 1 }),
    ev('assistant/message', 2, PEAK_MS, { turn: 1, step: 1, usage: usage(100) }),
    ev('step/end', 3, PEAK_MS, { turn: 1, step: 1 }),
    marker,
    ev('step/start', 4, OFF_MS, { turn: 1, step: 1 }),
    ev('assistant/message', 5, OFF_MS, { turn: 1, step: 1, usage: usage(7) }),
    ev('step/end', 6, OFF_MS, { turn: 1, step: 1 }),
  ]
  const state = foldEvents(events)
  assert.equal(state.costTotals.peak.input, 0)
  assert.equal(state.costTotals.offPeak.input, 7)
})

test('last seed marker wins across multiple markers', () => {
  const events = [
    ev('session/end-seed', 1, 0, {}),
    ev('assistant/message', 2, PEAK_MS, { turn: 1, step: 1, usage: usage(100) }),
    ev('step/end', 3, PEAK_MS, { turn: 1, step: 1 }),
    ev('session/end-seed', 4, 0, {}),
    ev('assistant/message', 5, PEAK_MS, { turn: 1, step: 1, usage: usage(7) }),
    ev('step/end', 6, PEAK_MS, { turn: 1, step: 1 }),
  ]
  const state = foldEvents(events)
  assert.equal(state.seedEnd, 4)
  assert.equal(state.totals.input, 7)
})

test('cost maps stay consistent with token totals per model/day/provider', () => {
  const events = [
    ev('step/start', 1, PEAK_MS, { turn: 1, step: 1 }),
    ev('request/context', 2, PEAK_MS, { model: 'deepseek-v4-flash', provider: 'deepseek-official' }),
    ev('assistant/message', 3, PEAK_MS, { turn: 1, step: 1, usage: usage(10, 4, 2, 1) }),
    ev('step/end', 4, PEAK_MS, { turn: 1, step: 1 }),
    ev('step/start', 5, OFF_MS, { turn: 2, step: 1 }),
    ev('request/header', 6, OFF_MS, { header: { config: { model: 'deepseek-v4-pro', provider: 'deepseek-official' } } }),
    ev('assistant/message', 7, OFF_MS, { turn: 2, step: 1, usage: usage(5) }),
    ev('step/end', 8, OFF_MS, { turn: 2, step: 1 }),
  ]
  const state = foldEvents(withMarker(events))
  const phaseSum = (phase: 'peak' | 'offPeak'): number =>
    Object.values(state.costByModel).reduce((sum, p) => sum + p[phase].input, 0)
  assert.equal(state.totals.input, 15)
  assert.equal(phaseSum('peak') + phaseSum('offPeak'), 15)
  assert.equal(state.costByModel['deepseek-v4-flash']!.peak.input, 10)
  assert.equal(state.costByModel['deepseek-v4-pro']!.offPeak.input, 5)
  assert.equal(state.costByProvider['deepseek-official']!.peak.input, 10)
  const day = '2026-08-24'
  assert.equal(state.costByDay[day]!['deepseek-v4-flash']!.peak.input, 10)
})

test('a zero-usage step folds no cost entries', () => {
  const events = [
    ev('step/start', 1, PEAK_MS, { turn: 1, step: 1 }),
    ev('assistant/message', 2, PEAK_MS, { turn: 1, step: 1, usage: usage(0, 0, 0, 0) }),
    ev('step/end', 3, PEAK_MS, { turn: 1, step: 1 }),
  ]
  const state = foldEvents(withMarker(events))
  assert.equal(state.totals.input, 0)
  assert.deepEqual(state.costTotals, { peak: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, offPeak: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } })
})

test('turn/end commits an open step with its cost buckets', () => {
  const events = [
    ev('step/start', 1, OFF_MS, { turn: 1, step: 1 }),
    ev('assistant/message', 2, OFF_MS, { turn: 1, step: 1, usage: usage(6) }),
    ev('turn/end', 3, OFF_MS, {}),
  ]
  const state = foldEvents(withMarker(events))
  assert.equal(state.totals.input, 6)
  assert.equal(state.costTotals.offPeak.input, 6)
})

test('an identical step/start event is a no-op reference', () => {
  const start = ev('step/start', 2, PEAK_MS, { turn: 1, step: 1 })
  let state = initState()
  state = { ...state, seedEnd: 1 }
  const first = applyEvent(state, start)
  const second = applyEvent(first, start)
  assert.equal(first, second)
})

test('cold single-pass armed fold counts nothing before the marker', () => {
  // Mirrors the registry's lazy cold fold: init + apply per event, no lookahead.
  let state = initState()
  state = applyEvent(state, ev('step/start', 1, PEAK_MS, { turn: 1, step: 1 }))
  state = applyEvent(state, ev('assistant/message', 2, PEAK_MS, { turn: 1, step: 1, usage: usage(100) }))
  state = applyEvent(state, ev('step/end', 3, PEAK_MS, { turn: 1, step: 1 }))
  assert.equal(state.totals.input, 0)
  state = applyEvent(state, ev('session/end-seed', 4, 0, {}))
  state = applyEvent(state, ev('step/start', 5, PEAK_MS, { turn: 1, step: 1 }))
  state = applyEvent(state, ev('assistant/message', 6, PEAK_MS, { turn: 1, step: 1, usage: usage(7) }))
  state = applyEvent(state, ev('step/end', 7, PEAK_MS, { turn: 1, step: 1 }))
  assert.equal(state.totals.input, 7)
  assert.equal(state.costTotals.peak.input, 7)
})
