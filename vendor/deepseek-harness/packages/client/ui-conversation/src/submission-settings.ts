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
  [VIEW_TABS_FIELD]: z.boolean().default(DEFAULT_VIEW_TABS),
})
