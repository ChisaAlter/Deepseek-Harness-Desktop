/** One bucket's official published prices, idle and peak, CNY per million tokens. */
export interface BucketPricePair {
    readonly idle: number;
    readonly peak: number;
}
/** One official model column: each bucket's idle/peak pair. */
export interface OfficialModelPrice {
    readonly inputCacheHit: BucketPricePair;
    readonly inputCacheMiss: BucketPricePair;
    readonly output: BucketPricePair;
}
/** One official price column. */
export interface OfficialPriceEntry {
    /** Exact official model id. */
    readonly model: string;
    /** Idle/peak CNY prices per million tokens for every bucket. */
    readonly price: OfficialModelPrice;
}
/** DeepSeek official price table (CNY per million tokens), both periods as published. */
export declare const DEEPSEEK_OFFICIAL_PRICES: readonly OfficialPriceEntry[];
/** Date the official table above took effect (peak/valley billing start, Beijing). */
export declare const OFFICIAL_PRICES_AS_OF = "2026-08-17";
/** Official source of the table above (DeepSeek API docs, pricing page). */
export declare const OFFICIAL_PRICES_SOURCE = "https://api-docs.deepseek.com/zh-cn/quick_start/pricing";
/** The three price inputs a user edits, CNY per million tokens (peak column). */
export interface SessionCostModelPrice {
    inputCacheHit: number;
    inputCacheMiss: number;
    output: number;
    /** Explicit off-peak column; absent means derived (half of the peaks). */
    idle?: {
        inputCacheHit: number;
        inputCacheMiss: number;
        output: number;
    };
    /** Per-model peak/valley pricing OFF: both periods bill the peak column. */
    flat?: boolean;
}
/**
 * User-edited prices keyed by `provider/model` (composite) or, for legacy
 * records, by the bare model id.
 */
export type SessionCostPrices = Record<string, SessionCostModelPrice>;
/** Where a resolved price came from, shown by the price UI. */
export type PriceSource = 'official' | 'custom';
/** A resolved model price: the peak column and the idle column it bills with. */
export interface ResolvedModelPrice {
    /** CNY prices per million tokens billed during peak hours. */
    readonly peak: {
        inputCacheHit: number;
        inputCacheMiss: number;
        output: number;
    };
    /** CNY prices per million tokens billed during off-peak hours. */
    readonly idle: {
        inputCacheHit: number;
        inputCacheMiss: number;
        output: number;
    };
    /**
     * Whether the idle column is explicit (official column, the user's
     * peak/valley entry, or a flat entry) rather than derived from the peaks.
     */
    readonly idleExplicit: boolean;
    /** Per-model peak/valley OFF (single price for both periods). */
    readonly flat: boolean;
    /** How the price was chosen: user-edited or the official column. */
    readonly source: PriceSource;
}
/**
 * Whether a provider route id names a DeepSeek API route. Matching on the
 * substring keeps the built-in adapter (`deepseek-official`), the catalog
 * provider (`deepseek`) and any relay whose route id contains "deepseek"
 * covered without a hardcoded enumeration.
 * @param provider - provider route id; null/empty never matches.
 * @returns true when the route is a DeepSeek API provider.
 */
export declare function isDeepSeekProvider(provider: string | null | undefined): boolean;
/**
 * Case-insensitive official column lookup.
 * @param model - the model id to look up.
 * @returns the model's published idle/peak prices, or undefined when the table does not name it.
 */
export declare function officialPriceFor(model: string): OfficialModelPrice | undefined;
/**
 * One persistent price key: `${provider}/${model}`. Provider route ids never
 * contain a `/` (the custom-provider route pattern rejects it), so the first
 * `/` splits the key back unambiguously even when the model id contains one.
 * @param provider - provider route id.
 * @param model - provider-owned model id.
 * @returns the composite record key.
 */
export declare function compositePriceKey(provider: string, model: string): string;
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
export declare function resolveModelPrice(provider: string | null | undefined, model: string | null | undefined, customPrices: SessionCostPrices): ResolvedModelPrice | null;
/** Largest price the editor accepts, CNY per million tokens. */
export declare const MAX_PRICE = 1000000;
/**
 * Parse and sanitize user price input (JSON-shaped, e.g. from the wire or
 * storage). Values must be finite numbers in [0, MAX_PRICE]; keys are
 * non-empty strings; `idle`/`flat` are optional. Output key order follows
 * input order; never throws.
 * @param input - unknown JSON-shaped input.
 * @returns the parsed prices plus per-key issues, or the issues alone.
 */
export declare function parseSessionCostPrices(input: unknown): {
    ok: true;
    prices: SessionCostPrices;
} | {
    ok: false;
    issues: string[];
};
/**
 * Render a cost as `¥X.XX` from integer cents.
 * @param cents - cost in cents (fen).
 * @returns the display text, two decimals, never negative.
 */
export declare function formatCost(cents: number): string;
/**
 * Render one price value as the compact text used in the price UI.
 * @param yuanPerMillion - CNY per million tokens.
 * @returns the compact price text, e.g. `1.5`, `0.05`.
 */
export declare function priceText(yuanPerMillion: number): string;
/**
 * Every model id the price editor can offer: the official table's columns
 * first (official order), then user-added keys ascending, deduplicated.
 * @param customPrices - keyed record (values unused).
 * @returns model ids in display order.
 */
export declare function knownModelNames(customPrices: Readonly<Record<string, unknown>>): string[];
