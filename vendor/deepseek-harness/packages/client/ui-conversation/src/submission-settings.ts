/** Conversation preferences stored in the Host user-settings document. */

import z from '@deepseek-ai/schemastery'

/** Settings namespace owned by the conversation plugin. */
export const CONVERSATION_SETTINGS_NAMESPACE = 'ui-conversation'

/** Field carrying the delivery mode for plain Enter while an agent is busy. */
export const BUSY_ENTER_FIELD = 'busyEnter'

/** Field carrying whether the composer plays the send/think border beam. */
export const COMPOSER_BEAM_FIELD = 'composerBeam'

/** Field carrying whether the composer text box can be drag-resized. */
export const COMPOSER_RESIZE_FIELD = 'composerResize'

/** Field carrying the last dragged composer scrollport height in CSS pixels. */
export const COMPOSER_RESIZE_HEIGHT_FIELD = 'composerResizeHeight'

/** Field carrying the last dragged composer card width in CSS pixels. */
export const COMPOSER_RESIZE_WIDTH_FIELD = 'composerResizeWidth'

/** Field carrying whether the composer dock paints the session stats strip. */
export const STATS_LINE_FIELD = 'statsLine'

/** Field carrying whether the official peak/valley status row is force-enabled. */
export const OFFICIAL_PEAK_VALLEY_FIELD = 'officialPeakValley'

/** Field carrying whether the composer dock paints the session cost figure. */
export const SESSION_COST_FIELD = 'sessionCost'

/** Field carrying the user's per-model custom peak-hour prices (absent model = use official/default). */
export const SESSION_COST_PRICES_FIELD = 'sessionCostPrices'

/** Field carrying whether the session header paints Chat/Trajectory tabs. */
export const VIEW_TABS_FIELD = 'viewTabs'

/** Busy-Enter behaviors accepted at settings and input boundaries. */
export const BUSY_ENTER_BEHAVIORS = ['queue', 'steer'] as const

/** Configurable meaning of plain Enter while the addressed agent is busy. */
export type BusyEnterBehavior = typeof BUSY_ENTER_BEHAVIORS[number]

/** Default preserves Enter-as-Queue for running conversations. */
export const DEFAULT_BUSY_ENTER_BEHAVIOR: BusyEnterBehavior = 'queue'

/** Default keeps the composer border beam while a turn is in flight. */
export const DEFAULT_COMPOSER_BEAM = true

/** Default keeps auto-grow only; drag-resize is an explicit opt-in. */
export const DEFAULT_COMPOSER_RESIZE = false

/** Default means no remembered scrollport height (auto-grow). */
export const DEFAULT_COMPOSER_RESIZE_HEIGHT: number | null = null

/** Default means no remembered card width (column width). */
export const DEFAULT_COMPOSER_RESIZE_WIDTH: number | null = null

/** Default keeps the composer-dock session stats strip. */
export const DEFAULT_STATS_LINE = true

/** Default means the peak/valley row shows only while a DeepSeek API route is detected. */
export const DEFAULT_OFFICIAL_PEAK_VALLEY = false

/** Default hides the session cost figure until the user opts in. */
export const DEFAULT_SESSION_COST = false

/** Default means every model bills at its official (or first-column) price. */
export const DEFAULT_SESSION_COST_PRICES: SessionCostPrices = {}

/**
 * Prices for one model, in CNY per million tokens. The base fields describe
 * the peak column; off-peak billing reads the official idle column for an
 * official model, the explicit {@link SessionCostModelPrice.idle} column when
 * the user prices both periods, or the idle figure implied by the peaks for a
 * single-priced model the official table does not name.
 */
export interface SessionCostModelPrice {
  /** Cache-hit prompt input during peak hours. */
  inputCacheHit: number
  /** Cache-miss prompt input (cache writes included) during peak hours. */
  inputCacheMiss: number
  /** Response output during peak hours. */
  output: number
  /**
   * Explicit off-peak column (peak/valley pricing mode): both periods billed
   * as entered. Absent for single-priced models — the idle figure derives
   * from the peaks.
   */
  idle?: {
    /** Cache-hit prompt input during off-peak hours. */
    inputCacheHit: number
    /** Cache-miss prompt input (cache writes included) during off-peak hours. */
    inputCacheMiss: number
    /** Response output during off-peak hours. */
    output: number
  }
}

/**
 * User-edited peak-hour prices keyed by `provider/model` (two providers may
 * serve the same model id with different real-world prices, so each keeps its
 * own slot). A bare model id remains accepted as a legacy key, billing it for
 * any provider serving that model until the panel re-saves per provider. A
 * model absent from the record bills at its official table column, or the
 * table's first column when the official table does not name it.
 */
export type SessionCostPrices = Record<string, SessionCostModelPrice>

/** Default keeps the Chat/Trajectory header tablist when more than one view exists. */
export const DEFAULT_VIEW_TABS = true

/** Durable conversation section shared by the Host schema and the browser scope. */
export interface ConversationSettings {
  /** Delivery mode for plain Enter while the addressed agent is busy. */
  busyEnter: BusyEnterBehavior
  /** Whether InputBar paints `.cardBeam` while a turn is sending or thinking. */
  composerBeam: boolean
  /** Whether InputBar shows a top-edge handle that sets the draft scrollport height. */
  composerResize: boolean
  /** Last drag-committed scrollport height in CSS pixels; absent/undefined restores auto-grow height. */
  composerResizeHeight?: number | null
  /** Last drag-committed card width in CSS pixels; absent/undefined restores column width. */
  composerResizeWidth?: number | null
  /** Whether StatsLine paints session-stats figures in the composer-dock row. */
  statsLine: boolean
  /** Whether the composer dock force-paints the official peak/valley status row. */
  officialPeakValley: boolean
  /** Whether the composer dock paints the session cost figure; absent/undefined reads as off. */
  sessionCost?: boolean
  /** User-edited per-model peak-hour prices; absent keys bill at official/default prices. */
  sessionCostPrices?: SessionCostPrices
  /** Whether ConversationSessionHeader paints the Chat/Trajectory tablist. */
  viewTabs: boolean
}

/** Durable conversation schema; also the wire envelope the browser scope validates against. */
export const ConversationSettingsSchema: z<ConversationSettings> = z.object({
  [BUSY_ENTER_FIELD]: z.union([...BUSY_ENTER_BEHAVIORS]).default(DEFAULT_BUSY_ENTER_BEHAVIOR),
  [COMPOSER_BEAM_FIELD]: z.boolean().default(DEFAULT_COMPOSER_BEAM),
  [COMPOSER_RESIZE_FIELD]: z.boolean().default(DEFAULT_COMPOSER_RESIZE),
  [COMPOSER_RESIZE_HEIGHT_FIELD]: z.number().min(1).required(false),
  [COMPOSER_RESIZE_WIDTH_FIELD]: z.number().min(1).required(false),
  [STATS_LINE_FIELD]: z.boolean().default(DEFAULT_STATS_LINE),
  [OFFICIAL_PEAK_VALLEY_FIELD]: z.boolean().default(DEFAULT_OFFICIAL_PEAK_VALLEY),
  // Optional without a materialized default: the registered section defaults
  // keep their pre-cost shape, and an absent field reads as off at adoption.
  [SESSION_COST_FIELD]: z.boolean().required(false),
  // Optional and intentionally loose at the schema: a schemastery dict would
  // materialize an empty-object default into the registered section defaults,
  // and the write path validates positivity at the price panel. Adoption
  // sanitizes the shape before use.
  [SESSION_COST_PRICES_FIELD]: z.any().required(false),
  [VIEW_TABS_FIELD]: z.boolean().default(DEFAULT_VIEW_TABS),
})
