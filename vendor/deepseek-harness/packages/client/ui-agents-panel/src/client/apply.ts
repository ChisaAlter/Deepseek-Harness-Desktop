/** Registers the Agents page type in the right Sidebar. */
import type { Context } from '@deepseek-ai/cordis'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
import { AgentsPanel } from './AgentsPanel.tsx'
import type { AgentsPanelInjected } from './AgentsPanel.tsx'
import { en, NS, zh, type AgentsKey } from './locales.ts'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import type {} from '@deepseek-ai/dsh-client-ui-workspace/client'

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
export const inject = ['slots', 'locale', 'sessions', 'uiWorkspace', 'sidebarRightTabs']

/** The implementation identity, and the key its body registers under. */
export const AGENTS_ID = '@deepseek-ai/dsh-client-ui-agents-panel'

/** The page kind opened through the right Sidebar. */
export const AGENTS_KIND = 'agents'

/**
 * Register dictionaries and the Agents page type and body.
 * @param ctx - Client root context.
 */
export function apply(ctx: Context): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-agents-panel: dictionaries')
  const t = ctx.locale.bind(NS)

  ctx.effect(() => ctx.sidebarRightTabs.register({
    id: AGENTS_ID,
    kind: AGENTS_KIND,
    priority: 'extension',
    title: () => t('type.label'),
    guide: [{
      id: 'agents',
      order: 40,
      title: () => t('guide.title'),
      description: () => t('guide.description'),
    }],
  }), 'ui-agents-panel: page type')

  ctx.effect(() => ctx.slots.inject('sidebar.right.pane.tab', () => ctx.slots.register({
    name: 'sidebar.right.pane.tab',
    key: AGENTS_ID,
    locale: NS,
    inject: (): AgentsPanelInjected => ({
      openAgent: (id: SessionId) => {
        const address = ctx.sessions.subagentAddress(id)
        ctx.uiWorkspace.openSession(address ?? id)
      },
    }),
  }, AgentsPanel)), 'ui-agents-panel: page body')
}
