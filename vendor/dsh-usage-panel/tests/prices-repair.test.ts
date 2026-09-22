// Locks the one-time section repair: it defers (and retries) while the
// conversation section is unregistered, writes exactly once when a retired
// flat record is found, marks itself done only after the write landed, and
// never lets a failure escape into the RPC path that calls `attempt()`.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createPricesRepair } from '../src/host/prices-repair.ts'
import type { PricesSource } from '../src/host/prices-source.ts'
import type { SessionCostPrices } from '../src/shared/pricing.ts'

/** The retired OFF shape: a flat marker over a peak-looking triple, no idle column. */
const FLAT_ONLY: SessionCostPrices = {
  'hohai/gpt-6-astra': { inputCacheHit: 2, inputCacheMiss: 0.12, output: 12, flat: true },
}

const REPAIRED: SessionCostPrices = {
  'hohai/gpt-6-astra': {
    inputCacheHit: 2,
    inputCacheMiss: 0.12,
    output: 12,
    idle: { inputCacheHit: 2, inputCacheMiss: 0.12, output: 12 },
    flat: true,
  },
}

interface FakeSource extends PricesSource {
  registered: boolean
  current: SessionCostPrices
  saves: SessionCostPrices[]
  failSave: string | null
}

function fakeSource(current: SessionCostPrices, registered = true): FakeSource {
  const fake: FakeSource = {
    registered,
    current,
    saves: [],
    failSave: null,
    snapshot: () => fake.current,
    isSectionRegistered: () => fake.registered,
    adoptSection: () => {},
    async save(prices: SessionCostPrices): Promise<void> {
      if (fake.failSave !== null) throw new Error(fake.failSave)
      fake.saves.push(prices)
      fake.current = prices
    },
  }
  return fake
}

function sinks(): { warns: string[]; logs: string[]; warn: (m: string) => void; log: (m: string) => void } {
  const warns: string[] = []
  const logs: string[] = []
  return { warns, logs, warn: (m) => warns.push(m), log: (m) => logs.push(m) }
}

test('an unregistered section defers the repair and a later attempt retries it', async () => {
  const prices = fakeSource(FLAT_ONLY, false)
  const sink = sinks()
  const repair = createPricesRepair({ prices, warn: sink.warn, log: sink.log })
  await repair.attempt()
  assert.equal(repair.isDone(), false)
  assert.equal(prices.saves.length, 0)
  assert.equal(sink.warns.length, 1)
  assert.match(sink.warns[0]!, /not registered yet/)
  // The section registers from another plugin: the retry (a later billing.get)
  // must repair it rather than report a repair that never happened.
  await repair.attempt()
  assert.equal(sink.warns.length, 1, 'the same deferral is not news twice')
  prices.registered = true
  await repair.attempt()
  assert.equal(repair.isDone(), true)
  assert.deepEqual(prices.saves, [REPAIRED])
  assert.equal(sink.warns.length, 1)
  assert.equal(sink.logs.length, 1)
  assert.match(sink.logs[0]!, /idle column/)
})

test('a section with nothing to repair completes without writing', async () => {
  const prices = fakeSource({
    'relay/peak-valley': { inputCacheHit: 4, inputCacheMiss: 8, output: 16, idle: { inputCacheHit: 1, inputCacheMiss: 2, output: 3 } },
    'relay/legacy-single': { inputCacheHit: 4, inputCacheMiss: 8, output: 16 },
  })
  const sink = sinks()
  const repair = createPricesRepair({ prices, warn: sink.warn, log: sink.log })
  await repair.attempt()
  assert.equal(repair.isDone(), true)
  assert.deepEqual(prices.saves, [])
  assert.deepEqual(sink.logs, [])
  assert.deepEqual(sink.warns, [])
})

test('a second run over the repaired section writes nothing (idempotent)', async () => {
  const prices = fakeSource(FLAT_ONLY)
  const repair = createPricesRepair({ prices, warn: () => {}, log: () => {} })
  await repair.attempt()
  assert.deepEqual(prices.saves, [REPAIRED])
  await repair.attempt() // `done` short-circuits, and the pure repair reports changed:false anyway
  assert.deepEqual(prices.saves, [REPAIRED])
  assert.deepEqual(prices.current, REPAIRED)
})

test('a rejected write is not reported as done and is retried', async () => {
  const prices = fakeSource(FLAT_ONLY)
  const sink = sinks()
  const repair = createPricesRepair({ prices, warn: sink.warn, log: sink.log })
  prices.failSave = 'settings namespace "ui-conversation" is not registered'
  await repair.attempt()
  assert.equal(repair.isDone(), false)
  assert.equal(prices.saves.length, 0)
  assert.equal(sink.warns.length, 1)
  assert.match(sink.warns[0]!, /retried on the next billing\.get/)
  prices.failSave = null
  await repair.attempt()
  assert.equal(repair.isDone(), true)
  assert.deepEqual(prices.saves, [REPAIRED])
})

test('attempt() never rejects, even when the section read throws', async () => {
  const prices = fakeSource(FLAT_ONLY)
  prices.isSectionRegistered = () => {
    throw new Error('settings service disposed')
  }
  const sink = sinks()
  const repair = createPricesRepair({ prices, warn: sink.warn, log: sink.log })
  await repair.attempt()
  assert.equal(repair.isDone(), false)
  assert.equal(sink.warns.length, 1)
  assert.match(sink.warns[0]!, /settings service disposed/)
})
