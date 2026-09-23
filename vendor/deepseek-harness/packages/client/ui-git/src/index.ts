/** Host loader entry for the browser-only git plugin. */

import type { Context, Volatile } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { DEFAULT_TITLEBAR_GIT, TITLEBAR_GIT_FIELD } from './git-settings.ts'
import type {} from '@deepseek-ai/dsh-settings'

export {
  DEFAULT_TITLEBAR_GIT, GIT_SETTINGS_NAMESPACE, TITLEBAR_GIT_FIELD,
  type GitSettings,
} from './git-settings.ts'

/**
 * Register the durable Git titlebar-visibility section when a settings provider exists.
 * @param ctx - Host context whose optional settings service owns the section.
 */
export interface Config {
  titlebarGit: Volatile<boolean>
}

export const Config = z.object({
  [TITLEBAR_GIT_FIELD]: z.boolean().default(DEFAULT_TITLEBAR_GIT).volatile(),
})

export function apply(ctx: Context): void {
  ctx.inject(['settings'], child => { child.effect(() => child.settings.configure({ auto: false }, ctx.fiber)) })
}
