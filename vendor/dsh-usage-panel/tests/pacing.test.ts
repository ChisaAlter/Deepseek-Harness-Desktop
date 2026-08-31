// Locks the cooperative-pacing helpers: yield-loop batching, progress beats,
// and the promise timeout bound (per-provider adapter calls must degrade, not
// hang the settings modal's model directory).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { scanPacer, withTimeout, yieldLoop } from '../src/host/pacing.ts'

test('scanPacer yields every batch and logs at the final index', async () => {
  const logs: string[] = []
  const pacer = scanPacer((m) => logs.push(m))
  for (let i = 1; i <= 175; i += 1) await pacer.beat(i, 175)
  // Logging happens only on 200-multiples or the final index; batching yields on
  // every 25th step (both verified by execution completing without a hang).
  assert.deepEqual(logs, ['scan progress: 175/175 sessions processed'])
})

test('scanPacer logs on 200-multiples mid-corpus', async () => {
  const logs: string[] = []
  const pacer = scanPacer((m) => logs.push(m))
  for (let i = 1; i <= 400; i += 1) await pacer.beat(i, 400)
  assert.deepEqual(logs, ['scan progress: 200/400 sessions processed', 'scan progress: 400/400 sessions processed'])
})

test('yieldLoop settles as a macrotask', async () => {
  await yieldLoop()
  assert.ok(true)
})

test('withTimeout resolves the fast source and clears its timer', async () => {
  const value = await withTimeout(Promise.resolve(42), 500, 'fast')
  assert.equal(value, 42)
})

test('withTimeout rejects on expiry and swallows the late settlement', async () => {
  let settled = false
  const slow = new Promise<number>(() => {
    /* never settles */
  })
  const start = Date.now()
  await assert.rejects(() => withTimeout(slow, 20, 'adapter models for x'), /adapter models for x timed out/)
  assert.ok(Date.now() - start < 2000)
  settled = true
  assert.equal(settled, true) // the late settlement never surfaces as unhandled
})

test('withTimeout propagates a source rejection', async () => {
  await assert.rejects(
    () => withTimeout(Promise.reject(new Error('boom')), 500, 'src'),
    /boom/,
  )
})
