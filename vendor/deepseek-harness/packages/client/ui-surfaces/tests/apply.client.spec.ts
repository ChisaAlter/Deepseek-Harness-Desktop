// @vitest-environment jsdom
/** Surfaces plugin occupies the layout surfaces column and declares five children. */
import { Context } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SlotRegistry } from '@deepseek-ai/dsh-client-ui-renderer/client'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { apply, desktopListingAvailable, inject } from '../src/client/index.ts'
import type { SurfacesRootInjected } from '../src/client/SurfacesRoot.tsx'
import { SurfacesRoot } from '../src/client/SurfacesRoot.tsx'

function declare(slots: SlotRegistry): () => void {
  return slots.register({
    name: 'root',
    children: {
      surfaces: { kind: 'single', scope: 'session-maybe' },
    },
  } as never, () => null)
}

function sessionsStub(opts: { current?: string; cwd?: string } = {}) {
  const current = opts.current
  const cwd = opts.cwd ?? '/tmp/proj'
  return {
    list: {
      getSnapshot: () => ({
        current,
        byId: current === undefined ? {} : { [current]: { cwd } },
      }),
    },
  }
}

async function bench(opts: { current?: string; cwd?: string } = {}) {
  const ctx = new Context()
  await ctx.plugin(SlotRegistry).await()
  const slots = ctx.get('slots') as SlotRegistry
  const declaration = declare(slots)
  const layout = { openSurfaces: vi.fn() }
  const originalOpen = vi.fn(async (_path: string, _options?: { line?: number }) => {})
  const workspaces = { openPath: originalOpen }
  ctx.provide('layout', layout)
  ctx.provide('locale', new LocaleRuntime(ctx))
  ctx.provide('workspaces', workspaces)
  ctx.provide('sessions', sessionsStub(opts))
  const fiber = ctx.plugin({ inject: [...inject], apply })
  await fiber.await()
  return { ctx, slots, declaration, fiber, layout, workspaces, originalOpen }
}

function bindOpenFile(
  slots: SlotRegistry,
  openFile = vi.fn(),
): ReturnType<typeof vi.fn> {
  const entry = slots.entries('surfaces')[0]
  ;(entry?.inject as unknown as (
    sessionId: string,
    actions: { openFile: (sessionId: string, relativePath: string) => void },
  ) => SurfacesRootInjected)('sess-1', { openFile })
  return openFile
}

afterEach(() => {
  delete (window as Window & { shell?: unknown }).shell
})

describe('ui-surfaces apply', () => {
  it('declares only the services it uses', () => {
    expect(inject).toEqual(['slots', 'layout', 'locale', 'workspaces', 'sessions'])
  })

  it('occupies surfaces and declares six single session-maybe children', async () => {
    const b = await bench()
    const entry = b.slots.entries('surfaces')[0]
    expect(entry?.component).toBe(SurfacesRoot)
    expect(entry?.children).toEqual({
      'surfaces.browser': { kind: 'single', scope: 'session-maybe' },
      'surfaces.terminal': { kind: 'single', scope: 'session-maybe' },
      'surfaces.files': { kind: 'single', scope: 'session-maybe' },
      'surfaces.file': { kind: 'single', scope: 'session-maybe' },
      'surfaces.diff': { kind: 'single', scope: 'session-maybe' },
      'surfaces.agents': { kind: 'single', scope: 'session-maybe' },
    })
    const occupant = (): null => null
    const attached = b.slots.register({ name: 'surfaces.terminal' } as never, occupant)
    expect(b.slots.entries('surfaces.terminal')[0]?.component).toBe(occupant)
    attached()
    const injected = (entry?.inject as unknown as (
      sessionId: undefined,
      actions: { openFile: (sessionId: string, relativePath: string) => void } | undefined,
    ) => SurfacesRootInjected)(undefined, { openFile: vi.fn() })
    expect(injected.openSurfaces).toBeDefined()
    injected.openSurfaces()
    expect(b.layout.openSurfaces).toHaveBeenCalledOnce()
    await expect(injected.gitStatus('/tmp')).resolves.toBeNull()
    const unbound = (entry?.inject as unknown as (
      sessionId: undefined,
      actions: undefined,
    ) => SurfacesRootInjected)(undefined, undefined)
    expect(unbound.openSurfaces).toBeDefined()
    ;(window as Window & { shell?: { gitStatus: () => Promise<unknown>; previewOpen: () => Promise<unknown> } }).shell = {
      gitStatus: async () => ({ refName: 'main' }),
      previewOpen: async () => ({}),
    }
    const withShell = (entry?.inject as unknown as (
      sessionId: undefined,
      actions: { openFile: (sessionId: string, relativePath: string) => void },
    ) => SurfacesRootInjected)(undefined, { openFile: vi.fn() })
    expect(withShell.previewAvailable).toBe(true)
    await expect(withShell.gitStatus('/tmp')).resolves.toEqual({ refName: 'main' })
    await b.fiber.dispose()
    expect(b.slots.entries('surfaces')).toHaveLength(0)
  })

  it('re-registers after the declaring surfaces slot collapses and returns', async () => {
    const b = await bench()
    b.declaration()
    expect(b.slots.entries('surfaces')).toHaveLength(0)
    const redeclare = declare(b.slots)
    await Promise.resolve()
    expect(b.slots.entries('surfaces')[0]?.component).toBe(SurfacesRoot)
    expect(b.slots.entries('surfaces')[0]?.children?.['surfaces.terminal']).toEqual({
      kind: 'single', scope: 'session-maybe',
    })
    redeclare()
    await b.fiber.dispose()
  })

  it('restores workspaces.openPath on dispose', async () => {
    const b = await bench()
    const wrapped = b.workspaces.openPath
    await b.fiber.dispose()
    expect(b.workspaces.openPath).toBe(b.originalOpen)
    expect(wrapped).not.toBe(b.originalOpen)
  })

  it('reports desktop listing from window.shell.listDir', () => {
    expect(desktopListingAvailable()).toBe(false)
    ;(window as Window & { shell?: { listDir: () => Promise<unknown> } }).shell = {
      listDir: async () => ({ ok: true }),
    }
    expect(desktopListingAvailable()).toBe(true)
  })

  it('intercepts desktop openPath into surfaces', async () => {
    const b = await bench({ current: 'sess-1' })
    const openFile = bindOpenFile(b.slots)
    ;(window as Window & { shell?: { listDir: () => Promise<unknown> } }).shell = {
      listDir: async () => ({ ok: true }),
    }
    await b.workspaces.openPath('/tmp/proj/src/a.ts')
    expect(openFile).toHaveBeenCalledWith('sess-1', 'src/a.ts')
    expect(b.layout.openSurfaces).toHaveBeenCalledOnce()
    expect(b.originalOpen).not.toHaveBeenCalled()
    await b.fiber.dispose()
  })

  it('forwards openPath line into openFile revealLine', async () => {
    const b = await bench({ current: 'sess-1' })
    const openFile = bindOpenFile(b.slots)
    ;(window as Window & { shell?: { listDir: () => Promise<unknown> } }).shell = {
      listDir: async () => ({ ok: true }),
    }
    await b.workspaces.openPath('/tmp/proj/src/a.ts', { line: 10 })
    expect(openFile).toHaveBeenCalledWith('sess-1', 'src/a.ts', { revealLine: 10 })
    expect(b.originalOpen).not.toHaveBeenCalled()
    await b.fiber.dispose()
  })

  it('falls through when the path is outside cwd or listing is absent', async () => {
    const b = await bench({ current: 'sess-1' })
    const openFile = bindOpenFile(b.slots)
    await b.workspaces.openPath('/tmp/proj/a.ts')
    expect(openFile).not.toHaveBeenCalled()
    expect(b.originalOpen).toHaveBeenCalledWith('/tmp/proj/a.ts')

    b.originalOpen.mockClear()
    ;(window as Window & { shell?: { listDir: () => Promise<unknown> } }).shell = {
      listDir: async () => ({ ok: true }),
    }
    await b.workspaces.openPath('/tmp/other/a.ts')
    expect(openFile).not.toHaveBeenCalled()
    expect(b.originalOpen).toHaveBeenCalledWith('/tmp/other/a.ts')

    b.originalOpen.mockClear()
    await b.workspaces.openPath('/tmp/proj')
    expect(openFile).not.toHaveBeenCalled()
    expect(b.originalOpen).toHaveBeenCalledWith('/tmp/proj')
    await b.fiber.dispose()
  })

  it('falls through when the session has an empty cwd', async () => {
    const b = await bench({ current: 'sess-1', cwd: '' })
    bindOpenFile(b.slots)
    ;(window as Window & { shell?: { listDir: () => Promise<unknown> } }).shell = {
      listDir: async () => ({ ok: true }),
    }
    await b.workspaces.openPath('/tmp/proj/a.ts')
    expect(b.originalOpen).toHaveBeenCalledWith('/tmp/proj/a.ts')
    await b.fiber.dispose()
  })

  it('falls through when inject has not bound openFile yet', async () => {
    const b = await bench({ current: 'sess-1' })
    ;(window as Window & { shell?: { listDir: () => Promise<unknown> } }).shell = {
      listDir: async () => ({ ok: true }),
    }
    await b.workspaces.openPath('/tmp/proj/a.ts')
    expect(b.originalOpen).toHaveBeenCalledWith('/tmp/proj/a.ts')
    await b.fiber.dispose()
  })

  it('opens Browser for html after Files when previewWorkspaceFile succeeds', async () => {
    const b = await bench({ current: 'sess-1' })
    const openFile = bindOpenFile(b.slots)
    const previewWorkspaceFile = vi.fn(async () => ({
      ok: true as const, url: 'http://127.0.0.1:9/tok/site/index.html',
    }))
    const events: unknown[] = []
    const onOpen = (event: Event) => { events.push((event as CustomEvent).detail) }
    window.addEventListener('dshd-open-surface', onOpen)
    sessionStorage.clear()
    ;(window as Window & { shell?: unknown }).shell = {
      listDir: async () => ({ ok: true }),
      previewWorkspaceFile,
    }
    try {
      await b.workspaces.openPath('/tmp/proj/site/index.html')
      expect(openFile).toHaveBeenCalledWith('sess-1', 'site/index.html')
      expect(previewWorkspaceFile).toHaveBeenCalledWith({
        cwd: '/tmp/proj', relativePath: 'site/index.html',
      })
      expect(sessionStorage.getItem('dshd-pending-preview-url')).toBe(
        'http://127.0.0.1:9/tok/site/index.html',
      )
      expect(events).toEqual([{ kind: 'preview', url: 'http://127.0.0.1:9/tok/site/index.html' }])
    } finally {
      window.removeEventListener('dshd-open-surface', onOpen)
      await b.fiber.dispose()
    }
  })

  it('opens Browser for pdf after Files when previewWorkspaceFile succeeds', async () => {
    const b = await bench({ current: 'sess-1' })
    const openFile = bindOpenFile(b.slots)
    const previewWorkspaceFile = vi.fn(async () => ({
      ok: true as const, url: 'http://127.0.0.1:9/tok/doc.pdf',
    }))
    const events: unknown[] = []
    const onOpen = (event: Event) => { events.push((event as CustomEvent).detail) }
    window.addEventListener('dshd-open-surface', onOpen)
    sessionStorage.clear()
    ;(window as Window & { shell?: unknown }).shell = {
      listDir: async () => ({ ok: true }),
      previewWorkspaceFile,
    }
    try {
      await b.workspaces.openPath('/tmp/proj/doc.pdf')
      expect(openFile).toHaveBeenCalledWith('sess-1', 'doc.pdf')
      expect(previewWorkspaceFile).toHaveBeenCalledWith({
        cwd: '/tmp/proj', relativePath: 'doc.pdf',
      })
      expect(sessionStorage.getItem('dshd-pending-preview-url')).toBe(
        'http://127.0.0.1:9/tok/doc.pdf',
      )
      expect(events).toEqual([{ kind: 'preview', url: 'http://127.0.0.1:9/tok/doc.pdf' }])
    } finally {
      window.removeEventListener('dshd-open-surface', onOpen)
      await b.fiber.dispose()
    }
  })

  it('does not preview a non-browser file', async () => {
    const b = await bench({ current: 'sess-1' })
    const openFile = bindOpenFile(b.slots)
    const previewWorkspaceFile = vi.fn(async () => ({ ok: true as const, url: 'http://127.0.0.1:9/tok/a.ts' }))
    ;(window as Window & { shell?: unknown }).shell = {
      listDir: async () => ({ ok: true }),
      previewWorkspaceFile,
    }
    await b.workspaces.openPath('/tmp/proj/src/a.ts')
    expect(openFile).toHaveBeenCalledWith('sess-1', 'src/a.ts')
    await b.workspaces.openPath('/tmp/proj/LICENSE')
    expect(openFile).toHaveBeenCalledWith('sess-1', 'LICENSE')
    expect(previewWorkspaceFile).not.toHaveBeenCalled()
    await b.fiber.dispose()
  })

  it('keeps Files when previewWorkspaceFile is missing or refuses', async () => {
    const b = await bench({ current: 'sess-1' })
    const openFile = bindOpenFile(b.slots)
    ;(window as Window & { shell?: unknown }).shell = {
      listDir: async () => ({ ok: true }),
    }
    await expect(b.workspaces.openPath('/tmp/proj/index.html')).resolves.toBeUndefined()
    expect(openFile).toHaveBeenCalledWith('sess-1', 'index.html')
    expect(b.originalOpen).not.toHaveBeenCalled()

    const previewWorkspaceFile = vi.fn(async (): Promise<{ ok: true } | { ok: false; message: string }> => (
      { ok: false, message: 'nope' }
    ))
    ;(window as Window & { shell?: unknown }).shell = {
      listDir: async () => ({ ok: true }),
      previewWorkspaceFile,
    }
    const events: unknown[] = []
    const onOpen = (event: Event) => { events.push((event as CustomEvent).detail) }
    window.addEventListener('dshd-open-surface', onOpen)
    try {
      await b.workspaces.openPath('/tmp/proj/page.svg')
      expect(previewWorkspaceFile).toHaveBeenCalled()
      expect(events).toEqual([])
      expect(b.originalOpen).not.toHaveBeenCalled()

      previewWorkspaceFile.mockImplementation(async () => { throw new Error('ipc') })
      await expect(b.workspaces.openPath('/tmp/proj/index.htm')).resolves.toBeUndefined()
      expect(events).toEqual([])
      expect(b.originalOpen).not.toHaveBeenCalled()

      previewWorkspaceFile.mockImplementation(async () => ({ ok: true as const }))
      await b.workspaces.openPath('/tmp/proj/diagram.xhtml')
      expect(events).toEqual([])
      expect(openFile).toHaveBeenCalled()
    } finally {
      window.removeEventListener('dshd-open-surface', onOpen)
      await b.fiber.dispose()
    }
  })

  it('forwards onOpenPreviewUrl into the preview surface event', async () => {
    let listener: ((payload: { url?: string }) => void) | undefined
    ;(window as Window & { shell?: unknown }).shell = {
      listDir: async () => ({ ok: true }),
      onOpenPreviewUrl: (fn: (payload: { url?: string }) => void) => {
        listener = fn
        return () => { listener = undefined }
      },
    }
    const b = await bench({ current: 'sess-1' })
    const events: unknown[] = []
    const onOpen = (event: Event) => { events.push((event as CustomEvent).detail) }
    window.addEventListener('dshd-open-surface', onOpen)
    sessionStorage.clear()
    try {
      listener?.({ url: '' })
      listener?.({})
      expect(events).toEqual([])
      listener?.({ url: 'http://127.0.0.1:5173/' })
      expect(sessionStorage.getItem('dshd-pending-preview-url')).toBe('http://127.0.0.1:5173/')
      expect(events).toEqual([{ kind: 'preview', url: 'http://127.0.0.1:5173/' }])

      events.length = 0
      vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
        throw new Error('quota')
      })
      listener?.({ url: 'http://127.0.0.1:4173/' })
      expect(events).toEqual([{ kind: 'preview', url: 'http://127.0.0.1:4173/' }])
    } finally {
      vi.restoreAllMocks()
      window.removeEventListener('dshd-open-surface', onOpen)
      await b.fiber.dispose()
      expect(listener).toBeUndefined()
    }
  })
})
