/**
 * Built-in plugins settings surface and the official plugin configuration
 * pages, browser half. The Settings section is the shell around the
 * feature-owned tabs registered into `settings.plugins.tab` (the read-only
 * inventory ships one); the configuration pages this package ships register
 * into the Plugins page's `plugins.item` slot, for the host-plane namespaces
 * the deployment exposes, and appear in the page's Official group. Each form
 * binds its namespace through the client settings scope, which keeps the
 * pages unaware of one another and of the section.
 */

// Type-only: pulls the locale plugin's Context merge (ctx.locale).
import type {} from '@deepseek-ai/dsh-client-locale/client'
// Type-only: the settings shell's SlotMap merge (the 'settings.section' entry)
// and the ctx.settingsScope Context merge. Cross-plugin collaboration goes
// through the service, never a value import (client bundle purity gate).
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
// Type-only: the Plugins page's SlotMap merge (the 'plugins.item' entry).
import type {} from '@deepseek-ai/dsh-client-ui-plugin-manager/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import { resolveSlotLabel } from '@deepseek-ai/dsh-client-ui-slots'
// Type-only: the ctx.remote Context merge and the forwarded-event key face.
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import { AgentLoopCard } from './AgentLoopCard.tsx'
import { BashCard } from './BashCard.tsx'
import { PluginsSettingsSection } from './PluginsSettingsSection.tsx'
import type { PluginsSettingsSectionInjected, PluginsSettingsTabEntry } from './PluginsSettingsSection.tsx'
import { SubagentCard } from './SubagentCard.tsx'
import { subagentCardFace } from './subagent-card-controller.ts'
import { SubagentLimitsCardController } from './subagent-limits-card-controller.ts'
import { WebSearchCard } from './WebSearchCard.tsx'
import { AGENT_LOOP_NS, AgentLoopCardController } from './agent-loop-card-controller.ts'
import { SHELL_NS, BashCardController } from './bash-card-controller.ts'
import {
  SUBAGENT_MODEL_SELECTION_NS, SubagentModelSelectionCardController,
} from './subagent-model-selection-card-controller.ts'
import { WEB_SEARCH_NS, WebSearchCardController } from './web-search-card-controller.ts'
import { en, zh } from './locales.ts'

export type { PluginsSettingsSectionInjected, PluginsSettingsSectionProps } from './PluginsSettingsSection.tsx'
export type { PluginConfigFormProps } from './PluginConfigForm.tsx'
export type { FieldProps } from './fields.tsx'
export type {
  CardActions, CardFieldSpec, CardFieldState, CardSecretSpec, CardShell,
} from './card-form.ts'
export type { AgentLoopCardFace, AgentLoopCardState } from './agent-loop-card-controller.ts'
export type { BashCardFace, BashCardState } from './bash-card-controller.ts'
export type { WebSearchCardFace, WebSearchCardState } from './web-search-card-controller.ts'

/** Dictionary namespace owned by this plugin. */
const NS = 'settings.plugins'

/** Required services (cordis fiber inject). */
export const inject = [
  'slots', 'locale', 'remote', 'remote.credentials', 'remote.session', 'settingsScope',
]

/**
 * Mount the built-in plugins section and the configuration pages this package ships.
 * @param ctx - the browser plugin context.
 */
export function apply(ctx: ClientContext): void {
  const t = ctx.locale.bind(NS)
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-settings-plugins: section dictionaries')

  const bash = new BashCardController(ctx.settingsScope.bind({ namespace: SHELL_NS }))
  const agentLoop = new AgentLoopCardController(ctx.settingsScope.bind({ namespace: AGENT_LOOP_NS }))
  const webSearch = new WebSearchCardController(
    ctx.settingsScope.bind({ namespace: WEB_SEARCH_NS }), ctx)
  const subagentLimits = new SubagentLimitsCardController(ctx.settingsScope.bind({ namespace: 'subagent' }))
  const subagentModelSelection = new SubagentModelSelectionCardController(
    ctx.settingsScope.bind({ namespace: SUBAGENT_MODEL_SELECTION_NS }),
    ctx,
  )
  const subagentLimitsFace = subagentLimits.inject()
  const subagentModelsFace = subagentModelSelection.inject()

  // The credential a page reports is not part of any settings section, so its
  // scope publishes nothing when one is written. This is the only signal that
  // a key written on another surface reached the Host.
  ctx.effect(
    () => ctx.remote.$on('credentials/reference-updated', (ref) => { webSearch.refreshCredential(ref) }),
    'ui-settings-plugins: credential invalidations',
  )
  ctx.effect(
    () => ctx.remote.$on('llm/adapters-updated', () => { subagentModelSelection.refreshCatalog() }),
    'ui-settings-plugins: subagent adapter invalidations',
  )
  ctx.effect(
    () => ctx.remote.$on('settings/document-updated', () => { subagentModelSelection.refreshCatalog() }),
    'ui-settings-plugins: subagent settings invalidations',
  )
  ctx.effect(
    () => ctx.on('connection/reset', () => { subagentModelSelection.resetConnection() }),
    'ui-settings-plugins: subagent connection generation',
  )
  ctx.effect(() => () => { subagentModelSelection.dispose() }, 'ui-settings-plugins: subagent preference')

  // Configuration pages register while the Host serves their namespaces.
  // A deployment without those plugins shows no trace of them. Card registration order is the page order, not the
  // Host's description order, which follows plugin activation and can change
  // between boots.
  const pages: ReadonlyArray<readonly [namespaces: readonly [string, ...string[]], register: () => () => void]> = [
    [[SHELL_NS], () => ctx.slots.inject('plugins.item', () => ctx.slots.register({
      name: 'plugins.item', id: 'bash', order: 10, label: () => t('bashTitle'), locale: NS, inject: () => bash.inject(),
    }, BashCard))],
    [[AGENT_LOOP_NS], () => ctx.slots.inject('plugins.item', () => ctx.slots.register({
      name: 'plugins.item', id: 'agent-loop', order: 20, label: () => t('agentLoopTitle'), locale: NS, inject: () => agentLoop.inject(),
    }, AgentLoopCard))],
    [['subagent', SUBAGENT_MODEL_SELECTION_NS], () => ctx.slots.inject('plugins.item', () => ctx.slots.register({
      name: 'plugins.item',
      id: 'subagent',
      order: 30,
      label: () => t('subagentTitle'),
      locale: NS,
      inject: () => subagentCardFace(subagentLimitsFace, subagentModelsFace),
    }, SubagentCard))],
    [[WEB_SEARCH_NS], () => ctx.slots.inject('plugins.item', () => ctx.slots.register({
      name: 'plugins.item', id: 'web-search', order: 40, label: () => t('webSearchTitle'), locale: NS, inject: () => webSearch.inject(),
    }, WebSearchCard))],
  ]
  // The shared SettingsScope mirror updates after document commits and reconnects.
  const describeFace = ctx.settingsScope.describe()
  ctx.effect(() => {
    const registered = new Map<string, () => void>()
    const sync = (): void => {
      const served = new Set(describeFace.getSnapshot().view?.namespaces.map(view => view.ns) ?? [])
      for (const [namespaces, register] of pages) {
        const namespace = namespaces[0]
        const available = namespaces.some(namespace => served.has(namespace))
        const off = registered.get(namespace)
        if (available && off === undefined) registered.set(namespace, register())
        else if (!available && off !== undefined) {
          off()
          registered.delete(namespace)
        }
      }
    }
    const unsubscribe = describeFace.subscribe(sync)
    void describeFace.ensure()
    sync()
    return () => {
      unsubscribe()
      for (const off of registered.values()) off()
      registered.clear()
    }
  }, 'ui-settings-plugins: configuration pages')

  let tabsVersion = -1
  let tabsRevision = -1
  let tabs: readonly PluginsSettingsTabEntry[] = []
  const sectionInjected = (): PluginsSettingsSectionInjected => ({
    hooks: {
      tabs: {
        getSnapshot: () => {
          const version = ctx.slots.getVersion('settings.plugins.tab')
          const revision = ctx.locale.getSnapshot().revision
          if (version !== tabsVersion || revision !== tabsRevision) {
            tabsVersion = version
            tabsRevision = revision
            tabs = ctx.slots.entries('settings.plugins.tab')
              .map(entry => ({
                /* v8 ignore next -- list-slot registration requires id */
                id: entry.options.id ?? '',
                order: entry.options.order ?? 0,
                label: resolveSlotLabel(entry.options.label) ?? '',
              }))
              .sort((a, b) => a.order - b.order)
          }
          return tabs
        },
        subscribe: (listener) => {
          const offLedger = ctx.slots.subscribe('settings.plugins.tab', listener)
          const offLocale = ctx.locale.subscribe(listener)
          return () => {
            offLedger()
            offLocale()
          }
        },
      },
    },
  })

  // This package owns the one Built-in plugins navigation entry and the tab
  // chrome; feature plugins contribute pages without competing for Settings nav rows.
  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section',
    id: 'plugins',
    order: 15,
    label: () => t('nav'),
    locale: NS,
    inject: sectionInjected,
    children: { 'settings.plugins.tab': { kind: 'list', scope: 'root' } },
  }, PluginsSettingsSection))
}
