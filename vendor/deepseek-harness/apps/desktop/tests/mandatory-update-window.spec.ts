import { EventEmitter } from 'node:events'
import { afterEach, expect, it, vi } from 'vitest'
import type { BrowserWindow } from 'electron'
import { DesktopMandatoryUpdateWindow, type MandatoryUpdateView } from '../src/mandatory-update-window.ts'
import { MANDATORY_IPC } from '../src/mandatory-update-ipc.ts'
import { resolveDesktopLocale } from '../src/locale.ts'
import type { DesktopPolicyState } from '../src/mandatory-update-policy.ts'
import type { DesktopUpdateState } from '../src/ipc.ts'

const native = vi.hoisted(() => ({ handlers: new Map<string, (...args: unknown[]) => unknown>(),
  open: vi.fn<(...args: unknown[]) => Promise<void>>(), write: vi.fn(), read: vi.fn(), quit: vi.fn() }))
vi.mock('electron', () => ({ ipcMain: {
  handle: (channel: string, handler: (...args: unknown[]) => unknown) => native.handlers.set(channel, handler),
  removeHandler: (channel: string) => native.handlers.delete(channel),
}, app: { quit: native.quit }, shell: { openExternal: native.open }, clipboard: { writeText: native.write, readText: native.read } }))
vi.mock('../src/update-overlay.ts', () => ({ createMandatoryUpdateWindow: () => window }))

let window: ReturnType<typeof fakeWindow>
let ui: DesktopMandatoryUpdateWindow | undefined
function fakeWindow() {
  const contents = Object.assign(new EventEmitter(), { mainFrame: { url: 'dsh-app://shell/mandatory-update.html' },
    send: vi.fn(), setWindowOpenHandler: vi.fn() })
  return Object.assign(new EventEmitter(), { webContents: contents, setMenu: vi.fn(), setTitle: vi.fn(),
    loadURL: vi.fn(async () => {}), destroy: vi.fn(), isDestroyed: () => false,
    isFocused: () => true, isMinimized: () => false, focus: vi.fn(), show: vi.fn(), restore: vi.fn() })
}
afterEach(() => { ui?.dispose(); vi.clearAllMocks(); native.handlers.clear() })
function setup() {
  window = fakeWindow()
  let policy: DesktopPolicyState = { blocking: true, checking: false, page: 'https://downloads.example.com/desktop' }
  let update: DesktopUpdateState = { phase: 'ready', version: '1.0.1-nightly.1' }
  const install = vi.fn(async () => update)
  ui = new DesktopMandatoryUpdateWindow({ preload: 'owned', locale: resolveDesktopLocale('zh'),
    allowedPageOrigins: ['https://downloads.example.com'], parent: () => window as unknown as BrowserWindow,
    policy: () => policy, update: () => update, refresh: async () => {}, download: async () => update, install })
  ui.sync()
  const event = { sender: window.webContents, senderFrame: window.webContents.mainFrame }
  const view = () => native.handlers.get(MANDATORY_IPC.status)!(event) as MandatoryUpdateView
  const action = (name: string, version: string = '1.0.1-nightly.1', revision = view().confirmation?.revision) =>
    native.handlers.get(MANDATORY_IPC.action)!(event, name, version, revision)
  return { view, action, install, policy(next: DesktopPolicyState) { policy = next; ui!.sync() },
    update(next: DesktopUpdateState) { update = next; ui!.sync() } }
}

it('waits for a version-bound second click in the same modal and rejects obsolete or hidden responses', async () => {
  const f = setup()
  const pending = ui!.confirm('1.0.1-nightly.1', false)
  expect(f.view().confirmation).toEqual({ version: '1.0.1-nightly.1', active: false, revision: 1 })
  expect(window.loadURL).toHaveBeenCalledOnce()
  expect(f.install).not.toHaveBeenCalled()
  expect(() => f.action('install', '2.0.0')).toThrow(/stale/)
  expect(() => f.action('later')).toThrow(/deferral/)
  await f.action('install')
  expect(await pending).toBe(true)
  expect(f.view().confirmation).toBeUndefined()
  ui!.preparingRestart(false)
  expect(f.view().restart).toBe('preparing')
  ui!.preparingRestart(true)
  expect(f.view().restart).toBe('stopping-tasks')
  expect(window.loadURL).toHaveBeenCalledOnce()
})

it('defers without dismissing, and cancels pending approval on policy clearance or disposal', async () => {
  const f = setup()
  const deferred = ui!.confirm('1.0.1-nightly.1', true)
  await f.action('later')
  expect(await deferred).toBe(false)
  expect(f.view().deferred).toBe(true)
  expect(window.destroy).not.toHaveBeenCalled()
  const cleared = ui!.confirm('1.0.1-nightly.1', false)
  expect(() => f.action('install', '1.0.1-nightly.1', 1)).toThrow(/stale/)
  f.policy({ blocking: false, checking: false })
  expect(await cleared).toBe(false)
  ui!.preparingRestart(false)
  f.policy({ blocking: true, checking: false })
  expect(f.view().restart).toBeUndefined()
  expect(f.view().deferred).toBe(false)
  const disposed = ui!.confirm('1.0.1-nightly.1', false)
  ui!.dispose()
  expect(await disposed).toBe(false)
  expect(native.handlers.size).toBe(0)
})

it('offers copy immediately while browser opening is pending and keeps navigation failures separate', async () => {
  const f = setup()
  const opened = Promise.withResolvers<undefined>()
  native.open.mockReturnValueOnce(opened.promise)
  native.read.mockResolvedValue('https://downloads.example.com/desktop')
  const pending = f.action('page')
  expect(f.view().navigation).toEqual({ page: 'requested' })
  await f.action('copy')
  expect(f.view().navigation).toEqual({ page: 'requested', copy: 'copied' })
  opened.reject(new Error('browser rejected'))
  await pending
  expect(f.view().navigation).toEqual({ page: 'failed', copy: 'copied' })
  expect(f.view().error).toBeUndefined()
  expect(f.view().policy.blocking).toBe(true)
})

it('reports clipboard failure and ignores completion after the policy destination changes', async () => {
  const f = setup()
  native.read.mockResolvedValue('different clipboard contents')
  await f.action('page')
  await f.action('copy')
  expect(f.view().navigation?.copy).toBe('failed')
  const pendingCopy = Promise.withResolvers<undefined>()
  native.write.mockReturnValueOnce(pendingCopy.promise)
  const pending = f.action('copy')
  f.policy({ blocking: true, checking: false, page: 'https://downloads.example.com/new' })
  pendingCopy.reject(new Error('old copy failed'))
  await pending
  expect(f.view().navigation).toBeUndefined()
  f.policy({ blocking: true, checking: false, page: 'https://evil.example/desktop' })
  await expect(f.action('page')).rejects.toThrow(/no allowed/)
  expect(native.open).toHaveBeenCalledTimes(1)
})

it('rejects same-URL child frames and removes quit from renderer privileges', () => {
  const f = setup()
  const event = { sender: window.webContents, senderFrame: { ...window.webContents.mainFrame } }
  expect(() => native.handlers.get(MANDATORY_IPC.status)!(event)).toThrow(/unowned/)
  expect(() => f.action('quit')).toThrow(/invalid action/)
})

it('exits the application when the mandatory window is closed without clearing the policy', () => {
  const f = setup()
  const event = { preventDefault: vi.fn() }
  window.emit('close', event)
  expect(event.preventDefault).toHaveBeenCalledOnce()
  expect(native.quit).toHaveBeenCalledOnce()
  expect(f.view().policy.blocking).toBe(true)
})
