// @vitest-environment jsdom
/** User-terminal owns the conversation drawer; the right panel is ui-sidebar-terminal. */
import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it, vi } from 'vitest'
import { SlotRegistry } from '@deepseek-ai/dsh-client-ui-renderer/client'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { apply, inject } from '../src/client/index.ts'
import type { TerminalShellInjected } from '../src/client/shell.ts'
import { TerminalDrawer } from '../src/client/TerminalDrawer.tsx'

function declare(slots: SlotRegistry): () => void {
  return slots.register({
    name: 'root',
    children: {
      'shell.terminalDrawer': { kind: 'single', scope: 'session-maybe' },
    },
  } as never, () => null)
}

async function bench() {
  const ctx = new Context()
  await ctx.plugin(SlotRegistry).await()
  const slots = ctx.get('slots') as SlotRegistry
  const declaration = declare(slots)
  const layout = { toggleTerminalDrawer: vi.fn(), setTerminalDrawer: vi.fn() }
  const sidebarRight = { openTabIn: vi.fn(() => true) }
  ctx.provide('layout', layout)
  ctx.provide('locale', new LocaleRuntime(ctx))
  ctx.provide('sidebarRight', sidebarRight)
  const fiber = ctx.plugin({ inject: [...inject], apply })
  await fiber.await()
  return { ctx, slots, declaration, fiber, layout, sidebarRight }
}

describe('ui-user-terminal apply', () => {
  it('declares only the services it uses', () => {
    expect(inject).toEqual(['slots', 'layout', 'locale'])
  })

  it('injects only the drawer, with no legacy surfaces occupant', async () => {
    const b = await bench()
    expect(b.slots.entries('shell.terminalDrawer')[0]?.component).toBe(TerminalDrawer)
    expect(b.slots.entries('surfaces.terminal')).toHaveLength(0)
    await b.fiber.dispose()
    expect(b.slots.entries('shell.terminalDrawer')).toHaveLength(0)
  })

  it('re-registers the drawer after the declaring slot collapses and returns', async () => {
    const b = await bench()
    b.declaration()
    expect(b.slots.entries('shell.terminalDrawer')).toHaveLength(0)
    const redeclare = declare(b.slots)
    await Promise.resolve()
    expect(b.slots.entries('shell.terminalDrawer')[0]?.component).toBe(TerminalDrawer)
    redeclare()
    await b.fiber.dispose()
  })

  it('routes a loopback URL to the originating Session Sidebar Browser', async () => {
    const b = await bench()
    const setDraft = vi.fn()
    b.ctx.provide('conversation', {
      input: { for: () => ({ setDraft, state: { getSnapshot: () => ({ draft: '' }) } }) },
    })
    b.ctx.provide('sessions', { scope: () => ({}), list: { getSnapshot: () => ({ byId: {} }) } })
    const openPath = vi.fn(async () => {})
    b.ctx.provide('workspaces', { openPath })
    const injected = (b.slots.entries('shell.terminalDrawer')[0]?.inject as unknown as (
      sessionId: string,
    ) => TerminalShellInjected)('sess')
    injected.mentionTerminal('sess', '\n')
    expect(setDraft).not.toHaveBeenCalled()
    injected.mentionTerminal('sess', 'ls\n')
    expect(setDraft).toHaveBeenCalledWith('```terminal\nls\n```')
    injected.openWorkspacePath('/tmp/proj/a.ts')
    expect(openPath).toHaveBeenCalledWith('/tmp/proj/a.ts')
    injected.openLocalUrl('http://127.0.0.1:5173')
    expect(b.sidebarRight.openTabIn).toHaveBeenCalledWith(
      'sess',
      'browser',
      { params: { url: 'http://127.0.0.1:5173' } },
    )
    const openExternal = vi.fn(async () => {})
    Object.defineProperty(window, 'shell', { configurable: true, value: { openExternal } })
    injected.openExternal('https://example.com/docs')
    expect(openExternal).toHaveBeenCalledWith('https://example.com/docs')
    Reflect.deleteProperty(window, 'shell')
    await injected.writeClipboard('copied')
    await b.fiber.dispose()
  })
})
