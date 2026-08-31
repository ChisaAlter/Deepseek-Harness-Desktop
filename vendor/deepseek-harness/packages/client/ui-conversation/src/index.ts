/** Host registration for browser conversation preferences. */

import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-settings'
import { CONVERSATION_SETTINGS_NAMESPACE, ConversationSettingsSchema } from './submission-settings.ts'

export {
  BUSY_ENTER_BEHAVIORS, BUSY_ENTER_FIELD, COMPOSER_BEAM_FIELD, COMPOSER_RESIZE_FIELD,
  COMPOSER_RESIZE_HEIGHT_FIELD, COMPOSER_RESIZE_WIDTH_FIELD,
  CONVERSATION_SETTINGS_NAMESPACE, OFFICIAL_PEAK_VALLEY_FIELD, SESSION_COST_FIELD,
  SESSION_COST_PRICES_FIELD, STATS_LINE_FIELD, VIEW_TABS_FIELD,
  DEFAULT_BUSY_ENTER_BEHAVIOR, DEFAULT_COMPOSER_BEAM, DEFAULT_COMPOSER_RESIZE,
  DEFAULT_COMPOSER_RESIZE_HEIGHT, DEFAULT_COMPOSER_RESIZE_WIDTH,
  DEFAULT_OFFICIAL_PEAK_VALLEY, DEFAULT_SESSION_COST, DEFAULT_SESSION_COST_PRICES,
  DEFAULT_STATS_LINE, DEFAULT_VIEW_TABS,
  type BusyEnterBehavior, type ConversationSettings, type SessionCostModelPrice, type SessionCostPrices,
} from './submission-settings.ts'

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
}
