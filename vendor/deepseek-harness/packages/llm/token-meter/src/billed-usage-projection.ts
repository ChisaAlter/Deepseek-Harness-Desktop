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
 * replace-per-attempt rule as the `tokenUsage` unit: a finalized
 * `assistant/message` usage replaces an earlier `assistant/attempt` sample
 * for the same `(turn, step)` instead of double-counting it. A
 * `llm/retry-started` boundary closes that replacement slot so a retried
 * request is billed independently.
 *
 * Every sample is additionally attributed to the model route that dispatched
 * it, read from the log's own `request/context` (base) and `request/header`
 * (`header.config` overrides) snapshots — the same attribution the session
 * statistics use. A conversation may switch models, and two routes may serve
 * the same model id at different prices, so the fold keeps one bucket pair
 * per route rather than one per model id: pricing the whole log at a single
 * route's column would bill every other model's tokens at the wrong rate.
 * The session-wide totals stay alongside the rows for readers that want a
 * figure without resolving a price per route.
 *
 * @module @deepseek-ai/dsh-token-meter/billed-usage-projection
 */

import { z } from 'zod'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import type { ProjectionDefinition } from '@deepseek-ai/dsh-session-projection'
import type { BilledUsageBuckets, ModelBilledUsage } from './projection.ts'
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

/** The wire route row: the identity plus the same period buckets. */
const modelUsageSchema = z.object({
  provider: z.string(),
  model: z.string(),
  peak: bucketsSchema,
  offPeak: bucketsSchema,
}).strict()

/** The state route row: the wire row plus the composite key it is filed under. */
const modelStateSchema = z.object({
  provider: z.string(),
  model: z.string(),
  peak: bucketsSchema,
  offPeak: bucketsSchema,
}).strict()

const projectionSchema = z.object({
  peak: bucketsSchema,
  offPeak: bucketsSchema,
  models: z.array(modelUsageSchema),
}).strict()

const routeSchema = z.object({
  provider: z.string(),
  model: z.string(),
}).strict()

/** The unit's state schema — the one definition of the state shape; the state type is inferred from it. */
const billedUsageStateSchema = z.object({
  peak: bucketsSchema,
  offPeak: bucketsSchema,
  models: z.record(z.string(), modelStateSchema),
  route: routeSchema,
  stepStart: z.object({
    turn: z.number().int().nonnegative(),
    step: z.number().int().nonnegative(),
    ms: z.number().int().nonnegative(),
  }).nullable(),
  last: z.object({
    turn: z.number().int().nonnegative(),
    step: z.number().int().nonnegative(),
    peak: z.boolean(),
    key: z.string(),
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
 * The composite identity of one priced route: `provider/model`. A provider
 * route id never contains a `/`, so the first `/` always splits the pair back
 * unambiguously, even for a model id that itself contains one.
 * @param route - the route reported by the log.
 * @returns the stable model-row key.
 */
function routeKey(route: { provider: string; model: string }): string {
  return `${route.provider}/${route.model}`
}

/**
 * The billed-usage unit: peak/off-peak bucket totals over the whole durable
 * log, session-wide and per model route, with the per-step replace rule of
 * the `tokenUsage` unit. A legal log never reports usage for an earlier step
 * once a later step begins, so the single `last` slot carries the sample a
 * same-step final message replaces.
 */
export const billedUsageProjectionDefinition = {
  key: 'billedUsage',
  stateVersion: 3,
  stateSchema: billedUsageStateSchema,
  init: (): BilledUsageState => ({
    peak: zeroBuckets(),
    offPeak: zeroBuckets(),
    models: {},
    route: { provider: '', model: '' },
    stepStart: null,
    last: null,
  }),
  apply: (state: BilledUsageState, event: SessionEvent): BilledUsageState => {
    if (event.type === 'step/start') {
      const stepStart = { turn: event.data.turn, step: event.data.step, ms: event.time }
      const current = state.stepStart
      if (current !== null && current.turn === stepStart.turn
        && current.step === stepStart.step && current.ms === stepStart.ms) return state
      return { ...state, stepStart }
    }

    // Route attribution: the context snapshot names the registered route, and
    // a logged header snapshot overrides it with the config actually sent.
    if (event.type === 'request/context') {
      return setRoute(state, event.data.provider, event.data.model)
    }
    if (event.type === 'request/header') {
      const config = event.data.header.config
      return setRoute(state, config.provider, config.model)
    }

    if (event.type === 'llm/retry-started') {
      return state.last?.turn === event.data.turn && state.last.step === event.data.step
        ? { ...state, last: null }
        : state
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
    const buckets = { missInputTokens, cacheReadTokens, outputTokens }
    const key = routeKey(state.route)

    const previous = state.last
    if (previous !== null && previous.turn === turn && previous.step === step) {
      if (previous.peak === peak && previous.key === key
        && previous.missInputTokens === missInputTokens
        && previous.cacheReadTokens === cacheReadTokens
        && previous.outputTokens === outputTokens) return state
      // Subtract the superseded sample from the phase AND route it was filed
      // under before adding its replacement, so a re-attributed restatement
      // never leaves the old row inflated.
      const without = remove(state, previous.peak, previous.key, {
        missInputTokens: previous.missInputTokens,
        cacheReadTokens: previous.cacheReadTokens,
        outputTokens: previous.outputTokens,
      })
      return add(without, peak, key, buckets, turn, step)
    }
    return add(state, peak, key, buckets, turn, step)
  },
  wire: {
    viewSchema: projectionSchema,
    view: state => ({
      peak: state.peak,
      offPeak: state.offPeak,
      models: Object.entries(state.models).map(([, row]): ModelBilledUsage => ({
        provider: row.provider,
        model: row.model,
        peak: row.peak,
        offPeak: row.offPeak,
      })),
    }),
  },
} satisfies ProjectionDefinition<'billedUsage', BilledUsageState>

/** Adopt a reported route, keeping the state reference when it did not move. */
function setRoute(state: BilledUsageState, provider: string, model: string): BilledUsageState {
  if (state.route.provider === provider && state.route.model === model) return state
  return { ...state, route: { provider, model } }
}

/** Add one sample to its route's and phase's buckets and record it as the replaceable last sample. */
function add(
  state: BilledUsageState,
  peak: boolean,
  key: string,
  buckets: BilledUsageBuckets,
  turn: number,
  step: number,
): BilledUsageState {
  const target = peak ? state.peak : state.offPeak
  const nextTotals = {
    ...(peak ? { peak: addBuckets(target, buckets) } : { offPeak: addBuckets(target, buckets) }),
  }
  return {
    ...state,
    ...nextTotals,
    models: addToRoute(state, key, peak, buckets, 1),
    last: {
      turn,
      step,
      peak,
      key,
      missInputTokens: buckets.missInputTokens,
      cacheReadTokens: buckets.cacheReadTokens,
      outputTokens: buckets.outputTokens,
    },
  }
}

/** Subtract one superseded sample from its route's and phase's buckets. */
function remove(
  state: BilledUsageState,
  peak: boolean,
  key: string,
  buckets: BilledUsageBuckets,
): BilledUsageState {
  const target = peak ? state.peak : state.offPeak
  const nextTotals = {
    ...(peak ? { peak: subtractBuckets(target, buckets) } : { offPeak: subtractBuckets(target, buckets) }),
  }
  return {
    ...state,
    ...nextTotals,
    models: addToRoute(state, key, peak, buckets, -1),
  }
}

/**
 * Move one route's row by `sign` on one phase's buckets, creating the row on
 * first sight. A row reduced to all-zero buckets is dropped, so a route whose
 * only sample was superseded by another route's leaves no empty row behind.
 * @param state - the state carrying the rows.
 * @param key - the composite route key.
 * @param peak - whether the sample bills in the peak phase.
 * @param buckets - the sample's buckets.
 * @param sign - `1` to add the sample, `-1` to subtract it.
 * @returns the replacement rows record.
 */
function addToRoute(
  state: BilledUsageState,
  key: string,
  peak: boolean,
  buckets: BilledUsageBuckets,
  sign: 1 | -1,
): Record<string, z.infer<typeof modelStateSchema>> {
  const existing = state.models[key]
  const route = existing ?? {
    provider: state.route.provider,
    model: state.route.model,
    peak: zeroBuckets(),
    offPeak: zeroBuckets(),
  }
  const phase = peak ? route.peak : route.offPeak
  const moved = sign === 1 ? addBuckets(phase, buckets) : subtractBuckets(phase, buckets)
  const row = { ...route, ...(peak ? { peak: moved } : { offPeak: moved }) }
  const models = { ...state.models }
  if (isEmptyBuckets(row.peak) && isEmptyBuckets(row.offPeak)) {
    delete models[key]
  } else {
    models[key] = row
  }
  return models
}

/** Add two bucket sets field-wise. */
function addBuckets(a: BilledUsageBuckets, b: BilledUsageBuckets): BilledUsageBuckets {
  return {
    missInputTokens: a.missInputTokens + b.missInputTokens,
    cacheReadTokens: a.cacheReadTokens + b.cacheReadTokens,
    outputTokens: a.outputTokens + b.outputTokens,
  }
}

/** Subtract one bucket set from another field-wise. */
function subtractBuckets(a: BilledUsageBuckets, b: BilledUsageBuckets): BilledUsageBuckets {
  return {
    missInputTokens: a.missInputTokens - b.missInputTokens,
    cacheReadTokens: a.cacheReadTokens - b.cacheReadTokens,
    outputTokens: a.outputTokens - b.outputTokens,
  }
}

/** Whether every bucket of one set is zero. */
function isEmptyBuckets(buckets: BilledUsageBuckets): boolean {
  return buckets.missInputTokens === 0 && buckets.cacheReadTokens === 0 && buckets.outputTokens === 0
}
