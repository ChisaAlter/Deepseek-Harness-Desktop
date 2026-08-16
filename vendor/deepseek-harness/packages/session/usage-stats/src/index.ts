/**
 * Function plugin registering the `usageDaily` projection unit and the
 * `usageStats` summary service. Without the projection registry the fiber
 * stays pending and nothing registers.
 *
 * @module @deepseek-ai/dsh-usage-stats
 */

import type { Context } from '@deepseek-ai/cordis'
import { usageDailyProjectionDefinition } from './projection.ts'
import { UsageStats } from './service.ts'

export type * from './types.ts'
export { foldSummary, localDateKey, addCivilDays, enumerateDays } from './summarize.ts'
export { tokenTotal, usageDailyProjectionDefinition } from './projection.ts'
export { UsageStats } from './service.ts'

/** Cordis plugin name. */
export const name = 'usage-stats'
/** The projection registry is required; without it the fiber stays pending. */
export const inject = ['sessionProjections']

/**
 * Register the `usageDaily` unit and provide {@link UsageStats}.
 * @param ctx - registrant context carrying the projection registry.
 */
export function apply(ctx: Context): void {
  ctx.sessionProjections.register(usageDailyProjectionDefinition)
  ctx.plugin(UsageStats)
}
