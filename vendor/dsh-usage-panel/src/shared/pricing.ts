// dsh-usage-panel · pricing: the single official DeepSeek price table and the
// model-column resolver, plus user-price validation and price formatting.
//
// PURE (no IO) and shared by host and browser. Reality disclaimer: this is an
// ESTIMATE, not a bill. The official table is a data file with its asOf date
// and source link pinned by unit tests; user-edited prices describe a model's
// peak column (the price editor's three inputs); for a user-priced model
// without an explicit idle column, the off-peak values derive from the entered
// peaks (official rule: off-peak = half of peak) — a convention hint, never
// claimed as an official rule. A record the editor wrote for a user's 峰谷计价
// OFF therefore carries BOTH columns at the entered price plus the plugin's own
// `flat` marker (the harness has no such field and halves an absent idle
// column); `repairFlatEntries` enforces that shape on the write path and once
// over the stored section.
//
// Resolver order: custom (provider-scoped composite key first, then the bare
// model id for legacy records) → official column (matched by model id,
// case-insensitive) → null. An unknown model with no custom price resolves to
// null: the UI shows "not priced" instead of guessing (competitor red line:
// never a made-up figure).

/** One bucket's official published prices, idle and peak, CNY per million tokens. */
export interface BucketPricePair {
  readonly idle: number
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

/** DeepSeek official price table (CNY per million tokens), both periods as published. */
export const DEEPSEEK_OFFICIAL_PRICES: readonly OfficialPriceEntry[] = [
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
] as const

/** Date the official table above took effect (peak/valley billing start, Beijing). */
export const OFFICIAL_PRICES_AS_OF = '2026-08-17'

/** Official source of the table above (DeepSeek API docs, pricing page). */
export const OFFICIAL_PRICES_SOURCE = 'https://api-docs.deepseek.com/zh-cn/quick_start/pricing'

/** The three price inputs a user edits, CNY per million tokens (peak column). */
export interface SessionCostModelPrice {
  inputCacheHit: number
  inputCacheMiss: number
  output: number
  /** Explicit off-peak column; absent means derived (half of the peaks). */
  idle?: { inputCacheHit: number; inputCacheMiss: number; output: number }
  /**
   * Per-model 峰谷计价 OFF: one price for both periods. This marker is THIS
   * PLUGIN'S OWN — the harness record has no `flat` field and ignores it, which
   * is why the editor persists the same triple as an explicit `idle` column
   * beside it (`repairFlatEntries` shows why a flat record without `idle`
   * billed half in off-peak hours).
   */
  flat?: boolean
}

/**
 * User-edited prices keyed by `provider/model` (composite) or, for legacy
 * records, by the bare model id.
 */
export type SessionCostPrices = Record<string, SessionCostModelPrice>

/** Where a resolved price came from, shown by the price UI. */
export type PriceSource = 'official' | 'custom'

/** A resolved model price: the peak column and the idle column it bills with. */
export interface ResolvedModelPrice {
  /** CNY prices per million tokens billed during peak hours. */
  readonly peak: { inputCacheHit: number; inputCacheMiss: number; output: number }
  /** CNY prices per million tokens billed during off-peak hours. */
  readonly idle: { inputCacheHit: number; inputCacheMiss: number; output: number }
  /**
   * Whether the idle column is explicit (official column, the user's
   * peak/valley entry, or a flat entry) rather than derived from the peaks.
   */
  readonly idleExplicit: boolean
  /** Per-model peak/valley OFF (single price for both periods). */
  readonly flat: boolean
  /** How the price was chosen: user-edited or the official column. */
  readonly source: PriceSource
}

/**
 * Whether a provider route id names a DeepSeek API route. Matching on the
 * substring keeps the built-in adapter (`deepseek-official`), the catalog
 * provider (`deepseek`) and any relay whose route id contains "deepseek"
 * covered without a hardcoded enumeration.
 * @param provider - provider route id; null/empty never matches.
 * @returns true when the route is a DeepSeek API provider.
 */
export function isDeepSeekProvider(provider: string | null | undefined): boolean {
  return provider !== null && provider !== undefined && provider !== '' && provider.toLowerCase().includes('deepseek')
}

/**
 * Case-insensitive official column lookup.
 * @param model - the model id to look up.
 * @returns the model's published idle/peak prices, or undefined when the table does not name it.
 */
export function officialPriceFor(model: string): OfficialModelPrice | undefined {
  const needle = model.toLowerCase()
  return DEEPSEEK_OFFICIAL_PRICES.find((entry) => entry.model.toLowerCase() === needle)?.price
}

/**
 * One persistent price key: `${provider}/${model}`. Provider route ids never
 * contain a `/` (the custom-provider route pattern rejects it), so the first
 * `/` splits the key back unambiguously even when the model id contains one.
 * @param provider - provider route id.
 * @param model - provider-owned model id.
 * @returns the composite record key.
 */
export function compositePriceKey(provider: string, model: string): string {
  return provider + '/' + model
}

/**
 * Resolve one model's billing prices: a user-edited entry wins (composite
 * provider-scoped key first, then the bare model id fallback), then the
 * official column; anything else resolves to null (the UI prompts for a
 * price instead of guessing).
 * @param provider - the session's provider route id.
 * @param model - the session's current model id; null/empty resolves to null.
 * @param customPrices - user-edited prices keyed by `provider/model` (or bare model id).
 * @returns the peak and idle columns plus their origin, or null when not priced.
 */
export function resolveModelPrice(
  provider: string | null | undefined,
  model: string | null | undefined,
  customPrices: SessionCostPrices,
): ResolvedModelPrice | null {
  if (model === null || model === undefined || model === '') return null
  const custom = lookupCustomPrice(provider, model, customPrices)
  if (custom !== undefined) {
    const peak = { inputCacheHit: custom.inputCacheHit, inputCacheMiss: custom.inputCacheMiss, output: custom.output }
    if (custom.flat === true) {
      return { peak, idle: peak, idleExplicit: true, flat: true, source: 'custom' }
    }
    if (custom.idle !== undefined) {
      return { peak, idle: custom.idle, idleExplicit: true, flat: false, source: 'custom' }
    }
    // Official convention hint: off-peak is half of peak; not an official rule for a user price.
    const half = (n: number): number => n / 2
    return {
      peak,
      idle: {
        inputCacheHit: half(peak.inputCacheHit),
        inputCacheMiss: half(peak.inputCacheMiss),
        output: half(peak.output),
      },
      idleExplicit: false,
      flat: false,
      source: 'custom',
    }
  }
  const official = officialPriceFor(model)
  if (official === undefined) return null
  return {
    peak: { inputCacheHit: official.inputCacheHit.peak, inputCacheMiss: official.inputCacheMiss.peak, output: official.output.peak },
    idle: { inputCacheHit: official.inputCacheHit.idle, inputCacheMiss: official.inputCacheMiss.idle, output: official.output.idle },
    idleExplicit: true,
    flat: false,
    source: 'official',
  }
}

function lookupCustomPrice(
  provider: string | null | undefined,
  model: string,
  customPrices: SessionCostPrices,
): SessionCostModelPrice | undefined {
  if (provider !== null && provider !== undefined) {
    const byProvider = customPrices[compositePriceKey(provider, model)]
    if (byProvider !== undefined) return byProvider
  }
  return customPrices[model]
}

/** Largest price the editor accepts, CNY per million tokens. */
export const MAX_PRICE = 1_000_000

const MAX_KEY_LENGTH = 256

/**
 * Parse and sanitize user price input (JSON-shaped, e.g. from the wire or
 * storage). Values must be finite numbers in [0, MAX_PRICE]; keys are
 * non-empty strings; `idle`/`flat` are optional. Output key order follows
 * input order; never throws.
 * @param input - unknown JSON-shaped input.
 * @returns the parsed prices plus per-key issues, or the issues alone.
 */
export function parseSessionCostPrices(
  input: unknown,
): { ok: true; prices: SessionCostPrices } | { ok: false; issues: string[] } {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    return { ok: false, issues: ['prices must be an object'] }
  }
  const prices: SessionCostPrices = {}
  const issues: string[] = []
  for (const [key, raw] of Object.entries(input)) {
    if (key.length === 0) {
      issues.push('empty price key')
      continue
    }
    if (key.length > MAX_KEY_LENGTH) {
      issues.push('price key too long: ' + key.slice(0, 24) + '…')
      continue
    }
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
      issues.push('price for "' + key + '" must be an object')
      continue
    }
    const value = raw as Record<string, unknown>
    const inputCacheHit = readPrice(value.inputCacheHit)
    const inputCacheMiss = readPrice(value.inputCacheMiss)
    const output = readPrice(value.output)
    if (inputCacheHit === null || inputCacheMiss === null || output === null) {
      issues.push('price for "' + key + '" needs finite numbers: inputCacheHit/inputCacheMiss/output')
      continue
    }
    const entry: SessionCostModelPrice = { inputCacheHit, inputCacheMiss, output }
    if (value.flat !== undefined && value.flat !== true) {
      issues.push('price for "' + key + '" has a non-boolean flat')
      continue
    }
    if (value.flat === true) entry.flat = true
    if (value.idle !== undefined) {
      const idle = value.idle as Record<string, unknown>
      const idleHit = readPrice(idle.inputCacheHit)
      const idleMiss = readPrice(idle.inputCacheMiss)
      const idleOut = readPrice(idle.output)
      if (idleHit === null || idleMiss === null || idleOut === null) {
        issues.push('price for "' + key + '" has an invalid idle column')
        continue
      }
      entry.idle = { inputCacheHit: idleHit, inputCacheMiss: idleMiss, output: idleOut }
    }
    prices[key] = entry
  }
  if (issues.length > 0) return { ok: false, issues }
  return { ok: true, prices }
}

function readPrice(value: unknown): number | null {
  if (typeof value !== 'number') return null
  if (!Number.isFinite(value)) return null
  if (value < 0 || value > MAX_PRICE) return null
  return value
}

/**
 * Give every flat record an explicit idle column.
 *
 * `flat` is this plugin's own marker for "峰谷计价 OFF: one price for both
 * periods", and the HARNESS does not know it: it reads the three top-level
 * numbers as the PEAK column and derives the off-peak charge as half of them
 * whenever `idle` is absent. A flat record without `idle` therefore billed the
 * entered single price at HALF in off-peak hours. This returns the record with
 * `idle` = the same three numbers for every `flat: true` entry that lacks it —
 * the shape the modal's OFF branch writes now — so every reader (the harness
 * composer strip, this plugin's cost math, the modal on reopen) agrees that both
 * periods bill that price.
 *
 * Entries that already carry an `idle` column are left untouched, and so is
 * every non-flat entry: for a single-column non-flat record the derived half IS
 * the intended semantics (that record declares a peak column), so repairing it
 * would silently change what it bills.
 * @param prices - the stored record; never mutated.
 * @returns the repaired record plus whether anything changed — a second run
 *   over the first run's output reports `changed: false`.
 */
export function repairFlatEntries(prices: SessionCostPrices): { prices: SessionCostPrices; changed: boolean } {
  let changed = false
  const next: SessionCostPrices = {}
  for (const [key, entry] of Object.entries(prices)) {
    if (entry.flat === true && entry.idle === undefined) {
      changed = true
      next[key] = {
        ...entry,
        idle: {
          inputCacheHit: entry.inputCacheHit,
          inputCacheMiss: entry.inputCacheMiss,
          output: entry.output,
        },
      }
      continue
    }
    next[key] = entry
  }
  return { prices: next, changed }
}

/**
 * Render a cost as `¥X.XX` from integer cents.
 * @param cents - cost in cents (fen).
 * @returns the display text, two decimals, never negative.
 */
export function formatCost(cents: number): string {
  return '¥' + (Math.max(0, Math.round(cents)) / 100).toFixed(2)
}

/**
 * Render one price value as the compact text used in the price UI.
 * @param yuanPerMillion - CNY per million tokens.
 * @returns the compact price text, e.g. `1.5`, `0.05`.
 */
export function priceText(yuanPerMillion: number): string {
  return String(Math.round(yuanPerMillion * 1e6) / 1e6)
}

/**
 * Every model id the price editor can offer: the official table's columns
 * first (official order), then user-added keys ascending, deduplicated.
 * @param customPrices - keyed record (values unused).
 * @returns model ids in display order.
 */
export function knownModelNames(customPrices: Readonly<Record<string, unknown>>): string[] {
  const names: string[] = []
  const seen = new Set<string>()
  const push = (name: string): void => {
    if (seen.has(name)) return
    seen.add(name)
    names.push(name)
  }
  for (const entry of DEEPSEEK_OFFICIAL_PRICES) push(entry.model)
  for (const key of Object.keys(customPrices).sort()) push(key)
  return names
}
