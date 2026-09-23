/**
 * Browser-half lifecycle over the real SlotRegistry: the dictionary,
 * header-slot, and document-preview path registrations with fiber teardown
 * proving removal (HMR safety) and the injected controller faces.
 */

import { Context } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SlotRegistry } from '@deepseek-ai/dsh-client-ui-renderer/client'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import { apply, inject, type OpenInAppActionInjected, type OpenPathInjected } from '../src/client/index.ts'
import { apply as nodeApply } from '../src/index.ts'
import { OpenInAppAction } from '../src/client/OpenInAppAction.tsx'
import { OpenPathAction } from '../src/client/OpenPathAction.tsx'
import { OpenPathEmptyAction } from '../src/client/OpenPathEmptyAction.tsx'
import { en, NS, zh } from '../src/client/locales.ts'

afterEach(() => {
  vi.unstubAllGlobals()
  vi.clearAllMocks()
})

/** The Session Remote slice the path controls call; answers a desktop and acknowledges every gesture. */
const remote = {
  session: {
    workspacePathApplications: vi.fn(async () => ({ ok: true as const, value: [] })),
    canOpenWorkspacePath: vi.fn(async () => ({ ok: true as const, value: true })),
    openWorkspacePath: vi.fn(async () => ({ ok: true as const, value: { opened: true as const } })),
  },
}

/** Boot the browser half over a real slot tree that declares the header list and the document-preview seats. */
async function bench(): Promise<{ ctx: Context; fiber: ReturnType<Context['plugin']> }> {
  const ctx = new Context()
  await ctx.plugin(SlotRegistry).await()
  ctx.slots.register({
    name: 'root',
    children: {
      'conversation.session.header.utilities': { kind: 'list', scope: 'session' },
      'sidebar.right.tab.document.actions': { kind: 'list', scope: 'session' },
      'sidebar.right.tab.document.unpreviewable': { kind: 'list', scope: 'session' },
      'deliverables.file.actions': { kind: 'list', scope: 'session' },
      'deliverables.review.file.actions': { kind: 'list', scope: 'session' },
    },
  } as never, () => null)
  ctx.provide('sessions', {})
  ctx.provide('locale', new LocaleRuntime(ctx))
  ctx.provide('remote', remote as never)
  ctx.provide('remote.session', remote.session as never)
  const fiber = ctx.plugin({ inject: [...inject], apply })
  await fiber.await()
  return { ctx, fiber }
}

function headerEntryIds(ctx: Context): (string | undefined)[] {
  return ctx.slots.entries('conversation.session.header.utilities').map(entry => entry.options.id)
}

describe('open-in-app browser half', () => {
  it('declares the services it binds', () => {
    expect(inject).toEqual(['sessions', 'slots', 'locale', 'remote', 'remote.session'])
  })

  it('registers both document-preview path controls behind one desktop answer, and fiber teardown removes them', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ apps: [] }), { status: 200 })))
    const { ctx, fiber } = await bench()
    const header = ctx.slots.entries('sidebar.right.tab.document.actions')[0]
    const empty = ctx.slots.entries('sidebar.right.tab.document.unpreviewable')[0]
    expect(header?.component).toBe(OpenPathAction)
    expect(empty?.component).toBe(OpenPathEmptyAction)
    expect(ctx.slots.entries('deliverables.file.actions')).toHaveLength(1)
    expect(header?.options).toMatchObject({ id: 'open-in-app' })
    const face = (header?.inject as unknown as () => OpenPathInjected)()
    const emptyFace = (empty?.inject as unknown as () => OpenPathInjected)()
    expect(emptyFace.hooks.openInAppDesktop).toBe(face.hooks.openInAppDesktop)
    expect(emptyFace.applications).toBe(face.applications)
    expect(face.hooks.openInAppDesktop.getSnapshot()).toBeNull()
    await Promise.all([face.loadDesktop(), emptyFace.loadDesktop()])
    expect(remote.session.canOpenWorkspacePath).toHaveBeenCalledOnce()
    const signal = new AbortController().signal
    await expect(face.applications('/w/clip.mp4', signal)).resolves.toEqual([])
    expect(remote.session.workspacePathApplications).toHaveBeenCalledWith({ path: '/w/clip.mp4' }, signal)
    expect(face.hooks.openInAppDesktop.getSnapshot()).toBe(true)
    expect(await face.openPath('/w/clip.mp4', 'reveal')).toBeNull()
    expect(remote.session.openWorkspacePath).toHaveBeenLastCalledWith({ path: '/w/clip.mp4', action: 'reveal' })
    await fiber.dispose()
    expect(ctx.slots.entries('sidebar.right.tab.document.actions').map(entry => entry.options.id)).not.toContain('open-in-app')
    expect(ctx.slots.entries('sidebar.right.tab.document.unpreviewable').map(entry => entry.options.id)).not.toContain('open-in-app')
    expect(ctx.slots.entries('deliverables.file.actions')).toHaveLength(0)
  })

  it('registers the header split button, and fiber teardown removes it (HMR safety)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ apps: [] }), { status: 200 })))
    const { ctx, fiber } = await bench()
    const entry = ctx.slots.entries('conversation.session.header.utilities')[0]
    expect(entry?.component).toBe(OpenInAppAction)
    expect(entry?.options).toMatchObject({ id: 'open-in-app' })
    await fiber.dispose()
    expect(headerEntryIds(ctx)).not.toContain('open-in-app')
  })

  it('injects the controller face: availability sources, launch carrier, choice, and icon URLs', async () => {
    const fetcher = vi.fn(async (input: string | URL, init?: RequestInit) => {
      void init
      const url = String(input)
      if (url === 'open-in-app/apps') {
        return new Response(JSON.stringify({ apps: ['finder', 'cursor', 7] }), { status: 200 })
      }
      return new Response(JSON.stringify({ ok: true }), { status: 200 })
    })
    vi.stubGlobal('fetch', fetcher)
    const { ctx, fiber } = await bench()
    const entry = ctx.slots.entries('conversation.session.header.utilities')[0]
    const injected = (entry?.inject as unknown as () => OpenInAppActionInjected)()

    await vi.waitFor(() => {
      expect(injected.hooks.openInAppApps.getSnapshot()).toEqual(['finder', 'cursor'])
    })
    expect(injected.iconUrl('cursor')).toBe('open-in-app/icon/cursor')

    injected.choose('cursor')
    expect(injected.hooks.openInAppChoice.getSnapshot()).toBe('cursor')

    await injected.launch('cursor', '/w/dir')
    const openCall = fetcher.mock.calls.find(call => call[0] === 'open-in-app/open')
    expect(openCall?.[1]).toMatchObject({
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ app: 'cursor', path: '/w/dir' }),
    })
    await fiber.dispose()
  })

  it('publishes an empty availability list when the host read fails, and launches reject on HTTP errors', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL) => {
      if (String(input) === 'open-in-app/apps') throw new Error('down')
      return new Response('', { status: 502 })
    }))
    const { ctx, fiber } = await bench()
    const entry = ctx.slots.entries('conversation.session.header.utilities')[0]
    const injected = (entry?.inject as unknown as () => OpenInAppActionInjected)()
    await vi.waitFor(() => {
      expect(injected.hooks.openInAppApps.getSnapshot()).toEqual([])
    })
    await expect(injected.launch('finder', '/w/dir')).rejects.toThrow('open failed: HTTP 502')
    await fiber.dispose()
  })

  it('registers both dictionaries under its own namespace and releases them with the fiber', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ apps: [] }), { status: 200 })))
    const { ctx, fiber } = await bench()
    ctx.locale.setLocale('zh')
    const translate = ctx.locale.bind(NS)
    expect(translate('path.more')).toBe(zh['path.more'])
    ctx.locale.setLocale('en')
    expect(translate('path.more')).toBe(en['path.more'])
    await fiber.dispose()
    expect(translate('path.more')).not.toBe(en['path.more'])
  })

  it('keeps the English dictionary key-identical to the Chinese source of truth', () => {
    expect(Object.keys(en).sort()).toEqual(Object.keys(zh).sort())
  })
})

describe('ui-open-in-app node half', () => {
  it('the node apply is an inert loader seat', () => {
    expect(() => { nodeApply() }).not.toThrow()
  })
})
