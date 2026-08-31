// @vitest-environment jsdom
/** User-terminal plugin injects the drawer and the ui-surfaces-declared surfaces.terminal slot. */
import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it, vi } from 'vitest'
import { SlotRegistry } from '@deepseek-ai/dsh-client-ui-renderer/client'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { apply, inject } from '../src/client/index.ts'
import type { TerminalShellInjected } from '../src/client/shell.ts'
import { OPEN_SURFACE_EVENT, PENDING_PREVIEW_URL_KEY } from '../src/client/links.ts'
import { TerminalDrawer } from '../src/client/TerminalDrawer.tsx'
import { TerminalSurface } from '../src/client/TerminalSurface.tsx'

function declare(slots: SlotRegistry): () => void {
  return slots.register({
    name: 'root',
    children: {
      'shell.terminalDrawer': { kind: 'single', scope: 'session-maybe' },
      'surfaces.terminal': { kind: 'single', scope: 'session-maybe' },
    },
  } as never, () => null)
}

async function bench() {
  const ctx = new Context()
  await ctx.plugin(SlotRegistry).await()
  const slots = ctx.get('slots') as SlotRegistry
  const declaration = declare(slots)
  const layout = { toggleTerminalDrawer: vi.fn(), setTerminalDrawer: vi.fn(), openSurfaces: vi.fn() }
  ctx.provide('layout', layout)
  ctx.provide('locale', new LocaleRuntime(ctx))
  const fiber = ctx.plugin({ inject: [...inject], apply })
  await fiber.await()
  return { ctx, slots, declaration, fiber, layout }
}

describe('ui-user-terminal apply', () => {
  it('declares only the services it uses', () => {
    expect(inject).toEqual(['slots', 'layout', 'locale'])
  })

  it('injects the drawer into shell.terminalDrawer and the surface into surfaces.terminal', async () => {
    const b = await bench()
    expect(b.slots.entries('shell.terminalDrawer')[0]?.component).toBe(TerminalDrawer)
    expect(b.slots.entries('surfaces.terminal')[0]?.component).toBe(TerminalSurface)
    expect(b.slots.entries('shell.terminalDrawer')[0]?.store)
      .not.toBe(b.slots.entries('surfaces.terminal')[0]?.store)
    await b.fiber.dispose()
    expect(b.slots.entries('shell.terminalDrawer')).toHaveLength(0)
    expect(b.slots.entries('surfaces.terminal')).toHaveLength(0)
  })

  it('re-registers after the declaring slots collapse and return', async () => {
    const b = await bench()
    b.declaration()
    expect(b.slots.entries('shell.terminalDrawer')).toHaveLength(0)
    expect(b.slots.entries('surfaces.terminal')).toHaveLength(0)
    const redeclare = declare(b.slots)
    await Promise.resolve()
    expect(b.slots.entries('shell.terminalDrawer')[0]?.component).toBe(TerminalDrawer)
    expect(b.slots.entries('surfaces.terminal')[0]?.component).toBe(TerminalSurface)
    redeclare()
    await b.fiber.dispose()
  })

  it('mentions a fenced selection and opens a preview URL', async () => {
    const b = await bench()
    const setDraft = vi.fn()
    b.ctx.provide('conversation', {
      input: { for: () => ({ setDraft, state: { getSnapshot: () => ({ draft: '' }) } }) },
    })
    b.ctx.provide('sessions', { scope: () => ({}) })
    const openPath = vi.fn(async () => {})
    b.ctx.provide('workspaces', { openPath })
    const injected = (b.slots.entries('shell.terminalDrawer')[0]?.inject as unknown as () => TerminalShellInjected)()
    injected.mentionTerminal('sess', '\n')
    expect(setDraft).not.toHaveBeenCalled()
    injected.mentionTerminal('sess', 'ls\n')
    expect(setDraft).toHaveBeenCalledWith('```terminal\nls\n```')
    injected.openWorkspacePath('/tmp/proj/a.ts')
    expect(openPath).toHaveBeenCalledWith('/tmp/proj/a.ts')
    injected.openWorkspacePath('/tmp/proj/src/a.ts', { line: 10 })
    expect(openPath).toHaveBeenCalledWith('/tmp/proj/src/a.ts', { line: 10 })
    const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('quota')
    })
    injected.openLocalUrl('http://127.0.0.1:3000')
    setItem.mockRestore()
    injected.openLocalUrl('http://127.0.0.1:5173')
    expect(sessionStorage.getItem(PENDING_PREVIEW_URL_KEY)).toBe('http://127.0.0.1:5173')
    expect(b.layout.openSurfaces).toHaveBeenCalledTimes(2)
    const openExternal = vi.fn(async () => {})
    Object.defineProperty(window, 'shell', { configurable: true, value: { openExternal } })
    injected.openExternal('https://example.com/docs')
    expect(openExternal).toHaveBeenCalledWith('https://example.com/docs')
    Reflect.deleteProperty(window, 'shell')
    window.dispatchEvent(new CustomEvent(OPEN_SURFACE_EVENT, { detail: { kind: 'preview' } }))
    await injected.writeClipboard('copied')
    await b.fiber.dispose()
  })
})
