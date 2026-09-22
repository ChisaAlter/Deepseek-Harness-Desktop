/** What the browser half registers, and that it all leaves with the fiber. */

import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it, onTestFinished, vi } from 'vitest'
import { resolveSlotLabel } from '@deepseek-ai/dsh-client-ui-slots'
import { SlotRegistry } from '@deepseek-ai/dsh-client-ui-renderer/client'
import { RemoteError, TestRemote } from '@deepseek-ai/dsh-client-test-runtime'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { apply as settingsApply, inject as settingsInject } from '@deepseek-ai/dsh-client-ui-settings/client'
import { apply, inject } from '@deepseek-ai/dsh-client-ui-settings-plugins/client'
import type { PluginsSettingsSectionInjected } from '@deepseek-ai/dsh-client-ui-settings-plugins/client'
import { SubagentModelSelectionCardController } from '../src/client/subagent-model-selection-card-controller.ts'
import { apply as hostApply } from '../src/index.ts'

// These specs assert the shipped Chinese copy. The lane has no jsdom `window`,
// so browser-language detection never runs and a fresh LocaleRuntime opens on
// FALLBACK_LOCALE (en); bench stages zh explicitly on the locale instead.

/**
 * @param served - namespaces the Host describes; omitted answers a failed read,
 * which is what most of these specs want (no card has anything to render).
 */
async function bench(served?: string[]) {
  const ctx = new Context()
  await ctx.plugin(SlotRegistry).await()
  const locale = new LocaleRuntime(ctx)
  locale.setLocale('zh')
  ctx.provide('locale', locale)
  const describeCredentials = vi.fn(() => Promise.resolve({
    ok: false, error: new RemoteError('gateway/internal', 'no provider', {}),
  }))
  const models = vi.fn(() => Promise.resolve({
    ok: true as const, value: { groups: [], failures: [] },
  }))
  const describeSettings = vi.fn(() => Promise.resolve(served === undefined
    ? { ok: false, error: new RemoteError('gateway/internal', 'no provider', {}) }
    : {
      ok: true,
      value: {
        writable: true,
        hasDocument: true,
        namespaces: served.map(ns => ({
          ns, schema: {}, value: {}, applies: 'live', secrets: [], revision: 0,
        })),
      },
    }))
  const remote = new TestRemote(ctx, {
    credentials: { describe: describeCredentials, set: vi.fn() },
    session: { modelCatalog: models },
    settings: { describe: describeSettings },
  })
  await ctx.plugin({ inject: [...settingsInject], apply: settingsApply }).await()
  return {
    ctx, slots: ctx.get('slots') as SlotRegistry, describeCredentials, describeSettings, models, remote,
  }
}

/** The Settings shell's section slot and the Plugins page's item slot, as the two owners declare them. */
function declareRoot(slots: SlotRegistry): () => void {
  return slots.register({
    name: 'root',
    children: {
      'settings.section': { kind: 'list', scope: 'root' },
      'plugins.item': { kind: 'list', scope: 'root' },
    },
  } as never, () => null)
}

describe('ui-settings-plugins apply', () => {
  it('keeps the host Loader entry inert', () => {
    expect(hostApply).not.toThrow()
  })

  it('declares the services it uses', () => {
    expect(inject).toEqual([
      'slots', 'locale', 'remote', 'remote.credentials', 'remote.session', 'settingsScope',
    ])
  })

  it('registers one Built-in plugins section and declares its tab slot, contributing no tab of its own', async () => {
    const { ctx, slots } = await bench()
    declareRoot(slots)

    await ctx.plugin({ inject: [...inject], apply }).await()

    const section = slots.entries('settings.section')[0]!
    expect(section.options).toMatchObject({ id: 'plugins', order: 15 })
    // The nav label is a locale-following thunk; owners resolve it at read time.
    expect(resolveSlotLabel(section.options.label)).toBe('内置插件')
    expect(slots.spec('settings.plugins.tab')).toMatchObject({ kind: 'list', scope: 'root' })
    expect(slots.entries('settings.plugins.tab')).toHaveLength(0)
  })

  it('injects a live tab projection and one business face per configuration page', async () => {
    const { ctx, slots } = await bench(['shell', 'agent-loop', 'subagent', 'subagent-model-selection', 'web-search-deepseek'])
    declareRoot(slots)
    await ctx.plugin({ inject: [...inject], apply }).await()

    const section = slots.entries('settings.section')[0]!
    const sectionFace = (section.inject as unknown as () => PluginsSettingsSectionInjected)()
    const initialTabs = sectionFace.hooks.tabs.getSnapshot()
    expect(initialTabs).toEqual([])
    expect(sectionFace.hooks.tabs.getSnapshot()).toBe(initialTabs)

    const listener = vi.fn()
    const unsubscribe = sectionFace.hooks.tabs.subscribe(listener)
    slots.register({ name: 'settings.plugins.tab', id: 'plain' } as never, () => null)
    slots.register({ name: 'settings.plugins.tab', id: 'first', order: -1 } as never, () => null)
    // Tabs follow their contribution's order, whatever order they registered in.
    expect(sectionFace.hooks.tabs.getSnapshot()).toEqual([
      { id: 'first', order: -1, label: '' },
      { id: 'plain', order: 0, label: '' },
    ])
    unsubscribe()

    await vi.waitFor(() => { expect(slots.entries('plugins.item')).toHaveLength(4) })
    for (const entry of slots.entries('plugins.item')) {
      const face = (entry as { inject?: () => unknown }).inject?.() as { hooks: Record<string, unknown> }
      expect(Object.keys(face.hooks)).toHaveLength(entry.options.id === 'subagent' ? 2 : 1)
    }
  })

  it('registers one configuration page per served namespace, in its own order, titled in the active locale', async () => {
    const { ctx, slots } = await bench(['web-search-deepseek', 'shell', 'agent-loop', 'subagent-model-selection'])
    declareRoot(slots)

    await ctx.plugin({ inject: [...inject], apply }).await()

    await vi.waitFor(() => { expect(slots.entries('plugins.item')).toHaveLength(4) })
    const entries = slots.entries('plugins.item')
    expect(entries.map(entry => entry.options.id)).toEqual(['bash', 'agent-loop', 'subagent', 'web-search'])
    expect(entries.map(entry => resolveSlotLabel(entry.options.label))).toEqual(['终端', 'Agent 循环', 'Subagent', '网页搜索'])
    expect(entries.every(entry => entry.locale === 'settings.plugins')).toBe(true)
  })

  it.each([
    ['subagent'],
    ['subagent-model-selection'],
    ['subagent', 'subagent-model-selection'],
  ])('keeps one Subagent page while either namespace is served: %j', async (...served) => {
    const { ctx, slots, describeSettings, remote } = await bench(served)
    onTestFinished(() => ctx.fiber.dispose())
    declareRoot(slots)
    await ctx.plugin({ inject: [...inject], apply }).await()
    await vi.waitFor(() => {
      expect(slots.entries('plugins.item').map(entry => entry.options.id)).toEqual(['subagent'])
    })
    const entry = slots.entries('plugins.item')[0]
    for (const namespaces of [['subagent-model-selection'], ['subagent'], []]) {
      describeSettings.mockResolvedValue({
        ok: true,
        value: {
          writable: true, hasDocument: true,
          namespaces: namespaces.map(ns => ({ ns, schema: {}, value: {}, applies: 'live', secrets: [], revision: 1 })),
        },
      })
      remote.emit('settings/document-updated', ['subagent', 1])
      await vi.waitFor(() => {
        expect(ctx.settingsScope.describe().getSnapshot().view?.namespaces.map(view => view.ns)).toEqual(namespaces)
        expect(slots.entries('plugins.item')).toEqual(namespaces.length > 0 ? [entry] : [])
      })
    }
  })

  it('registers the pages of the served namespaces only, and withdraws one the Host stops serving', async () => {
    // ui-theme is served but belongs to another surface, and a deployment
    // composing no PowerShell/POSIX executor serves no `bash` at all.
    const { ctx, slots, describeSettings, remote } = await bench(['agent-loop', 'ui-theme', 'web-search-deepseek'])
    declareRoot(slots)
    await ctx.plugin({ inject: [...inject], apply }).await()

    await vi.waitFor(() => {
      expect(slots.entries('plugins.item').map(entry => entry.options.id)).toEqual(['agent-loop', 'web-search'])
    })

    describeSettings.mockResolvedValue({
      ok: true,
      value: {
        writable: true,
        hasDocument: true,
        namespaces: [{ ns: 'agent-loop', schema: {}, value: {}, applies: 'live', secrets: [], revision: 1 }],
      },
    })
    remote.emit('settings/document-updated', ['web-search-deepseek', 1])

    await vi.waitFor(() => {
      expect(slots.entries('plugins.item').map(entry => entry.options.id)).toEqual(['agent-loop'])
    })
  })

  it('re-reads the served namespaces when the Host commits a settings document', async () => {
    // Which namespaces the Host serves is a registration fact the wire never
    // announces on its own, so the tab rides the invalidation that can
    // accompany a changed composition.
    const { ctx, slots, describeSettings, remote } = await bench(['bash'])
    declareRoot(slots)
    await ctx.plugin({ inject: [...inject], apply }).await()
    await vi.waitFor(() => { expect(describeSettings).toHaveBeenCalled() })
    describeSettings.mockClear()

    remote.emit('settings/document-updated', ['bash', 1])

    await vi.waitFor(() => { expect(describeSettings).toHaveBeenCalled() })
  })

  it('re-reads the served namespaces after a reconnect', async () => {
    const { ctx, slots, describeSettings } = await bench(['bash'])
    declareRoot(slots)
    await ctx.plugin({ inject: [...inject], apply }).await()
    await vi.waitFor(() => { expect(describeSettings).toHaveBeenCalled() })
    describeSettings.mockClear()

    ctx.emit('connection/reset')

    await vi.waitFor(() => { expect(describeSettings).toHaveBeenCalled() })
  })

  it('re-reads the credential when the Host reports the watched reference changed', async () => {
    const { ctx, slots, describeCredentials, remote } = await bench()
    declareRoot(slots)
    await ctx.plugin({ inject: [...inject], apply }).await()
    await vi.waitFor(() => { expect(describeCredentials).toHaveBeenCalled() })
    describeCredentials.mockClear()

    // A key written on another surface changes no settings section, so this
    // event is the only thing that reaches the card.
    remote.emit('credentials/reference-updated', ['DEEPSEEK_API_KEY'])

    await vi.waitFor(() => { expect(describeCredentials).toHaveBeenCalledTimes(1) })
  })

  it('refreshes the subagent catalog after model inputs change or the connection resets', async () => {
    const refresh = vi.spyOn(SubagentModelSelectionCardController.prototype, 'refreshCatalog')
    const reset = vi.spyOn(SubagentModelSelectionCardController.prototype, 'resetConnection')
    const { ctx, slots, remote } = await bench(['subagent-model-selection'])
    declareRoot(slots)
    await ctx.plugin({ inject: [...inject], apply }).await()
    refresh.mockClear()
    reset.mockClear()

    remote.emit('llm/adapters-updated', [])
    expect(refresh).toHaveBeenCalledTimes(1)
    remote.emit('settings/document-updated', ['llm-deepseek', 1])
    expect(refresh).toHaveBeenCalledTimes(2)
    ctx.emit('connection/reset')
    expect(reset).toHaveBeenCalledTimes(1)
  })

  it('ignores a credential change for a reference no card watches', async () => {
    const { ctx, slots, describeCredentials, remote } = await bench()
    declareRoot(slots)
    await ctx.plugin({ inject: [...inject], apply }).await()
    await vi.waitFor(() => { expect(describeCredentials).toHaveBeenCalled() })
    describeCredentials.mockClear()

    remote.emit('credentials/reference-updated', ['SOME_OTHER_KEY'])
    await Promise.resolve()

    expect(describeCredentials).not.toHaveBeenCalled()
  })

  it('registers into a declaration that arrives after apply', async () => {
    const { ctx, slots } = await bench()
    await ctx.plugin({ inject: [...inject], apply }).await()

    declareRoot(slots)

    await vi.waitFor(() => { expect(slots.entries('settings.section')).toHaveLength(1) })
  })

  it('collapses every contribution on teardown', async () => {
    const { ctx, slots } = await bench(['shell', 'agent-loop'])
    declareRoot(slots)
    const fiber = ctx.plugin({ inject: [...inject], apply })
    await fiber.await()
    await vi.waitFor(() => { expect(slots.entries('plugins.item')).toHaveLength(2) })

    await fiber.dispose()

    expect(slots.entries('settings.section')).toHaveLength(0)
    expect(slots.spec('settings.plugins.tab')).toBeUndefined()
    expect(slots.entries('plugins.item')).toHaveLength(0)
  })
})
