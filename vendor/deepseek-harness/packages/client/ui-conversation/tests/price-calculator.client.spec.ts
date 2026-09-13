// PriceCalculator: official table resolution (both periods as published),
// custom overrides, integer-cent math, per-period billing, and per-route
// decomposition across a multi-model conversation.

import { describe, expect, it } from 'vitest'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { en as commonEn } from '@deepseek-ai/dsh-client-locale/src/locales/en.ts'
import type { BilledUsageBuckets, BilledUsageProjection, ModelBilledUsage } from '@deepseek-ai/dsh-token-meter/client'
import {
  billedCostCents, cacheHitRate, DEEPSEEK_OFFICIAL_PRICES, formatCost, formatTokenCount, priceText,
  knownModelNames, mergeBilledUsage, resolveModelPrice,
} from '../src/client/price-calculator.ts'
import type { SessionCostPrices } from '../src/submission-settings.ts'
import { en } from '../src/client/locales.ts'

// Mirrors the real lookup chain (conversation namespace, then common).
const tEn = makeTranslate(en, commonEn)

const ZERO: BilledUsageBuckets = { missInputTokens: 0, cacheReadTokens: 0, outputTokens: 0 }

/** One bucket set from its three token counts. */
const buckets = (
  missInputTokens: number,
  cacheReadTokens: number,
  outputTokens: number,
): BilledUsageBuckets => ({ missInputTokens, cacheReadTokens, outputTokens })

/** One route's row with the given peak buckets and zero off-peak buckets. */
const route = (
  provider: string,
  model: string,
  peak: BilledUsageBuckets,
  offPeak: BilledUsageBuckets = ZERO,
): ModelBilledUsage => ({ provider, model, peak, offPeak })

const add = (a: BilledUsageBuckets, b: BilledUsageBuckets): BilledUsageBuckets => ({
  missInputTokens: a.missInputTokens + b.missInputTokens,
  cacheReadTokens: a.cacheReadTokens + b.cacheReadTokens,
  outputTokens: a.outputTokens + b.outputTokens,
})

/** A projection whose session totals are the sum of its route rows. */
const usageOf = (...models: ModelBilledUsage[]): BilledUsageProjection => ({
  peak: models.reduce((sum, model) => add(sum, model.peak), ZERO),
  offPeak: models.reduce((sum, model) => add(sum, model.offPeak), ZERO),
  models,
})

/** One single-route projection of peak buckets, priced through the record. */
const costOf = (
  peak: BilledUsageBuckets,
  provider: string,
  model: string,
  prices: SessionCostPrices,
): number => billedCostCents(usageOf(route(provider, model, peak)), prices).cents

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
    expect(costOf(buckets(1_000_000, 0, 0), 'deepseek-official', 'deepseek-v4-flash', {})).toBe(300)
  })

  it('bills peak cache-hit input at the peak column price', () => {
    // 1,000,000 hit tokens at 0.10 CNY/M = 0.10 CNY = 10 fen.
    expect(costOf(buckets(0, 1_000_000, 0), 'deepseek-official', 'deepseek-v4-flash', {})).toBe(10)
  })

  it('bills peak output at the peak column price', () => {
    // 100,000 output tokens at 9.0 CNY/M = 0.90 CNY = 90 fen.
    expect(costOf(buckets(0, 0, 100_000), 'deepseek-official', 'deepseek-v4-flash', {})).toBe(90)
  })

  it('bills off-peak buckets at the official idle column price', () => {
    // 1,000,000 miss tokens at the published idle 1.5 CNY/M = 1.50 CNY = 150 fen.
    const usage = usageOf(route('deepseek-official', 'deepseek-v4-flash', ZERO, { missInputTokens: 1_000_000, cacheReadTokens: 0, outputTokens: 0 }))
    expect(billedCostCents(usage, {}).cents).toBe(150)
  })

  it('rounds once on the total, not per bucket', () => {
    // 50,000 idle hit tokens at 0.05 CNY/M = 0.0025 CNY, and 50,000 idle
    // output tokens at 4.5 CNY/M = 0.225 CNY. Sum 0.2275 CNY rounds to 23
    // fen — per-bucket rounding would give 0 + 23 from a different split.
    const usage = usageOf(route('deepseek-official', 'deepseek-v4-flash', ZERO, { missInputTokens: 0, cacheReadTokens: 50_000, outputTokens: 50_000 }))
    expect(billedCostCents(usage, {}).cents).toBe(23)
  })

  it('prices the pro column three times the flash column within one period', () => {
    const flash = costOf(buckets(1_000_000, 1_000_000, 1_000_000), 'deepseek-official', 'deepseek-v4-flash', {})
    const pro = costOf(buckets(1_000_000, 1_000_000, 1_000_000), 'deepseek-official', 'deepseek-v4-pro', {})
    expect(pro).toBe(flash * 3)
  })

  it('applies user-edited peak prices immediately', () => {
    expect(costOf(buckets(1_000_000, 0, 0), 'deepseek-official', 'deepseek-v4-flash', {
      'deepseek-v4-flash': { inputCacheHit: 0, inputCacheMiss: 1, output: 0 },
    })).toBe(100)
  })

  it('serves zero for a session without usage', () => {
    expect(billedCostCents(usageOf(), {}).cents).toBe(0)
    expect(billedCostCents(usageOf(route('deepseek-official', 'deepseek-v4-flash', ZERO, ZERO)), {}).cents).toBe(0)
  })

  it('prices every route a multi-model conversation used at its own column', () => {
    // The regression this decomposition exists for: a session that ran an
    // unpriced relay model and then an official one must not re-rate the
    // relay tokens at the official column (nor report the whole session as
    // unpriced because the newest model is the unpriced one).
    const usage = usageOf(
      route('relay', 'glm-5.3-flash', { missInputTokens: 1_000_000, cacheReadTokens: 0, outputTokens: 0 }),
      route('deepseek-official', 'deepseek-v4-flash', { missInputTokens: 1_000_000, cacheReadTokens: 0, outputTokens: 0 }),
    )
    const unpricedOnly = billedCostCents(usage, {})
    // The relay route has no official column, so only the official half bills.
    expect(unpricedOnly.cents).toBe(300)
    expect(unpricedOnly.rows).toHaveLength(2)
    expect(unpricedOnly.priced.map(row => row.model)).toEqual(['deepseek-v4-flash'])
    expect(unpricedOnly.unpriced.map(row => row.model)).toEqual(['glm-5.3-flash'])

    const priced = billedCostCents(usage, {
      'relay/glm-5.3-flash': { inputCacheHit: 0, inputCacheMiss: 1, output: 0 },
    })
    // 1,000,000 relay miss tokens at 1.0 CNY/M = 100 fen, plus the official 300.
    expect(priced.cents).toBe(400)
    expect(priced.unpriced).toEqual([])
    expect(priced.rows.map(row => row.cents)).toEqual([100, 300])
  })

  it('skips routes that carry no tokens at all', () => {
    const usage = usageOf(
      route('relay', 'idle-route', ZERO, ZERO),
      route('deepseek-official', 'deepseek-v4-flash', { missInputTokens: 1_000_000, cacheReadTokens: 0, outputTokens: 0 }),
    )
    const breakdown = billedCostCents(usage, {})
    expect(breakdown.rows.map(row => row.model)).toEqual(['deepseek-v4-flash'])
    expect(breakdown.cents).toBe(300)
  })

  it('carries each route its own peak and off-peak buckets', () => {
    // The rows are the card's only input: a consumer reads one route's
    // tokens and its cost from the same value instead of joining two
    // independently-ordered lists by index.
    const relayPeak = buckets(1_000, 2_000, 3_000)
    const relayOffPeak = buckets(4_000, 5_000, 6_000)
    const flashPeak = buckets(7_000, 8_000, 9_000)
    const usage = usageOf(
      route('relay', 'glm-5.3-flash', relayPeak, relayOffPeak),
      route('deepseek-official', 'deepseek-v4-flash', flashPeak),
    )
    const breakdown = billedCostCents(usage, {})
    expect(breakdown.rows.map(row => row.peak)).toEqual([relayPeak, flashPeak])
    expect(breakdown.rows[0]?.offPeak).toEqual(relayOffPeak)
    expect(breakdown.rows[1]?.offPeak).toEqual(ZERO)
    // An unpriced route carries its buckets too: "this model ran and is not
    // priced" is exactly what the card has to show.
    expect(breakdown.unpriced[0]?.peak).toEqual(relayPeak)
  })
})

describe('mergeBilledUsage', () => {
  const flashPeak = buckets(1_000_000, 0, 0)

  it('folds one model billed by several Sessions into a single summed route', () => {
    // A delegated child bills in its own Session; the card still lists one row
    // per (provider, model), so the header total is exactly the sum of rows.
    const merged = mergeBilledUsage([
      usageOf(route('deepseek-official', 'deepseek-v4-flash', flashPeak)),
      usageOf(route('deepseek-official', 'deepseek-v4-flash', flashPeak)),
    ])
    expect(merged.models).toHaveLength(1)
    expect(merged.models[0]?.peak).toEqual(buckets(2_000_000, 0, 0))
    expect(merged.peak).toEqual(buckets(2_000_000, 0, 0))
    // The merged figure is the same money as two separately priced Sessions.
    expect(billedCostCents(merged, {}).cents).toBe(600)
  })

  it('sums both periods and keeps each provider\'s own row for one model id', () => {
    const merged = mergeBilledUsage([
      usageOf(route('deepseek-official', 'deepseek-v4-flash', flashPeak, buckets(0, 7, 0))),
      usageOf(
        route('relay', 'deepseek-v4-flash', buckets(0, 0, 5)),
        route('deepseek-official', 'deepseek-v4-flash', buckets(2, 0, 0)),
      ),
    ])
    // First-seen order, and the two providers that serve the same model id stay
    // apart: their user prices are recorded per (provider, model).
    expect(merged.models.map(row => row.provider)).toEqual(['deepseek-official', 'relay'])
    expect(merged.models[0]?.peak).toEqual(buckets(1_000_002, 0, 0))
    expect(merged.models[0]?.offPeak).toEqual(buckets(0, 7, 0))
    expect(merged.models[1]?.peak).toEqual(buckets(0, 0, 5))
    // The merged totals are the merged routes, so a reader of either sees one
    // consistent picture.
    expect(merged.peak).toEqual(buckets(1_000_002, 0, 5))
    expect(merged.offPeak).toEqual(buckets(0, 7, 0))
  })

  it('returns an empty projection for no sources', () => {
    expect(mergeBilledUsage([])).toEqual({ peak: ZERO, offPeak: ZERO, models: [] })
  })

  it('owns its buckets rather than aliasing a source\'s', () => {
    // A later write to one source's sample must not reach the merged value.
    const source = usageOf(route('deepseek-official', 'deepseek-v4-flash', flashPeak))
    const merged = mergeBilledUsage([source])
    ;(source.models[0]!.peak as { missInputTokens: number }).missInputTokens = 42
    expect(merged.models[0]?.peak).toEqual(buckets(1_000_000, 0, 0))
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

describe('formatTokenCount', () => {
  it('abbreviates thousand and million counts through the locale templates', () => {
    expect(formatTokenCount(0, tEn)).toBe('0')
    expect(formatTokenCount(517, tEn)).toBe('517')
    expect(formatTokenCount(12_240, tEn)).toBe('12.2K')
    expect(formatTokenCount(517_000, tEn)).toBe('517K')
    expect(formatTokenCount(1_230_000, tEn)).toBe('1.2M')
  })

  it('keeps a boundary count in the smaller unit', () => {
    expect(formatTokenCount(999, tEn)).toBe('999')
    expect(formatTokenCount(1_000, tEn)).toBe('1K')
    expect(formatTokenCount(999_999, tEn)).toBe('1000K')
  })
})

describe('cacheHitRate', () => {
  it('reads the share of prompt input served from cache across both periods', () => {
    // 99 reads + 1 miss over the two periods: one combined rate, so the split
    // between the periods cannot change it.
    expect(cacheHitRate([buckets(1, 99, 0), buckets(0, 50, 7)], tEn)).toBe(' (99%)')
  })

  it('reads a full hit as 100 and an all-miss source as 0', () => {
    expect(cacheHitRate([buckets(0, 1_024, 900)], tEn)).toBe(' (100%)')
    expect(cacheHitRate([buckets(1_024, 0, 900)], tEn)).toBe(' (0%)')
  })

  it('omits the parenthetical when the source billed no prompt token', () => {
    // Output-only usage has no rate to report; a fabricated 0% would claim the
    // prompt was un-cached when there was no prompt.
    expect(cacheHitRate([buckets(0, 0, 900)], tEn)).toBe('')
    expect(cacheHitRate([ZERO], tEn)).toBe('')
    expect(cacheHitRate([], tEn)).toBe('')
  })

  it('never rounds a partial hit up to a full one', () => {
    // Rounding the whole percent would read 100%; the miss stays visible.
    expect(cacheHitRate([buckets(1, 999, 0)], tEn)).toBe(' (99.9%)')
    expect(cacheHitRate([buckets(1, 999_999, 0)], tEn)).toBe(' (99.9999%)')
  })
})
