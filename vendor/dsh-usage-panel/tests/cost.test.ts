// Locks the integer money math: micro-yuan rates, single rounding to whole
// cents, and the period billing rule (peak column for peak buckets, idle
// column for off-peak buckets).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  billedBucketsOf,
  computeBilledCost,
  costCentsFor,
  costCompositionCents,
  splitCostCents,
  sumCostCents,
  type PhaseBuckets,
} from '../src/shared/cost.ts'
import { resolveModelPrice } from '../src/shared/pricing.ts'

const EMPTY = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }
const PHASE: PhaseBuckets = { peak: { ...EMPTY }, offPeak: { ...EMPTY } }

function flashPrice(): NonNullable<ReturnType<typeof resolveModelPrice>> {
  const price = resolveModelPrice('deepseek-official', 'deepseek-v4-flash', {})
  assert.ok(price)
  return price
}

test('computeBilledCost bills each period at its own column: 1M miss = ¥3 peak / ¥1.5 idle', () => {
  const price = flashPrice()
  const usage = {
    peak: { missInputTokens: 1_000_000, cacheReadTokens: 0, outputTokens: 0 },
    offPeak: { missInputTokens: 500_000, cacheReadTokens: 0, outputTokens: 0 },
  }
  assert.equal(computeBilledCost(usage, price), 375) // 300 + 75 cents
  assert.equal(computeBilledCost({ peak: { missInputTokens: 0, cacheReadTokens: 0, outputTokens: 0 }, offPeak: { missInputTokens: 0, cacheReadTokens: 0, outputTokens: 0 } }, price), 0)
})

test('cache reads bill at the hit rate, cache writes at the miss rate', () => {
  const price = flashPrice()
  const usage = {
    peak: {
      missInputTokens: 1_000_000 + 200_000, // uncached 1M + cacheWrite 200k
      cacheReadTokens: 400_000,
      outputTokens: 300_000,
    },
    offPeak: { missInputTokens: 0, cacheReadTokens: 0, outputTokens: 0 },
  }
  // peak: miss 3.0, hit 0.1, out 9.0 → 1.2M*3 + 400k*0.1 + 300k*9 per M
  const cents = computeBilledCost(usage, price)
  assert.equal(cents, 360 + 4 + 270) // ¥3.60 + ¥0.04 + ¥2.70
})

test('splitCostCents returns the per-period pair', () => {
  const price = flashPrice()
  const buckets: PhaseBuckets = {
    peak: { input: 1_000_000, output: 0, cacheRead: 0, cacheWrite: 0 },
    offPeak: { input: 500_000, output: 0, cacheRead: 0, cacheWrite: 0 },
  }
  const split = splitCostCents(buckets, price)
  assert.equal(split.peak, 300)
  assert.equal(split.offPeak, 75)
})

test('the single rounding step is half up (0.025 yuan → 3 fen)', () => {
  const price = flashPrice()
  const usage = {
    peak: { missInputTokens: 0, cacheReadTokens: 0, outputTokens: 0 },
    offPeak: { missInputTokens: 0, cacheReadTokens: 500_000, outputTokens: 0 }, // 500k × 0.05/M = 0.025 yuan
  }
  assert.equal(computeBilledCost(usage, price), 3)
})

test('custom prices take precedence over the official column', () => {
  const buckets: PhaseBuckets = {
    peak: { input: 1_000_000, output: 0, cacheRead: 0, cacheWrite: 0 },
    offPeak: { ...EMPTY },
  }
  const cents = costCentsFor(buckets, 'deepseek-official', 'deepseek-v4-flash', {
    'deepseek-official/deepseek-v4-flash': { inputCacheHit: 1, inputCacheMiss: 7, output: 1 },
  })
  assert.equal(cents, 700)
})

test('an unpriced model returns null (never a guessed figure)', () => {
  const buckets: PhaseBuckets = {
    peak: { input: 1_000_000, output: 0, cacheRead: 0, cacheWrite: 0 },
    offPeak: { ...EMPTY },
  }
  assert.equal(costCentsFor(buckets, 'openrouter', 'openai/gpt-4o', {}), null)
  assert.equal(costCentsFor(buckets, 'deepseek-official', 'unknown-model', {}), null)
})

test('a custom-priced relay row bills its own price', () => {
  const buckets: PhaseBuckets = {
    peak: { input: 1_000_000, output: 0, cacheRead: 0, cacheWrite: 0 },
    offPeak: { ...EMPTY },
  }
  const cents = costCentsFor(buckets, 'relay', 'custom-model', {
    'relay/custom-model': { inputCacheHit: 1, inputCacheMiss: 2, output: 3, flat: true },
  })
  assert.equal(cents, 200)
})

test('peakValley=false bills both periods at the peak column', () => {
  const buckets: PhaseBuckets = {
    peak: { input: 1_000_000, output: 0, cacheRead: 0, cacheWrite: 0 },
    offPeak: { input: 500_000, output: 0, cacheRead: 0, cacheWrite: 0 },
  }
  // Without the switch: 300 + 300 (peak column); with it: 300 + 75 (idle prices).
  assert.equal(costCentsFor(buckets, 'deepseek-official', 'deepseek-v4-flash', {}, false), 450)
  assert.equal(costCentsFor(buckets, 'deepseek-official', 'deepseek-v4-flash', {}, true), 375)
})

test('sumCostCents is null when every row is unpriced and sums otherwise', () => {
  assert.equal(sumCostCents([]), null)
  assert.equal(sumCostCents([null, null]), null)
  assert.equal(sumCostCents([100, null, 50]), 150)
})

test('billedBucketsOf folds cache writes into the miss bucket', () => {
  assert.deepEqual(billedBucketsOf({ input: 10, output: 3, cacheRead: 4, cacheWrite: 2 }), {
    missInputTokens: 12,
    cacheReadTokens: 4,
    outputTokens: 3,
  })
})

test('compaction-free invariant: PHASE helper stays zero-initializable', () => {
  assert.deepEqual(PHASE, { peak: EMPTY, offPeak: EMPTY })
})

test('costCompositionCents splits the session cost into hit/miss/output', () => {
  const rows = [
    {
      model: 'deepseek-v4-flash',
      provider: 'deepseek-official',
      cost: {
        peak: { input: 2_000_000, output: 1_000_000, cacheRead: 500_000, cacheWrite: 200_000 },
        offPeak: { input: 100_000, output: 0, cacheRead: 0, cacheWrite: 0 },
      } as PhaseBuckets,
    },
  ]
  const comp = costCompositionCents(rows, {}, true)
  assert.ok(comp)
  // peak: miss 2.2M×3 = 660c, hit 500k×0.1 = 5c, out 1M×9 = 900c;
  // off-peak: miss 100k×1.5/M = 15c.
  assert.equal(comp!.hit, 5)
  assert.equal(comp!.miss, 675)
  assert.equal(comp!.output, 900)
})

test('costCompositionCents is null when every row is unpriced', () => {
  const rows = [{ model: 'openai/gpt-4o', provider: 'openrouter', cost: PHASE }]
  assert.equal(costCompositionCents(rows, {}, true), null)
})
