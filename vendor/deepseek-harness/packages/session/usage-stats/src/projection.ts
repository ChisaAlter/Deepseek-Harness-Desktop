/**
 * The `usageDaily` projection unit: a pure fold of usage chunks, assembled
 * assistant messages, and human prompts into timestamped samples. The fold
 * does not bucket by local calendar day.
 */

import type { TokenUsage } from '@deepseek-ai/dsh-llm'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import type { ProjectionDefinition } from '@deepseek-ai/dsh-session-projection'
import { z } from 'zod'
import type { UsageDailyProjection, UsageSampleView } from './types.ts'

/** Open sample that later same-step usage may replace. */
interface OpenSample extends UsageSampleView {
  turn: number
  step: number
}

/** Internal fold state; {@link UsageDailyProjection} is the published view. */
export interface UsageDailyState {
  samples: UsageSampleView[]
  last: OpenSample | null
  currentModel: string | null
  userMessageTimes: number[]
}

const UNKNOWN_MODEL = '(unknown)'

/**
 * Sum the four billed buckets. Reasoning tokens are already in output.
 * @param usage - provider-reported usage, possibly partial.
 * @returns non-negative integer token total.
 */
export function tokenTotal(usage: TokenUsage): number {
  return (usage.inputTokens ?? 0)
    + (usage.outputTokens ?? 0)
    + (usage.cacheReadTokens ?? 0)
    + (usage.cacheWriteTokens ?? 0)
}

function commitLast(state: UsageDailyState): UsageSampleView[] {
  if (state.last === null) return state.samples
  return [...state.samples, { time: state.last.time, model: state.last.model, tokens: state.last.tokens }]
}

function modelOf(event: SessionEvent): string | undefined {
  if (event.type === 'request/header') {
    const model = event.data.header.config.model
    return typeof model === 'string' && model.length > 0 ? model : undefined
  }
  if (event.type === 'request/context') {
    const model = event.data.model
    return typeof model === 'string' && model.length > 0 ? model : undefined
  }
  if (event.type === 'assistant/message') {
    const model = event.data.message.source.model
    return typeof model === 'string' && model.length > 0 ? model : undefined
  }
  return undefined
}

function usageOf(event: SessionEvent): { turn: number; step: number; usage: TokenUsage } | undefined {
  if (event.type === 'assistant/chunk' && event.data.chunk.type === 'usage') {
    return { turn: event.data.turn, step: event.data.step, usage: event.data.chunk.usage }
  }
  if (event.type === 'assistant/message' && event.data.usage !== undefined) {
    return { turn: event.data.turn, step: event.data.step, usage: event.data.usage }
  }
  return undefined
}

/**
 * Fold definition for the `usageDaily` projection key.
 */
export const usageDailyProjectionDefinition: ProjectionDefinition<
  'usageDaily',
  UsageDailyState
> = {
  key: 'usageDaily',
  stateVersion: 1,
  schema: z.object({
    samples: z.array(z.object({
      time: z.number(),
      model: z.string(),
      tokens: z.number().int().nonnegative(),
    })),
    userMessageTimes: z.array(z.number()),
  }).strict(),
  init: (): UsageDailyState => ({
    samples: [],
    last: null,
    currentModel: null,
    userMessageTimes: [],
  }),
  apply: (state, event): UsageDailyState => {
    if (event.type === 'user/message' && event.data.source.kind === 'user') {
      return { ...state, userMessageTimes: [...state.userMessageTimes, event.time] }
    }

    const named = modelOf(event)
    let next: UsageDailyState = state
    if (named !== undefined && named !== state.currentModel) {
      next = { ...state, currentModel: named }
    }

    const reported = usageOf(event)
    if (reported === undefined) return next

    const tokens = tokenTotal(reported.usage)
    const model = named ?? next.currentModel ?? UNKNOWN_MODEL
    const sample: OpenSample = {
      turn: reported.turn,
      step: reported.step,
      time: event.time,
      model,
      tokens,
    }

    if (
      next.last !== null
      && next.last.turn === sample.turn
      && next.last.step === sample.step
    ) {
      if (
        next.last.time === sample.time
        && next.last.model === sample.model
        && next.last.tokens === sample.tokens
      ) {
        return next === state ? state : next
      }
      return { ...next, last: sample }
    }

    return { ...next, samples: commitLast(next), last: sample }
  },
  view: (state): UsageDailyProjection => ({
    samples: commitLast(state),
    userMessageTimes: state.userMessageTimes,
  }),
}
