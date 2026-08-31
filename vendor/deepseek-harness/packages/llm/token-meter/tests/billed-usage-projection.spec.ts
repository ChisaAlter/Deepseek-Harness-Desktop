import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { createMessage } from '@deepseek-ai/dsh-llm'
import type { TokenUsage } from '@deepseek-ai/dsh-llm'
import SessionStore from '@deepseek-ai/dsh-session'
import type { Session, SessionEvent } from '@deepseek-ai/dsh-session'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import TokenMeter from '@deepseek-ai/dsh-token-meter'
import type { BilledUsageBuckets, BilledUsageProjection } from '@deepseek-ai/dsh-token-meter/client'
import { billedUsageProjectionDefinition } from '../src/billed-usage-projection.ts'
import { isPeakBillingTime } from '../src/billing-window.ts'

// Beijing wall time is UTC+8 with no DST, so these UTC constructors are exact
// wall-clock pins regardless of the host timezone.
const PEAK_MS = Date.UTC(2026, 2, 2, 2, 0, 0) // Monday 10:00:00 Beijing
const PEAK_LATER_MS = Date.UTC(2026, 2, 2, 2, 30, 0) // Monday 10:30:00 Beijing
const BOUNDARY_BEFORE_MS = Date.UTC(2026, 2, 2, 3, 59, 59) // Monday 11:59:59 Beijing (peak)
const BOUNDARY_AFTER_MS = Date.UTC(2026, 2, 2, 4, 0, 1) // Monday 12:00:01 Beijing (off-peak)
const OFF_PEAK_MS = Date.UTC(2026, 2, 2, 11, 0, 0) // Monday 19:00:00 Beijing
const WEEKEND_MS = Date.UTC(2026, 2, 7, 2, 0, 0) // Saturday 10:00:00 Beijing

const ZERO: BilledUsageBuckets = { missInputTokens: 0, cacheReadTokens: 0, outputTokens: 0 }

const foldAll = (events: SessionEvent[]): BilledUsageProjection => {
  let state = billedUsageProjectionDefinition.init()
  for (const event of events) state = billedUsageProjectionDefinition.apply(state, event)
  return billedUsageProjectionDefinition.wire.view(state)
}

const viewOf = (state: ReturnType<typeof billedUsageProjectionDefinition.init>): BilledUsageProjection =>
  billedUsageProjectionDefinition.wire.view(state)

const stepStart = (seq: number, time: number, turn: number, step: number): SessionEvent => ({
  type: 'step/start',
  seq,
  time,
  data: { turn, step },
})

const usageChunk = (seq: number, time: number, usage: TokenUsage, turn = 1, step = 1): SessionEvent => ({
  type: 'assistant/chunk',
  seq,
  time,
  data: { turn, step, chunk: { type: 'usage', usage } },
})

const finalMessage = (seq: number, time: number, usage: TokenUsage, turn = 1, step = 1): SessionEvent => ({
  type: 'assistant/message',
  seq,
  time,
  data: {
    turn,
    step,
    message: createMessage({ role: 'assistant', content: [], source: { kind: 'model', provider: 'mock', model: 'mock' } }),
    usage,
  },
  surfaceOp: 'append',
  sourceEventSeqs: [],
})

const MISS: TokenUsage = { inputTokens: 300, outputTokens: 90 }
const MIXED: TokenUsage = { inputTokens: 200, outputTokens: 40, cacheReadTokens: 1_000, cacheWriteTokens: 25 }

describe('billed-usage fold — phase classification', () => {
  it('classifies weekday daytime as peak and evenings, nights, and weekends as off-peak', () => {
    expect(isPeakBillingTime(PEAK_MS)).toBe(true)
    expect(isPeakBillingTime(BOUNDARY_BEFORE_MS)).toBe(true)
    expect(isPeakBillingTime(OFF_PEAK_MS)).toBe(false)
    expect(isPeakBillingTime(WEEKEND_MS)).toBe(false)
    // 11:59 Beijing is still peak; 12:00 is the break; 13:59 break; 14:00 peak.
    expect(isPeakBillingTime(Date.UTC(2026, 2, 2, 3, 59, 0))).toBe(true)
    expect(isPeakBillingTime(Date.UTC(2026, 2, 2, 4, 0, 0))).toBe(false)
    expect(isPeakBillingTime(Date.UTC(2026, 2, 2, 5, 59, 0))).toBe(false)
    expect(isPeakBillingTime(Date.UTC(2026, 2, 2, 6, 0, 0))).toBe(true)
  })

  it('serves zero buckets for a log without usage reports', () => {
    expect(foldAll([stepStart(0, PEAK_MS, 1, 1)])).toEqual({ peak: ZERO, offPeak: ZERO })
  })

  it('buckets a peak-window sample at the peak rates shape', () => {
    const view = foldAll([
      stepStart(0, PEAK_MS, 1, 1),
      usageChunk(1, PEAK_LATER_MS, MISS),
    ])
    expect(view.peak).toEqual({ missInputTokens: 300, cacheReadTokens: 0, outputTokens: 90 })
    expect(view.offPeak).toEqual(ZERO)
  })

  it('splits cache reads from uncached input and bills cache writes as uncached', () => {
    const view = foldAll([
      stepStart(0, PEAK_MS, 1, 1),
      usageChunk(1, PEAK_LATER_MS, MIXED),
    ])
    expect(view.peak).toEqual({ missInputTokens: 225, cacheReadTokens: 1_000, outputTokens: 40 })
  })

  it('bills a request that straddles a boundary at its start instant', () => {
    const view = foldAll([
      stepStart(0, BOUNDARY_BEFORE_MS, 1, 1),
      usageChunk(1, BOUNDARY_AFTER_MS, MISS),
    ])
    // The usage event's own time is already off-peak; the step started peak.
    expect(view.peak.missInputTokens).toBe(300)
    expect(view.offPeak).toEqual(ZERO)
  })

  it('falls back to the sample event time when no step/start is in the log', () => {
    const view = foldAll([usageChunk(0, OFF_PEAK_MS, MISS, 3, 1)])
    expect(view.offPeak.missInputTokens).toBe(300)
    expect(view.peak).toEqual(ZERO)
  })

  it('buckets weekend samples off-peak', () => {
    const view = foldAll([
      stepStart(0, WEEKEND_MS, 1, 1),
      usageChunk(1, WEEKEND_MS, MISS),
    ])
    expect(view.offPeak.missInputTokens).toBe(300)
    expect(view.peak).toEqual(ZERO)
  })

  it('keeps peak and off-peak samples in disjoint buckets across steps', () => {
    const view = foldAll([
      stepStart(0, PEAK_MS, 1, 1),
      usageChunk(1, PEAK_LATER_MS, MISS),
      stepStart(2, OFF_PEAK_MS, 1, 2),
      usageChunk(3, OFF_PEAK_MS, MIXED, 1, 2),
    ])
    expect(view.peak).toEqual({ missInputTokens: 300, cacheReadTokens: 0, outputTokens: 90 })
    expect(view.offPeak).toEqual({ missInputTokens: 225, cacheReadTokens: 1_000, outputTokens: 40 })
  })
})

describe('billed-usage fold — replace and identity rules', () => {
  it('replaces a same-step usage chunk with the final message instead of double-counting', () => {
    const view = foldAll([
      stepStart(0, PEAK_MS, 1, 1),
      usageChunk(1, PEAK_LATER_MS, { inputTokens: 10, outputTokens: 2, cacheReadTokens: 3 }),
      finalMessage(2, PEAK_LATER_MS, MIXED),
    ])
    expect(view.peak).toEqual({ missInputTokens: 225, cacheReadTokens: 1_000, outputTokens: 40 })
  })

  it('keeps a replaced sample in its own phase when the replacement lands in the other phase', () => {
    // Degenerate log: the chunk sampled off-peak, the final message re-reports
    // with a start-time phase flip. The subtraction targets the phase the
    // superseded sample was filed under.
    const view = foldAll([
      usageChunk(0, OFF_PEAK_MS, { inputTokens: 10, outputTokens: 2 }, 1, 1),
      finalMessage(1, OFF_PEAK_MS, MISS, 1, 1),
    ])
    expect(view.offPeak).toEqual({ missInputTokens: 300, cacheReadTokens: 0, outputTokens: 90 })
    expect(view.peak).toEqual(ZERO)
  })

  it('leaves the state reference untouched for unrelated events and identical restatements', () => {
    const definition = billedUsageProjectionDefinition
    let state = definition.init()
    const stepEnd: SessionEvent = {
      type: 'step/end',
      seq: 0,
      time: PEAK_MS,
      data: { turn: 1, step: 1 },
    }
    const afterUnrelated = definition.apply(state, stepEnd)
    expect(afterUnrelated).toBe(state)
    state = definition.apply(state, stepStart(1, PEAK_MS, 1, 1))
    const withSample = definition.apply(state, usageChunk(2, PEAK_LATER_MS, MISS))
    expect(definition.apply(withSample, usageChunk(3, PEAK_LATER_MS, MISS))).toBe(withSample)
  })

  it('projects the wire view through the validated schema shape', () => {
    const state = billedUsageProjectionDefinition.apply(
      billedUsageProjectionDefinition.apply(
        billedUsageProjectionDefinition.init(),
        stepStart(0, PEAK_MS, 1, 1),
      ),
      usageChunk(1, PEAK_LATER_MS, MIXED),
    )
    expect(billedUsageProjectionDefinition.wire.viewSchema.parse(viewOf(state))).toEqual({
      peak: { missInputTokens: 225, cacheReadTokens: 1_000, outputTokens: 40 },
      offPeak: ZERO,
    })
  })
})

describe('billedUsage session projection — registry integration', () => {
  it('splits a real log across the Beijing boundary via the registered unit', async () => {
    vi.useFakeTimers()
    try {
      vi.setSystemTime(PEAK_MS)
      const ctx = new Context()
      await ctx.plugin(SessionStore)
      await ctx.plugin(SessionProjectionRegistry)
      await ctx.plugin(TokenMeter)
      const session: Session = ctx.sessions.create()
      session.append('step/start', { turn: 1, step: 1 })
      session.append('assistant/chunk', { turn: 1, step: 1, chunk: { type: 'usage', usage: MISS } })
      session.append('assistant/message', {
        turn: 1,
        step: 1,
        message: createMessage({ role: 'assistant', content: [], source: { kind: 'model', provider: 'mock', model: 'mock' } }),
        usage: MISS,
      }, { surfaceOp: 'append', sourceEventSeqs: [] })
      session.append('step/end', { turn: 1, step: 1 })
      vi.setSystemTime(OFF_PEAK_MS)
      session.append('step/start', { turn: 2, step: 1 })
      session.append('assistant/chunk', { turn: 2, step: 1, chunk: { type: 'usage', usage: MIXED } })
      session.append('assistant/message', {
        turn: 2,
        step: 1,
        message: createMessage({ role: 'assistant', content: [], source: { kind: 'model', provider: 'mock', model: 'mock' } }),
        usage: MIXED,
      }, { surfaceOp: 'append', sourceEventSeqs: [] })
      session.append('step/end', { turn: 2, step: 1 })

      const value = ctx.sessionProjections.snapshot(session).values.billedUsage as BilledUsageProjection | undefined
      expect(value).toBeDefined()
      expect(value?.peak).toEqual({ missInputTokens: 300, cacheReadTokens: 0, outputTokens: 90 })
      expect(value?.offPeak).toEqual({ missInputTokens: 225, cacheReadTokens: 1_000, outputTokens: 40 })
    } finally {
      vi.useRealTimers()
    }
  })
})
