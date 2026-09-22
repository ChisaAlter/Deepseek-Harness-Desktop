/** Host loader entry for the browser-only git plugin. */

import type { Context } from '@deepseek-ai/cordis'
import { GIT_SETTINGS_NAMESPACE, GitSettingsSchema } from './git-settings.ts'
import type {} from '@deepseek-ai/dsh-settings'

export {
  DEFAULT_TITLEBAR_GIT, GIT_SETTINGS_NAMESPACE, TITLEBAR_GIT_FIELD,
  type GitSettings,
} from './git-settings.ts'

/**
 * Register the durable Git titlebar-visibility section when a settings provider exists.
 * @param ctx - Host context whose optional settings service owns the section.
 */
export function apply(ctx: Context): void {
  ctx.inject(['settings'], (settingsCtx) => {
    settingsCtx.settings.register(
      GIT_SETTINGS_NAMESPACE,
      GitSettingsSchema,
    )
  })
}
