// @vitest-environment jsdom
/** Chat inject factories exercised over independently mounted Conversation and Chat plugins. */
import { describe, expect, it, vi } from 'vitest'
import { AttachmentId } from '@deepseek-ai/dsh-attachment'
import type { ISession } from '@deepseek-ai/dsh-api-session-controller/client'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import {
  RemoteError, SlotTestRuntime, TestRemote, stubSettingsScope, usePinnedBrowserLanguages,
} from '@deepseek-ai/dsh-client-test-runtime'
import type { SessionBehaviorOverrides } from '@deepseek-ai/dsh-client-test-runtime'
import type { ClientRemote } from '@deepseek-ai/dsh-api-remotes/client'
import {
  apply as applyConversation, inject as injectConversation,
} from '@deepseek-ai/dsh-client-ui-conversation/client'
import {
  apply as applyChat, inject as injectChat, type ChatViewInjected,
} from '@deepseek-ai/dsh-client-ui-chat/client'
import { SessionSeq, type SessionId } from '@deepseek-ai/dsh-session/types'
import type { WorkspaceId } from '@deepseek-ai/dsh-workspace/types'
import { createChatStore } from '../src/client/stores.ts'

usePinnedBrowserLanguages('zh-CN')

const ROOT = 'root-1' as SessionId
const ATTACHMENT = {
  attachmentId: AttachmentId('image-1'),
  mediaType: 'image/png',
  bytes: 1,
  width: 1,
  height: 1,
} as const

type ChatInstance = ReturnType<ReturnType<typeof createChatStore>['create']>
type ChatActions = ChatInstance['actions']

function sessionFakeFor() {
  return {
    loadOlder: vi.fn<ISession['loadOlder']>(() => Promise.resolve()),
    loadThrough: vi.fn<ISession['loadThrough']>(() => Promise.resolve()),
    readAttachment: vi.fn<ISession['readAttachment']>(() => Promise.resolve({
      ok: true,
      value: { attachment: ATTACHMENT, data: Uint8Array.of(1) },
    })),
    prompt: vi.fn<ISession['prompt']>(() => Promise.resolve({ ok: true, value: { accepted: true } })),
    cancel: vi.fn<ISession['cancel']>(() => Promise.resolve({ ok: true, value: { accepted: true } })),
  } satisfies SessionBehaviorOverrides
}

async function bench() {
  const runtime = await SlotTestRuntime.create()
  const openPath = vi.fn(async (_path: string, _options?: { line?: number }) => {})
  ;(runtime.ctx.workspaces as typeof runtime.ctx.workspaces & {
    openPath: (path: string, options?: { line?: number }) => Promise<void>
  }).openPath = openPath
  runtime.ctx.provide('settingsScope', { bind: () => stubSettingsScope().scope } as never)
  const layout = { closeRightbar: vi.fn(), openRightbar: vi.fn() }
  runtime.ctx.provide('layout', layout as never)
  const sidebarRight = { openResource: vi.fn<(address: string) => void>() }
  runtime.ctx.provide('sidebarRight', sidebarRight as never)
  const openWorkspacePath = vi.fn<ClientRemote['session']['openWorkspacePath']>(
    () => Promise.resolve({ ok: true, value: { opened: true } }),
  )
  new TestRemote(runtime.ctx, { session: { openWorkspacePath } })
  runtime.ctx.provide('uiWorkspace', {
    openWorkspace: vi.fn(async (_workspaceId: WorkspaceId, beforeOpen: (id: SessionId) => void) => {
      beforeOpen(ROOT)
      runtime.sessions.open(ROOT)
    }),
    openSession: (id: SessionId) => { runtime.sessions.open(id) },
  } as never)
  const session = sessionFakeFor()
  await runtime.sessions.add({
    id: ROOT,
    summary: { title: 'R', displayTitle: 'R', cwd: '/proj' },
    session,
  }, { current: false })
  const locale = new LocaleRuntime(runtime.ctx)
  runtime.ctx.provide('locale', locale)
  runtime.slots.installLocale(locale)
  await runtime.root.declare({
    'main': { kind: 'keyed', scope: 'root' },
  }, (_props: { renderSlot?: unknown }) => null)
  await runtime.mount({ inject: [...injectConversation], apply: applyConversation })
  await runtime.mount({ inject: [...injectChat], apply: applyChat })
  runtime.renderRoot()

  const chatViewApi = (id: SessionId) => {
    const entry = runtime.slots.entries('conversation.view')[0]!
    const instance = runtime.storeOf('conversation.view', id) as ChatInstance
    const injected = (entry.inject as unknown as (
      sessionId: SessionId,
      actions: ChatActions,
    ) => ChatViewInjected)(id, instance.actions)
    return { instance, injected }
  }
  return { runtime, layout, openPath, openWorkspacePath, sidebarRight, session, chatViewApi }
}

describe('Chat inject API', () => {
  it('loads older history and forks through the Session Controller', async () => {
    const b = await bench()
    const { injected } = b.chatViewApi(ROOT)
    injected.loadOlder()
    expect(b.session.loadOlder).toHaveBeenCalledOnce()

    void injected.loadThrough(SessionSeq(42))
    expect(b.session.loadThrough).toHaveBeenCalledWith(42)

    injected.forkAt(17)
    await vi.waitFor(() => {
      expect(b.runtime.sessions.calls).toContainEqual({ method: 'open', args: [ROOT] })
    })
    expect(b.runtime.sessions.calls).toContainEqual({
      method: 'fork', args: [{ sessionId: ROOT, atSeq: 17, increaseTitle: true }],
    })

    const fork = vi.spyOn(b.runtime.sessions, 'fork').mockRejectedValueOnce(new Error('fork failed'))
    injected.forkAt(18)
    await vi.waitFor(() => {
      expect(fork).toHaveBeenCalledWith({ sessionId: ROOT, atSeq: 18, increaseTitle: true })
    })
    await b.runtime.dispose()
  })

  it('resolves file paths through the shared Workspace opener and preserves failures', async () => {
    const b = await bench()
    const { injected } = b.chatViewApi(ROOT)
    await injected.openFile('src/a.ts')
    // Files stay in the product: the desktop surfaces intercept wraps this one
    // shared opener (Files tab, Browser for html/pdf), so the call site hands
    // it a workspace-absolute path, not an address.
    expect(b.openPath).toHaveBeenCalledWith('/proj/src/a.ts', undefined)
    expect(b.openWorkspacePath).not.toHaveBeenCalled()

    // A line travels as an option beside the path, so the opened file can jump.
    await injected.openFile('src/a.ts', { line: 7 })
    expect(b.openPath).toHaveBeenLastCalledWith('/proj/src/a.ts', { line: 7 })

    b.openPath.mockRejectedValueOnce(new RemoteError(
      'gateway/internal', 'workspace preview is not available', {},
    ))
    await expect(injected.openFile('src/b.ts')).rejects.toThrow('workspace preview is not available')
    await b.runtime.dispose()
  })

  it('keeps a relative path under the Session without a cwd for the Host to resolve', async () => {
    const b = await bench()
    const NO_CWD = 'root-2' as SessionId
    await b.runtime.sessions.add({
      id: NO_CWD,
      summary: { title: 'N', displayTitle: 'N' },
      session: sessionFakeFor(),
    }, { current: false })
    const { injected } = b.chatViewApi(NO_CWD)
    // The Host resolves the relative path against the root it holds for the
    // Session; the Client need not know it.
    await injected.openFile('src/a.ts')
    expect(b.openPath).toHaveBeenCalledWith('src/a.ts', undefined)
    await b.runtime.dispose()
  })

  it('fails loud when a Chat View inject resolves no Session', async () => {
    const b = await bench()
    const entry = b.runtime.slots.entries('conversation.view')[0]!
    const injectView = entry.inject as unknown as (
      sessionId: SessionId,
      actions: ChatActions,
    ) => ChatViewInjected
    expect(() => injectView('never-listed' as SessionId, {} as ChatActions))
      .toThrow(/unknown session/)
    await b.runtime.dispose()
  })

  it('owns image loading, scroll memory, and optional closing-file mentions', async () => {
    const b = await bench()
    const { injected } = b.chatViewApi(ROOT)
    const owner = {} as never

    expect(injected.fileMentions(owner)).toBeUndefined()
    const mentions = { resolve: vi.fn() } as never
    const forClosing = vi.fn(() => mentions)
    b.runtime.ctx.provide('chatFileMentions', { forClosing } as never)
    expect(injected.fileMentions(owner)).toBe(mentions)
    expect(forClosing).toHaveBeenCalledWith(owner, ROOT)

    expect(injected.chatScroll.read()).toBeNull()
    const position = { anchorKey: 'node-1', anchorTop: 4, scrollTop: 12 }
    injected.chatScroll.save(position)
    expect(injected.chatScroll.read()).toEqual(position)
    injected.chatScroll.save(null)
    expect(injected.chatScroll.read()).toBeNull()

    const loaded = await injected.loadImage(ATTACHMENT)
    expect(loaded).toEqual(expect.any(String))
    expect(b.session.readAttachment).toHaveBeenCalledWith(ATTACHMENT.attachmentId)
    expect(injected.loadImage.peek?.(ATTACHMENT)).toBe(loaded)
    await b.runtime.dispose()
  })
})
