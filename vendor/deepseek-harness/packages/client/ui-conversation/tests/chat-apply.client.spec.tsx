// @vitest-environment jsdom
// apply wiring: the conversation service provided, the chat view registered
// as the first 'conversation.view' ring entry declaring the whole-Tool seat,
// the slot registrations land against a root entry's children declarations
// (the AppFrame role), and the shared store handle rides all strict session
// entries. Tool composition belongs to ui-tool and its machinery spec.

import { describe, expect, it, vi } from 'vitest'
import { SlotTestRuntime, usePinnedBrowserLanguages, stubSettingsScope } from '@deepseek-ai/dsh-client-test-runtime'
import { resolveSlotLabel } from '@deepseek-ai/dsh-client-ui-slots'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import type { SessionId } from '@deepseek-ai/dsh-client-runtime/client'
import { apply, inject } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { ApprovalComposerInjected } from '../src/client/contract/slots.ts'
import type { BeamRowInjected } from '../src/client/settings/BeamRow.tsx'
import type { ResizeRowInjected } from '../src/client/settings/ResizeRow.tsx'
import type { StatsLineRowInjected } from '../src/client/settings/StatsLineRow.tsx'
import type { ViewTabsRowInjected } from '../src/client/settings/ViewTabsRow.tsx'

// The service reads its initial locale from the browser; these specs assert
// the shipped Chinese copy, so they state the browser they assume.
usePinnedBrowserLanguages('zh-CN')

const ROOT = 'root-1' as SessionId
const CHILD = 'child-1' as SessionId

async function bench() {
  const runtime = await SlotTestRuntime.create()
  runtime.provide('connection', { api: { settings: {} }, isLoopback: false })
  // The plugin injects both; these specs exercise no settings path.
  runtime.provide('remote', { $on: () => () => {} })
  runtime.provide('settingsScope', { bind: () => stubSettingsScope().scope } as never)
  await runtime.sessions.add({ id: ROOT, summary: { title: 'R', displayTitle: 'R' } }, { current: false })
  await runtime.sessions.add(
    { id: CHILD, summary: { title: 'C', displayTitle: 'C', parentId: ROOT } }, { current: false })
  runtime.provide('layout', { openDetails: vi.fn(), closeDetails: vi.fn() })
  const locale = new LocaleRuntime(runtime.ctx)
  runtime.provide('locale', locale)
  runtime.slots.installLocale(locale)

  // Declared by ui-layout's root entry in production; the test root declares
  // them here so the contributions land.
  await runtime.root.declare({
    'conversation': { kind: 'single', scope: 'session-maybe' },
    'details': { kind: 'single', scope: 'session' },
    'settings.general.item': { kind: 'list', scope: 'root' },
    'settings.interface.item': { kind: 'list', scope: 'root' },
  }, (_p: { renderSlot?: unknown }) => null)

  const feature = await runtime.mount({ inject: [...inject], apply })
  return { runtime, feature, slots: runtime.slots }
}

/** First stored entry for a key (inject/store live directly on StoredEntry). */
function renderEntryOf(slots: Awaited<ReturnType<typeof bench>>['slots'], key: 'conversation' | 'conversation.session' | 'conversation.session.header' | 'conversation.view' | 'details') {
  return slots.entries(key)[0] as undefined | { inject?: unknown; store?: unknown }
}

describe('apply wiring', () => {
  it('provides the conversation service', async () => {
    const b = await bench()
    expect(b.runtime.ctx.get('conversation')).toBeDefined()
    await b.runtime.dispose()
  })

  it('registers the chat view and its keyed business-node seat', async () => {
    const b = await bench()
    const entries = b.slots.entries('conversation.view')
    expect(entries.map(e => e.options.id)).toEqual(['chat'])
    // Label is a locale thunk resolving through the zh dictionary.
    expect(resolveSlotLabel(entries[0]?.options.label)).toBe('对话')
    expect(entries[0]?.options.order).toBe(0)
    // Declaring is claiming: the chat entry's registration put the hole on
    // the ledger with the contract's kind/scope.
    const nodeSlot = b.slots.spec('conversation.chat.node')
    expect(nodeSlot).toMatchObject({ kind: 'keyed', scope: 'session' })
    expect(nodeSlot?.inject?.hooks?.turnData).toBeTypeOf('function')
    expect(b.slots.spec('conversation.chat.empty')).toEqual({ kind: 'list', scope: 'session' })
    await b.runtime.dispose()
  })

  it('declares the user-message action strip on the user node renderer only', async () => {
    const b = await bench()
    const entries = b.slots.entries('conversation.chat.node')
    const user = entries.find(entry => entry.options.key === 'user')
    const steering = entries.find(entry => entry.options.key === 'steering')
    expect(user).toBeDefined()
    expect(steering).toBeDefined()
    // Declaring is claiming: the user renderer's registration put the list
    // and single seats on the ledger (kind/scope) and authorized its own
    // renderSlot for them — the render site of a plugin's per-message user
    // actions and the inline-editor replacement.
    expect(b.slots.spec('conversation.chat.user-actions')).toEqual({ kind: 'list', scope: 'session' })
    expect(b.slots.spec('conversation.chat.user-editor')).toEqual({ kind: 'single', scope: 'session' })
    expect(user?.children?.['conversation.chat.user-actions']).toEqual({ kind: 'list', scope: 'session' })
    expect(user?.children?.['conversation.chat.user-editor']).toEqual({ kind: 'single', scope: 'session' })
    // Steering carries neither seat: no children declaration, so its renderer
    // receives no renderSlot seat and a plugin can never attach there.
    expect(steering?.children?.['conversation.chat.user-actions']).toBeUndefined()
    expect(steering?.children?.['conversation.chat.user-editor']).toBeUndefined()
    expect(steering?.children).toBeUndefined()
    await b.runtime.dispose()
  })

  it('occupies the slots + the ring; session entries share one store handle', async () => {
    const b = await bench()
    const conversation = renderEntryOf(b.slots, 'conversation')
    const conversationSession = renderEntryOf(b.slots, 'conversation.session')
    const conversationHeader = renderEntryOf(b.slots, 'conversation.session.header')
    const chatView = renderEntryOf(b.slots, 'conversation.view')
    const details = renderEntryOf(b.slots, 'details')
    expect(conversation?.inject).toBeTypeOf('function')
    expect(chatView?.inject).toBeTypeOf('function')
    expect(details?.inject).toBeTypeOf('function')
    // The shared handle: one apply-built store value on ALL session entries
    // (the session-maybe 'conversation' shell carries no store by design).
    expect(conversationSession?.store).toBeDefined()
    expect(conversationHeader?.store).toBe(conversationSession?.store)
    expect(details?.store).toBe(conversationSession?.store)
    expect(chatView?.store).toBe(conversationSession?.store)
    // The hero holes ride the conversation entry's children declaration (the
    // empty-state occupant is gone). Both are root-scoped: the new-session
    // screen precedes the session either would belong to.
    expect(b.slots.spec('conversation.hero.brand.mark')).toEqual({ kind: 'single', scope: 'root' })
    expect(b.slots.spec('conversation.hero.workspace')).toEqual({ kind: 'single', scope: 'root' })
    expect(b.slots.spec('conversation.hero.agentPreset')).toEqual({ kind: 'single', scope: 'root' })
    expect(b.slots.spec('conversation.session.header.lineage'))
      .toEqual({ kind: 'single', scope: 'session' })
    expect(b.slots.entries('settings.general.item').map(entry => entry.options.id)).toEqual(['composer-enter'])
    expect(b.slots.entries('settings.interface.item').map(entry => entry.options.id)).toEqual([
      'composer-beam', 'composer-resize', 'stats-line', 'view-tabs',
    ])
    const beam = b.slots.entries('settings.interface.item')[0]
    const beamInjected = (beam?.inject as unknown as () => BeamRowInjected)()
    expect(beamInjected.hooks.composerBeam.getSnapshot()).toBe(true)
    beamInjected.setComposerBeam(false)
    expect(beamInjected.hooks.composerBeam.getSnapshot()).toBe(false)
    const resize = b.slots.entries('settings.interface.item')[1]
    const resizeInjected = (resize?.inject as unknown as () => ResizeRowInjected)()
    expect(resizeInjected.hooks.composerResize.getSnapshot()).toBe(false)
    resizeInjected.setComposerResize(true)
    expect(resizeInjected.hooks.composerResize.getSnapshot()).toBe(true)
    const approval = b.slots.entries('conversation.composer')[0]
    const approvalInjected = (approval?.inject as unknown as () => ApprovalComposerInjected)()
    expect(approvalInjected.hooks.composerResize).toBe(resizeInjected.hooks.composerResize)
    const stats = b.slots.entries('settings.interface.item')[2]
    const statsInjected = (stats?.inject as unknown as () => StatsLineRowInjected)()
    expect(statsInjected.hooks.statsLine.getSnapshot()).toBe(true)
    statsInjected.setStatsLine(false)
    expect(statsInjected.hooks.statsLine.getSnapshot()).toBe(false)
    const tabs = b.slots.entries('settings.interface.item')[3]
    const tabsInjected = (tabs?.inject as unknown as () => ViewTabsRowInjected)()
    expect(tabsInjected.hooks.viewTabs.getSnapshot()).toBe(true)
    tabsInjected.setViewTabs(false)
    expect(tabsInjected.hooks.viewTabs.getSnapshot()).toBe(false)
    await b.runtime.dispose()
  })

  it('leaves per-Tool rows to the ui-tool plugin', async () => {
    const b = await bench()
    // The actual toolview declaration activates every registrant. The
    // file-mutation registrant claims both write and edit for the diff card; the
    // one search row registers under both grep and glob; the web rows register
    // one component under both web tool names.
    expect(b.slots.entries('conversation.chat.node').map(entry => entry.options.key)).not.toContain('tool-call')
    // Stats stick with the composer (not inside ChatView).
    expect(b.slots.entries('conversation.composer.dock').map(e => e.options.id)).toEqual(['stats'])
    await b.runtime.dispose()
  })

  it('plugin fiber disposal collects every registration (unload cascade, ring and hole included)', async () => {
    const b = await bench()
    await b.feature.dispose()
    expect(b.slots.entries('conversation')).toHaveLength(0)
    // The declared ring collapses with its declaring entry, and the chat
    // entry's keyed hole (with the sample's registration) collapses with it.
    expect(b.slots.entries('conversation.view')).toHaveLength(0)
    expect(b.slots.entries('conversation.chat.node')).toHaveLength(0)
    expect(b.slots.spec('conversation.chat.node')).toBeUndefined()
    expect(b.slots.entries('details')).toHaveLength(0)
    expect(b.slots.entries('settings.general.item')).toHaveLength(0)
    expect(b.slots.entries('settings.interface.item')).toHaveLength(0)
    expect(b.runtime.ctx.get('conversation')).toBeUndefined()
    await b.runtime.dispose()
  })
})
