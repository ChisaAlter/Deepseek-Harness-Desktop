/**
 * Pure fold for the period-bucketed billable usage of a complete session log.
 *
 * The official peak/valley schedule (see `billing-window.ts`) splits every
 * usage sample into one of two price-independent bucket sets — peak and
 * off-peak — so a presentation layer can apply any price table, official or
 * user-edited, without refolding the log. Each sample bills at its request's
 * Beijing-time window: the matching `step/start` instant when the sample's
 * step has one (a request straddling a boundary bills at the instant it
 * started), otherwise the sample event's own time. Samples follow the same
 * replace-per-step rule as the `tokenUsage` unit: a finalized
 * `assistant/message` usage replaces an earlier usage chunk for the same
 * `(turn, step)` instead of double-counting it.
 *
 * @module @deepseek-ai/dsh-token-meter/billed-usage-projection
 */

import { z } from 'zod'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import type { ProjectionDefinition } from '@deepseek-ai/dsh-session-projection'
import type { BilledUsageBuckets } from './projection.ts'
import { isPeakBillingTime } from './billing-window.ts'
import { usageSampleOf } from './usage-projection.ts'

const zeroBuckets = (): BilledUsageBuckets => ({
  missInputTokens: 0,
  cacheReadTokens: 0,
  outputTokens: 0,
})

/** The state/wire bucket shape — one validated definition of it. */
const bucketsSchema = z.object({
  missInputTokens: z.number().int().nonnegative(),
  cacheReadTokens: z.number().int().nonnegative(),
  outputTokens: z.number().int().nonnegative(),
}).strict()

const projectionSchema = z.object({
  peak: bucketsSchema,
  offPeak: bucketsSchema,
}).strict()

/** The unit's state schema — the one definition of the state shape; the state type is inferred from it. */
const billedUsageStateSchema = z.object({
  peak: bucketsSchema,
  offPeak: bucketsSchema,
  stepStart: z.object({
    turn: z.number().int().nonnegative(),
    step: z.number().int().nonnegative(),
    ms: z.number().int().nonnegative(),
  }).nullable(),
  last: z.object({
    turn: z.number().int().nonnegative(),
    step: z.number().int().nonnegative(),
    peak: z.boolean(),
    missInputTokens: z.number().int().nonnegative(),
    cacheReadTokens: z.number().int().nonnegative(),
    outputTokens: z.number().int().nonnegative(),
  }).nullable(),
}).strict()

type BilledUsageState = z.infer<typeof billedUsageStateSchema>

declare module '@deepseek-ai/dsh-session-projection/types' {
  interface SessionProjectionStateMap {
    billedUsage: BilledUsageState
  }
}

/**
 * The billed-usage unit: peak/off-peak bucket totals over the whole durable
 * log, with the per-step replace rule of the `tokenUsage` unit. A legal log
 * never reports usage for an earlier step once a later step begins, so the
 * single `last` slot carries the sample a same-step final message replaces.
 */
export const billedUsageProjectionDefinition = {
  key: 'billedUsage',
  stateVersion: 1,
  stateSchema: billedUsageStateSchema,
  init: (): BilledUsageState => ({ peak: zeroBuckets(), offPeak: zeroBuckets(), stepStart: null, last: null }),
  apply: (state: BilledUsageState, event: SessionEvent): BilledUsageState => {
    if (event.type === 'step/start') {
      const stepStart = { turn: event.data.turn, step: event.data.step, ms: event.time }
      const current = state.stepStart
      if (current !== null && current.turn === stepStart.turn
        && current.step === stepStart.step && current.ms === stepStart.ms) return state
      return { ...state, stepStart }
    }

    const sample = usageSampleOf(event)
    if (sample === undefined) return state
    const { turn, step } = sample
    // A request straddling a boundary bills at the instant its step started.
    const startMs = state.stepStart !== null
      && state.stepStart.turn === turn
      && state.stepStart.step === step
      ? state.stepStart.ms
      : event.time
    const peak = isPeakBillingTime(startMs)
    // Cache writes bill as uncached input; the three buckets stay disjoint.
    const missInputTokens = sample.usage.inputTokens + (sample.usage.cacheWriteTokens ?? 0)
    const cacheReadTokens = sample.usage.cacheReadTokens ?? 0
    const outputTokens = sample.usage.outputTokens

    const previous = state.last
    if (previous !== null && previous.turn === turn && previous.step === step) {
      if (previous.peak === peak && previous.missInputTokens === missInputTokens
        && previous.cacheReadTokens === cacheReadTokens && previous.outputTokens === outputTokens) return state
      const phase = previous.peak ? state.peak : state.offPeak
      // Subtract the superseded sample before adding its replacement.
      return add({
        ...state,
        [previous.peak ? 'peak' : 'offPeak']: {
          missInputTokens: phase.missInputTokens - previous.missInputTokens,
          cacheReadTokens: phase.cacheReadTokens - previous.cacheReadTokens,
          outputTokens: phase.outputTokens - previous.outputTokens,
        },
      }, peak, { missInputTokens, cacheReadTokens, outputTokens }, turn, step)
    }
    return add(state, peak, { missInputTokens, cacheReadTokens, outputTokens }, turn, step)
  },
  wire: {
    viewSchema: projectionSchema,
    view: state => ({ peak: state.peak, offPeak: state.offPeak }),
  },
} satisfies ProjectionDefinition<'billedUsage', BilledUsageState>

/** Add one sample to its phase's buckets and record it as the replaceable last sample. */
function add(
  state: BilledUsageState,
  peak: boolean,
  buckets: BilledUsageBuckets,
  turn: number,
  step: number,
): BilledUsageState {
  const target = peak ? state.peak : state.offPeak
  return {
    ...state,
    [peak ? 'peak' : 'offPeak']: {
      missInputTokens: target.missInputTokens + buckets.missInputTokens,
      cacheReadTokens: target.cacheReadTokens + buckets.cacheReadTokens,
      outputTokens: target.outputTokens + buckets.outputTokens,
    },
    last: {
      turn,
      step,
      peak,
      missInputTokens: buckets.missInputTokens,
      cacheReadTokens: buckets.cacheReadTokens,
      outputTokens: buckets.outputTokens,
    },
  }
}
