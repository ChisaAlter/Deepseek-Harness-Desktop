import { describe, expect, it } from 'vitest'
import { LlmError } from '@deepseek-ai/dsh-llm'
import { finishError } from '../src/finish-error.ts'

describe('finishError', () => {
  it('treats stop and max-tokens as success', () => {
    expect(finishError({ kind: 'stop' })).toBeUndefined()
    expect(finishError({ kind: 'max-tokens' })).toBeUndefined()
  })

  it('rethrows provider error/aborted as LlmError with the provider code', () => {
    const error = finishError({
      kind: 'error',
      failure: { message: '模型不存在', code: 'INVALID_REQUEST', status: 400 },
    })
    expect(error).toBeInstanceOf(LlmError)
    expect(error?.code).toBe('INVALID_REQUEST')
    expect(error?.message).toBe('模型不存在')
    expect(error?.failure.status).toBe(400)

    const aborted = finishError({
      kind: 'aborted',
      failure: { message: 'cancelled', code: 'ABORTED' },
    })
    expect(aborted).toBeInstanceOf(LlmError)
    expect(aborted?.code).toBe('ABORTED')

    const retry = finishError({
      kind: 'error',
      failure: {
        message: 'busy',
        code: 'RATE_LIMIT',
        providerRetryAfterMs: 1_000,
        requestId: 'req-1' as never,
      },
    })
    expect(retry?.failure.providerRetryAfterMs).toBe(1_000)
    expect(retry?.failure.requestId).toBe('req-1')
  })

  it('maps tool-calls and unknown kinds to INVALID_REQUEST', () => {
    const tools = finishError({ kind: 'tool-calls' })
    expect(tools).toBeInstanceOf(LlmError)
    expect(tools?.code).toBe('INVALID_REQUEST')

    const unknown = finishError({ kind: 'mystery' } as never)
    expect(unknown).toBeInstanceOf(LlmError)
    expect(unknown?.code).toBe('INVALID_REQUEST')
    expect(unknown?.message).toMatch(/mystery/)
  })
})
