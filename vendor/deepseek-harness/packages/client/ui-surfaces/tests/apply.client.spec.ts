// @vitest-environment jsdom
/** Surfaces plugin routes desktop file opens into the native right Sidebar. */
import { Context } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SlotRegistry } from '@deepseek-ai/dsh-client-ui-renderer/client'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { TestRemote } from '@deepseek-ai/dsh-client-test-runtime'
import { apply, desktopListingAvailable, inject } from '../src/client/index.ts'

function sessionsStub(opts: {
  mainView?: string
  cwd?: string
  background?: { id: string; cwd: string }
} = {}) {
  const cwd = opts.cwd ?? '/tmp/proj'
  return {
    list: {
      getSnapshot: () => ({
        byId: {
          ...(opts.mainView === undefined ? {} : {
            [opts.mainView]: {
              id: opts.mainView,
              displayTitle: opts.mainView,
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
      }),
    },
  }
}

function sidebarRightStub() {
  return {
    openResource: vi.fn(),
    openResourceIn: vi.fn(() => true),
    openTab: vi.fn(),
    openTabIn: vi.fn(() => true),
  }
}

async function bench(
  opts: {
    mainView?: string
    cwd?: string
    background?: { id: string; cwd: string }
    sidebarRight?: ReturnType<typeof sidebarRightStub>
  } = {},
) {
  const ctx = new Context()
  await ctx.plugin(SlotRegistry).await()
  const slots = ctx.get('slots') as SlotRegistry
  slots.register({ name: 'root', children: {} } as never, () => null)
  const layout = { closeSurfaces: vi.fn() }
  const originalOpen = vi.fn(async (_path: string, _options?: { line?: number; sessionId?: string }) => {})
  const workspaces = { openPath: originalOpen }
  ctx.provide('layout', layout)
  ctx.provide('locale', new LocaleRuntime(ctx))
  ctx.provide('workspaces', workspaces)
  ctx.provide('sessions', sessionsStub(opts))
  if (opts.sidebarRight !== undefined) ctx.provide('sidebarRight', opts.sidebarRight as never)
  new TestRemote(ctx, {
    session: {
      openWorkspacePath: async () => ({ ok: true as const, value: { opened: true as const } }),
    },
  })
  const fiber = ctx.plugin({ inject: [...inject], apply })
  await fiber.await()
  return { ctx, slots, fiber, layout, workspaces, originalOpen }
}

afterEach(() => {
  delete (window as Window & { shell?: unknown }).shell
})

describe('ui-surfaces apply', () => {
  it('declares only the services it uses', () => {
    expect(inject).toEqual([
      'slots', 'layout', 'locale', 'workspaces', 'sessions', 'remote', 'remote.session',
    ])
  })

  it('normalizes the retired surfaces width and registers no shell', async () => {
    const b = await bench()
    expect(b.layout.closeSurfaces).toHaveBeenCalledOnce()
    expect(b.slots.entries('surfaces')).toHaveLength(0)
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

  it('routes workspace paths through the main-view Session into the Sidebar', async () => {
    const sidebarRight = sidebarRightStub()
    const b = await bench({ mainView: 'sess-main', sidebarRight })
    ;(window as Window & { shell?: { listDir: () => Promise<unknown> } }).shell = {
      listDir: async () => ({ ok: true }),
    }

    await b.workspaces.openPath('/tmp/proj/src/a.ts')

    expect(sidebarRight.openResourceIn).toHaveBeenCalledWith(
      'sess-main',
      'dsh-resource://file/session/sess-main/src/a.ts',
    )
    expect(b.originalOpen).not.toHaveBeenCalled()
    await b.fiber.dispose()
  })

  it('routes a citation to its originating Session instead of the main view', async () => {
    const sidebarRight = sidebarRightStub()
    const b = await bench({
      mainView: 'sess-main',
      cwd: '/tmp/main',
      background: { id: 'sess-background', cwd: '/tmp/proj' },
      sidebarRight,
    })
    ;(window as Window & { shell?: { listDir: () => Promise<unknown> } }).shell = {
      listDir: async () => ({ ok: true }),
    }

    await b.workspaces.openPath('/tmp/proj/src/a.ts', { line: 9, sessionId: 'sess-background' })

    expect(sidebarRight.openResourceIn).toHaveBeenCalledWith(
      'sess-background',
      'dsh-resource://file/session/sess-background/src/a.ts',
      { params: { line: 9 } },
    )
    await b.fiber.dispose()
  })

  it('routes a no-workspace relative citation through the scratch Session cwd', async () => {
    const sidebarRight = sidebarRightStub()
    const cwd = 'C:\\Users\\tester\\AppData\\Roaming\\Deepseek-Harness-Desktop\\dsh-home\\no-workspace'
    const b = await bench({ mainView: 'sess-1', cwd, sidebarRight })
    ;(window as Window & { shell?: { listDir: () => Promise<unknown> } }).shell = {
      listDir: async () => ({ ok: true }),
    }

    await b.workspaces.openPath(`${cwd}\\pelican-bike.html`)

    expect(sidebarRight.openResourceIn).toHaveBeenCalledWith(
      'sess-1',
      'dsh-resource://file/session/sess-1/pelican-bike.html',
    )
    await b.fiber.dispose()
  })

  it('routes a cwd-less absolute citation without inventing a workspace root', async () => {
    const sidebarRight = sidebarRightStub()
    const b = await bench({ mainView: 'sess-1', cwd: '', sidebarRight })
    ;(window as Window & { shell?: { listDir: () => Promise<unknown> } }).shell = {
      listDir: async () => ({ ok: true }),
    }

    await b.workspaces.openPath(
      'C:\\Users\\tester\\AppData\\Roaming\\Deepseek-Harness-Desktop\\dsh-home\\no-workspace\\pelican-bike.html',
    )

    expect(sidebarRight.openResourceIn).toHaveBeenCalledWith(
      'sess-1',
      'dsh-resource://file/session/sess-1/C:/Users/tester/AppData/Roaming/Deepseek-Harness-Desktop/dsh-home/no-workspace/pelican-bike.html',
    )
    await b.fiber.dispose()
  })

  it('keeps a cwd-less relative citation on the Host fallback', async () => {
    const sidebarRight = sidebarRightStub()
    const b = await bench({ mainView: 'sess-1', cwd: '', sidebarRight })
    ;(window as Window & { shell?: { listDir: () => Promise<unknown> } }).shell = {
      listDir: async () => ({ ok: true }),
    }

    await b.workspaces.openPath('pelican-bike.html')

    expect(sidebarRight.openResourceIn).not.toHaveBeenCalled()
    expect(b.originalOpen).toHaveBeenCalledWith('pelican-bike.html')
    await b.fiber.dispose()
  })

  it('opens the Sidebar Files page for the workspace root', async () => {
    const sidebarRight = sidebarRightStub()
    const b = await bench({ mainView: 'sess-1', sidebarRight })
    ;(window as Window & { shell?: { listDir: () => Promise<unknown> } }).shell = {
      listDir: async () => ({ ok: true }),
    }

    await b.workspaces.openPath('/tmp/proj/.')

    expect(sidebarRight.openTabIn).toHaveBeenCalledWith('sess-1', 'files')
    await b.fiber.dispose()
  })

  it('keeps browser documents in their file resource while opening Sidebar Browser', async () => {
    const sidebarRight = sidebarRightStub()
    const b = await bench({ mainView: 'sess-1', sidebarRight })
    const previewWorkspaceFile = vi.fn(async ({ relativePath }: { relativePath: string }) => ({
      ok: true as const,
      url: `http://127.0.0.1:9/tok/${relativePath}`,
    }))
    ;(window as Window & { shell?: unknown }).shell = {
      listDir: async () => ({ ok: true }),
      previewWorkspaceFile,
    }

    await b.workspaces.openPath('/tmp/proj/site/index.html', { line: 24 })
    await b.workspaces.openPath('/tmp/proj/doc.pdf')

    expect(sidebarRight.openResourceIn.mock.calls).toEqual([
      ['sess-1', 'dsh-resource://file/session/sess-1/site/index.html', { params: { line: 24 } }],
      ['sess-1', 'dsh-resource://file/session/sess-1/doc.pdf'],
    ])
    expect(sidebarRight.openTabIn.mock.calls).toEqual([
      ['sess-1', 'browser', { params: { url: 'http://127.0.0.1:9/tok/site/index.html' } }],
      ['sess-1', 'browser', { params: { url: 'http://127.0.0.1:9/tok/doc.pdf' } }],
    ])
    await b.fiber.dispose()
  })

  it('leaves text files on the file resource', async () => {
    const sidebarRight = sidebarRightStub()
    const b = await bench({ mainView: 'sess-1', sidebarRight })
    const previewWorkspaceFile = vi.fn()
    ;(window as Window & { shell?: unknown }).shell = {
      listDir: async () => ({ ok: true }),
      previewWorkspaceFile,
    }

    await b.workspaces.openPath('/tmp/proj/src/a.ts')
    await b.workspaces.openPath('/tmp/proj/page.svg')

    expect(previewWorkspaceFile).not.toHaveBeenCalled()
    expect(sidebarRight.openTabIn).not.toHaveBeenCalled()
    await b.fiber.dispose()
  })

  it('throws when the Sidebar rejects an already-routed target', async () => {
    const sidebarRight = sidebarRightStub()
    sidebarRight.openResourceIn.mockReturnValueOnce(false)
    const b = await bench({ mainView: 'sess-1', sidebarRight })
    ;(window as Window & { shell?: { listDir: () => Promise<unknown> } }).shell = {
      listDir: async () => ({ ok: true }),
    }

    await expect(b.workspaces.openPath('/tmp/proj/src/a.ts')).rejects.toThrow(
      'surfaces: file target is unavailable',
    )
    expect(b.originalOpen).not.toHaveBeenCalled()
    await b.fiber.dispose()
  })

  it('falls through when the path is outside cwd or listing is absent', async () => {
    const b = await bench({ mainView: 'sess-1' })
    await b.workspaces.openPath('/tmp/proj/a.ts')
    expect(b.originalOpen).toHaveBeenCalledWith('/tmp/proj/a.ts')

    b.originalOpen.mockClear()
    ;(window as Window & { shell?: { listDir: () => Promise<unknown> } }).shell = {
      listDir: async () => ({ ok: true }),
    }
    await b.workspaces.openPath('/tmp/other/a.ts')
    expect(b.originalOpen).toHaveBeenCalledWith('/tmp/other/a.ts')
    await b.fiber.dispose()
  })
})
