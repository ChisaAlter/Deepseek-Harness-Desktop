// Locks the billing-preferences store: durable-medium roundtrip, semantic
// rejection, memory fail-soft, and the late medium attach upgrade.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { BillingStore, type BillingMedium } from '../src/host/billing-store.ts'
import type { BillingSettings } from '../src/shared/contract.ts'

function fakeMedium(initial: unknown): BillingMedium & { stored: unknown; writes: number } {
  const medium = {
    stored: initial,
    writes: 0,
    get(): unknown {
      return medium.stored
    },
    async set(value: unknown): Promise<void> {
      medium.stored = value
      medium.writes += 1
    },
  }
  return medium
}

const SETTINGS: BillingSettings = {
  prices: {
    'deepseek-official/deepseek-v4-flash': { inputCacheHit: 0.1, inputCacheMiss: 3, output: 9 },
  },
  stripVisible: true,
  peakHintVisible: false,
  peakValleyEnabled: false,
}

test('load returns the stored record; absent switches default to on', async () => {
  const medium = fakeMedium({
    prices: { 'a/b': { inputCacheHit: 0.1, inputCacheMiss: 3, output: 9 } },
  })
  const store = new BillingStore(medium, () => {})
  assert.equal(store.mode, 'durable')
  const loaded = await store.load()
  assert.deepEqual(loaded.prices, { 'a/b': { inputCacheHit: 0.1, inputCacheMiss: 3, output: 9 } })
  assert.equal(loaded.stripVisible, true)
  assert.equal(loaded.peakHintVisible, true)
  assert.equal(loaded.peakValleyEnabled, true)
})

test('save writes through to the medium and is reflected on a fresh load', async () => {
  const medium = fakeMedium(undefined)
  const store = new BillingStore(medium, () => {})
  const saved = await store.save(SETTINGS)
  assert.deepEqual(saved, SETTINGS)
  assert.equal(medium.writes, 1)
  assert.deepEqual(medium.stored, SETTINGS)
  const fresh = new BillingStore(medium, () => {})
  assert.deepEqual(await fresh.load(), SETTINGS)
})

test('invalid prices are refused on save and never reach the medium', async () => {
  const medium = fakeMedium(undefined)
  const store = new BillingStore(medium, () => {})
  await assert.rejects(
    () => store.save({ ...SETTINGS, prices: { 'a/b': { inputCacheHit: -1, inputCacheMiss: 3, output: 9 } } }),
    /invalid prices/,
  )
  await assert.rejects(
    () => store.save({ ...SETTINGS, stripVisible: 'yes' as never }),
    /stripVisible\/peakHintVisible\/peakValleyEnabled/,
  )
  await assert.rejects(
    () => store.save({ ...SETTINGS, peakHintVisible: 'yes' as never }),
    /stripVisible\/peakHintVisible\/peakValleyEnabled/,
  )
  assert.equal(medium.writes, 0)
})

test('a corrupted medium degrades to defaults (warned) instead of throwing', async () => {
  const warns: string[] = []
  const store = new BillingStore(fakeMedium({ prices: { 'a/b': { inputCacheHit: 'x', inputCacheMiss: 1, output: 1 } } }), (m) => warns.push(m))
  const loaded = await store.load()
  assert.deepEqual(loaded.prices, {})
  assert.equal(loaded.stripVisible, true)
  assert.equal(warns.length, 1)
  assert.match(warns[0]!, /failed validation/)
})

test('memory mode persists nothing but keeps working, then upgrades on attach', async () => {
  const store = new BillingStore(undefined, () => {})
  assert.equal(store.mode, 'memory')
  await store.save(SETTINGS)
  assert.deepEqual(await store.load(), SETTINGS)
  const medium = fakeMedium(undefined)
  store.attachMedium(medium)
  assert.equal(store.mode, 'durable')
  assert.deepEqual(await store.load(), SETTINGS) // cache survives the attach
  const next: BillingSettings = { ...SETTINGS, stripVisible: false }
  await store.save(next)
  assert.deepEqual(medium.stored, next)
})
