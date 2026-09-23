/** Host registration for browser conversation preferences. */
import type {} from '@deepseek-ai/dsh-settings'

import type { Volatile, Context } from '@deepseek-ai/cordis'
import type { BusyEnterBehavior } from './submission-settings.ts'
import z from '@deepseek-ai/schemastery'
import { BUSY_ENTER_FIELD } from './submission-settings.ts'

import { ConversationSettingsFields } from './submission-settings.ts'

export {
  BUSY_ENTER_BEHAVIORS, BUSY_ENTER_FIELD, COMPOSER_BEAM_DIRECTIONS, COMPOSER_BEAM_EASINGS,
  COMPOSER_BEAM_FIELD, COMPOSER_BEAM_MODES, COMPOSER_BEAM_PALETTE_COLORS, COMPOSER_BEAM_PALETTES,
  COMPOSER_BEAM_PRESETS_FIELD, COMPOSER_BEAM_STYLE_FIELD, COMPOSER_RESIZE_FIELD,
  COMPOSER_RESIZE_HEIGHT_FIELD, COMPOSER_RESIZE_WIDTH_FIELD,
  CONVERSATION_SETTINGS_NAMESPACE, CUSTOM_INSTRUCTIONS_FIELD, CUSTOM_INSTRUCTIONS_MAX_LENGTH,
  OFFICIAL_PEAK_VALLEY_FIELD, SESSION_COST_FIELD,
  SESSION_COST_PRICES_FIELD, STATS_LINE_FIELD, VIEW_TABS_FIELD,
  TYPING_FX_CURSORS, TYPING_FX_EFFECTS, TYPING_FX_FIELD, TYPING_FX_PRESETS_FIELD,
  TYPING_FX_STYLE_FIELD,
  DEFAULT_BUSY_ENTER_BEHAVIOR, DEFAULT_COMPOSER_BEAM, DEFAULT_COMPOSER_BEAM_PRESETS,
  DEFAULT_COMPOSER_BEAM_STYLE, DEFAULT_COMPOSER_RESIZE,
  DEFAULT_COMPOSER_RESIZE_HEIGHT, DEFAULT_COMPOSER_RESIZE_WIDTH,
  DEFAULT_CUSTOM_INSTRUCTIONS,
  DEFAULT_OFFICIAL_PEAK_VALLEY, DEFAULT_SESSION_COST, DEFAULT_SESSION_COST_PRICES,
  DEFAULT_STATS_LINE, DEFAULT_TYPING_FX, DEFAULT_TYPING_FX_PRESETS, DEFAULT_TYPING_FX_STYLE,
  DEFAULT_VIEW_TABS,
  type BusyEnterBehavior, type ComposerBeamDirection, type ComposerBeamEasing, type ComposerBeamMode,
  type ComposerBeamPalette, type ComposerBeamPaletteId, type ComposerBeamPresets, type ComposerBeamStyle,
  type ConversationSettings, type SessionCostModelPrice, type SessionCostPrices,
  type TypingFxColors, type TypingFxColorSchemeId, type TypingFxCursor, type TypingFxEffect,
  type TypingFxPresets, type TypingFxStyle,
} from './submission-settings.ts'

/** Runtime preferences projected to the browser. */
export interface Config {
  /** Enter key behavior while a turn is running. */
  busyEnter: Volatile<BusyEnterBehavior>
}

/** Live preferences projected to the browser. */
export const Config = z.object({
  [BUSY_ENTER_FIELD]: ConversationSettingsFields[BUSY_ENTER_FIELD].volatile(),
})

/** Host preferences are consumed through the configuration form projection.
 * @param ctx Plugin context used for optional settings presentation.
 */
export function apply(ctx: Context): void {
  ctx.inject(['settings'], (child) => { child.effect(() => child.settings.configure({ auto: false }, ctx.fiber)) })
}
