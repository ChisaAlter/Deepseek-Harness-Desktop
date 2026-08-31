/**
 * MCP settings section plugin, browser half.
 */

import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import { McpSection } from './McpSection.tsx'
import type { McpSectionInjected } from './McpSection.tsx'
import { en, zh, type McpSettingsKey } from './locales.ts'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'

export type { McpSectionInjected, McpSectionProps } from './McpSection.tsx'
export type { McpSettingsKey } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** MCP settings copy. */
    'settings.mcp': McpSettingsKey
  }
}

/** Dictionary namespace. */
export const NS = 'settings.mcp'

/** Required services. */
export const inject = ['slots', 'locale', 'remote', 'remote.mcpServers']

/**
 * Register the MCP settings section.
 * @param ctx - client root.
 */
export function apply(ctx: Context): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-settings-mcp: dictionaries')
  const t = ctx.locale.bind(NS) as McpSectionInjected['t']
  const injected = (): McpSectionInjected => ({
    t,
    list: async () => unwrap(await ctx.remote.mcpServers.list(), 'mcpServers.list'),
    upsert: async (spec) => { unwrap(await ctx.remote.mcpServers.upsert({ spec }), 'mcpServers.upsert') },
    remove: async (id) => { unwrap(await ctx.remote.mcpServers.delete({ id }), 'mcpServers.delete') },
    setEnabled: async (id, enabled) => {
      unwrap(await ctx.remote.mcpServers.setEnabled({ id, enabled }), 'mcpServers.setEnabled')
    },
    retry: async (id) => { unwrap(await ctx.remote.mcpServers.retry({ id }), 'mcpServers.retry') },
    authorize: async (id) => { unwrap(await ctx.remote.mcpServers.authorize({ id }), 'mcpServers.authorize') },
  })
  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section',
    id: 'mcp',
    order: 18,
    label: () => t('nav'),
    locale: NS,
    inject: injected,
  }, McpSection))
}

function unwrap<T>(result: { ok: true; value: T } | { ok: false; error: { code: string; message: string } }, label: string): T {
  if (!result.ok) throw new Error(`${label} failed: ${result.error.code}: ${result.error.message}`)
  return result.value
}
