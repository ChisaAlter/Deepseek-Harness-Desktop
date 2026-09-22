/**
 * PriceCalculator: the pure pricing face of the session-cost row.
 *
 * The official DeepSeek table carries each period's own published prices —
 * one idle and one peak column per bucket per model — and billing reads the
 * column of the bucket's period directly; the two columns are independent
 * official numbers, not one derived from the other. User-edited prices
 * describe a model's peak column (the panel's three inputs); for a
 * user-priced model that has no official idle column, the panel derives its
 * idle hint from the entered peak values so the convention stays visible
 * without claiming it as an official rule. All money math stays in integers:
 * rates convert to integer micro-yuan per million tokens (1e-6 CNY
 * granularity, far below the table's 0.01 step), products with token counts
 * stay exact well inside the float64 integer range, and the single rounding
 * step lands on whole cents at the very end.
 *
 * A session bills one row per model route that reported usage, because a
 * conversation may switch models; each row's own buckets resolve their own
 * columns, and a route the price record cannot name is reported rather than
 * folded into the total at another route's rate.
 *
 * @module price-calculator
 */

import type {
  BilledUsageBuckets, BilledUsageProjection, ModelBilledUsage,
} from '@deepseek-ai/dsh-token-meter/client'
import type { ComposerBarProps } from './contract/slots.ts'
import type { SessionCostModelPrice, SessionCostPrices } from '../submission-settings.ts'

export type { SessionCostModelPrice, SessionCostPrices }

/** One bucket's official published prices, idle and peak, CNY per million tokens. */
export interface BucketPricePair {
  /** Off-peak (idle) hours. */
  readonly idle: number
  /** Peak hours. */
  readonly peak: number
}

/** One official model column: each bucket's idle/peak pair. */
export interface OfficialModelPrice {
  readonly inputCacheHit: BucketPricePair
  readonly inputCacheMiss: BucketPricePair
  readonly output: BucketPricePair
}

/** One official price column. */
export interface OfficialPriceEntry {
  /** Exact official model id. */
  readonly model: string
  /** Idle/peak CNY prices per million tokens for every bucket. */
  readonly price: OfficialModelPrice
}

/**
 * DeepSeek official price table (CNY per million tokens), both periods as
 * published. The first entry is the default column for models the table does
 * not name: flash 0.05/0.10 hit, 1.5/3.0 miss, 4.5/9.0 output; pro 0.15/0.30,
 * 4.5/9.0, 13.5/27.0; vision-exp matches flash.
 */
export const DEEPSEEK_OFFICIAL_PRICES: readonly OfficialPriceEntry[] = [
  {
    model: 'deepseek-v4-flash',
    price: {
      inputCacheHit: { idle: 0.05, peak: 0.1 },
      inputCacheMiss: { idle: 1.5, peak: 3.0 },
      output: { idle: 4.5, peak: 9.0 },
    },
  },
  {
    model: 'deepseek-v4-pro',
    price: {
      inputCacheHit: { idle: 0.15, peak: 0.3 },
      inputCacheMiss: { idle: 4.5, peak: 9.0 },
      output: { idle: 13.5, peak: 27.0 },
    },
  },
  {
    model: 'deepseek-v4-flash-vision-exp',
    price: {
      inputCacheHit: { idle: 0.05, peak: 0.1 },
      inputCacheMiss: { idle: 1.5, peak: 3.0 },
      output: { idle: 4.5, peak: 9.0 },
    },
  },
]

/** Where a resolved price came from, shown by the price panel. */
export type PriceSource = 'official' | 'custom' | 'default'

/** A resolved model price: the peak column and the idle column it bills with. */
export interface ResolvedModelPrice {
  /** CNY prices per million tokens billed during peak hours. */
  readonly peak: SessionCostModelPrice
  /** CNY prices per million tokens billed during off-peak hours. */
  readonly idle: SessionCostModelPrice
  /**
   * Whether the idle column is an explicit price (official column or the
   * user's peak/valley entry) rather than derived from the peaks for a
   * single-priced model.
   */
  readonly idleExplicit: boolean
  /** How the price was chosen: user-edited, official column, or first-column fallback. */
  readonly source: PriceSource
}

/**
 * Whether a provider route id names a DeepSeek API route. The built-in adapter
 * registers `deepseek-official` and the catalog provider `deepseek`; matching
 * on the substring keeps both (and any future DeepSeek route id) covered
 * without a hardcoded enumeration in the presentation layer. A custom relay
 * whose route id contains "deepseek" is likewise treated as a DeepSeek route,
 * the same convention the peak/valley row uses.
 * @param provider - provider route id; null never matches.
 * @returns true when the route is a DeepSeek API provider.
 */
export function isDeepSeekProvider(provider: string | null): boolean {
  return provider !== null && provider.toLowerCase().includes('deepseek')
}

/**
 * Case-insensitive official column lookup.
 * @param model - the model id to look up.
 * @returns the model's published idle/peak prices, or undefined when the table does not name it.
 */
export function officialPriceFor(model: string): OfficialModelPrice | undefined {
  const needle = model.toLowerCase()
  return DEEPSEEK_OFFICIAL_PRICES.find(entry => entry.model.toLowerCase() === needle)?.price
}

/** Split one official pair into the billing shapes the row and panel consume. */
function asPeriodPrices(price: OfficialModelPrice): {
  peak: SessionCostModelPrice
  idle: SessionCostModelPrice
  idleExplicit: true
} {
  return {
    peak: { inputCacheHit: price.inputCacheHit.peak, inputCacheMiss: price.inputCacheMiss.peak, output: price.output.peak },
    idle: { inputCacheHit: price.inputCacheHit.idle, inputCacheMiss: price.inputCacheMiss.idle, output: price.output.idle },
    idleExplicit: true,
  }
}

/**
 * One persistent price key: `${provider}/${model}`. A provider route id never
 * contains a `/` (the custom-provider route pattern rejects it), so the first
 * `/` splits the key back into provider and model unambiguously even when the
 * model id itself contains a `/`.
 * @param provider - provider route id.
 * @param model - provider-owned model id.
 * @returns the composite record key.
 */
export function compositePriceKey(provider: string, model: string): string {
  return `${provider}/${model}`
}

/**
 * Resolve one model's billing prices: a user-edited peak entry wins (its idle
 * column derives from the entered peaks for the panel hint, since no official
 * idle column exists), then the official column, then the table's first
 * column. A custom price is looked up per (provider, model) first — two
 * providers may serve the same model id with different real-world prices —
 * then by the bare model id for a record written before provider-scoped keys.
 * @param provider - the session's provider route id; null/unknown reads the bare-model fallback only.
 * @param model - the session's current model id; null/empty always falls back to the default column.
 * @param customPrices - user-edited peak prices keyed by `provider/model` (or bare model id for legacy records).
 * @returns the peak and idle columns plus their origin.
 */
export function resolveModelPrice(
  provider: string | null | undefined,
  model: string | null | undefined,
  customPrices: SessionCostPrices,
): ResolvedModelPrice {
  const custom = model === null || model === undefined || model === ''
    ? undefined
    : provider === null || provider === undefined || provider === ''
      ? customPrices[model]
      : customPrices[compositePriceKey(provider, model)] ?? customPrices[model]
  if (custom !== undefined) {
    const peak = custom
    return {
      peak,
      idle: custom.idle ?? {
        inputCacheHit: peak.inputCacheHit / 2,
        inputCacheMiss: peak.inputCacheMiss / 2,
        output: peak.output / 2,
      },
      idleExplicit: custom.idle !== undefined,
      source: 'custom',
    }
  }
  const needle = model?.toLowerCase()
  const official = needle === undefined || needle === ''
    ? undefined
    : officialPriceFor(needle)
  if (official !== undefined) return { ...asPeriodPrices(official), source: 'official' }
  return { ...asPeriodPrices(DEEPSEEK_OFFICIAL_PRICES[0]!.price), idleExplicit: false, source: 'default' }
}

/**
 * Every model the price panel can offer: the official table's columns plus
 * each user-added model, official order first. The record is read only for
 * its keys, so the panel can pass its string-valued draft too.
 * @param customPrices - keyed record (values unused).
 * @returns model ids in display order.
 */
export function knownModelNames(customPrices: Readonly<Record<string, unknown>>): string[] {
  const names = DEEPSEEK_OFFICIAL_PRICES.map(entry => entry.model)
  for (const name of Object.keys(customPrices)) {
    if (!names.some(official => official.toLowerCase() === name.toLowerCase())) names.push(name)
  }
  return names
}

/**
 * One rate as integer micro-yuan per million tokens. Micro-yuan (1e-6 CNY)
 * keeps every official and typical user price exact while the subsequent
 * token products stay inside exact float64 integer range.
 * @param yuanPerMillion - CNY per million tokens for one period.
 * @returns integer micro-yuan per million tokens.
 */
function microRate(yuanPerMillion: number): number {
  return Math.round(yuanPerMillion * 1_000_000)
}

/** Micro-yuan cost of one bucket set at its period's rates. */
function bucketMicro(buckets: BilledUsageBuckets, hit: number, miss: number, out: number): number {
  return buckets.missInputTokens * miss + buckets.cacheReadTokens * hit + buckets.outputTokens * out
}

/**
 * Whole-session cost in integer cents: peak buckets bill at the resolved
 * peak column, off-peak buckets at the resolved idle column — each period's
 * own published prices, no derived ratio. Input cache misses and cache
 * writes bill at the miss rate; cache reads at the hit rate. Micro-yuan
 * products with token counts carry a 1e-6 tokens/1e-6 CNY scale, so the
 * micro-yuan sum divides by 1e6 (per-million) x 1e4 (cents per yuan).
 * @param peak - one route's or session's peak-window buckets.
 * @param offPeak - the same set's off-peak buckets.
 * @param price - the resolved peak and idle columns.
 * @returns the cost in cents (fen), rounded half up.
 */
export function bucketsCostCents(
  peak: BilledUsageBuckets,
  offPeak: BilledUsageBuckets,
  price: ResolvedModelPrice,
): number {
  const peakMicro = bucketMicro(
    peak,
    microRate(price.peak.inputCacheHit),
    microRate(price.peak.inputCacheMiss),
    microRate(price.peak.output),
  )
  const offPeakMicro = bucketMicro(
    offPeak,
    microRate(price.idle.inputCacheHit),
    microRate(price.idle.inputCacheMiss),
    microRate(price.idle.output),
  )
  return Math.round((peakMicro + offPeakMicro) / 10_000_000_000)
}

/** One model route's share of a session's cost. */
export interface ModelCostRow {
  /** Provider route id the tokens were dispatched through; empty when the log names none. */
  readonly provider: string
  /** Provider-owned model id; empty when the log names none. */
  readonly model: string
  /** Integer cents this route's own buckets bill; zero when the route has no price. */
  readonly cents: number
  /** The route's resolved columns, or null when it has no price at all. */
  readonly price: ResolvedModelPrice | null
  /**
   * The same route's peak-window buckets. The row carries them so a consumer
   * reads a route's tokens and its cost from one value instead of joining two
   * independently-ordered lists by position.
   */
  readonly peak: BilledUsageBuckets
  /** The same route's off-peak buckets. */
  readonly offPeak: BilledUsageBuckets
}

/**
 * A session's cost decomposed per model route. A conversation that switched
 * models bills every route at its own resolved column, so the total never
 * mixes one route's rates into another's tokens; routes the price record
 * cannot name are reported instead of being guessed at.
 */
export interface SessionCostBreakdown {
  /** Integer cents summed over every priced route. */
  readonly cents: number
  /** One row per route that reported usage, in first-seen order. */
  readonly rows: readonly ModelCostRow[]
  /** The rows whose route resolved to no price; their tokens contribute nothing. */
  readonly unpriced: readonly ModelCostRow[]
  /** The rows whose route resolved to a price column. */
  readonly priced: readonly ModelCostRow[]
}

/**
 * Price every route in one session's billed usage separately and total them.
 * A route counts as priced when its own column resolves — user-edited first,
 * then the official table; a session where only some routes resolve keeps the
 * priced part of the figure and reports the rest, because a per-model
 * breakdown is the only honest answer once a conversation spans models.
 * @param usage - the session's per-route period-bucketed usage.
 * @param customPrices - user-edited prices keyed by `provider/model` (or bare model id).
 * @returns the per-route rows, their split, and the summed cents.
 */
export function billedCostCents(
  usage: BilledUsageProjection,
  customPrices: SessionCostPrices,
): SessionCostBreakdown {
  const rows: ModelCostRow[] = []
  let cents = 0
  for (const route of usage.models) {
    if (isEmptyBuckets(route.peak) && isEmptyBuckets(route.offPeak)) continue
    const price = resolveModelPrice(route.provider, route.model, customPrices)
    const priced = price.source !== 'default'
    const routeCents = priced ? bucketsCostCents(route.peak, route.offPeak, price) : 0
    cents += routeCents
    rows.push({
      provider: route.provider,
      model: route.model,
      cents: routeCents,
      price: priced ? price : null,
      peak: route.peak,
      offPeak: route.offPeak,
    })
  }
  return {
    cents,
    rows,
    unpriced: rows.filter(row => row.price === null),
    priced: rows.filter(row => row.price !== null),
  }
}

/** Whether one billed-usage bucket set carries no tokens at all. */
function isEmptyBuckets(buckets: BilledUsageBuckets): boolean {
  return buckets.missInputTokens === 0 && buckets.cacheReadTokens === 0 && buckets.outputTokens === 0
}

/** The additive identity of a bucket set; never mutated — `sumBuckets` returns a new set. */
const ZERO_BUCKETS: BilledUsageBuckets = { missInputTokens: 0, cacheReadTokens: 0, outputTokens: 0 }

/** One bucket set added to another, token by token. */
function sumBuckets(left: BilledUsageBuckets, right: BilledUsageBuckets): BilledUsageBuckets {
  return {
    missInputTokens: left.missInputTokens + right.missInputTokens,
    cacheReadTokens: left.cacheReadTokens + right.cacheReadTokens,
    outputTokens: left.outputTokens + right.outputTokens,
  }
}

/**
 * Fold several Sessions' billed usage into the one projection the cost rows are
 * priced from. Delegated subagents bill in their own Session, so an unfolded
 * read prices the conversation's routes without them; folding by
 * `provider/model` instead of concatenating gives the card one row per route —
 * a model the Session and three children billed is one row whose tokens and
 * cost are the sums, and the displayed total then equals the sum of its rows
 * exactly. The composite key is unambiguous because a provider route id never
 * contains `/` (see {@link compositePriceKey}), so two providers serving one
 * model id stay separate rows.
 * @param sources - one projection per Session to fold; a source's own totals are ignored (the merged totals are derived from its routes, so the fold cannot double-count or lose an unattributed token).
 * @returns one route per `provider/model`, in first-seen order, with the summed buckets.
 */
export function mergeBilledUsage(
  sources: readonly BilledUsageProjection[],
): BilledUsageProjection {
  const routes = new Map<string, ModelBilledUsage>()
  for (const source of sources) {
    for (const route of source.models) {
      const key = compositePriceKey(route.provider, route.model)
      const summed = routes.get(key)
      routes.set(key, summed === undefined
        // Copied on first sight: the merged projection owns its buckets rather
        // than aliasing one source's, so no later write can reach a sample.
        ? { provider: route.provider, model: route.model, peak: { ...route.peak }, offPeak: { ...route.offPeak } }
        : {
          provider: summed.provider,
          model: summed.model,
          peak: sumBuckets(summed.peak, route.peak),
          offPeak: sumBuckets(summed.offPeak, route.offPeak),
        })
    }
  }
  const models = [...routes.values()]
  return {
    peak: models.reduce((sum, route) => sumBuckets(sum, route.peak), ZERO_BUCKETS),
    offPeak: models.reduce((sum, route) => sumBuckets(sum, route.offPeak), ZERO_BUCKETS),
    models,
  }
}

/**
 * Render a cost as `¥X.XX` from integer cents.
 * @param cents - cost in cents (fen).
 * @returns the display text, two decimals, never negative.
 */
export function formatCost(cents: number): string {
  return `¥${(Math.max(0, cents) / 100).toFixed(2)}`
}

/**
 * Render one price value as the compact panel hint text.
 * @param yuanPerMillion - CNY per million tokens.
 * @returns the compact price text, e.g. `1.5`.
 */
export function priceText(yuanPerMillion: number): string {
  return String(yuanPerMillion)
}

/**
 * Compact token count for the cost row's hover text: `517`, `12.2K`, `1.2M`.
 * The unit suffixes come from the shared common vocabulary
 * (`number.thousand` / `number.million`) through the owning locale seat, so
 * the figure stays locale-owned. The formatter is local because the identical
 * `ui-chat` one is another feature plugin's value (a plugin may not
 * import those) and the context meter's copy is private to that component.
 * @param value - token count.
 * @param t - the owning dock's locale seat, carrying the shared number templates.
 * @returns the abbreviated count.
 */
export function formatTokenCount(value: number, t: ComposerBarProps['t']): string {
  const scaled = (candidate: number): string => candidate >= 100
    ? String(Math.round(candidate))
    : String(Math.round(candidate * 10) / 10)
  if (value < 1_000) return String(value)
  if (value < 1_000_000) return t('number.thousand', { value: scaled(value / 1_000) })
  return t('number.million', { value: scaled(value / 1_000_000) })
}

/**
 * Exact whole-percent cache-hit units: `hit / denominator` rounded to the
 * nearest percent with positive ties up, computed in integers so a token count
 * large enough to lose precision in a float ratio still rounds exactly. The
 * search mirrors ui-chat's private formatter, which this package may not import
 * for the same reason as {@link formatTokenCount}.
 * @param hit - prompt tokens served from cache.
 * @param denominator - prompt tokens billed (cache reads plus cache misses).
 * @returns the percentage in whole units.
 */
function cacheHitPercentUnits(hit: number, denominator: number): number {
  const scale = 100
  const doubledScale = scale * 2
  const denominatorQuotient = Math.floor(denominator / doubledScale)
  const denominatorRemainder = denominator % doubledScale
  let lower = 0
  let upper = scale
  while (lower < upper) {
    const candidate = Math.floor((lower + upper + 1) / 2)
    const factor = candidate * 2 - 1
    const threshold = factor * denominatorQuotient
      + Math.ceil(factor * denominatorRemainder / doubledScale)
    if (hit >= threshold) lower = candidate
    else upper = candidate - 1
  }
  return lower
}

/**
 * Display-ready cache-hit share of the prompt input, never rounding a partial
 * hit up to a full 100%.
 * @param hit - prompt tokens served from cache.
 * @param denominator - prompt tokens billed (cache reads plus cache misses; cache writes fold into the miss side).
 * @returns percentage text without the sign, or null when no prompt token was billed.
 */
function formatCacheHitPercent(hit: number, denominator: number): string | null {
  if (denominator === 0) return null
  const missed = denominator - hit
  if (missed === 0) return '100'
  const units = cacheHitPercentUnits(hit, denominator)
  if (units < 100) return String(units)
  // The whole-percent reading rounds a near-full hit up to 100; add exactly the
  // precision that makes the miss visible instead of claiming a full hit.
  let places = 1
  let scaledDoubleGap = missed * 200
  const denominatorTens = Math.floor(denominator / 10)
  while (scaledDoubleGap <= denominatorTens) {
    scaledDoubleGap *= 10
    places += 1
  }
  const denominatorOnes = denominator % 10
  let roundedLoss = 5
  for (let loss = 1; loss < 5; loss += 1) {
    const factor = loss * 2 + 1
    const threshold = factor * denominatorTens + Math.floor(factor * denominatorOnes / 10)
    if (scaledDoubleGap <= threshold) {
      roundedLoss = loss
      break
    }
  }
  return `99.${'9'.repeat(places - 1)}${10 - roundedLoss}`
}

/**
 * The inline cache-hit parenthetical of one billed route or one delegated
 * child, or an empty string when that source moved no prompt token at all.
 * Both periods of one source combine — the peak/idle split decides which
 * column a token bills at, not what a cache hit is — while a caller that wants
 * a single period's own rate passes only that period's buckets. The
 * denominator is the prompt side only (cache reads plus misses), so output
 * tokens never dilute the rate, and a source with no prompt input reports
 * nothing rather than a fabricated 0%.
 * @param buckets - the bucket sets to rate (one period, or a source's combined totals).
 * @param t - the owning dock's locale seat.
 * @returns the localized parenthetical including its own spacing, or '' when there is no rate to report.
 */
export function cacheHitRate(
  buckets: readonly BilledUsageBuckets[],
  t: ComposerBarProps['t'],
): string {
  let hit = 0
  let miss = 0
  for (const set of buckets) {
    hit += set.cacheReadTokens
    miss += set.missInputTokens
  }
  const percent = formatCacheHitPercent(hit, hit + miss)
  return percent === null ? '' : t('sessionCost.hitRateInline', { percent })
}
