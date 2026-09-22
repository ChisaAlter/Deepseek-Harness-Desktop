/** Host registration for browser conversation preferences. */

import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-settings'
import type {} from '@deepseek-ai/dsh-system-prompt'
import {
  CONVERSATION_SETTINGS_NAMESPACE, ConversationSettingsSchema, CUSTOM_INSTRUCTIONS_FIELD,
} from './submission-settings.ts'
import type { ConversationSettings } from './submission-settings.ts'

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

/** Prompt variable carrying the raw user text; substitution is never re-scanned for `{{...}}`. */
const CUSTOM_INSTRUCTIONS_VARIABLE = 'custom_instructions'

/** Section text emitted while custom instructions are configured. */
const CUSTOM_INSTRUCTIONS_PROMPT = `The user configured the following custom instructions; they apply to every task.\n{{${CUSTOM_INSTRUCTIONS_VARIABLE}}}`

/**
 * Register the durable conversation section when a settings provider exists.
 * @param ctx - Host context whose optional settings service owns the section.
 */
export function apply(ctx: Context): void {
  ctx.inject(['settings'], (settingsCtx) => {
    settingsCtx.settings.register(
      CONVERSATION_SETTINGS_NAMESPACE,
      ConversationSettingsSchema,
    )
  })
  // Separate injection: the durable section registers without a prompt
  // registry, and the prompt contribution appears only where one is composed.
  ctx.inject(['settings', 'systemPrompt'], (promptCtx) => {
    const instructions = (): string => {
      const section = promptCtx.settings.get(CONVERSATION_SETTINGS_NAMESPACE) as
        | ConversationSettings
        | undefined
      return section?.[CUSTOM_INSTRUCTIONS_FIELD] ?? ''
    }
    promptCtx.systemPrompt.variable(CUSTOM_INSTRUCTIONS_VARIABLE, instructions)
    promptCtx.systemPrompt.section({
      name: 'ui:custom-instructions',
      order: promptCtx.systemPrompt.getSectionOrder('USER_INSTRUCTIONS'),
      text: () => (instructions().trim() === '' ? '' : CUSTOM_INSTRUCTIONS_PROMPT),
    })
  })
}
