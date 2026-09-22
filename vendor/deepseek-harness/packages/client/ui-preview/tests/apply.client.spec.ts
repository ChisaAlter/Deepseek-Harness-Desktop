// @vitest-environment jsdom
/** Preview plugin registers the Desktop Browser provider for the native right Sidebar. */
import { Context } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SlotRegistry } from '@deepseek-ai/dsh-client-ui-renderer/client'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { SidebarRightTabRegistry } from '../../ui-sidebar-right/src/client/tab-registry.ts'
import { apply, inject } from '../src/client/index.ts'
import { SidebarPreviewPanel, SidebarPreviewTitle } from '../src/client/PreviewPanel.tsx'
import { DshdMiniPlayer } from '../src/client/DshdMiniPlayer.tsx'

const PREVIEW_ID = '@deepseek-ai/dsh-client-ui-preview/browser'

function declare(slots: SlotRegistry): () => void {
  return slots.register({
    name: 'root',
    children: {
      'sidebar.right.pane.tab': { kind: 'keyed', scope: 'session', inject: { hooks: { tabInfo: () => () => ({}) } } },
      'sidebar.right.pane.tab.title': { kind: 'keyed', scope: 'session', inject: { hooks: { tabInfo: () => () => ({}) } } },
      'shell.overlay': { kind: 'list', scope: 'root' },
    },
  } as never, () => null)
}

function enableShell(onOpenPreviewUrl: (fn: (payload: { url?: string }) => void) => () => void = () => () => {}) {
  ;(window as Window & { shell?: unknown }).shell = {
    previewOpen: async () => ({ ok: true, id: 'p1' }),
    onOpenPreviewUrl,
  }
  return onOpenPreviewUrl
}

async function bench() {
  const ctx = new Context()
  await ctx.plugin(SlotRegistry).await()
  const slots = ctx.get('slots') as SlotRegistry
  const declaration = declare(slots)
  const tabs = new SidebarRightTabRegistry(ctx)
  const sidebarRight = { openTab: vi.fn() }
  ctx.provide('locale', new LocaleRuntime(ctx))
  ctx.provide('sidebarRightTabs', tabs)
  ctx.provide('sidebarRight', sidebarRight)
  const fiber = ctx.plugin({ inject: [...inject], apply })
  await fiber.await()
  return { ctx, slots, declaration, tabs, sidebarRight, fiber }
}

afterEach(() => {
  delete (window as Window & { shell?: unknown }).shell
})

describe('ui-preview apply', () => {
  it('declares only the services it uses', () => {
    expect(inject).toEqual(['slots', 'locale'])
  })

  it('registers nothing without the desktop preload capability', async () => {
    const b = await bench()
    expect(b.tabs.entries()).toHaveLength(0)
    expect(b.slots.entries('sidebar.right.pane.tab')).toHaveLength(0)
    expect(b.slots.entries('shell.overlay')).toHaveLength(0)
    await b.fiber.dispose()
  })

  it('registers the Desktop Browser extension, body, title, and mini-player', async () => {
    enableShell()
    const b = await bench()
    const definition = b.tabs.entries().find(entry => entry.id === PREVIEW_ID)
    expect(definition).toMatchObject({ kind: 'browser', priority: 'extension' })
    expect(definition?.guide?.[0]).toMatchObject({ id: 'new', order: 30 })
    expect(b.slots.entries('sidebar.right.pane.tab')[0]?.component).toBe(SidebarPreviewPanel)
    expect(b.slots.entries('sidebar.right.pane.tab.title')[0]?.component).toBe(SidebarPreviewTitle)
    expect(b.slots.entries('shell.overlay')[0]?.component).toBe(DshdMiniPlayer)
    await b.fiber.dispose()
    expect(b.tabs.entries()).toHaveLength(0)
    expect(b.slots.entries('sidebar.right.pane.tab')).toHaveLength(0)
    expect(b.slots.entries('shell.overlay')).toHaveLength(0)
  })

  it('opens main-process preview URLs in the bound Sidebar Browser', async () => {
    let listener: ((payload: { url?: string }) => void) | undefined
    enableShell((fn) => {
      listener = fn
      return () => { listener = undefined }
    })
    const b = await bench()
    listener?.({ url: 'http://127.0.0.1:5173/' })
    expect(b.sidebarRight.openTab).toHaveBeenCalledWith('browser', { params: { url: 'http://127.0.0.1:5173/' } })
    listener?.({})
    expect(b.sidebarRight.openTab).toHaveBeenCalledTimes(1)
    await b.fiber.dispose()
    expect(listener).toBeUndefined()
  })
})
