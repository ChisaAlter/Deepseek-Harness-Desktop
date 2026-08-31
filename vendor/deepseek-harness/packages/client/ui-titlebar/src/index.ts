/** Host loader entry for the browser-only titlebar plugin. */

import type { Context } from '@deepseek-ai/cordis'
import { TITLEBAR_SETTINGS_NAMESPACE, TitlebarSettingsSchema } from './titlebar-settings.ts'
import type {} from '@deepseek-ai/dsh-settings'

export {
  DEFAULT_PANEL_TOGGLE, SURFACES_TOGGLE_FIELD, TERMINAL_TOGGLE_FIELD, TITLEBAR_SETTINGS_NAMESPACE,
  type TitlebarSettings,
} from './titlebar-settings.ts'

/**
 * Register the durable panel-toggle visibility section when a settings provider exists.
 * @param ctx - Host context whose optional settings service owns the section.
 */
export function apply(ctx: Context): void {
  ctx.inject(['settings'], (settingsCtx) => {
    settingsCtx.settings.register(
      TITLEBAR_SETTINGS_NAMESPACE,
      TitlebarSettingsSchema,
    )
  })
}
