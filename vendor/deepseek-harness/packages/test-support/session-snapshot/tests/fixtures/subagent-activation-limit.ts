/** Hold child execution until the parent's capacity probe has been recorded. */
import type { Context } from '@deepseek-ai/cordis'

export const name = 'subagent-activation-limit'
export const inject = ['agents', 'settings', 'subagents']

/** Order parent admission and child completion without elapsed-time assumptions. */
export function apply(ctx: Context): void {
  const parentClosed = Promise.withResolvers<undefined>()
  ctx.effect(() => () => { parentClosed.resolve(undefined) })
  ctx.on('session/event', (session, event) => {
    if (session.header.parentSession === undefined && event.type === 'turn/end') parentClosed.resolve(undefined)
  })
  ctx.on('agent/pre-step', async ({ agent }, next) => {
    if (agent.session.header.parentSession !== undefined) await parentClosed.promise
    else await ctx.settings.update('subagent', { maxActiveSubagents: 1 })
    return next()
  })
}
