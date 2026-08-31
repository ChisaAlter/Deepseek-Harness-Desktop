/** Registers the Agents occupant into surfaces.agents. */
import type { Context } from '@deepseek-ai/cordis'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-surfaces/client'
import { AgentsPanel } from './AgentsPanel.tsx'
import type { AgentsPanelInjected } from './AgentsPanel.tsx'
import { en, NS, zh, type AgentsKey } from './locales.ts'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'

export type { AgentsPanelProps, AgentsPanelInjected } from './AgentsPanel.tsx'
export type { AgentRow } from './agents.ts'
export type { AgentsKey } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Agents surface copy. */
    agents: AgentsKey
  }
}

/** Services required by the agents-panel plugin. */
export const inject = ['slots', 'locale', 'sessions']

/**
 * Register dictionaries and inject the Agents occupant.
 * @param ctx - Client root context.
 */
export function apply(ctx: Context): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-agents-panel: dictionaries')

  ctx.slots.inject('surfaces.agents', () => ctx.slots.register({
    name: 'surfaces.agents',
    locale: NS,
    inject: (): AgentsPanelInjected => ({
      openAgent: (id: SessionId) => {
        const address = ctx.sessions.subagentAddress(id)
        if (address !== undefined) ctx.sessions.openSubagent(address)
        else ctx.sessions.open(id)
      },
    }),
  }, AgentsPanel))
}
