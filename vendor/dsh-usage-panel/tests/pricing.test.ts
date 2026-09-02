// Locks the official price table (asOf + every published value), the resolver
// order, user-price parsing, and cost text. Any drift from the published
// table fails here — bump OFFICIAL_PRICES_AS_OF deliberately, with the new
// source.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  DEEPSEEK_OFFICIAL_PRICES,
  OFFICIAL_PRICES_AS_OF,
  OFFICIAL_PRICES_SOURCE,
  compositePriceKey,
  formatCost,
  isDeepSeekProvider,
  knownModelNames,
  officialPriceFor,
  parseSessionCostPrices,
  priceText,
  resolveModelPrice,
} from '../src/shared/pricing.ts'

test('official table carries the published 2026-08-17 values verbatim', () => {
  assert.equal(OFFICIAL_PRICES_AS_OF, '2026-08-17')
  assert.ok(OFFICIAL_PRICES_SOURCE.includes('api-docs.deepseek.com'))
  assert.deepEqual(DEEPSEEK_OFFICIAL_PRICES, [
    {
      model: 'deepseek-v4-flash',
      price: {
        inputCacheHit: { idle: 0.05, peak: 0.1 },
        inputCacheMiss: { idle: 1.5, peak: 3 },
        output: { idle: 4.5, peak: 9 },
      },
    },
    {
      model: 'deepseek-v4-pro',
      price: {
        inputCacheHit: { idle: 0.15, peak: 0.3 },
        inputCacheMiss: { idle: 4.5, peak: 9 },
        output: { idle: 13.5, peak: 27 },
      },
    },
    {
      model: 'deepseek-v4-flash-vision-exp',
      price: {
        inputCacheHit: { idle: 0.05, peak: 0.1 },
        inputCacheMiss: { idle: 1.5, peak: 3 },
        output: { idle: 4.5, peak: 9 },
      },
    },
  ])
})

test('officialPriceFor is case-insensitive and misses unknown models', () => {
  assert.equal(officialPriceFor('DEEPSEEK-V4-PRO')?.output.peak, 27)
  assert.equal(officialPriceFor('nope'), undefined)
})

test('isDeepSeekProvider matches DeepSeek route ids and deepseek-named relays', () => {
  assert.equal(isDeepSeekProvider('deepseek-official'), true)
  assert.equal(isDeepSeekProvider('deepseek'), true)
  assert.equal(isDeepSeekProvider('my-deepseek-relay'), true)
  assert.equal(isDeepSeekProvider(null), false)
  assert.equal(isDeepSeekProvider(''), false)
  assert.equal(isDeepSeekProvider('openrouter'), false)
})

test('compositePriceKey splits provider/model on the first slash', () => {
  assert.equal(compositePriceKey('relay', 'foo/bar'), 'relay/foo/bar')
})

test('custom price wins over the official column, provider-scoped first', () => {
  const prices = {
    'relay/deepseek-v4-flash': { inputCacheHit: 0.2, inputCacheMiss: 4, output: 12 },
  }
  const price = resolveModelPrice('relay', 'deepseek-v4-flash', prices)
  assert.ok(price)
  assert.equal(price.source, 'custom')
  assert.equal(price.peak.inputCacheMiss, 4)
  const legacy = { 'deepseek-v4-flash': { inputCacheHit: 1, inputCacheMiss: 1, output: 1 } }
  const price2 = resolveModelPrice(null, 'deepseek-v4-flash', legacy)
  assert.ok(price2)
  assert.equal(price2.source, 'custom')
  assert.equal(price2.peak.output, 1)
})

test('official column resolves its own published peak and idle columns', () => {
  const price = resolveModelPrice('deepseek-official', 'deepseek-v4-flash', {})
  assert.ok(price)
  assert.equal(price.source, 'official')
  assert.equal(price.flat, false)
  assert.equal(price.idleExplicit, true)
  assert.deepEqual(price.peak, { inputCacheHit: 0.1, inputCacheMiss: 3, output: 9 })
  assert.deepEqual(price.idle, { inputCacheHit: 0.05, inputCacheMiss: 1.5, output: 4.5 })
})

test('a user price derives the idle column as half the peaks unless explicit', () => {
  const derived = { 'relay/custom-model': { inputCacheHit: 4, inputCacheMiss: 8, output: 16 } }
  const price = resolveModelPrice('relay', 'custom-model', derived)
  assert.ok(price)
  assert.equal(price.source, 'custom')
  assert.equal(price.idleExplicit, false)
  assert.deepEqual(price.idle, { inputCacheHit: 2, inputCacheMiss: 4, output: 8 })
  const explicit = {
    'relay/custom-model': { inputCacheHit: 4, inputCacheMiss: 8, output: 16, idle: { inputCacheHit: 1, inputCacheMiss: 2, output: 3 } },
  }
  const price2 = resolveModelPrice('relay', 'custom-model', explicit)
  assert.ok(price2)
  assert.equal(price2.idleExplicit, true)
  assert.deepEqual(price2.idle, { inputCacheHit: 1, inputCacheMiss: 2, output: 3 })
})

test('flat entry bills the peak triple in both periods', () => {
  const flat = { 'relay/custom-model': { inputCacheHit: 4, inputCacheMiss: 8, output: 16, flat: true } }
  const price = resolveModelPrice('relay', 'custom-model', flat)
  assert.ok(price)
  assert.equal(price.flat, true)
  assert.equal(price.idleExplicit, true)
  assert.deepEqual(price.idle, price.peak)
})

test('an unpriced unknown model resolves to null (never a guessed figure)', () => {
  assert.equal(resolveModelPrice('openrouter', 'openai/gpt-4o', {}), null)
  assert.equal(resolveModelPrice(null, 'some-vendor-model', {}), null)
  assert.equal(resolveModelPrice('p', '', {}), null)
  assert.equal(resolveModelPrice('p', undefined, {}), null)
  assert.equal(resolveModelPrice('deepseek-official', 'unknown-v5-flash', {}), null)
})

test('a relay serving an official model id bills the official column', () => {
  const price = resolveModelPrice('relay', 'deepseek-v4-flash', {})
  assert.ok(price)
  assert.equal(price.source, 'official')
})

test('parseSessionCostPrices accepts a valid record and rejects bad shapes', () => {
  const ok = parseSessionCostPrices({
    'deepseek/deepseek-v4-flash': { inputCacheHit: 0.1, inputCacheMiss: 3, output: 9, flat: true },
    'relay/custom': { inputCacheHit: 1, inputCacheMiss: 2, output: 3, idle: { inputCacheHit: 0.5, inputCacheMiss: 1, output: 1.5 } },
  })
  assert.equal(ok.ok, true)
  assert.deepEqual(ok.prices['relay/custom'], {
    inputCacheHit: 1,
    inputCacheMiss: 2,
    output: 3,
    idle: { inputCacheHit: 0.5, inputCacheMiss: 1, output: 1.5 },
  })
  for (const bad of [null, [], 'x', 42]) {
    assert.equal(parseSessionCostPrices(bad).ok, false)
  }
  assert.equal(parseSessionCostPrices({ 'a/b': { inputCacheHit: -1, inputCacheMiss: 1, output: 1 } }).ok, false)
  assert.equal(parseSessionCostPrices({ 'a/b': { inputCacheHit: NaN, inputCacheMiss: 1, output: 1 } }).ok, false)
  assert.equal(parseSessionCostPrices({ 'a/b': { inputCacheHit: Infinity, inputCacheMiss: 1, output: 1 } }).ok, false)
  assert.equal(parseSessionCostPrices({ 'a/b': { inputCacheHit: '1', inputCacheMiss: 1, output: 1 } }).ok, false)
  assert.equal(parseSessionCostPrices({ '': { inputCacheHit: 1, inputCacheMiss: 1, output: 1 } }).ok, false)
  assert.equal(parseSessionCostPrices({ 'a/b': { inputCacheHit: 1, inputCacheMiss: 1, output: 1, flat: 'yes' } }).ok, false)
  assert.equal(parseSessionCostPrices({ 'a/b': { inputCacheHit: 1, inputCacheMiss: 1, output: 1, idle: { inputCacheHit: -0.1, inputCacheMiss: 1, output: 1 } } }).ok, false)
  assert.equal(parseSessionCostPrices({ ['a'.repeat(300) + '/b']: { inputCacheHit: 1, inputCacheMiss: 1, output: 1 } }).ok, false)
})

test('formatCost renders ¥ with two decimals, never negative', () => {
  assert.equal(formatCost(375), '¥3.75')
  assert.equal(formatCost(0), '¥0.00')
  assert.equal(formatCost(-1), '¥0.00')
  assert.equal(formatCost(27_00), '¥27.00')
})

test('priceText renders compact values', () => {
  assert.equal(priceText(1.5), '1.5')
  assert.equal(priceText(0.05), '0.05')
  assert.equal(priceText(9), '9')
})

test('knownModelNames lists official columns first, then custom keys, deduped', () => {
  const names = knownModelNames({ 'relay/gpt-4o': {}, 'deepseek-v4-pro': {} })
  assert.deepEqual(names, [
    'deepseek-v4-flash',
    'deepseek-v4-pro',
    'deepseek-v4-flash-vision-exp',
    'relay/gpt-4o', // the bare official key deduped into its official position
  ])
})
