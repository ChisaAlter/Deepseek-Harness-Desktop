/** Conversation preferences stored in the Host user-settings document. */

import z from '@deepseek-ai/schemastery'

/** Settings namespace owned by the conversation plugin. */
export const CONVERSATION_SETTINGS_NAMESPACE = 'ui-conversation'

/** Field carrying the delivery mode for plain Enter while an agent is busy. */
export const BUSY_ENTER_FIELD = 'busyEnter'

/** Field carrying whether the composer plays the send/think border beam. */
export const COMPOSER_BEAM_FIELD = 'composerBeam'

/** Field carrying the configurable visual treatment for the composer beam. */
export const COMPOSER_BEAM_STYLE_FIELD = 'composerBeamStyle'

/** Field carrying the user's saved composer-beam visual presets. */
export const COMPOSER_BEAM_PRESETS_FIELD = 'composerBeamPresets'

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

/** Directions accepted by the running composer beam. */
export const COMPOSER_BEAM_DIRECTIONS = ['clockwise', 'counterclockwise', 'pingPong'] as const

/** Direction of the rotating beam window. */
export type ComposerBeamDirection = typeof COMPOSER_BEAM_DIRECTIONS[number]

/** Named visual profiles; none of these reads Conversation business state. */
export const COMPOSER_BEAM_MODES = ['legacy', 'lounge', 'aurora', 'reactive', 'custom'] as const

/** Visual profile applied to the running beam. */
export type ComposerBeamMode = typeof COMPOSER_BEAM_MODES[number]

/** Built-in palette identifiers exposed by the settings panel. */
export const COMPOSER_BEAM_PALETTES = [
  'legacy', 'warm', 'aurora', 'rose', 'glacier', 'cyber', 'sunset', 'cyan',
] as const

/** Built-in palette identifier. */
export type ComposerBeamPaletteId = typeof COMPOSER_BEAM_PALETTES[number]

/** Color stops used by the eight built-in beam palettes. */
export const COMPOSER_BEAM_PALETTE_COLORS: Readonly<Record<ComposerBeamPaletteId, readonly string[]>> = {
  legacy: ['#ff3264', '#288cff', '#32c850', '#1eb9aa', '#6446ff', '#ff7828', '#f032b4'],
  warm: ['#ff4d6d', '#ff8c42', '#ffd166', '#ef476f', '#ff4d6d'],
  aurora: ['#42e8c8', '#3f8cff', '#8a5cf6', '#e45bff', '#42e8c8'],
  rose: ['#ff4f81', '#ff79c6', '#c77dff', '#7b61ff', '#ff4f81'],
  glacier: ['#d9f7ff', '#6edff6', '#328bff', '#5b6dff', '#d9f7ff'],
  cyber: ['#00f0ff', '#00ff8f', '#b6ff00', '#ffed00', '#00f0ff'],
  sunset: ['#ff5f6d', '#ffc371', '#ff9a8b', '#ff6a88', '#ff5f6d'],
  cyan: ['#31d7ff', '#1eb9aa', '#64a8ff', '#31d7ff'],
}

/** Palette selected by a beam profile. */
export type ComposerBeamPalette =
  | { kind: 'preset'; id: ComposerBeamPaletteId }
  | { kind: 'custom'; colors: string[] }

/** Independent breathing animation controls. */
export interface ComposerBeamBreathing {
  enabled: boolean
  amplitude: number
  period: number
}

/** Independent hue-cycle animation controls. */
export interface ComposerBeamHueCycle {
  enabled: boolean
  range: number
  period: number
}

/** Local-clock night dimming controls. */
export interface ComposerBeamNight {
  enabled: boolean
  fromMinute: number
  toMinute: number
  dim: number
}

/** Easing choices used by the primary beam motion. */
export const COMPOSER_BEAM_EASINGS = ['linear', 'ease', 'ease-in-out', 'cubic-bezier'] as const

/** Persisted easing identifier. */
export type ComposerBeamEasing = typeof COMPOSER_BEAM_EASINGS[number]

/** User-tunable beam values; the shell, source geometry, and masks stay fixed in CSS. */
export interface ComposerBeamStyle {
  /** Rotation direction for the conic intensity window. */
  direction: ComposerBeamDirection
  /** Seconds for one complete rotation. */
  period: number
  /** Percent scale applied to stroke, inner light, and bloom. */
  intensity: number
  /** Additional percent scale applied only to bloom. */
  bloom: number
  /** Global hue offset in degrees. */
  hue: number
  /** Named visual / motion profile. */
  mode: ComposerBeamMode
  /** Built-in or custom color source shared by all beam layers. */
  palette: ComposerBeamPalette
  /** Stroke track width in CSS pixels. */
  trackWidth: number
  /** Bloom filter blur in CSS pixels. */
  glowBlur: number
  /** Optional opacity breathing profile. */
  breathing: ComposerBeamBreathing
  /** Optional hue-rotation profile. */
  hueCycle: ComposerBeamHueCycle
  /** Optional local-clock dimming window. */
  night: ComposerBeamNight
  /** Primary rotation / ping-pong easing. */
  easing: ComposerBeamEasing
}

export const MIN_COMPOSER_BEAM_PERIOD = 0.8
export const MAX_COMPOSER_BEAM_PERIOD = 60
export const MIN_COMPOSER_BEAM_INTENSITY = 40
export const MAX_COMPOSER_BEAM_INTENSITY = 140
export const MIN_COMPOSER_BEAM_BLOOM = 0
export const MAX_COMPOSER_BEAM_BLOOM = 160
export const MIN_COMPOSER_BEAM_HUE = -180
export const MAX_COMPOSER_BEAM_HUE = 180
export const MIN_COMPOSER_BEAM_TRACK_WIDTH = 0.5
export const MAX_COMPOSER_BEAM_TRACK_WIDTH = 4
export const MIN_COMPOSER_BEAM_GLOW_BLUR = 0
export const MAX_COMPOSER_BEAM_GLOW_BLUR = 12
export const MIN_COMPOSER_BEAM_BREATHING_AMPLITUDE = 0
export const MAX_COMPOSER_BEAM_BREATHING_AMPLITUDE = 0.8
export const MIN_COMPOSER_BEAM_BREATHING_PERIOD = 1
export const MAX_COMPOSER_BEAM_BREATHING_PERIOD = 20
export const MIN_COMPOSER_BEAM_HUE_CYCLE_RANGE = 0
export const MAX_COMPOSER_BEAM_HUE_CYCLE_RANGE = 360
export const MIN_COMPOSER_BEAM_HUE_CYCLE_PERIOD = 1
export const MAX_COMPOSER_BEAM_HUE_CYCLE_PERIOD = 60
export const MIN_COMPOSER_BEAM_NIGHT_MINUTE = 0
export const MAX_COMPOSER_BEAM_NIGHT_MINUTE = 1439
export const MIN_COMPOSER_BEAM_NIGHT_DIM = 0
export const MAX_COMPOSER_BEAM_NIGHT_DIM = 100
export const MIN_COMPOSER_BEAM_CUSTOM_COLORS = 2
export const MAX_COMPOSER_BEAM_CUSTOM_COLORS = 6
export const MAX_COMPOSER_BEAM_PRESETS = 5
export const MAX_COMPOSER_BEAM_PRESET_NAME_LENGTH = 32
export const MAX_COMPOSER_BEAM_JSON_BYTES = 64 * 1024

const DEFAULT_COMPOSER_BEAM_PALETTE: ComposerBeamPalette = Object.freeze({ kind: 'preset', id: 'legacy' })
const DEFAULT_COMPOSER_BEAM_BREATHING: ComposerBeamBreathing = Object.freeze({
  enabled: false,
  amplitude: 0.3,
  period: 6,
})
const DEFAULT_COMPOSER_BEAM_HUE_CYCLE: ComposerBeamHueCycle = Object.freeze({
  enabled: true,
  range: 30,
  period: 12,
})
const DEFAULT_COMPOSER_BEAM_NIGHT: ComposerBeamNight = Object.freeze({
  enabled: false,
  fromMinute: 1320,
  toMinute: 360,
  dim: 40,
})

/** Defaults reproduce the beam that shipped before customization. */
export const DEFAULT_COMPOSER_BEAM_STYLE: ComposerBeamStyle = Object.freeze({
  direction: 'clockwise',
  period: 1.96,
  intensity: 100,
  bloom: 100,
  hue: 0,
  mode: 'legacy',
  palette: DEFAULT_COMPOSER_BEAM_PALETTE,
  trackWidth: 2,
  glowBlur: 8,
  breathing: DEFAULT_COMPOSER_BEAM_BREATHING,
  hueCycle: DEFAULT_COMPOSER_BEAM_HUE_CYCLE,
  night: DEFAULT_COMPOSER_BEAM_NIGHT,
  easing: 'linear',
})

/** Empty by default so adding the feature does not materialize a new user entry. */
export const DEFAULT_COMPOSER_BEAM_PRESETS: ComposerBeamPresets = Object.freeze({})

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value)

const clampNumber = (value: unknown, fallback: number, min: number, max: number): number => {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback
  return Math.min(max, Math.max(min, value))
}

const isPaletteId = (value: unknown): value is ComposerBeamPaletteId =>
  typeof value === 'string' && COMPOSER_BEAM_PALETTES.includes(value as ComposerBeamPaletteId)

const isHexColor = (value: unknown): value is string =>
  typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value)

const normalizePalette = (value: unknown): ComposerBeamPalette => {
  if (!isRecord(value)) return { ...DEFAULT_COMPOSER_BEAM_PALETTE }
  if (value.kind === 'preset' && isPaletteId(value.id)) return { kind: 'preset', id: value.id }
  if (value.kind === 'custom' && Array.isArray(value.colors)) {
    const colors = value.colors.filter(isHexColor).map(color => color.toLowerCase())
    if (colors.length >= MIN_COMPOSER_BEAM_CUSTOM_COLORS && colors.length <= MAX_COMPOSER_BEAM_CUSTOM_COLORS) {
      return { kind: 'custom', colors }
    }
  }
  return { ...DEFAULT_COMPOSER_BEAM_PALETTE }
}

/** Normalize an active style at browser, preset, and settings adoption boundaries. */
export function normalizeComposerBeamStyle(value: unknown): ComposerBeamStyle {
  const raw = isRecord(value) ? value : {}
  const breathing = isRecord(raw.breathing) ? raw.breathing : {}
  const hueCycle = isRecord(raw.hueCycle) ? raw.hueCycle : {}
  const night = isRecord(raw.night) ? raw.night : {}
  return {
    direction: COMPOSER_BEAM_DIRECTIONS.includes(raw.direction as ComposerBeamDirection)
      ? raw.direction as ComposerBeamDirection
      : DEFAULT_COMPOSER_BEAM_STYLE.direction,
    period: clampNumber(raw.period, DEFAULT_COMPOSER_BEAM_STYLE.period, MIN_COMPOSER_BEAM_PERIOD, MAX_COMPOSER_BEAM_PERIOD),
    intensity: clampNumber(raw.intensity, DEFAULT_COMPOSER_BEAM_STYLE.intensity, MIN_COMPOSER_BEAM_INTENSITY, MAX_COMPOSER_BEAM_INTENSITY),
    bloom: clampNumber(raw.bloom, DEFAULT_COMPOSER_BEAM_STYLE.bloom, MIN_COMPOSER_BEAM_BLOOM, MAX_COMPOSER_BEAM_BLOOM),
    hue: clampNumber(raw.hue, DEFAULT_COMPOSER_BEAM_STYLE.hue, MIN_COMPOSER_BEAM_HUE, MAX_COMPOSER_BEAM_HUE),
    mode: COMPOSER_BEAM_MODES.includes(raw.mode as ComposerBeamMode)
      ? raw.mode as ComposerBeamMode
      : DEFAULT_COMPOSER_BEAM_STYLE.mode,
    palette: normalizePalette(raw.palette),
    trackWidth: clampNumber(
      raw.trackWidth,
      DEFAULT_COMPOSER_BEAM_STYLE.trackWidth,
      MIN_COMPOSER_BEAM_TRACK_WIDTH,
      MAX_COMPOSER_BEAM_TRACK_WIDTH,
    ),
    glowBlur: clampNumber(
      raw.glowBlur,
      DEFAULT_COMPOSER_BEAM_STYLE.glowBlur,
      MIN_COMPOSER_BEAM_GLOW_BLUR,
      MAX_COMPOSER_BEAM_GLOW_BLUR,
    ),
    breathing: {
      enabled: breathing.enabled === true,
      amplitude: clampNumber(
        breathing.amplitude,
        DEFAULT_COMPOSER_BEAM_STYLE.breathing.amplitude,
        MIN_COMPOSER_BEAM_BREATHING_AMPLITUDE,
        MAX_COMPOSER_BEAM_BREATHING_AMPLITUDE,
      ),
      period: clampNumber(
        breathing.period,
        DEFAULT_COMPOSER_BEAM_STYLE.breathing.period,
        MIN_COMPOSER_BEAM_BREATHING_PERIOD,
        MAX_COMPOSER_BEAM_BREATHING_PERIOD,
      ),
    },
    hueCycle: {
      enabled: hueCycle.enabled !== false,
      range: clampNumber(
        hueCycle.range,
        DEFAULT_COMPOSER_BEAM_STYLE.hueCycle.range,
        MIN_COMPOSER_BEAM_HUE_CYCLE_RANGE,
        MAX_COMPOSER_BEAM_HUE_CYCLE_RANGE,
      ),
      period: clampNumber(
        hueCycle.period,
        DEFAULT_COMPOSER_BEAM_STYLE.hueCycle.period,
        MIN_COMPOSER_BEAM_HUE_CYCLE_PERIOD,
        MAX_COMPOSER_BEAM_HUE_CYCLE_PERIOD,
      ),
    },
    night: {
      enabled: night.enabled === true,
      fromMinute: Math.round(clampNumber(
        night.fromMinute,
        DEFAULT_COMPOSER_BEAM_STYLE.night.fromMinute,
        MIN_COMPOSER_BEAM_NIGHT_MINUTE,
        MAX_COMPOSER_BEAM_NIGHT_MINUTE,
      )),
      toMinute: Math.round(clampNumber(
        night.toMinute,
        DEFAULT_COMPOSER_BEAM_STYLE.night.toMinute,
        MIN_COMPOSER_BEAM_NIGHT_MINUTE,
        MAX_COMPOSER_BEAM_NIGHT_MINUTE,
      )),
      dim: clampNumber(
        night.dim,
        DEFAULT_COMPOSER_BEAM_STYLE.night.dim,
        MIN_COMPOSER_BEAM_NIGHT_DIM,
        MAX_COMPOSER_BEAM_NIGHT_DIM,
      ),
    },
    easing: COMPOSER_BEAM_EASINGS.includes(raw.easing as ComposerBeamEasing)
      ? raw.easing as ComposerBeamEasing
      : DEFAULT_COMPOSER_BEAM_STYLE.easing,
  }
}

/** User presets are a bounded plain record of normalized active styles. */
export type ComposerBeamPresets = Record<string, ComposerBeamStyle>

/** Normalize preset names and cap the durable library at five entries. */
export function normalizeComposerBeamPresets(value: unknown): ComposerBeamPresets {
  if (!isRecord(value)) return {}
  const result: ComposerBeamPresets = {}
  for (const [rawName, rawStyle] of Object.entries(value)) {
    if (Object.keys(result).length >= MAX_COMPOSER_BEAM_PRESETS) break
    const name = rawName.trim().slice(0, MAX_COMPOSER_BEAM_PRESET_NAME_LENGTH)
    if (name === '' || name === '__proto__' || name === 'constructor' || name === 'prototype') continue
    Object.defineProperty(result, name, {
      configurable: true,
      enumerable: true,
      value: normalizeComposerBeamStyle(rawStyle),
      writable: true,
    })
  }
  return result
}

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
  /** Optional visual tuning for the same running beam. */
  composerBeamStyle?: ComposerBeamStyle
  /** Optional user-named visual presets for the same running beam. */
  composerBeamPresets?: ComposerBeamPresets
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

const ComposerBeamPaletteSchema = z.union([
  z.object({
    kind: z.union(['preset'] as const),
    id: z.union([...COMPOSER_BEAM_PALETTES]),
  }),
  z.object({
    kind: z.union(['custom'] as const),
    colors: z.array(z.string().pattern(/^#[0-9a-f]{6}$/i)).min(MIN_COMPOSER_BEAM_CUSTOM_COLORS).max(MAX_COMPOSER_BEAM_CUSTOM_COLORS),
  }),
])

const ComposerBeamStyleSchema: z<ComposerBeamStyle> = z.object({
  direction: z.union([...COMPOSER_BEAM_DIRECTIONS]).default(DEFAULT_COMPOSER_BEAM_STYLE.direction),
  period: z.number().min(MIN_COMPOSER_BEAM_PERIOD).max(MAX_COMPOSER_BEAM_PERIOD).default(DEFAULT_COMPOSER_BEAM_STYLE.period),
  intensity: z.number().min(MIN_COMPOSER_BEAM_INTENSITY).max(MAX_COMPOSER_BEAM_INTENSITY).default(DEFAULT_COMPOSER_BEAM_STYLE.intensity),
  bloom: z.number().min(MIN_COMPOSER_BEAM_BLOOM).max(MAX_COMPOSER_BEAM_BLOOM).default(DEFAULT_COMPOSER_BEAM_STYLE.bloom),
  hue: z.number().min(MIN_COMPOSER_BEAM_HUE).max(MAX_COMPOSER_BEAM_HUE).default(DEFAULT_COMPOSER_BEAM_STYLE.hue),
  mode: z.union([...COMPOSER_BEAM_MODES]).default(DEFAULT_COMPOSER_BEAM_STYLE.mode),
  palette: ComposerBeamPaletteSchema.default(DEFAULT_COMPOSER_BEAM_STYLE.palette),
  trackWidth: z.number()
    .min(MIN_COMPOSER_BEAM_TRACK_WIDTH)
    .max(MAX_COMPOSER_BEAM_TRACK_WIDTH)
    .default(DEFAULT_COMPOSER_BEAM_STYLE.trackWidth),
  glowBlur: z.number()
    .min(MIN_COMPOSER_BEAM_GLOW_BLUR)
    .max(MAX_COMPOSER_BEAM_GLOW_BLUR)
    .default(DEFAULT_COMPOSER_BEAM_STYLE.glowBlur),
  breathing: z.object({
    enabled: z.boolean().default(DEFAULT_COMPOSER_BEAM_STYLE.breathing.enabled),
    amplitude: z.number()
      .min(MIN_COMPOSER_BEAM_BREATHING_AMPLITUDE)
      .max(MAX_COMPOSER_BEAM_BREATHING_AMPLITUDE)
      .default(DEFAULT_COMPOSER_BEAM_STYLE.breathing.amplitude),
    period: z.number()
      .min(MIN_COMPOSER_BEAM_BREATHING_PERIOD)
      .max(MAX_COMPOSER_BEAM_BREATHING_PERIOD)
      .default(DEFAULT_COMPOSER_BEAM_STYLE.breathing.period),
  }).default(DEFAULT_COMPOSER_BEAM_STYLE.breathing),
  hueCycle: z.object({
    enabled: z.boolean().default(DEFAULT_COMPOSER_BEAM_STYLE.hueCycle.enabled),
    range: z.number()
      .min(MIN_COMPOSER_BEAM_HUE_CYCLE_RANGE)
      .max(MAX_COMPOSER_BEAM_HUE_CYCLE_RANGE)
      .default(DEFAULT_COMPOSER_BEAM_STYLE.hueCycle.range),
    period: z.number()
      .min(MIN_COMPOSER_BEAM_HUE_CYCLE_PERIOD)
      .max(MAX_COMPOSER_BEAM_HUE_CYCLE_PERIOD)
      .default(DEFAULT_COMPOSER_BEAM_STYLE.hueCycle.period),
  }).default(DEFAULT_COMPOSER_BEAM_STYLE.hueCycle),
  night: z.object({
    enabled: z.boolean().default(DEFAULT_COMPOSER_BEAM_STYLE.night.enabled),
    fromMinute: z.number()
      .min(MIN_COMPOSER_BEAM_NIGHT_MINUTE)
      .max(MAX_COMPOSER_BEAM_NIGHT_MINUTE)
      .default(DEFAULT_COMPOSER_BEAM_STYLE.night.fromMinute),
    toMinute: z.number()
      .min(MIN_COMPOSER_BEAM_NIGHT_MINUTE)
      .max(MAX_COMPOSER_BEAM_NIGHT_MINUTE)
      .default(DEFAULT_COMPOSER_BEAM_STYLE.night.toMinute),
    dim: z.number()
      .min(MIN_COMPOSER_BEAM_NIGHT_DIM)
      .max(MAX_COMPOSER_BEAM_NIGHT_DIM)
      .default(DEFAULT_COMPOSER_BEAM_STYLE.night.dim),
  }).default(DEFAULT_COMPOSER_BEAM_STYLE.night),
  easing: z.union([...COMPOSER_BEAM_EASINGS]).default(DEFAULT_COMPOSER_BEAM_STYLE.easing),
})

/** Durable conversation schema; also the wire envelope the browser scope validates against. */
export const ConversationSettingsSchema: z<ConversationSettings> = z.object({
  [BUSY_ENTER_FIELD]: z.union([...BUSY_ENTER_BEHAVIORS]).default(DEFAULT_BUSY_ENTER_BEHAVIOR),
  [COMPOSER_BEAM_FIELD]: z.boolean().default(DEFAULT_COMPOSER_BEAM),
  [COMPOSER_BEAM_STYLE_FIELD]: ComposerBeamStyleSchema.default(DEFAULT_COMPOSER_BEAM_STYLE),
  // The browser policy enforces the five-entry and name-length caps before
  // writes; schemastery validates each preset value here.
  [COMPOSER_BEAM_PRESETS_FIELD]: z.dict(ComposerBeamStyleSchema).required(false),
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
