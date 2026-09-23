import { EventEmitter } from 'node:events'
import { afterEach, expect, it, vi } from 'vitest'
import { DesktopPlatformView, platformBounds } from '../src/platform-view.ts'

const state = vi.hoisted(() => ({
  views: [] as unknown[], sessions: [] as unknown[], openExternal: vi.fn(async () => {}), loadFailure: undefined as Error | undefined,
}))
vi.mock('electron', () => ({
  shell: { openExternal: state.openExternal },
  session: { fromPartition: vi.fn((partition: string) => {
    const value = {
      partition, webRequest: { onBeforeSendHeaders: vi.fn(), onCompleted: vi.fn(), onErrorOccurred: vi.fn() },
      setPermissionRequestHandler: vi.fn(), setPermissionCheckHandler: vi.fn(),
      clearStorageData: vi.fn(async () => {}),
    }
    state.sessions.push(value)
    return value
  }) },
  WebContentsView: class {
    webContents = Object.assign(new EventEmitter(), {
      mainFrame: { url: 'https://platform.deepseek.com/usage' },
      session: { clearStorageData: vi.fn(async () => {}) },
      setWindowOpenHandler: vi.fn(),
      loadURL: vi.fn(async (_url: string) => { if (state.loadFailure !== undefined) throw state.loadFailure }),
      isDestroyed: () => false, close: vi.fn(), send: vi.fn(),
    })
    setVisible = vi.fn()
    setBounds = vi.fn()
    constructor() { state.views.push(this) }
  },
}))

afterEach(() => { state.views.length = 0; state.sessions.length = 0; state.loadFailure = undefined; vi.clearAllMocks() })
function setup() {
  const removeChildView = vi.fn()
  const owner = Object.assign(new EventEmitter(), {
    webContents: new EventEmitter(), contentView: { addChildView: vi.fn(), removeChildView }, isDestroyed: () => false,
  })
  const manager = new DesktopPlatformView('/bundled/preload.cjs', () => 'en_US')
  manager.setSession({ origin: 'https://platform.deepseek.com', token: 'fixture-secret' })
  return { manager, owner, removeChildView }
}
function view() {
  return state.views.at(-1) as {
    setVisible: ReturnType<typeof vi.fn>
    webContents: EventEmitter & {
      mainFrame: { url: string }
      loadURL: ReturnType<typeof vi.fn>
      setWindowOpenHandler: ReturnType<typeof vi.fn>
      close: ReturnType<typeof vi.fn>
      send: ReturnType<typeof vi.fn>
    } }
}
const bounds = { x: 10, y: 20, width: 800, height: 600 }

it('bootstraps only the owned main frame and never puts the token in a URL', async () => {
  const { manager, owner } = setup()
  await manager.open(owner, 'usage', bounds)
  const sender = view().webContents
  const event = { sender, senderFrame: sender.mainFrame }
  expect(manager.bootstrap(event)).toEqual({ origin: 'https://platform.deepseek.com', token: 'fixture-secret', locale: 'en_US' })
  expect(sender.loadURL).toHaveBeenCalledWith('https://platform.deepseek.com/usage')
  expect(() => manager.bootstrap({ ...event, senderFrame: { url: sender.mainFrame.url } })).toThrow()
  expect(() => manager.bootstrap({ ...event, sender: {} })).toThrow()
  sender.mainFrame.url = 'https://other.example/usage'
  expect(() => manager.bootstrap(event)).toThrow()
  manager.close()
})

it('destroys old documents on sign-out or credential replacement', async () => {
  const { manager, owner } = setup()
  await manager.open(owner, 'usage', bounds)
  const first = view().webContents
  manager.setSession({ origin: 'https://platform.deepseek.com', token: 'replacement' })
  expect(first.close).toHaveBeenCalledOnce()
  expect(() => manager.bootstrap({ sender: first, senderFrame: first.mainFrame })).toThrow()
  await manager.open(owner, 'top-up', bounds)
  expect(view().webContents.loadURL).toHaveBeenCalledWith('https://platform.deepseek.com/top_up')
  const second = view().webContents
  manager.setSession(null)
  expect(second.close).toHaveBeenCalledOnce()
  await expect(manager.open(owner, 'usage', bounds)).rejects.toThrow()
})

it('keeps the view when the Platform document replaces its own URL during the first load', async () => {
  const { manager, owner } = setup()
  state.loadFailure = Object.assign(new Error("ERR_ABORTED (-3) loading 'https://platform.deepseek.com/usage'"), { code: 'ERR_ABORTED' })
  await manager.open(owner, 'usage', bounds)
  expect(view().setVisible).toHaveBeenCalledWith(true)
  expect(view().webContents.close).not.toHaveBeenCalled()
  state.loadFailure = Object.assign(new Error("ERR_FAILED (-2) loading 'https://platform.deepseek.com/usage'"), { code: 'ERR_FAILED' })
  await expect(manager.open(owner, 'usage', bounds)).rejects.toThrow('ERR_FAILED')
  expect(view().webContents.close).toHaveBeenCalledOnce()
})

it('blocks cross-origin navigation and redirects', async () => {
  const { manager, owner } = setup()
  await manager.open(owner, 'usage', bounds)
  for (const name of ['will-navigate', 'will-redirect']) {
    const event = { preventDefault: vi.fn() }
    view().webContents.emit(name, event, 'https://platform.deepseek.com.evil/usage')
    expect(event.preventDefault).toHaveBeenCalledOnce()
    event.preventDefault.mockClear()
    view().webContents.emit(name, event, 'https://platform.deepseek.com/top_up')
    expect(event.preventDefault).not.toHaveBeenCalled()
  }
  manager.close()
})

it.each([null, {}, { ...bounds, width: NaN }, { ...bounds, x: -1 }, { ...bounds, y: Infinity }])('rejects malformed IPC rectangles', (value) => {
  expect(() => platformBounds(value)).toThrow()
})


it('opens HTTPS payment links in the system browser without an embedded child window', async () => {
  const { manager, owner } = setup()
  await manager.open(owner, 'top-up', bounds)
  const handler = view().webContents.setWindowOpenHandler.mock.calls[0]![0] as (details: { url: string }) => { action: string }
  expect(handler({ url: 'https://payment.example/order' })).toEqual({ action: 'deny' })
  expect(state.openExternal).toHaveBeenCalledWith('https://payment.example/order')
  vi.mocked(state.openExternal).mockClear()
  for (const url of ['file:///tmp/test', 'javascript:alert(1)', 'https://user:pass@payment.example/order']) {
    expect(handler({ url })).toEqual({ action: 'deny' })
  }
  expect(state.openExternal).not.toHaveBeenCalled()
  manager.close()
})


it('reveals a loaded document only after loading finishes', async () => {
  const { manager, owner } = setup()
  const loading = manager.open(owner, 'usage', bounds)
  const active = view()
  expect(active.setVisible.mock.calls).toEqual([[false]])
  await loading
  expect(active.setVisible.mock.calls).toEqual([[false], [true]])
  manager.close()
})

it('does not reveal a document closed before its load settles', async () => {
  const { manager, owner } = setup()
  const loading = manager.open(owner, 'usage', bounds)
  const active = view()
  manager.close()
  await loading
  expect(active.setVisible.mock.calls).toEqual([[false]])
})


it('injects deployment headers only at the Platform origin and excludes them from bootstrap', async () => {
  const { manager, owner } = setup()
  manager.setSession({ origin: 'https://platform.deepseek.com', token: 'fixture-secret',
    requestHeaders: { cookie: 'route=new; gate=private', 'x-private-gate': 'private', 'x-client-platform': 'desktop-mac' } })
  await manager.open(owner, 'usage', bounds)
  const browserSession = state.sessions.at(-1) as { webRequest: { onBeforeSendHeaders: ReturnType<typeof vi.fn> } }
  const intercept = browserSession.webRequest.onBeforeSendHeaders.mock.calls[0]![0] as (
    details: { id: number; url: string; requestHeaders: Record<string, string> },
    callback: (value: { requestHeaders: Record<string, string> }) => void,
  ) => void
  const callback = vi.fn()
  for (const path of ['/usage', '/top_up', '/api/v0/users/get_user_summary']) {
    intercept({ id: 1, url: `https://platform.deepseek.com${path}`, requestHeaders: { Cookie: 'route=old; browser=keep', Accept: 'application/json' } }, callback)
    expect(callback).toHaveBeenLastCalledWith({ requestHeaders: {
      cookie: 'route=new; browser=keep; gate=private', accept: 'application/json', 'x-private-gate': 'private', 'x-client-platform': 'desktop-mac',
    } })
  }
  intercept({ id: 1, url: 'https://other.example/api', requestHeaders: {
    cookie: 'route=new; gate=private', 'x-private-gate': 'private', 'x-client-platform': 'desktop-mac', accept: 'application/json',
  } }, callback)
  expect(callback).toHaveBeenLastCalledWith({ requestHeaders: { accept: 'application/json' } })
  intercept({ id: 2, url: 'https://other.example/api', requestHeaders: { cookie: 'payment=session', constructor: 'keep' } }, callback)
  expect(callback).toHaveBeenLastCalledWith({ requestHeaders: { cookie: 'payment=session', constructor: 'keep' } })
  const sender = view().webContents
  expect(manager.bootstrap({ sender, senderFrame: sender.mainFrame }))
    .toEqual({ origin: 'https://platform.deepseek.com', token: 'fixture-secret', locale: 'en_US' })
  manager.close()
})

it.each(['usage', 'top-up'] as const)('selects the configured frontend deployment for %s', async (page) => {
  const { manager, owner } = setup()
  manager.setSession({ origin: 'https://platform.deepseek.com', token: 'fixture-secret', embeddedPageDist: 'feat/test&other=value' })
  await manager.open(owner, page, bounds)
  const url = new URL(view().webContents.loadURL.mock.calls[0]![0] as string)
  expect(url.origin).toBe('https://platform.deepseek.com')
  expect(url.pathname).toBe(page === 'usage' ? '/usage' : '/top_up')
  expect([...url.searchParams]).toEqual([['dist', 'feat/test&other=value']])
  const previous = view().webContents
  manager.setSession({ origin: 'https://platform.deepseek.com', token: 'fixture-secret', embeddedPageDist: 'another' })
  expect(previous.close).toHaveBeenCalledOnce()
  manager.close()
})


it('removes the native view when its application document reloads, without renderer cleanup', async () => {
  const { manager, owner, removeChildView } = setup()
  await manager.open(owner, 'usage', bounds)
  const child = view()
  owner.webContents.emit('did-start-navigation', {}, 'dsh-app://app/', false, true)
  expect(removeChildView).toHaveBeenCalledWith(child)
  expect(child.webContents.close).toHaveBeenCalledOnce()
  expect(owner.webContents.listenerCount('did-start-navigation')).toBe(0)
  expect(owner.listenerCount('closed')).toBe(0)
})

it('retains the view on same-document and subframe navigation', async () => {
  const { manager, owner } = setup()
  await manager.open(owner, 'usage', bounds)
  owner.webContents.emit('did-start-navigation', {}, 'dsh-app://app/#account', true, true)
  owner.webContents.emit('did-start-navigation', {}, 'about:blank', false, false)
  expect(view().webContents.close).not.toHaveBeenCalled()
  manager.close()
})

it.each(['render-process-gone', 'destroyed', 'closed'])('removes the view on owner %s', async (event) => {
  const { manager, owner } = setup()
  await manager.open(owner, 'usage', bounds)
  const child = view()
  ;(event === 'closed' ? owner : owner.webContents).emit(event)
  expect(child.webContents.close).toHaveBeenCalledOnce()
  expect(owner.webContents.listenerCount('destroyed')).toBe(0)
  expect(owner.webContents.listenerCount('render-process-gone')).toBe(0)
})


it('does not reveal a pending view after the owner reloads or remove a replacement view', async () => {
  const { manager, owner } = setup()
  const loading = manager.open(owner, 'usage', bounds)
  const previous = view()
  owner.webContents.emit('did-start-navigation', {}, 'dsh-app://app/', false, true)
  await manager.open(owner, 'top-up', bounds)
  const current = view()
  await loading
  expect(previous.setVisible.mock.calls).toEqual([[false]])
  expect(current.setVisible).toHaveBeenLastCalledWith(true)
  expect(current.webContents.close).not.toHaveBeenCalled()
  expect(owner.webContents.listenerCount('did-start-navigation')).toBe(1)
  manager.close()
  expect(owner.webContents.listenerCount('did-start-navigation')).toBe(0)
})


it('bootstraps the current language and updates an open view without reloading', async () => {
  const { owner } = setup()
  let locale: 'en_US' | 'zh_CN' = 'zh_CN'
  const manager = new DesktopPlatformView('/bundled/preload.cjs', () => locale)
  manager.setSession({ origin: 'https://platform.deepseek.com', token: 'fixture-secret' })
  manager.notifyLocaleChanged()
  await manager.open(owner, 'usage', bounds)
  const sender = view().webContents
  expect(manager.bootstrap({ sender, senderFrame: sender.mainFrame }).locale).toBe('zh_CN')
  locale = 'en_US'
  manager.notifyLocaleChanged()
  expect(sender.send).toHaveBeenCalledWith('dsh-platform:locale-changed', 'en_US')
  expect(sender.loadURL).toHaveBeenCalledOnce()
  manager.close()
  sender.send.mockClear()
  manager.notifyLocaleChanged()
  expect(sender.send).not.toHaveBeenCalled()
  await manager.open(owner, 'top-up', bounds)
  const reopened = view().webContents
  expect(manager.bootstrap({ sender: reopened, senderFrame: reopened.mainFrame }).locale).toBe('en_US')
  manager.close()
})
