/** Host loader entry for the browser-only titlebar plugin. */

import type { Context, Volatile } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { DEFAULT_PANEL_TOGGLE, TERMINAL_TOGGLE_FIELD, SURFACES_TOGGLE_FIELD } from './titlebar-settings.ts'
import type {} from '@deepseek-ai/dsh-settings'

export {
  DEFAULT_PANEL_TOGGLE, SURFACES_TOGGLE_FIELD, TERMINAL_TOGGLE_FIELD, TITLEBAR_SETTINGS_NAMESPACE,
  type TitlebarSettings,
} from './titlebar-settings.ts'

/**
 * Register the durable panel-toggle visibility section when a settings provider exists.
 * @param ctx - Host context whose optional settings service owns the section.
 */
export interface Config {
  terminalToggle: Volatile<boolean>
  surfacesToggle: Volatile<boolean>
}

export const Config = z.object({
  [TERMINAL_TOGGLE_FIELD]: z.boolean().default(DEFAULT_PANEL_TOGGLE).volatile(),
  [SURFACES_TOGGLE_FIELD]: z.boolean().default(DEFAULT_PANEL_TOGGLE).volatile(),
})

export function apply(ctx: Context): void {
  ctx.inject(['settings'], child => { child.effect(() => child.settings.configure({ auto: false }, ctx.fiber)) })
}
