/**
 * usage.summary RPC: absent-service mapping and a live fold through
 * usage-stats.
 */

import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { createMessage } from '@deepseek-ai/dsh-llm'
import SessionStore from '@deepseek-ai/dsh-session'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import * as UsageStatsPlugin from '@deepseek-ai/dsh-usage-stats'
import UserQuestionService from '@deepseek-ai/dsh-user-questions'
import type { RpcRequest, RpcResponse } from '../src/api/rpc.ts'
import { RpcId } from '../src/api/rpc.ts'
import { createApiProxy } from '../src/api-proxy.ts'

const DEFAULTS = { defaultModelSelection: () => ({ provider: 'p', model: 'm' }), cwd: '/tmp' }

let nextRpc = 1
function request<P>(payload: P): RpcRequest<P> {
  return { rpcId: RpcId('usage-' + String(nextRpc++)), payload }
}

function expectOk<T>(response: RpcResponse<T>): T {
  expect(response.result.ok).toBe(true)
  if (!response.result.ok) throw new Error('unreachable')
  return response.result.value
}

function expectErr<T>(response: RpcResponse<T>): { code: string } {
  expect(response.result.ok).toBe(false)
  if (response.result.ok) throw new Error('unreachable')
  return response.result.error
}

describe('usage.summary RPC', () => {
  it('answers usage-stats-absent when the composition mounts no service', async () => {
    const ctx = new Context()
    await ctx.plugin(UserQuestionService)
    const api = createApiProxy(ctx, DEFAULTS)
    const refused = expectErr(await api.usage.summary(request({ rangeDays: 7, timeZone: 'UTC' }), new AbortController().signal))
    expect(refused.code).toBe('usage-stats-absent')
  })

  it('summarizes live session usage through the mounted service', async () => {
    const ctx = new Context()
    await ctx.plugin(UserQuestionService)
    await ctx.plugin(SessionStore)
    await ctx.plugin(SessionProjectionRegistry)
    await ctx.plugin(UsageStatsPlugin)
    const session = ctx.sessions.create()
    session.append('assistant/message', {
      turn: 1,
      step: 1,
      message: createMessage({
        role: 'assistant',
        content: [],
        source: { kind: 'model', provider: 'mock', model: 'glm-5.3' },
      }),
      usage: { inputTokens: 8, outputTokens: 2 },
    }, { surfaceOp: 'append' })

    const api = createApiProxy(ctx, DEFAULTS)
    const value = expectOk(await api.usage.summary(request({ rangeDays: 7, timeZone: 'UTC' }), new AbortController().signal))
    expect(value.rangeDays).toBe(7)
    expect(value.totalTokens).toBe(10)
    expect(value.topModel).toEqual({ name: 'glm-5.3', share: 100 })
    expect(value.heatmap).toHaveLength(7)
  })
})
