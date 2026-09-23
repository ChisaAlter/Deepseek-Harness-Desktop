/**
 * The agents page type's registrations, and their removal when the plugin goes.
 *
 * The registry is real; the slot and locale services are recorders, because
 * what matters is the keyed body under the definition's id, the guide entry,
 * navigation, and that disposal leaves no registration behind.
 */
import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it, vi } from 'vitest'
import { SidebarRightTabRegistry } from '../../ui-sidebar-right/src/client/tab-registry.ts'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { SubagentAddress } from '@deepseek-ai/dsh-subagent/client'
import { AGENTS_ID, AGENTS_KIND, apply, inject } from '../src/client/index.ts'
import { AgentsPanel, type AgentsPanelInjected } from '../src/client/AgentsPanel.tsx'
import { en, zh } from '../src/client/locales.ts'

interface Recorded {
  name: string
  key: string
  locale: string
  inject: () => AgentsPanelInjected
  component: unknown
}

async function boot() {
  const ctx = new Context()
  const tabs = new SidebarRightTabRegistry(ctx)
  const injectedSlots: string[] = []
  const registered: Recorded[] = []
  const slots = {
    inject: vi.fn((name: string, register: () => () => void) => {
      injectedSlots.push(name)
      return register()
    }),
    register: vi.fn((options: Omit<Recorded, 'component'>, component: unknown) => {
      const entry = { ...options, component }
      registered.push(entry)
      return () => { registered.splice(registered.indexOf(entry), 1) }
    }),
  }
  const dictionaries = new Map<string, unknown>()
  const locale = {
    bind: vi.fn(() => (key: string) => key),
    register: vi.fn((ns: string, dicts: unknown) => {
      dictionaries.set(ns, dicts)
      return () => { dictionaries.delete(ns) }
    }),
  }
  const sessions = {
    subagentAddress: vi.fn((): SubagentAddress | undefined => undefined),
  }
  const jobsState = { rows: {}, observed: {} }
  const jobs = {
    state: { getSnapshot: () => jobsState, subscribe: () => () => {} },
    watchRows: vi.fn(() => () => {}),
  }
  const uiWorkspace = { openSession: vi.fn() }
  ctx.provide('sidebarRightTabs', tabs as never)
  ctx.provide('slots', slots as never)
  ctx.provide('locale', locale as never)
  ctx.provide('sessions', sessions as never)
  ctx.provide('jobs', jobs as never)
  ctx.provide('uiWorkspace', uiWorkspace as never)
  const fiber = ctx.plugin({ inject: [...inject], apply })
  await fiber.await()
  return { tabs, injectedSlots, registered, dictionaries, sessions, jobs, uiWorkspace, fiber }
}

describe('ui-agents-panel apply', () => {
  it('declares only the services it uses', () => {
    expect(inject).toEqual(['slots', 'locale', 'sessions', 'jobs', 'uiWorkspace', 'sidebarRightTabs'])
  })

  it('registers the type, guide, dictionaries, and keyed body under the definition id', async () => {
    const b = await boot()
    const definition = b.tabs.get(AGENTS_KIND)
    expect(definition?.id).toBe(AGENTS_ID)
    expect(definition?.priority).toBe('extension')
    expect(definition?.title('sidebar://agents')).toBe('type.label')
    expect(definition?.guide?.map(entry => [entry.order, entry.title(), entry.description?.()]))
      .toEqual([[40, 'guide.title', 'guide.description']])
    expect(b.dictionaries.get('agents')).toEqual({ zh, en })
    expect(b.registered.map(entry => [entry.name, entry.key, entry.locale, entry.component])).toEqual([
      ['sidebar.right.pane.tab', AGENTS_ID, 'agents', AgentsPanel],
    ])
    expect(b.injectedSlots).toEqual(['sidebar.right.pane.tab'])
    expect(b.injectedSlots.some(name => name.startsWith('surfaces.'))).toBe(false)
    expect(b.registered[0]?.inject().jobs).toBe(b.jobs.state)
    const release = b.registered[0]!.inject().watchJobs('parent' as SessionId)
    expect(b.jobs.watchRows).toHaveBeenCalledWith('parent')
    release()
  })

  it('opens a catalog child through workspace navigation with its address', async () => {
    const b = await boot()
    const injected = b.registered[0]!.inject()
    injected.openAgent('child-1' as SessionId)
    expect(b.uiWorkspace.openSession).toHaveBeenCalledWith('child-1')
    b.sessions.subagentAddress.mockReturnValueOnce({
      parentSessionId: 'parent' as SessionId,
      childSessionId: 'child-1' as SessionId,
      mode: 'continuable',
    })
    injected.openAgent('child-1' as SessionId)
    expect(b.uiWorkspace.openSession).toHaveBeenLastCalledWith({
      parentSessionId: 'parent', childSessionId: 'child-1', mode: 'continuable',
    })
    await b.fiber.dispose()
  })

  it('takes every registration back when the plugin is disposed', async () => {
    const b = await boot()
    await b.fiber.dispose()
    expect(b.tabs.get(AGENTS_KIND)).toBeUndefined()
    expect(b.registered).toEqual([])
    expect(b.dictionaries.size).toBe(0)
  })
})
