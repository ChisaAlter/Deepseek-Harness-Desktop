// dsh-usage-panel · per-session persisted projection (the accounting core).
//
// Registered via ctx.sessionProjections.register() so DSH folds one event per
// committed session event and checkpoints the state durably (write-behind by
// sessionProjectionCache, cold-read ladder by restore/coldSnapshot). The
// reducer is a pure function over plain-JSON state — fully unit-testable and
// replay-safe across stateVersion bumps.
//
// Accounting rules (all deliberate, see iteration-strategy §4.6):
//  - Four DISJOINT buckets per DSH TokenUsage: input is uncached only.
//  - Fork dedup: events with seq < the LAST session/end-seed are seed history
//    (fork/resume/replay) and are never counted — our v0.1.0 seedLength
//    correctness wall, preserved inside the projection.
//  - Model attribution: request/context.model base, request/header.config.model
//    overrides (v0.1.0 semantic); provider tracked the same way.
//  - Per-step replacement: assistant/chunk provisional usage accumulates per
//    (turn:step); the step's assistant/message REPLACES it (authoritative), so
//    a retried same-step message cannot double-count (v0.1.0 bug, fixed).
//    Commit happens at step/end (or the next step's first event / turn/end).
//  - llm/retry events are counted as retries, never as token usage.
//  - compaction/summary usage is attributed to its own model AND tracked in
//    compactionTokens (visible, never mixed silently into regular output).
//  - reasoningTokens are already inside outputTokens — never added again.
//  - Day keys are UTC.
import { z } from 'zod'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import { isPeakBillingTime } from '../shared/billing.ts'
import type { PhaseBuckets } from '../shared/cost.ts'
import { dayKeyUTC } from '../shared/usage.ts'

const bucketSchema = z.object({
  input: z.number(),
  output: z.number(),
  cacheRead: z.number(),
  cacheWrite: z.number(),
})

/** Period-classified buckets: peak vs off-peak (billing windows, Beijing). */
const phaseBucketsSchema = z.object({
  peak: bucketSchema,
  offPeak: bucketSchema,
})

const stepSchema = z.object({
  buckets: bucketSchema,
  /** Billing phase of the step's start instant (classification snapshot). */
  peak: z.boolean(),
  lastTime: z.number(),
  model: z.string(),
  provider: z.string(),
  mode: z.enum(['provisional', 'authoritative']),
})

const stepStartSchema = z.object({
  turn: z.number().int().nonnegative(),
  step: z.number().int().nonnegative(),
  ms: z.number().int().nonnegative(),
})

export const usagePanelSchema = z.object({
  totals: bucketSchema,
  byModel: z.record(z.string(), bucketSchema),
  byDay: z.record(z.string(), z.record(z.string(), bucketSchema)),
  byProvider: z.record(z.string(), bucketSchema),
  costTotals: phaseBucketsSchema,
  costByModel: z.record(z.string(), phaseBucketsSchema),
  costByDay: z.record(z.string(), z.record(z.string(), phaseBucketsSchema)),
  costByProvider: z.record(z.string(), phaseBucketsSchema),
  modelProviders: z.record(z.string(), z.string()),
  retries: z.number(),
  compactionTokens: z.number(),
  firstTime: z.number().nullable(),
  lastTime: z.number().nullable(),
  seedEnd: z.number().nullable(),
  currentModel: z.string(),
  currentProvider: z.string(),
  stepStart: stepStartSchema.nullable(),
  openStep: z.string().nullable(),
  steps: z.record(z.string(), stepSchema),
})

export type Buckets = z.infer<typeof bucketSchema>
export type StepState = z.infer<typeof stepSchema>
export type UsagePanelState = z.infer<typeof usagePanelSchema>

export const USAGE_PANEL_KEY = 'usagePanel'

declare module '@deepseek-ai/dsh-session-projection/types' {
  interface SessionProjectionMap {
    usagePanel: UsagePanelState
  }
  interface SessionProjectionStateMap {
    usagePanel: UsagePanelState
  }
}

const EMPTY: Buckets = Object.freeze({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0 })

export function initState(): UsagePanelState {
  return {
    totals: { ...EMPTY },
    byModel: {},
    byDay: {},
    byProvider: {},
    costTotals: { peak: { ...EMPTY }, offPeak: { ...EMPTY } },
    costByModel: {},
    costByDay: {},
    costByProvider: {},
    modelProviders: {},
    retries: 0,
    compactionTokens: 0,
    firstTime: null,
    lastTime: null,
    seedEnd: null,
    currentModel: 'unknown',
    currentProvider: 'unknown',
    stepStart: null,
    openStep: null,
    steps: {},
  }
}

function stepKey(turn: number, step: number): string {
  return turn + ':' + step
}

function add(a: Buckets, b: Buckets): Buckets {
  return {
    input: a.input + b.input,
    output: a.output + b.output,
    cacheRead: a.cacheRead + b.cacheRead,
    cacheWrite: a.cacheWrite + b.cacheWrite,
  }
}

function addInto(map: Record<string, Buckets>, key: string, b: Buckets): Record<string, Buckets> {
  const cur = map[key]
  return { ...map, [key]: cur ? add(cur, b) : { ...b } }
}

function addIntoDay(
  byDay: Record<string, Record<string, Buckets>>,
  day: string,
  model: string,
  b: Buckets,
): Record<string, Record<string, Buckets>> {
  const dayMap = byDay[day]
  return { ...byDay, [day]: dayMap ? addInto(dayMap, model, b) : { [model]: { ...b } } }
}

function addPhase(a: PhaseBuckets, b: Buckets, peak: boolean): PhaseBuckets {
  return { ...a, [peak ? 'peak' : 'offPeak']: add(a[peak ? 'peak' : 'offPeak'], b) }
}

function addIntoPhase(
  map: Record<string, PhaseBuckets>,
  key: string,
  b: Buckets,
  peak: boolean,
): Record<string, PhaseBuckets> {
  const cur = map[key]
  return {
    ...map,
    [key]: cur
      ? addPhase(cur, b, peak)
      : addPhase({ peak: { ...EMPTY }, offPeak: { ...EMPTY } }, b, peak),
  }
}

function addIntoDayPhase(
  byDay: Record<string, Record<string, PhaseBuckets>>,
  day: string,
  model: string,
  b: Buckets,
  peak: boolean,
): Record<string, Record<string, PhaseBuckets>> {
  const dayMap = byDay[day]
  return {
    ...byDay,
    [day]: dayMap
      ? addIntoPhase(dayMap, model, b, peak)
      : { [model]: addPhase({ peak: { ...EMPTY }, offPeak: { ...EMPTY } }, b, peak) },
  }
}

/**
 * Whether an event may be counted. The registry folds a cold log in ONE pass
 * (init + apply per event, no lookahead), so the unit arms itself: nothing is
 * counted until the LAST session/end-seed marker has been seen, and only
 * events at/after the marker's seq (live history) count. Seed events that
 * precede the marker in a cold fold are therefore never counted — the v0.1.0
 * seedLength correctness wall, preserved inside the projection.
 */
function isCounted(state: UsagePanelState, event: SessionEvent): boolean {
  return state.seedEnd !== null && event.seq >= state.seedEnd
}

function touchTime(state: UsagePanelState, time: number): UsagePanelState {
  if (state.firstTime === null || time < state.firstTime || time > (state.lastTime ?? 0)) {
    return {
      ...state,
      firstTime: state.firstTime === null ? time : Math.min(state.firstTime, time),
      lastTime: state.lastTime === null ? time : Math.max(state.lastTime, time),
    }
  }
  return state
}

/** Fold one step's buckets into the aggregates (pure; call once per step). */
function commitStep(state: UsagePanelState, key: string): UsagePanelState {
  const step = state.steps[key]
  if (!step) return state
  const b = step.buckets
  if (b.input === 0 && b.output === 0 && b.cacheRead === 0 && b.cacheWrite === 0) {
    // Zero usage still folds nothing; drop the step bookkeeping only.
    const steps = { ...state.steps }
    delete steps[key]
    return { ...state, steps, openStep: state.openStep === key ? null : state.openStep }
  }
  const day = dayKeyUTC(step.lastTime)
  const next: UsagePanelState = {
    ...state,
    totals: add(state.totals, b),
    byModel: addInto(state.byModel, step.model, b),
    byDay: addIntoDay(state.byDay, day, step.model, b),
    byProvider: addInto(state.byProvider, step.provider, b),
    costTotals: addPhase(state.costTotals, b, step.peak),
    costByModel: addIntoPhase(state.costByModel, step.model, b, step.peak),
    costByDay: addIntoDayPhase(state.costByDay, day, step.model, b, step.peak),
    costByProvider: addIntoPhase(state.costByProvider, step.provider, b, step.peak),
    modelProviders: { ...state.modelProviders, [step.model]: step.provider },
    firstTime: state.firstTime === null ? step.lastTime : Math.min(state.firstTime, step.lastTime),
    lastTime: state.lastTime === null ? step.lastTime : Math.max(state.lastTime, step.lastTime),
    steps: { ...state.steps },
    openStep: state.openStep === key ? null : state.openStep,
  }
  delete next.steps[key]
  return next
}

function commitOpenStep(state: UsagePanelState, incomingKey: string): UsagePanelState {
  if (state.openStep !== null && state.openStep !== incomingKey) {
    return commitStep(state, state.openStep)
  }
  return state
}

/**
 * Billing phase of one whole step, classified at its `step/start` instant
 * (a step straddling a phase boundary bills entirely at its start phase).
 * Falls back to the event instant only when no counted `step/start` event
 * established the step's start.
 */
function samplePeak(state: UsagePanelState, turn: number, step: number, eventTime: number): boolean {
  const start = state.stepStart
  if (start !== null && start.turn === turn && start.step === step) return isPeakBillingTime(start.ms)
  return isPeakBillingTime(eventTime)
}

/**
 * Pure transition: previous state + one committed session event → next state.
 * Returns the SAME reference for unrelated events (zero downstream work, per
 * the registry contract). State is plain JSON (persisted-cache precondition).
 */
export function applyEvent(state: UsagePanelState, event: SessionEvent): UsagePanelState {
  switch (event.type) {
    case 'session/end-seed': {
      // Last marker wins: a preset (cold fold) or earlier marker must not be
      // overwritten by an older one.
      if (state.seedEnd !== null && event.seq <= state.seedEnd) return state
      return { ...state, seedEnd: event.seq }
    }
    case 'step/start': {
      // Counted history only: seed-history step/starts must never arm a step's
      // phase (a forked session restarts turn/step, so matching a live step
      // against a seed start would misclassify its billing window).
      if (!isCounted(state, event)) return state
      const stepStart = { turn: event.data.turn, step: event.data.step, ms: event.time }
      const current = state.stepStart
      if (current !== null && current.turn === stepStart.turn && current.step === stepStart.step && current.ms === stepStart.ms) {
        return state
      }
      return { ...state, stepStart }
    }
    case 'request/context': {
      const { model, provider } = event.data
      if (!model && !provider) return state
      return {
        ...state,
        currentModel: model || state.currentModel,
        currentProvider: provider || state.currentProvider,
      }
    }
    case 'request/header': {
      const cfg = event.data.header && event.data.header.config
      if (!cfg || (!cfg.model && !cfg.provider)) return state
      return {
        ...state,
        currentModel: cfg.model || state.currentModel,
        currentProvider: cfg.provider || state.currentProvider,
      }
    }
    case 'assistant/chunk': {
      if (!isCounted(state, event)) return state
      const chunk = event.data.chunk
      if (!chunk || chunk.type !== 'usage' || !chunk.usage) return state
      const key = stepKey(event.data.turn, event.data.step)
      const usage = chunk.usage
      const b = {
        input: Number(usage.inputTokens) || 0,
        output: Number(usage.outputTokens) || 0,
        cacheRead: Number(usage.cacheReadTokens) || 0,
        cacheWrite: Number(usage.cacheWriteTokens) || 0,
      }
      let next = commitOpenStep(state, key)
      const existing = next.steps[key]
      const step: StepState = existing
        ? { ...existing, buckets: add(existing.buckets, b), lastTime: event.time }
        : {
            buckets: b,
            peak: samplePeak(next, event.data.turn, event.data.step, event.time),
            lastTime: event.time,
            model: next.currentModel,
            provider: next.currentProvider,
            mode: 'provisional',
          }
      return {
        ...next,
        steps: { ...next.steps, [key]: step },
        openStep: key,
      }
    }
    case 'assistant/message': {
      if (!isCounted(state, event)) return state
      const usage = event.data.usage
      if (!usage) return state
      const key = stepKey(event.data.turn, event.data.step)
      const b = {
        input: Number(usage.inputTokens) || 0,
        output: Number(usage.outputTokens) || 0,
        cacheRead: Number(usage.cacheReadTokens) || 0,
        cacheWrite: Number(usage.cacheWriteTokens) || 0,
      }
      let next = commitOpenStep(state, key)
      const existing = next.steps[key]
      const step: StepState = {
        buckets: b,
        // The step's phase is a snapshot: a provisional accumulation already
        // classified it, and a late message (after the next step's start) must
        // not reclassify it by its own (possibly post-boundary) arrival time.
        peak: existing ? existing.peak : samplePeak(next, event.data.turn, event.data.step, event.time),
        lastTime: event.time,
        model: next.currentModel,
        provider: next.currentProvider,
        mode: 'authoritative',
      }
      return {
        ...next,
        steps: { ...next.steps, [key]: step },
        openStep: key,
      }
    }
    case 'step/end': {
      const key = stepKey(event.data.turn, event.data.step)
      return commitStep(state, key)
    }
    case 'turn/end': {
      // Safety net for logs that end mid-step: commit the open step.
      return state.openStep !== null ? commitStep(state, state.openStep) : state
    }
    case 'llm/retry': {
      if (!isCounted(state, event)) return state
      return touchTime({ ...state, retries: state.retries + 1 }, event.time)
    }
    case 'compaction/summary': {
      if (!isCounted(state, event)) return state
      const usage = event.data.usage
      if (!usage) return state
      const b = {
        input: Number(usage.inputTokens) || 0,
        output: Number(usage.outputTokens) || 0,
        cacheRead: Number(usage.cacheReadTokens) || 0,
        cacheWrite: Number(usage.cacheWriteTokens) || 0,
      }
      const model = event.data.model || state.currentModel
      const provider = event.data.provider || state.currentProvider
      const day = dayKeyUTC(event.time)
      return {
        ...state,
        totals: add(state.totals, b),
        byModel: addInto(state.byModel, model, b),
        byDay: addIntoDay(state.byDay, day, model, b),
        byProvider: addInto(state.byProvider, provider, b),
        modelProviders: { ...state.modelProviders, [model]: provider },
        compactionTokens: state.compactionTokens + b.input + b.output + b.cacheRead + b.cacheWrite,
        firstTime: state.firstTime === null ? event.time : Math.min(state.firstTime, event.time),
        lastTime: state.lastTime === null ? event.time : Math.max(state.lastTime, event.time),
      }
    }
    default:
      return state
  }
}

/**
 * Fold a full event list from init (cold read path / tests). Two-pass: the
 * LAST session/end-seed marker in stored history is the seed boundary
 * (doc: "Locate the LAST one in stored history"), so it is located first and
 * preset — a single forward pass would count seed events that precede the
 * marker. The registry's own lazy cold fold is single-pass (init + apply),
 * where the unit self-arms: nothing is counted until a marker has been seen.
 */
export function foldEvents(events: readonly SessionEvent[]): UsagePanelState {
  let seedEnd: number | null = null
  for (const event of events) {
    if (event.type === 'session/end-seed') seedEnd = event.seq
  }
  let state = { ...initState(), seedEnd }
  for (const event of events) state = applyEvent(state, event)
  return state
}

/** Sum a session's day buckets whose key >= cutoffKey (recent-30d window). */
export function recentOf(
  value: UsagePanelState,
  cutoffKey: string,
): { totals: Buckets; byModel: Record<string, Buckets>; costByModel: Record<string, PhaseBuckets> } {
  const totals: Buckets = { ...EMPTY }
  const byModel: Record<string, Buckets> = {}
  const costByModel: Record<string, PhaseBuckets> = {}
  for (const day of Object.keys(value.byDay)) {
    if (day < cutoffKey) continue
    for (const model of Object.keys(value.byDay[day]!)) {
      const b = value.byDay[day]![model]!
      totals.input += b.input
      totals.output += b.output
      totals.cacheRead += b.cacheRead
      totals.cacheWrite += b.cacheWrite
      const cur = byModel[model]
      byModel[model] = cur
        ? {
            input: cur.input + b.input,
            output: cur.output + b.output,
            cacheRead: cur.cacheRead + b.cacheRead,
            cacheWrite: cur.cacheWrite + b.cacheWrite,
          }
        : { ...b }
    }
  }
  const dayCost = value.costByDay
  for (const day of Object.keys(dayCost)) {
    if (day < cutoffKey) continue
    for (const model of Object.keys(dayCost[day]!)) {
      const phase = dayCost[day]![model]!
      const cur = costByModel[model]
      costByModel[model] = cur
        ? {
            peak: add(cur.peak, phase.peak),
            offPeak: add(cur.offPeak, phase.offPeak),
          }
        : { peak: { ...phase.peak }, offPeak: { ...phase.offPeak } }
    }
  }
  return { totals, byModel, costByModel }
}
