// PriceCalculator: official table resolution (both periods as published),
// custom overrides, integer-cent math, and per-period billing.

import { describe, expect, it } from 'vitest'
import type { BilledUsageProjection } from '@deepseek-ai/dsh-token-meter/client'
import {
  billedCostCents, DEEPSEEK_OFFICIAL_PRICES, formatCost, priceText,
  knownModelNames, resolveModelPrice,
} from '../src/client/price-calculator.ts'
import type { SessionCostPrices } from '../src/submission-settings.ts'

const buckets = (
  missInputTokens: number,
  cacheReadTokens: number,
  outputTokens: number,
): BilledUsageProjection => ({
  peak: { missInputTokens, cacheReadTokens, outputTokens },
  offPeak: { missInputTokens: 0, cacheReadTokens: 0, outputTokens: 0 },
})

const FLASH = DEEPSEEK_OFFICIAL_PRICES[0]!

describe('resolveModelPrice', () => {
  it('resolves every official column case-insensitively with its own idle and peak prices', () => {
    const pro = resolveModelPrice('deepseek-official', 'deepseek-v4-pro', {})
    expect(pro.source).toBe('official')
    expect(pro.peak).toEqual({ inputCacheHit: 0.3, inputCacheMiss: 9.0, output: 27.0 })
    expect(pro.idle).toEqual({ inputCacheHit: 0.15, inputCacheMiss: 4.5, output: 13.5 })
    expect(resolveModelPrice('deepseek-official', 'DeepSeek-V4-Flash-Vision-Exp', {}).source).toBe('official')
    expect(resolveModelPrice('deepseek-official', 'deepseek-v4-flash', {}).peak).toEqual({
      inputCacheHit: 0.1, inputCacheMiss: 3.0, output: 9.0,
    })
    // The published idle column, not a derived ratio.
    expect(resolveModelPrice('deepseek-official', 'deepseek-v4-flash', {}).idle).toEqual({
      inputCacheHit: 0.05, inputCacheMiss: 1.5, output: 4.5,
    })
  })

  it('falls back to the first official column for unknown models', () => {
    const resolved = resolveModelPrice(null, 'deepseek-reasoner', {})
    expect(resolved.source).toBe('default')
    expect(resolved.peak).toEqual(FLASH.price.inputCacheHit === undefined ? {} : {
      inputCacheHit: 0.1, inputCacheMiss: 3.0, output: 9.0,
    })
    expect(resolved.idle).toEqual({
      inputCacheHit: 0.05, inputCacheMiss: 1.5, output: 4.5,
    })
  })

  it('treats a null model as the default column', () => {
    expect(resolveModelPrice(null, null, {}).source).toBe('default')
    expect(resolveModelPrice(null, undefined, {}).source).toBe('default')
  })

  it('lets a user-edited price win over the official column', () => {
    const custom: SessionCostPrices = {
      'deepseek-v4-pro': { inputCacheHit: 1, inputCacheMiss: 2, output: 3 },
    }
    const resolved = resolveModelPrice('deepseek-official', 'deepseek-v4-pro', custom)
    expect(resolved.source).toBe('custom')
    expect(resolved.peak).toEqual({ inputCacheHit: 1, inputCacheMiss: 2, output: 3 })
  })

  it('resolves custom models that the official table does not name', () => {
    const custom: SessionCostPrices = {
      'my-relay-model': { inputCacheHit: 0.5, inputCacheMiss: 5, output: 15 },
    }
    expect(resolveModelPrice('my-relay', 'my-relay-model', custom).source).toBe('custom')
    expect(resolveModelPrice('my-relay', 'my-relay-model', custom).peak.output).toBe(15)
  })

  it('prices the same model id per provider, with a composite key winning over a legacy bare key', () => {
    const custom: SessionCostPrices = {
      'hohai/glm-5.3-flash': { inputCacheHit: 1, inputCacheMiss: 1, output: 1 },
      'zai/glm-5.3-flash': { inputCacheHit: 2, inputCacheMiss: 2, output: 2 },
      'glm-5.3-flash': { inputCacheHit: 9, inputCacheMiss: 9, output: 9 },
    }
    expect(resolveModelPrice('hohai', 'glm-5.3-flash', custom).peak.output).toBe(1)
    expect(resolveModelPrice('zai', 'glm-5.3-flash', custom).peak.output).toBe(2)
    // A provider without a composite key falls back to the legacy bare key.
    expect(resolveModelPrice('other-relay', 'glm-5.3-flash', custom).peak.output).toBe(9)
  })
})

describe('knownModelNames', () => {
  it('lists official columns first, then user-added models without duplicates', () => {
    const custom: SessionCostPrices = {
      'my-model': { inputCacheHit: 1, inputCacheMiss: 1, output: 1 },
      'DEEPSEEK-V4-FLASH': { inputCacheHit: 1, inputCacheMiss: 1, output: 1 },
    }
    expect(knownModelNames(custom)).toEqual([
      'deepseek-v4-flash',
      'deepseek-v4-pro',
      'deepseek-v4-flash-vision-exp',
      'my-model',
    ])
  })
})

describe('billedCostCents', () => {
  it('bills peak cache-miss input at the peak column price', () => {
    // 1,000,000 miss tokens at 3.0 CNY/M in peak hours = 3.00 CNY = 300 fen.
    expect(billedCostCents(buckets(1_000_000, 0, 0), resolveModelPrice('deepseek-official', 'deepseek-v4-flash', {}))).toBe(300)
  })

  it('bills peak cache-hit input at the peak column price', () => {
    // 1,000,000 hit tokens at 0.10 CNY/M = 0.10 CNY = 10 fen.
    const usage = buckets(0, 1_000_000, 0)
    expect(billedCostCents(usage, resolveModelPrice('deepseek-official', 'deepseek-v4-flash', {}))).toBe(10)
  })

  it('bills peak output at the peak column price', () => {
    // 100,000 output tokens at 9.0 CNY/M = 0.90 CNY = 90 fen.
    expect(billedCostCents(buckets(0, 0, 100_000), resolveModelPrice('deepseek-official', 'deepseek-v4-flash', {}))).toBe(90)
  })

  it('bills off-peak buckets at the official idle column price', () => {
    // 1,000,000 miss tokens at the published idle 1.5 CNY/M = 1.50 CNY = 150 fen.
    const usage: BilledUsageProjection = {
      peak: { missInputTokens: 0, cacheReadTokens: 0, outputTokens: 0 },
      offPeak: { missInputTokens: 1_000_000, cacheReadTokens: 0, outputTokens: 0 },
    }
    expect(billedCostCents(usage, resolveModelPrice('deepseek-official', 'deepseek-v4-flash', {}))).toBe(150)
  })

  it('rounds once on the total, not per bucket', () => {
    // 50,000 idle hit tokens at 0.05 CNY/M = 0.0025 CNY, and 50,000 idle
    // output tokens at 4.5 CNY/M = 0.225 CNY. Sum 0.2275 CNY rounds to 23
    // fen — per-bucket rounding would give 0 + 23 from a different split.
    const allIdle: BilledUsageProjection = {
      peak: { missInputTokens: 0, cacheReadTokens: 0, outputTokens: 0 },
      offPeak: { missInputTokens: 0, cacheReadTokens: 50_000, outputTokens: 50_000 },
    }
    expect(billedCostCents(allIdle, resolveModelPrice('deepseek-official', 'deepseek-v4-flash', {}))).toBe(23)
  })

  it('prices the pro column three times the flash column within one period', () => {
    const usage = buckets(1_000_000, 1_000_000, 1_000_000)
    expect(billedCostCents(usage, resolveModelPrice('deepseek-official', 'deepseek-v4-pro', {})))
      .toBe(billedCostCents(usage, resolveModelPrice('deepseek-official', 'deepseek-v4-flash', {})) * 3)
  })

  it('applies user-edited peak prices immediately', () => {
    const usage = buckets(1_000_000, 0, 0)
    const resolved = resolveModelPrice('deepseek-official', 'deepseek-v4-flash', {
      'deepseek-v4-flash': { inputCacheHit: 0, inputCacheMiss: 1, output: 0 },
    })
    expect(billedCostCents(usage, resolved)).toBe(100)
  })

  it('serves zero for a session without usage', () => {
    expect(billedCostCents(buckets(0, 0, 0), resolveModelPrice('deepseek-official', 'deepseek-v4-flash', {}))).toBe(0)
  })
})

describe('formatCost and priceText', () => {
  it('renders integer cents as ¥X.XX', () => {
    expect(formatCost(0)).toBe('¥0.00')
    expect(formatCost(5)).toBe('¥0.05')
    expect(formatCost(1234)).toBe('¥12.34')
    expect(formatCost(-3)).toBe('¥0.00')
  })

  it('renders prices compactly', () => {
    expect(priceText(1.5)).toBe('1.5')
    expect(priceText(0.05)).toBe('0.05')
    expect(priceText(27)).toBe('27')
  })
})
