// @vitest-environment jsdom
/** Surfaces plugin occupies the layout surfaces column and declares five children. */
import { Context } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SlotRegistry } from '@deepseek-ai/dsh-client-ui-renderer/client'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { TestRemote } from '@deepseek-ai/dsh-client-test-runtime'
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

function sessionsStub(opts: { mainView?: string; cwd?: string; background?: { id: string; cwd: string } } = {}) {
  const cwd = opts.cwd ?? '/tmp/proj'
  return {
    list: {
      getSnapshot: () => {
        const mainView = opts.mainView
        return {
          byId: {
            ...(mainView === undefined ? {} : {
              [mainView]: {
                id: mainView,
                displayTitle: mainView,
                running: false,
                blank: false,
                updatedAt: 1,
                cwd,
                retainedBy: { mainView: 1 },
              },
            }),
            ...(opts.background === undefined ? {} : {
              [opts.background.id]: {
                id: opts.background.id,
                displayTitle: opts.background.id,
                running: true,
                blank: false,
                updatedAt: 2,
                cwd: opts.background.cwd,
                retainedBy: { gateway: 1 },
              },
            }),
          },
        }
      },
    },
  }
}

async function bench(
  opts: {
    mainView?: string
    cwd?: string
    background?: { id: string; cwd: string }
    sidebarRight?: {
      openResource: (address: string, options?: unknown) => void
      openResourceIn: (sessionId: string, address: string, options?: unknown) => boolean
      openTab: (kind: string, options?: unknown) => void
      openTabIn: (sessionId: string, kind: string, options?: unknown) => boolean
    }
  } = {},
) {
  const ctx = new Context()
  await ctx.plugin(SlotRegistry).await()
  const slots = ctx.get('slots') as SlotRegistry
  const declaration = declare(slots)
  const layout = { openSurfaces: vi.fn(), closeRightbar: vi.fn() }
  const originalOpen = vi.fn(async (_path: string, _options?: { line?: number; sessionId?: string }) => {})
  const hostOpenPath = vi.fn(async () => ({ ok: true as const, value: { opened: true as const } }))
  const workspaces = { openPath: originalOpen }
  ctx.provide('layout', layout)
  ctx.provide('locale', new LocaleRuntime(ctx))
  ctx.provide('workspaces', workspaces)
  ctx.provide('sessions', sessionsStub(opts))
  ctx.provide('uiSession', {} as never)
  if (opts.sidebarRight !== undefined) ctx.provide('sidebarRight', opts.sidebarRight as never)
  new TestRemote(ctx, { session: { openWorkspacePath: hostOpenPath } })
  const fiber = ctx.plugin({ inject: [...inject], apply })
  await fiber.await()
  return { ctx, slots, declaration, fiber, layout, workspaces, originalOpen, hostOpenPath }
}

function sidebarRightStub() {
  return {
    isExpanded: vi.fn(() => false),
    toggleExpanded: vi.fn(),
    openResource: vi.fn(),
    openResourceIn: vi.fn(() => true),
    openTab: vi.fn(),
    openTabIn: vi.fn(() => true),
  }
}

function bindOpenFile(
  slots: SlotRegistry,
  openFile = vi.fn(),
  open = vi.fn(),
): ReturnType<typeof vi.fn> {
  const entry = slots.entries('surfaces')[0]
  ;(entry?.inject as unknown as (
    sessionId: string,
    actions: {
      open: (sessionId: string, kind: 'files') => void
      openFile: (sessionId: string, relativePath: string) => void
    },
  ) => SurfacesRootInjected)('sess-1', { open, openFile })
  return openFile
}

afterEach(() => {
  delete (window as Window & { shell?: unknown }).shell
})

describe('ui-surfaces apply', () => {
  it('declares only the services it uses', () => {
    expect(inject).toEqual([
      'slots', 'layout', 'locale', 'workspaces', 'sessions', 'uiSession', 'remote', 'remote.session',
    ])
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
      actions: {
        open: (sessionId: string, kind: 'files') => void
        openFile: (sessionId: string, relativePath: string) => void
      } | undefined,
    ) => SurfacesRootInjected)(undefined, { open: vi.fn(), openFile: vi.fn() })
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
      actions: {
        open: (sessionId: string, kind: 'files') => void
        openFile: (sessionId: string, relativePath: string) => void
      },
    ) => SurfacesRootInjected)(undefined, { open: vi.fn(), openFile: vi.fn() })
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

  it('routes workspace paths through the main-view session and releases cleanly', async () => {
    const sessions: { mainView?: string; cwd: string; background: { id: string; cwd: string } } = {
      mainView: 'sess-main',
      cwd: '/tmp/main',
      background: { id: 'sess-background', cwd: '/tmp/proj' },
    }
    const b = await bench(sessions)
    const openFile = bindOpenFile(b.slots)
    ;(window as Window & { shell?: { listDir: () => Promise<unknown> } }).shell = {
      listDir: async () => ({ ok: true }),
    }

    await b.workspaces.openPath('/tmp/main/src/a.ts')
    expect(openFile).toHaveBeenCalledWith('sess-main', 'src/a.ts')
    expect(openFile).not.toHaveBeenCalledWith('sess-background', expect.any(String))

    delete sessions.mainView
    b.originalOpen.mockClear()
    await b.workspaces.openPath('/tmp/proj/background.ts')
    expect(b.originalOpen).toHaveBeenCalledWith('/tmp/proj/background.ts')
    expect(openFile).not.toHaveBeenCalledWith('sess-background', 'background.ts')
    await b.fiber.dispose()
  })

  it('intercepts desktop openPath into surfaces', async () => {
    const b = await bench({ mainView: 'sess-1' })
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

  it('routes a citation to its originating DSHD Session', async () => {
    const sidebarRight = sidebarRightStub()
    const b = await bench({
      mainView: 'sess-main',
      cwd: '/tmp/main',
      background: { id: 'sess-background', cwd: '/tmp/proj' },
      sidebarRight,
    })
    const openFile = bindOpenFile(b.slots)
    ;(window as Window & { shell?: unknown }).shell = { listDir: async () => ({ ok: true }) }

    await b.workspaces.openPath('/tmp/proj/src/a.ts', { sessionId: 'sess-background' })

    expect(openFile).toHaveBeenCalledWith('sess-background', 'src/a.ts')
    expect(sidebarRight.openResourceIn).not.toHaveBeenCalled()
    expect(b.layout.openSurfaces).toHaveBeenCalledOnce()
    expect(b.originalOpen).not.toHaveBeenCalled()
    await b.fiber.dispose()
  })

  it('keeps cwd-less absolute paths on the Host fallback', async () => {
    const sidebarRight = sidebarRightStub()
    const b = await bench({ mainView: 'sess-1', cwd: '', sidebarRight })
    const openFile = bindOpenFile(b.slots)
    ;(window as Window & { shell?: unknown }).shell = { listDir: async () => ({ ok: true }) }
    const path = 'C:\\Users\\tester\\AppData\\Roaming\\Deepseek-Harness-Desktop\\file.html'

    await b.workspaces.openPath(path)

    expect(openFile).not.toHaveBeenCalled()
    expect(sidebarRight.openResourceIn).not.toHaveBeenCalled()
    expect(b.originalOpen).toHaveBeenCalledWith(path)
    await b.fiber.dispose()
  })

  it('keeps delayed Browser preview owned by the originating Session', async () => {
    const sessions = {
      mainView: 'sess-first',
      cwd: '/tmp/first',
      background: { id: 'sess-origin', cwd: '/tmp/origin' },
    }
    const b = await bench(sessions)
    const openFile = bindOpenFile(b.slots)
    let finishToken: (value: { ok: true; url: string }) => void = () => {}
    const token = new Promise<{ ok: true; url: string }>((resolve) => { finishToken = resolve })
    let tokenStarted: () => void = () => {}
    const waitingForToken = new Promise<void>((resolve) => { tokenStarted = resolve })
    ;(window as Window & { shell?: unknown }).shell = {
      listDir: async () => ({ ok: true }),
      previewWorkspaceFile: async () => {
        tokenStarted()
        return token
      },
    }
    const events: unknown[] = []
    const onOpen = (event: Event): void => { events.push((event as CustomEvent).detail) }
    window.addEventListener('dshd-open-surface', onOpen)
    try {
      const opening = b.workspaces.openPath('/tmp/origin/site/index.html', {
        line: 7,
        sessionId: 'sess-origin',
      })
      await waitingForToken
      sessions.mainView = 'sess-second'
      finishToken({ ok: true, url: 'http://127.0.0.1:9/tok/index.html' })
      await opening

      expect(openFile).toHaveBeenCalledWith('sess-origin', 'site/index.html', { revealLine: 7 })
      expect(events).toEqual([{
        kind: 'preview',
        url: 'http://127.0.0.1:9/tok/index.html',
        sessionId: 'sess-origin',
      }])
      expect(b.originalOpen).not.toHaveBeenCalled()
    } finally {
      window.removeEventListener('dshd-open-surface', onOpen)
      await b.fiber.dispose()
    }
  })

  it('propagates a DSHD file viewer failure instead of opening externally', async () => {
    const b = await bench({ mainView: 'sess-1' })
    const openFile = vi.fn(() => { throw new Error('no file viewer') })
    bindOpenFile(b.slots, openFile)
    ;(window as Window & { shell?: unknown }).shell = { listDir: async () => ({ ok: true }) }

    await expect(b.workspaces.openPath('/tmp/proj/src/a.ts')).rejects.toThrow('no file viewer')

    expect(b.layout.openSurfaces).not.toHaveBeenCalled()
    expect(b.originalOpen).not.toHaveBeenCalled()
    await b.fiber.dispose()
  })
  it('forwards openPath line into openFile revealLine', async () => {
    const b = await bench({ mainView: 'sess-1' })
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
    const b = await bench({ mainView: 'sess-1' })
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

    await b.fiber.dispose()
  })

  it('opens the Files explorer for the workspace root', async () => {
    const b = await bench({ mainView: 'sess-1' })
    const open = vi.fn()
    const openFile = bindOpenFile(b.slots, vi.fn(), open)
    ;(window as Window & { shell?: { listDir: () => Promise<unknown> } }).shell = {
      listDir: async () => ({ ok: true }),
    }

    await b.workspaces.openPath('/tmp/proj/.')
    expect(open).toHaveBeenCalledWith('sess-1', 'files')
    expect(openFile).not.toHaveBeenCalled()
    expect(b.originalOpen).not.toHaveBeenCalled()
    await b.fiber.dispose()
  })

  it('falls through when the session has an empty cwd', async () => {
    const b = await bench({ mainView: 'sess-1', cwd: '' })
    bindOpenFile(b.slots)
    ;(window as Window & { shell?: { listDir: () => Promise<unknown> } }).shell = {
      listDir: async () => ({ ok: true }),
    }
    await b.workspaces.openPath('/tmp/proj/a.ts')
    expect(b.originalOpen).toHaveBeenCalledWith('/tmp/proj/a.ts')
    await b.fiber.dispose()
  })

  it('throws when no Files surface is available instead of reaching the Host opener', async () => {
    const b = await bench({ mainView: 'sess-1' })
    ;(window as Window & { shell?: { listDir: () => Promise<unknown> } }).shell = {
      listDir: async () => ({ ok: true }),
    }
    await expect(b.workspaces.openPath('/tmp/proj/a.ts')).rejects.toThrow(
      'surfaces: file preview is unavailable',
    )
    expect(b.originalOpen).not.toHaveBeenCalled()
    await b.fiber.dispose()
  })

  it('opens Browser for html after Files when previewWorkspaceFile succeeds', async () => {
    const b = await bench({ mainView: 'sess-1' })
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
      expect(events).toEqual([{ kind: 'preview', url: 'http://127.0.0.1:9/tok/site/index.html', sessionId: 'sess-1' }])
    } finally {
      window.removeEventListener('dshd-open-surface', onOpen)
      await b.fiber.dispose()
    }
  })

  it('opens Browser for pdf after Files when previewWorkspaceFile succeeds', async () => {
    const b = await bench({ mainView: 'sess-1' })
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
      expect(events).toEqual([{ kind: 'preview', url: 'http://127.0.0.1:9/tok/doc.pdf', sessionId: 'sess-1' }])
    } finally {
      window.removeEventListener('dshd-open-surface', onOpen)
      await b.fiber.dispose()
    }
  })

  it('keeps text, extensionless files, and SVG in Files', async () => {
    const b = await bench({ mainView: 'sess-1' })
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
    await b.workspaces.openPath('/tmp/proj/page.svg')
    expect(openFile).toHaveBeenCalledWith('sess-1', 'page.svg')
    expect(previewWorkspaceFile).not.toHaveBeenCalled()
    await b.fiber.dispose()
  })

  it('keeps Files when previewWorkspaceFile is missing or refuses', async () => {
    const b = await bench({ mainView: 'sess-1' })
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
    const b = await bench({ mainView: 'sess-1' })
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
