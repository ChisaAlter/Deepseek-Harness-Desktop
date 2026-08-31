/**
 * Skills settings section plugin, browser half.
 */

import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import { SkillsSection } from './SkillsSection.tsx'
import type { SkillsSectionInjected } from './SkillsSection.tsx'
import { en, zh, type SkillsSettingsKey } from './locales.ts'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import type {} from '@deepseek-ai/dsh-client-ui-workspace/client'
import type {} from '@deepseek-ai/dsh-api-workspace-controller/client'

export type { SkillsSectionInjected, SkillsSectionProps } from './SkillsSection.tsx'
export type { SkillsSettingsKey } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Skills settings copy. */
    'settings.skills': SkillsSettingsKey
  }
}

/** Dictionary namespace. */
export const NS = 'settings.skills'

/** Required services. */
export const inject = ['slots', 'locale', 'remote', 'remote.skillInventory', 'sessions', 'workspaces']

/**
 * Register the Skills settings section.
 * @param ctx - client root.
 */
export function apply(ctx: Context): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-settings-skills: dictionaries')
  const t = ctx.locale.bind(NS) as SkillsSectionInjected['t']
  const injected = (): SkillsSectionInjected => ({
    t,
    list: async scope => unwrap(await ctx.remote.skillInventory.list(scope), 'skillInventory.list'),
    get: async (name, scope) => unwrap(await ctx.remote.skillInventory.get({ name, ...scope }), 'skillInventory.get'),
    create: async (input) => {
      unwrap(await ctx.remote.skillInventory.create(input), 'skillInventory.create')
    },
    update: async (input) => { unwrap(await ctx.remote.skillInventory.update(input), 'skillInventory.update') },
    remove: async (name, scope) => { unwrap(await ctx.remote.skillInventory.delete({ name, ...scope }), 'skillInventory.delete') },
    setInvocation: async (name, modelInvocable, userInvocable, scope) => {
      unwrap(await ctx.remote.skillInventory.setInvocation({ name, modelInvocable, userInvocable, ...scope }), 'skillInventory.setInvocation')
    },
    openDirectory: directory => {
      const openPath = (ctx.workspaces as { openPath?: (path: string) => Promise<void> }).openPath
      if (openPath === undefined) {
        return Promise.reject(new Error('workspaces.openPath is not available on this pin'))
      }
      return openPath(directory)
    },
  })
  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section',
    id: 'skills',
    order: 16,
    label: () => t('nav'),
    locale: NS,
    inject: injected,
  }, SkillsSection))
}

function unwrap<T>(result: { ok: true; value: T } | { ok: false; error: { code: string; message: string } }, label: string): T {
  if (!result.ok) throw new Error(`${label} failed: ${result.error.code}: ${result.error.message}`)
  return result.value
}
