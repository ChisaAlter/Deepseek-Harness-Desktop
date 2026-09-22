// Locks the RETIRED (legacy) billing store, now a reader plus the import's
// cleanup write: durable-medium roundtrip, semantic rejection on load, the
// memory fail-soft mode, the late medium attach (whose kept cache is exactly
// why the one-time import must gate on `mode`), and the tolerance for legacy
// v0.3 strip fields (retired composer cost strip).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { BillingStore, billingGlobalSchema, type BillingMedium } from '../src/host/billing-store.ts'
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
  peakValleyEnabled: false,
}

test('load returns the stored record; absent switch defaults to on', async () => {
  const medium = fakeMedium({
    prices: { 'a/b': { inputCacheHit: 0.1, inputCacheMiss: 3, output: 9 } },
  })
  const store = new BillingStore(medium, () => {})
  assert.equal(store.mode, 'durable')
  const loaded = await store.load()
  assert.deepEqual(loaded.prices, { 'a/b': { inputCacheHit: 0.1, inputCacheMiss: 3, output: 9 } })
  assert.equal(loaded.peakValleyEnabled, true)
})

test('legacy v0.3 records with strip fields load and drop them', async () => {
  const legacy = {
    prices: { 'a/b': { inputCacheHit: 0.1, inputCacheMiss: 3, output: 9 } },
    stripVisible: false,
    peakHintVisible: false,
    peakValleyEnabled: false,
  }
  assert.equal(billingGlobalSchema.safeParse(legacy).success, true)
  const store = new BillingStore(fakeMedium(legacy), () => {})
  const loaded = await store.load()
  assert.deepEqual(loaded, {
    prices: { 'a/b': { inputCacheHit: 0.1, inputCacheMiss: 3, output: 9 } },
    peakValleyEnabled: false,
  })
  assert.equal('stripVisible' in loaded, false)
  assert.equal('peakHintVisible' in loaded, false)
})

test('clearPrices drops the prices through the medium and keeps the record valid', async () => {
  const medium = fakeMedium(SETTINGS)
  const store = new BillingStore(medium, () => {})
  await store.clearPrices()
  assert.equal(medium.writes, 1)
  assert.deepEqual(medium.stored, { prices: {}, peakValleyEnabled: true })
  assert.deepEqual(await store.load(), { prices: {}, peakValleyEnabled: true })
  // A fresh reader (the next process) sees the cleared record too.
  assert.deepEqual(await new BillingStore(medium, () => {}).load(), { prices: {}, peakValleyEnabled: true })
})

test('a corrupted medium degrades to defaults (warned) instead of throwing', async () => {
  const warns: string[] = []
  const store = new BillingStore(fakeMedium({ prices: { 'a/b': { inputCacheHit: 'x', inputCacheMiss: 1, output: 1 } } }), (m) => warns.push(m))
  const loaded = await store.load()
  assert.deepEqual(loaded.prices, {})
  assert.equal(loaded.peakValleyEnabled, true)
  assert.equal(warns.length, 1)
  assert.match(warns[0]!, /failed validation/)
})

test('memory mode reads an empty record, writes nothing, and keeps that cache across the attach', async () => {
  const store = new BillingStore(undefined, () => {})
  assert.equal(store.mode, 'memory')
  assert.deepEqual(await store.load(), { prices: {}, peakValleyEnabled: true })
  await store.clearPrices() // no medium: nothing is persisted, nothing throws
  const medium = fakeMedium({ prices: { 'a/b': { inputCacheHit: 0.1, inputCacheMiss: 3, output: 9 } }, peakValleyEnabled: true })
  store.attachMedium(medium)
  assert.equal(store.mode, 'durable')
  // The attach deliberately KEEPS the memory-phase cache — the record just
  // written does NOT appear, which is why the one-time import must never take a
  // memory-phase read as evidence that there are no legacy prices.
  assert.deepEqual(await store.load(), { prices: {}, peakValleyEnabled: true })
  assert.equal(medium.writes, 0)
})
