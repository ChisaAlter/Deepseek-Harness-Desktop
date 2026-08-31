/** Host registration for the browser theme preference and pre-plugin palette. */

import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-host-webserver'
import { settingsNamespace } from '@deepseek-ai/dsh-settings'
import { bootThemeInjection, buildThemeBootPayload } from './boot-theme.ts'
import {
  THEME_SETTINGS_NAMESPACE, ThemeSettingsSchema, type ThemeSettings,
} from './theme-settings.ts'

export {
  DEFAULT_FONT_SIZE, DEFAULT_PREFERENCE, DEFAULT_THEME_SETTINGS, FONT_SIZE_FIELD, FONT_SIZE_MAX,
  FONT_SIZE_MIN, THEME_PREFERENCE_FIELD, THEME_PREFERENCES, THEME_SETTINGS_NAMESPACE,
  type ThemePreference, type ThemeSettings,
} from './theme-settings.ts'
export { bootThemeInjection, buildThemeBootPayload, injectBootTheme } from './boot-theme.ts'
export type { ThemeBootPayload } from './boot-theme.ts'

const THEME_NAMESPACE = settingsNamespace(THEME_SETTINGS_NAMESPACE)

/** Read the registered theme section, or undefined when no settings provider is composed. */
function readSection(ctx: Context): ThemeSettings | undefined {
  const settings = ctx.get('settings')
  if (settings === undefined) return undefined
  return settings.get(THEME_NAMESPACE) as ThemeSettings | undefined
}

/**
 * Register the durable theme section when the optional settings service is
 * composed, and answer every index injection collection with the current
 * theme bootstrap row.
 * @param ctx - Host context that may acquire the settings service.
 */
export function apply(ctx: Context): void {
  ctx.inject(['settings'], (settingsCtx) => {
    settingsCtx.settings.register(THEME_NAMESPACE, ThemeSettingsSchema)
  })
  ctx.on('webserver/index-inject', (table) => {
    table.push(bootThemeInjection(buildThemeBootPayload(readSection(ctx))))
  })
}
