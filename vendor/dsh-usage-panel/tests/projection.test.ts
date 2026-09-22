// Locks the projection reducer's accounting semantics: seed boundary (fork
// dedup), dual-source model attribution, per-step provisional/authoritative
// replacement (retry dedup), compaction attribution, retry counting, disjoint
// buckets, and the same-reference contract for unrelated events.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import { applyEvent, foldEvents, initState, recentOf } from '../src/host/projection.ts'
import { usagePanelProjectionDefinition } from '../src/host/projection-unit.ts'

function ev(type: string, seq: number, time: number, data: unknown): SessionEvent {
  return { type, seq, time, data } as unknown as SessionEvent
}

/** Realistic logs start with the constructor's session/end-seed marker. */
function withMarker(events: SessionEvent[]): SessionEvent[] {
  const marker = ev('session/end-seed', 1, 0, {})
  return [marker, ...events.map((e) => ({ ...e, seq: e.seq + 1 }))]
}

function usage(input = 0, output = 0, cacheRead = 0, cacheWrite = 0) {
  return { inputTokens: input, outputTokens: output, cacheReadTokens: cacheRead, cacheWriteTokens: cacheWrite }
}

test('seed events are never counted; live events after session/end-seed are', () => {
  const events = [
    ev('request/header', 1, 1000, { header: { config: { model: 'm' } }, reason: 'initial' }),
    ev('assistant/message', 2, 1000, { turn: 1, step: 1, usage: usage(100) }),
    ev('session/end-seed', 3, 1000, {}),
    ev('assistant/message', 4, 2000, { turn: 1, step: 2, usage: usage(7) }),
    ev('step/end', 5, 2000, { turn: 1, step: 2 }),
  ]
  const state = foldEvents(withMarker(events))
  assert.equal(state.totals.input, 7)
  assert.equal(state.byModel['m']?.input, 7)
  assert.equal(state.seedEnd, 4)
})

test('model attribution: request/context base, request/header overrides (v0.1.0)', () => {
  const events = [
    ev('request/context', 1, 1000, { provider: 'p1', model: 'context-model' }),
    ev('assistant/message', 2, 1000, { turn: 1, step: 1, usage: usage(10) }),
    ev('request/header', 3, 1000, { header: { config: { provider: 'p1', model: 'header-model' } }, reason: 'change' }),
    ev('assistant/message', 4, 1000, { turn: 1, step: 2, usage: usage(20) }),
    ev('step/end', 5, 1000, { turn: 1, step: 2 }),
  ]
  const state = foldEvents(withMarker(events))
  assert.equal(state.byModel['context-model']?.input, 10)
  assert.equal(state.byModel['header-model']?.input, 20)
  assert.equal(state.byProvider['p1']?.input, 30)
})

test('chunk provisional accumulates and is replaced by the authoritative message', () => {
  const events = [
    ev('assistant/chunk', 1, 1000, { turn: 1, step: 1, chunk: { type: 'usage', usage: usage(10, 2) } }),
    ev('assistant/chunk', 2, 1000, { turn: 1, step: 1, chunk: { type: 'usage', usage: usage(5, 1) } }),
    ev('assistant/message', 3, 1000, { turn: 1, step: 1, usage: usage(100, 30) }),
    ev('step/end', 4, 1000, { turn: 1, step: 1 }),
  ]
  const state = foldEvents(withMarker(events))
  // Authoritative replaces the accumulated provisional: 100/30, not 115/33.
  assert.deepEqual(state.totals, { input: 100, output: 30, cacheRead: 0, cacheWrite: 0 })
})

test('same-step retried message replaces instead of double-counting (v0.1.0 bug)', () => {
  const events = [
    ev('assistant/message', 1, 1000, { turn: 1, step: 1, usage: usage(50) }),
    ev('llm/retry', 2, 1000, { turn: 1, step: 1, retryId: 'r1', provider: 'p', mode: 'normal', policyKey: 'k', retry: 1, maxRetries: 2, delayMs: 100, failure: { code: 'x', message: 'x' } }),
    ev('assistant/message', 3, 1000, { turn: 1, step: 1, usage: usage(80) }),
    ev('step/end', 4, 1000, { turn: 1, step: 1 }),
  ]
  const state = foldEvents(withMarker(events))
  assert.equal(state.totals.input, 80) // 80, not 130
  assert.equal(state.retries, 1)
})

test('distinct steps both count (each attempt is a real billed call)', () => {
  const events = [
    ev('assistant/message', 1, 1000, { turn: 1, step: 1, usage: usage(10) }),
    ev('step/end', 2, 1000, { turn: 1, step: 1 }),
    ev('assistant/message', 3, 1000, { turn: 1, step: 2, usage: usage(20) }),
    ev('step/end', 4, 1000, { turn: 1, step: 2 }),
  ]
  const state = foldEvents(withMarker(events))
  assert.equal(state.totals.input, 30)
})

test('step/end commits a provisional-only step (aborted stream still billed)', () => {
  const events = [
    ev('assistant/chunk', 1, 1000, { turn: 1, step: 1, chunk: { type: 'usage', usage: usage(9) } }),
    ev('step/end', 2, 1000, { turn: 1, step: 1 }),
  ]
  const state = foldEvents(withMarker(events))
  assert.equal(state.totals.input, 9)
})

test('turn/end commits the open step (log ends mid-step safety)', () => {
  const events = [
    ev('assistant/chunk', 1, 1000, { turn: 1, step: 3, chunk: { type: 'usage', usage: usage(4) } }),
    ev('turn/end', 2, 1000, { turn: 1, reason: 'success' }),
  ]
  const state = foldEvents(withMarker(events))
  assert.equal(state.totals.input, 4)
})

test('compaction/summary usage attributed to its own model and tracked separately', () => {
  const events = [
    ev('compaction/summary', 1, 1000, { compactionId: 'c1', summary: [], shadowedRange: { start: 1, end: 2 }, shadowedSeqs: [1, 2], shadowedTokenCount: 50, provider: 'p', model: 'compactor', usage: usage(6, 1, 2, 3) }),
  ]
  const state = foldEvents(withMarker(events))
  assert.equal(state.byModel['compactor']?.input, 6)
  assert.equal(state.compactionTokens, 12)
  assert.equal(state.totals.input, 6)
  assert.equal(state.totals.output + state.totals.cacheRead + state.totals.cacheWrite + state.totals.input, 12)
})

test('reasoning is already inside output — never added again', () => {
  const events = [
    ev('assistant/message', 1, 1000, { turn: 1, step: 1, usage: { ...usage(10, 20), reasoningTokens: 15 } }),
    ev('step/end', 2, 1000, { turn: 1, step: 1 }),
  ]
  const state = foldEvents(withMarker(events))
  assert.equal(state.totals.output, 20)
  assert.equal(state.totals.input + state.totals.output, 30)
})

test('unrelated events return the SAME state reference (zero downstream work)', () => {
  const state = initState()
  const next = applyEvent(state, ev('user/message', 1, 1000, { content: 'hi' }))
  assert.equal(next, state)
  // Unknown event types are ignored too.
  const next2 = applyEvent(state, ev('todo/write', 2, 1000, { todos: [] }))
  assert.equal(next2, state)
})

test('request/context without model/provider is a no-op (same reference)', () => {
  const state = initState()
  const next = applyEvent(state, ev('request/context', 1, 1000, {}))
  assert.equal(next, state)
})

test('day buckets are UTC and per-model', () => {
  const events = [
    ev('assistant/message', 1, Date.UTC(2026, 7, 15, 23, 30), { turn: 1, step: 1, usage: usage(5) }),
    ev('step/end', 2, Date.UTC(2026, 7, 15, 23, 30), { turn: 1, step: 1 }),
  ]
  const state = foldEvents(withMarker(events))
  assert.ok(state.byDay['2026-08-15'])
  assert.equal(state.byDay['2026-08-15']!['unknown']!.input, 5)
})

test('recentOf sums only days >= cutoff key', () => {
  const state = foldEvents(withMarker([
    ev('assistant/message', 1, Date.UTC(2026, 6, 1, 0, 0), { turn: 1, step: 1, usage: usage(100) }),
    ev('step/end', 2, Date.UTC(2026, 6, 1, 0, 0), { turn: 1, step: 1 }),
    ev('assistant/message', 3, Date.UTC(2026, 7, 14, 0, 0), { turn: 2, step: 1, usage: usage(7) }),
    ev('step/end', 4, Date.UTC(2026, 7, 14, 0, 0), { turn: 2, step: 1 }),
  ]))
  const recent = recentOf(state, '2026-07-16')
  assert.equal(recent.totals.input, 7)
  const all = recentOf(state, '2026-01-01')
  assert.equal(all.totals.input, 107)
})

test('firstTime/lastTime track the counted event range', () => {
  const state = foldEvents(withMarker([
    ev('assistant/message', 1, 5000, { turn: 1, step: 1, usage: usage(1) }),
    ev('step/end', 2, 5000, { turn: 1, step: 1 }),
    ev('llm/retry', 3, 9000, { turn: 1, step: 2, retryId: 'r', provider: 'p', mode: 'normal', policyKey: 'k', retry: 1, maxRetries: 1, delayMs: 1, failure: { code: 'x', message: 'x' } }),
  ]))
  assert.equal(state.firstTime, 5000)
  assert.equal(state.lastTime, 9000)
})

test('usagePanel projection definition exposes wire for client-visible snapshots', () => {
  assert.equal(usagePanelProjectionDefinition.key, 'usagePanel')
  assert.ok(usagePanelProjectionDefinition.wire)
  assert.equal(usagePanelProjectionDefinition.stateSchema, usagePanelProjectionDefinition.wire.viewSchema)
  const init = usagePanelProjectionDefinition.init()
  assert.equal(usagePanelProjectionDefinition.wire.view(init), init)
})
