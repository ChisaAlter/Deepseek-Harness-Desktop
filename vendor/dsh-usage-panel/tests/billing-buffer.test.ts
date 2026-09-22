// Locks the seeding rules the 计费设置 modal opens with: the switch state and
// every prefilled row are a function of the SAVED record, never a constant.
// The bug this file exists for: `bufferFromCustom` returned `idleChecked: true`
// unconditionally, so a model the user saved with 峰谷计价 OFF reopened with the
// switch ON.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { EMPTY_BUFFER, seedPriceBuffer } from '../src/client/billing-buffer.ts'
import type { ResolvedModelPrice, SessionCostModelPrice } from '../src/shared/pricing.ts'

/** The official deepseek-v4-flash column, in the shape the resolver returns. */
const OFFICIAL: ResolvedModelPrice = {
  peak: { inputCacheHit: 0.1, inputCacheMiss: 3, output: 9 },
  idle: { inputCacheHit: 0.05, inputCacheMiss: 1.5, output: 4.5 },
  idleExplicit: true,
  flat: false,
  source: 'official',
}

const FLAT_ROW = {
  idleChecked: false,
  idleHit: '2',
  idleMiss: '0.12',
  idleOut: '12',
}

test('no saved entry + no official column: switch OFF and empty, one price to enter', () => {
  assert.deepEqual(seedPriceBuffer(undefined, null), EMPTY_BUFFER)
  const seeded = seedPriceBuffer(undefined, null)
  // A fresh object: editing the buffer must never write through to the constant.
  seeded.hit = '1'
  assert.equal(EMPTY_BUFFER.hit, '')
})

test('no saved entry + an official column: switch ON with both published rows', () => {
  assert.deepEqual(seedPriceBuffer(undefined, OFFICIAL), {
    hit: '0.1',
    miss: '3',
    out: '9',
    idleChecked: true,
    idleHit: '0.05',
    idleMiss: '1.5',
    idleOut: '4.5',
  })
})

test('a saved flat entry reopens with the switch OFF and its own price in the single row', () => {
  // The exact record the defective OFF branch used to write: no idle column.
  const legacyFlat: SessionCostModelPrice = { inputCacheHit: 2, inputCacheMiss: 0.12, output: 12, flat: true }
  assert.deepEqual(seedPriceBuffer(legacyFlat, null), { ...EMPTY_BUFFER, ...FLAT_ROW })
  // The peak row stays empty so toggling ON prefills it as twice the idle row.
  assert.equal(seedPriceBuffer(legacyFlat, null).hit, '')
  // An official model saved flat is still the user's flat choice: the record wins.
  assert.deepEqual(seedPriceBuffer(legacyFlat, OFFICIAL), { ...EMPTY_BUFFER, ...FLAT_ROW })
})

test('a flat entry with an explicit idle column still opens OFF on its own triple', () => {
  // What the fixed OFF branch writes: both columns equal + the flat marker.
  const repaired: SessionCostModelPrice = {
    inputCacheHit: 2,
    inputCacheMiss: 0.12,
    output: 12,
    idle: { inputCacheHit: 2, inputCacheMiss: 0.12, output: 12 },
    flat: true,
  }
  assert.deepEqual(seedPriceBuffer(repaired, null), { ...EMPTY_BUFFER, ...FLAT_ROW })
})

test('a saved entry with an explicit idle column opens ON from both columns', () => {
  const peakValley: SessionCostModelPrice = {
    inputCacheHit: 2,
    inputCacheMiss: 0.12,
    output: 12,
    idle: { inputCacheHit: 1, inputCacheMiss: 0.06, output: 6 },
  }
  assert.deepEqual(seedPriceBuffer(peakValley, null), {
    hit: '2',
    miss: '0.12',
    out: '12',
    idleChecked: true,
    idleHit: '1',
    idleMiss: '0.06',
    idleOut: '6',
  })
})

test('a legacy single-column entry opens ON with the idle row at half the peaks', () => {
  // The harness derives exactly this half for that shape, so the seeded buffer
  // bills what the record already billed — it must not be read as a flat price.
  const legacy: SessionCostModelPrice = { inputCacheHit: 0.1, inputCacheMiss: 3, output: 9 }
  assert.deepEqual(seedPriceBuffer(legacy, OFFICIAL), {
    hit: '0.1',
    miss: '3',
    out: '9',
    idleChecked: true,
    idleHit: '0.05',
    idleMiss: '1.5',
    idleOut: '4.5',
  })
  // The half is printed by the price formatter, so float noise never reaches an input.
  const noisy: SessionCostModelPrice = { inputCacheHit: 0.30000000000000004, inputCacheMiss: 1, output: 1 }
  assert.equal(seedPriceBuffer(noisy, null).idleHit, '0.15')
  assert.deepEqual(seedPriceBuffer({ inputCacheHit: 1, inputCacheMiss: 1, output: 1 }, null), {
    hit: '1',
    miss: '1',
    out: '1',
    idleChecked: true,
    idleHit: '0.5',
    idleMiss: '0.5',
    idleOut: '0.5',
  })
})

test('seeding never mutates the saved record', () => {
  const flat: SessionCostModelPrice = { inputCacheHit: 2, inputCacheMiss: 0.12, output: 12, flat: true }
  const snapshot = structuredClone(flat)
  seedPriceBuffer(flat, OFFICIAL)
  assert.deepEqual(flat, snapshot)
})
