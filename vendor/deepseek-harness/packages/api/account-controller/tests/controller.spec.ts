/** Account Remote delegation preserves provider results, failures, and stream lifetime. */
import { Context } from '@deepseek-ai/cordis'
import type { DeepSeekAccount } from '@deepseek-ai/dsh-deepseek-account'
import type { AccountView, SignInAttemptId } from '../src/types.ts'
import { afterEach, expect, it, vi } from 'vitest'
import AccountController from '../src/index.ts'

const roots: Context[] = []
afterEach(async () => { await Promise.all(roots.splice(0).map(ctx => ctx.fiber.dispose())) })
const state: AccountView = { status: 'signed-out', links: { usageUrl: 'https://platform.example/usage', topUpUrl: 'https://platform.example/top_up' }, attempt: null }

function fixture() {
  const ctx = new Context()
  roots.push(ctx)
  const provider = {
    getState: vi.fn<DeepSeekAccount['getState']>().mockResolvedValue(state),
    getProfile: vi.fn<DeepSeekAccount['getProfile']>().mockResolvedValue({ status: 'failed' }),
    getBalance: vi.fn<DeepSeekAccount['getBalance']>().mockResolvedValue(null),
    startSignIn: vi.fn<DeepSeekAccount['startSignIn']>().mockResolvedValue(state),
    cancelSignIn: vi.fn<DeepSeekAccount['cancelSignIn']>().mockResolvedValue(state),
    signOut: vi.fn<DeepSeekAccount['signOut']>().mockResolvedValue(state),
    watch: vi.fn<DeepSeekAccount['watch']>(),
  }
  ctx.provide('deepseekAccount', provider as never)
  return { provider, controller: new AccountController(ctx) }
}

it('delegates account operations without coupling profile and balance queries', async () => {
  const { provider, controller } = fixture()
  expect(await controller.getState()).toBe(state)
  expect(await controller.getProfile()).toEqual({ status: 'failed' })
  expect(provider.getBalance).not.toHaveBeenCalled()
  expect(await controller.getBalance()).toBeNull()
  expect(await controller.startSignIn('zh-CN', 'http://127.0.0.1:8080', 'desktop')).toBe(state)
  expect(provider.startSignIn).toHaveBeenCalledExactlyOnceWith('zh-CN', 'http://127.0.0.1:8080', 'desktop')
  const id = 'attempt' as SignInAttemptId
  expect(await controller.cancelSignIn(id)).toBe(state)
  expect(provider.cancelSignIn).toHaveBeenCalledExactlyOnceWith(id)
  expect(await controller.signOut()).toBe(state)
  expect(provider.signOut).toHaveBeenCalledExactlyOnceWith()
  const failure = new Error('storage unavailable')
  provider.signOut.mockRejectedValueOnce(failure)
  await expect(controller.signOut()).rejects.toBe(failure)
})

it('passes the subscriber lifetime to the provider and returns its state stream', async () => {
  const { provider, controller } = fixture()
  const lifetime = new AbortController()
  const stream: AsyncIterable<AccountView> = { async *[Symbol.asyncIterator]() { yield state } }
  provider.watch.mockReturnValue(stream)
  expect(controller.watch(lifetime.signal)).toBe(stream)
  expect(provider.watch).toHaveBeenCalledExactlyOnceWith(lifetime.signal)
  const received: AccountView[] = []
  for await (const value of stream) received.push(value)
  expect(received).toEqual([state])
})
