/**
 * The `usageDaily` projection: usage chunks are replaced by the same
 * turn/step assistant message; human prompts are recorded by time; model
 * names come from the assembled message or the last request header.
 */

import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { createMessage, createUserMessage } from '@deepseek-ai/dsh-llm'
import SessionStore from '@deepseek-ai/dsh-session'
import type { Session, SessionEvent } from '@deepseek-ai/dsh-session'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import * as UsageStatsPlugin from '@deepseek-ai/dsh-usage-stats'
import { usageDailyProjectionDefinition } from '@deepseek-ai/dsh-usage-stats/src/projection.ts'
import type { UsageDailyProjection } from '@deepseek-ai/dsh-usage-stats/types'

async function harness(): Promise<{ ctx: Context; session: Session }> {
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  await ctx.plugin(SessionProjectionRegistry)
  await ctx.plugin(UsageStatsPlugin)
  return { ctx, session: ctx.sessions.create() }
}

function projected(ctx: Context, session: Session): UsageDailyProjection {
  const value = ctx.sessionProjections.snapshot(session).values.usageDaily
  if (value === undefined) throw new Error('usageDaily projection is not registered')
  return value
}

function at(time: number, type: string, data: unknown): SessionEvent {
  return { type, seq: time, time, data } as unknown as SessionEvent
}

function fold(events: readonly SessionEvent[]): UsageDailyProjection {
  const state = events.reduce(
    (folded, event) => usageDailyProjectionDefinition.apply(folded, event),
    usageDailyProjectionDefinition.init(),
  )
  return usageDailyProjectionDefinition.view(state)
}

const message = (model: string) => createMessage({
  role: 'assistant',
  content: [],
  source: { kind: 'model', provider: 'mock', model },
})

describe('usageDaily live registry', () => {
  it('serves an empty calendar on a blank session', async () => {
    const { ctx, session } = await harness()
    expect(projected(ctx, session)).toEqual({ samples: [], userMessageTimes: [] })
  })

  it('records a human prompt and ignores a plugin-sourced user message', async () => {
    const { ctx, session } = await harness()
    session.append('user/message', createUserMessage({
      content: [{ type: 'text', text: 'hello' }],
      source: { kind: 'user' },
    }), { surfaceOp: 'append' })
    session.append('user/message', createUserMessage({
      content: [{ type: 'text', text: 'tool' }],
      source: { kind: 'plugin', plugin: 'test' },
    }), { surfaceOp: 'append' })
    const view = projected(ctx, session)
    expect(view.userMessageTimes).toHaveLength(1)
    expect(view.samples).toEqual([])
  })

  it('unregisters with the plugin fiber', async () => {
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    await ctx.plugin(SessionProjectionRegistry)
    const fiber = await ctx.plugin(UsageStatsPlugin)
    const session = ctx.sessions.create()
    expect(projected(ctx, session).samples).toEqual([])
    await fiber.dispose()
    expect(ctx.sessionProjections.snapshot(session).values).not.toHaveProperty('usageDaily')
  })
})

describe('usageDaily fold (controlled timestamps)', () => {
  it('replaces a usage chunk with the same turn/step message and does not double-count', () => {
    expect(fold([
      at(1_000, 'assistant/chunk', {
        turn: 1, step: 1, chunk: { type: 'usage', usage: { inputTokens: 10, outputTokens: 2 } },
      }),
      at(2_000, 'assistant/message', {
        turn: 1, step: 1, message: message('glm-5.3'),
        usage: { inputTokens: 12, outputTokens: 4, cacheReadTokens: 3 },
      }),
    ])).toEqual({
      samples: [{ time: 2_000, model: 'glm-5.3', tokens: 19 }],
      userMessageTimes: [],
    })
  })

  it('keeps distinct steps as separate samples', () => {
    expect(fold([
      at(1_000, 'assistant/message', {
        turn: 1, step: 1, message: message('a'),
        usage: { inputTokens: 5, outputTokens: 1 },
      }),
      at(2_000, 'assistant/message', {
        turn: 1, step: 2, message: message('b'),
        usage: { inputTokens: 7, outputTokens: 2 },
      }),
    ]).samples).toEqual([
      { time: 1_000, model: 'a', tokens: 6 },
      { time: 2_000, model: 'b', tokens: 9 },
    ])
  })

  it('names a usage-only chunk from the last request header', () => {
    expect(fold([
      at(500, 'request/header', {
        header: { config: { provider: 'mock', model: 'header-model' } },
        reason: 'initial',
      }),
      at(1_000, 'assistant/chunk', {
        turn: 1, step: 1, chunk: { type: 'usage', usage: { inputTokens: 4, outputTokens: 1 } },
      }),
    ]).samples).toEqual([{ time: 1_000, model: 'header-model', tokens: 5 }])
  })

  it('records only user-kind prompts', () => {
    expect(fold([
      at(1_000, 'user/message', createUserMessage({
        content: [{ type: 'text', text: 'hi' }],
        source: { kind: 'user' },
      })),
      at(2_000, 'user/message', createUserMessage({
        content: [{ type: 'text', text: 'tool' }],
        source: { kind: 'plugin', plugin: 'x' },
      })),
    ]).userMessageTimes).toEqual([1_000])
  })

  it('ignores assistant messages without usage', () => {
    expect(fold([
      at(1_000, 'assistant/message', { turn: 1, step: 1, message: message('x') }),
    ])).toEqual({ samples: [], userMessageTimes: [] })
  })

  it('returns the same state reference for uninteresting events', () => {
    const init = usageDailyProjectionDefinition.init()
    const next = usageDailyProjectionDefinition.apply(init, at(1, 'turn/start', { turn: 1 }))
    expect(next).toBe(init)
  })
})
