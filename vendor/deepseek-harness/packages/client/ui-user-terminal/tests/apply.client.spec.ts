// @vitest-environment jsdom
/** User-terminal plugin injects only the drawer; the right panel owns its own Terminal tab type. */
import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it, vi } from 'vitest'
import { SlotRegistry } from '@deepseek-ai/dsh-client-ui-renderer/client'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { apply, inject } from '../src/client/index.ts'
import type { TerminalShellInjected } from '../src/client/shell.ts'
import { en } from '../src/client/locales.ts'
import { TerminalDrawer } from '../src/client/TerminalDrawer.tsx'
import { bindPtyListeners } from '../src/client/pty-bridge.ts'

const SID = 'session-term'

function declare(slots: SlotRegistry): () => void {
  return slots.register({
    name: 'root',
    children: {
      'shell.terminalDrawer': { kind: 'single', scope: 'session-maybe' },
    },
  } as never, () => null)
}

async function bench(sidebarRightOverride?: { openTabIn: ReturnType<typeof vi.fn> } | null) {
  const ctx = new Context()
  await ctx.plugin(SlotRegistry).await()
  const slots = ctx.get('slots') as SlotRegistry
  const declaration = declare(slots)
  const layout = { toggleTerminalDrawer: vi.fn(), setTerminalDrawer: vi.fn() }
  const sidebarRight = sidebarRightOverride === undefined ? { openTabIn: vi.fn(() => true) } : sidebarRightOverride
  ctx.provide('layout', layout)
  ctx.provide('locale', new LocaleRuntime(ctx))
  if (sidebarRight !== null) ctx.provide('sidebarRight', sidebarRight)
  const fiber = ctx.plugin({ inject: [...inject], apply })
  await fiber.await()
  return { ctx, slots, declaration, fiber, layout, sidebarRight }
}

describe('ui-user-terminal apply', () => {
  it('declares only the services it uses', () => {
    expect(inject).toEqual(['slots', 'layout', 'locale'])
  })

  it('injects only the drawer and leaves surfaces.terminal unoccupied', async () => {
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
    expect(b.slots.entries('surfaces.terminal')).toHaveLength(0)
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
    injected.openWorkspacePath('/tmp/proj/src/a.ts', { line: 10 })
    expect(openPath).toHaveBeenCalledWith('/tmp/proj/src/a.ts', { line: 10 })
    injected.openLocalUrl('http://127.0.0.1:5173')
    expect(b.sidebarRight?.openTabIn).toHaveBeenCalledWith(
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

  it('opens a loopback URL as a Browser tab in the originating Session', async () => {
    const openTabIn = vi.fn(() => true)
    const b = await bench({ openTabIn })
    const injected = (b.slots.entries('shell.terminalDrawer')[0]?.inject as unknown as
      (sessionId: string) => TerminalShellInjected)(SID)
    injected.openLocalUrl('http://127.0.0.1:5173')
    expect(openTabIn).toHaveBeenCalledWith(SID, 'browser', { params: { url: 'http://127.0.0.1:5173' } })
    await b.fiber.dispose()
  })

  it('reports a refused Browser open without dispatching the legacy event', async () => {
    const openTabIn = vi.fn(() => false)
    const b = await bench({ openTabIn })
    const notify = vi.fn()
    b.ctx.provide('conversation', { input: { for: () => ({ notify }) } })
    b.ctx.provide('sessions', { scope: () => ({}) })
    const injected = (b.slots.entries('shell.terminalDrawer')[0]?.inject as unknown as
      (sessionId: string) => TerminalShellInjected)(SID)
    injected.openLocalUrl('http://127.0.0.1:5173')
    expect(openTabIn).toHaveBeenCalledWith(SID, 'browser', { params: { url: 'http://127.0.0.1:5173' } })
    expect(notify).toHaveBeenCalledWith('error', en['error.openLink'])
    await b.fiber.dispose()
  })

  it('keeps the drawer usable when the Sidebar plugin is absent', async () => {
    const b = await bench(null)
    const notify = vi.fn()
    b.ctx.provide('conversation', { input: { for: () => ({ notify }) } })
    b.ctx.provide('sessions', { scope: () => ({}) })
    const injected = (b.slots.entries('shell.terminalDrawer')[0]?.inject as unknown as
      (sessionId: string) => TerminalShellInjected)(SID)
    expect(() => { injected.openLocalUrl('http://127.0.0.1:5173') }).not.toThrow()
    expect(notify).toHaveBeenCalledWith('error', en['error.openLink'])
    await b.fiber.dispose()
  })

  it('does not route a URL when the drawer has no Session', async () => {
    const openTabIn = vi.fn(() => true)
    const b = await bench({ openTabIn })
    const injected = (b.slots.entries('shell.terminalDrawer')[0]?.inject as unknown as
      (sessionId: undefined) => TerminalShellInjected)(undefined)
    injected.openLocalUrl('http://127.0.0.1:5173')
    expect(openTabIn).not.toHaveBeenCalled()
    await b.fiber.dispose()
  })
})

describe('bindPtyListeners acknowledgement', () => {
  /** Minimal store handle that records what it was asked to store. */
  function store(owns: boolean) {
    return {
      buffered: [] as string[],
      dispatchData(_id: string, data: string, seq: number) {
        if (!owns) return 0
        this.buffered.push(data)
        return seq
      },
      dispatchExit() {},
    }
  }

  function ptyStub() {
    let dataHandler: ((payload: { id: string; data: string; seq: number }) => void) | null = null
    const acks: Array<[string, number]> = []
    return {
      acks,
      emitData(id: string, data: string, seq: number) {
        dataHandler?.({ id, data, seq })
      },
      pty: {
        onPtyData: (handler: (payload: { id: string; data: string; seq: number }) => void) => {
          dataHandler = handler
          return () => { dataHandler = null }
        },
        onPtyExit: () => () => {},
        ptyAck: async (id: string, seq: number) => { acks.push([id, seq]) },
      },
    }
  }

  it('acknowledges only after a store really stored the frame', async () => {
    const owner = store(true)
    const idle = store(false)
    const { pty, acks, emitData } = ptyStub()
    bindPtyListeners([owner, idle], pty)
    emitData('pty-1', 'hello', 3)
    // Nothing was acknowledged synchronously: the ack means "stored", not
    // "the IPC message arrived".
    expect(acks).toEqual([])
    await Promise.resolve()
    expect(owner.buffered).toEqual(['hello'])
    expect(acks).toEqual([['pty-1', 3]])
  })

  it('leaves a frame no store owns unacknowledged so the backend stays paused', async () => {
    const idle = store(false)
    const { pty, acks, emitData } = ptyStub()
    bindPtyListeners([idle], pty)
    emitData('pty-other', 'orphan', 5)
    await Promise.resolve()
    expect(idle.buffered).toEqual([])
    expect(acks).toEqual([])
  })

  it('coalesces a burst into the highest acknowledgement instead of one per frame', async () => {
    const owner = store(true)
    const { pty, acks, emitData } = ptyStub()
    bindPtyListeners([owner], pty)
    for (let seq = 1; seq <= 20; seq += 1) emitData('pty-1', 'x', seq)
    await Promise.resolve()
    expect(owner.buffered).toHaveLength(20)
    expect(acks).toEqual([['pty-1', 20]])
  })

  it('drops late acknowledgements after the listener pair is disposed', async () => {
    const owner = store(true)
    const { pty, acks, emitData } = ptyStub()
    const dispose = bindPtyListeners([owner], pty)
    emitData('pty-1', 'queued', 2)
    dispose()
    await Promise.resolve()
    expect(acks).toEqual([])
  })
})
