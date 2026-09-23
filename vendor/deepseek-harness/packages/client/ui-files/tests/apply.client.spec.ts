// @vitest-environment jsdom
/** Files plugin registers the Desktop tree and editor as native Sidebar types. */
import { Context } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SlotRegistry } from '@deepseek-ai/dsh-client-ui-renderer/client'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { SidebarRightTabRegistry } from '../../ui-sidebar-right/src/client/tab-registry.ts'
import { apply, inject } from '../src/client/index.ts'
import { SidebarFilePreview } from '../src/client/FilePreview.tsx'
import { SidebarFilesPanel } from '../src/client/FilesPanel.tsx'
import {
  DESKTOP_FILE_ID,
  DESKTOP_FILES_ID,
  canOpenDesktopFile,
} from '../src/client/desktop-files.ts'
import type { FilesShellInjected } from '../src/client/shell.ts'

function declare(slots: SlotRegistry): () => void {
  return slots.register({
    name: 'root',
    children: {
      'sidebar.right.pane.tab': {
        kind: 'keyed',
        scope: 'session',
        inject: { hooks: { tabInfo: () => () => ({}) } },
      },
      'sidebar.right.tab.document.actions': {
        kind: 'list',
        scope: 'session',
        inject: { hooks: { tabInfo: () => () => ({}) } },
      },
    },
  } as never, () => null)
}

async function bench(options: {
  withPreload?: boolean
  cwd?: string
} = {}) {
  const ctx = new Context()
  await ctx.plugin(SlotRegistry).await()
  const slots = ctx.get('slots') as SlotRegistry
  const declaration = declare(slots)
  const tabs = new SidebarRightTabRegistry(ctx)
  ctx.provide('locale', new LocaleRuntime(ctx))
  ctx.provide('sidebarRightTabs', tabs)
  ctx.provide('sessions', {
    scope: () => ({}),
    list: {
      getSnapshot: () => ({
        byId: options.cwd === undefined ? {} : {
          'sess-1': { id: 'sess-1', cwd: options.cwd, retainedBy: { mainView: 1 } },
        },
      }),
    },
  })
  if (options.withPreload === false) {
    delete (window as Window & { shell?: unknown }).shell
  } else {
    ;(window as Window & { shell?: unknown }).shell = {
      previewOpenFileWindow: async () => ({ ok: true }),
    }
  }
  const fiber = ctx.plugin({ inject: [...inject], apply })
  await fiber.await()
  return { ctx, slots, declaration, tabs, fiber }
}

afterEach(() => {
  delete (window as Window & { shell?: unknown }).shell
})

describe('ui-files apply', () => {
  it('declares only the services it uses', () => {
    expect(inject).toEqual(['slots', 'locale', 'sidebarRightTabs', 'sessions'])
  })

  it('registers the Desktop Files page and file viewer in the native Sidebar', async () => {
    const b = await bench({ cwd: '/tmp/proj' })
    const files = b.tabs.entries().find(entry => entry.id === DESKTOP_FILES_ID)
    const file = b.tabs.entries().find(entry => entry.id === DESKTOP_FILE_ID)
    expect(files).toMatchObject({ kind: 'files', priority: 'extension' })
    expect(file).toMatchObject({ kind: 'desktop-file', priority: 'extension' })
    expect(file?.guide?.[0]).toMatchObject({ id: 'desktop-file' })
    expect(b.slots.entries('sidebar.right.pane.tab').map(entry => entry.options.key)).toEqual([
      DESKTOP_FILES_ID, DESKTOP_FILE_ID,
    ])
    expect(b.slots.entries('sidebar.right.pane.tab')[0]?.component).toBe(SidebarFilesPanel)
    expect(b.slots.entries('sidebar.right.pane.tab')[1]?.component).toBe(SidebarFilePreview)
    await b.fiber.dispose()
    expect(b.tabs.entries()).toHaveLength(0)
    expect(b.slots.entries('sidebar.right.pane.tab')).toHaveLength(0)
  })

  it('binds only the known floating-preview action when the preload exists', async () => {
    const b = await bench({ withPreload: true })
    expect(b.slots.entries('sidebar.right.tab.document.actions')).toHaveLength(1)
    await b.fiber.dispose()
  })

  it('omits the floating-preview action without the desktop preload', async () => {
    const b = await bench({ withPreload: false })
    expect(b.slots.entries('sidebar.right.tab.document.actions')).toHaveLength(0)
    await b.fiber.dispose()
  })

  it('binds mentionFile and missing-shell fallbacks', async () => {
    const b = await bench()
    const injected = (b.slots.entries('sidebar.right.pane.tab')[0]?.inject as unknown as () => FilesShellInjected)()
    injected.mentionFile('sess', 'a.ts')
    await expect(injected.listDir('/tmp', '')).resolves.toEqual({
      ok: false, message: 'Workspace listing is unavailable.',
    })
    await expect(injected.readFile('/tmp', 'a.ts')).resolves.toEqual({
      ok: false, message: 'Workspace listing is unavailable.',
    })
    await expect(injected.writeFile('/tmp', 'a.ts', 'x')).resolves.toEqual({
      ok: false, message: 'Workspace listing is unavailable.',
    })
    await b.fiber.dispose()
  })

  it('mentions a file as a markdown link in the composer draft', async () => {
    const b = await bench()
    const setDraft = vi.fn()
    b.ctx.provide('conversation', {
      input: {
        for: () => ({ setDraft, state: { getSnapshot: () => ({ draft: '' }) } }),
      },
    })
    const injected = (b.slots.entries('sidebar.right.pane.tab')[0]?.inject as unknown as () => FilesShellInjected)()
    injected.mentionFile('sess', 'docs/My File.md')
    expect(setDraft).toHaveBeenCalledWith('[My File.md](docs/My%20File.md)')
    await b.fiber.dispose()
  })

  it('accepts only session file addresses whose Session has a cwd', () => {
    const cwdOf = (sessionId: string) => (sessionId === 'sess-1' ? '/tmp/proj' : undefined)
    expect(canOpenDesktopFile('dsh-resource://file/session/sess-1/work/a.ts', cwdOf)).toBe(true)
    expect(canOpenDesktopFile('dsh-resource://file/session/sess-2/work/a.ts', cwdOf)).toBe(false)
    expect(canOpenDesktopFile('dsh-resource://file/absolute/C:/work/a.ts', cwdOf)).toBe(false)
    expect(canOpenDesktopFile('not-an-address', cwdOf)).toBe(false)
  })
})
