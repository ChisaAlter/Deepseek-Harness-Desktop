// Regression: every RPC call wrapper must pass an explicit payload object —
// the transport's JSON.stringify drops an absent payload key and the host
// envelope schema rejects the request ('invalid client-request message').
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { callBillingGet, callBillingModels, callOverview, callSessionCost } from '../src/client/api.ts'
import type { RpcResultLike } from '../src/client/ctx.ts'

function capturingRpc(): {
  rpc: { call(channel: string, endpoint: string, payload?: unknown): Promise<RpcResultLike<unknown>> }
  calls: Array<{ channel: string; endpoint: string; payload: unknown }>
} {
  const calls: Array<{ channel: string; endpoint: string; payload: unknown }> = []
  return {
    calls,
    rpc: {
      call(channel: string, endpoint: string, payload?: unknown): Promise<RpcResultLike<unknown>> {
        calls.push({ channel, endpoint, payload })
        return Promise.resolve({ ok: true, value: {} })
      },
    },
  }
}

test('callOverview always sends its force payload', async () => {
  const { rpc, calls } = capturingRpc()
  await callOverview(rpc, false)
  assert.deepEqual(calls[0]?.payload, { force: false })
})

test('callBillingGet always sends an explicit payload object', async () => {
  const { rpc, calls } = capturingRpc()
  await callBillingGet(rpc)
  assert.deepEqual(calls[0]?.payload, {})
})

test('callBillingModels always sends an explicit payload object', async () => {
  const { rpc, calls } = capturingRpc()
  await callBillingModels(rpc)
  assert.deepEqual(calls[0]?.payload, {})
})

test('callSessionCost sends the session id payload', async () => {
  const { rpc, calls } = capturingRpc()
  await callSessionCost(rpc, 's1')
  assert.deepEqual(calls[0]?.payload, { sessionId: 's1' })
})
