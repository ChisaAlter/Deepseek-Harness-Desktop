import { JSDOM } from 'jsdom'
import { afterEach, expect, it, vi } from 'vitest'
import { installMandatoryUpdateOverlay } from '../src/preload-mandatory-overlay.ts'
import { syncWindowsAppearance } from '../src/preload-windows.ts'
import { DESKTOP_IPC, type DshDesktopProductApi } from '../src/ipc.ts'

const electron = vi.hoisted(() => ({
  contextBridge: { exposeInMainWorld: vi.fn() },
  ipcRenderer: { invoke: vi.fn(), on: vi.fn(), off: vi.fn(), send: vi.fn() },
  webUtils: { getPathForFile: vi.fn() },
}))
vi.mock('electron', () => electron)
vi.mock('../src/preload-platform.ts', () => ({ markDocumentPlatform: vi.fn(), syncWindowFullscreen: vi.fn() }))
vi.mock('../src/preload-theme.ts', () => ({ syncNativeTheme: vi.fn() }))
vi.mock('../src/preload-windows.ts', () => ({ syncWindowsAppearance: vi.fn() }))
vi.mock('../src/preload-mandatory-overlay.ts', () => ({ installMandatoryUpdateOverlay: vi.fn() }))

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.clearAllMocks(); vi.resetModules() })

it('limits product documents to update status and a native confirmation action', async () => {
  vi.stubGlobal('location', new URL('dsh-app://app/index.html'))
  await import('../src/preload-app.ts')
  const api = electron.contextBridge.exposeInMainWorld.mock.calls.find(([name]) => name === 'dshDesktop')?.[1] as DshDesktopProductApi
  await api.updates.status()
  await api.updates.open()
  expect(electron.ipcRenderer.invoke.mock.calls).toEqual([[DESKTOP_IPC.updatesStatus], [DESKTOP_IPC.updatesOpen]])
  expect(api).not.toHaveProperty('plugins')
  expect(api).not.toHaveProperty('backend')
  expect(api.updates).not.toHaveProperty('install')
  const listener = vi.fn()
  const dispose = api.updates.subscribe(listener)
  const handler = electron.ipcRenderer.on.mock.calls.find(([channel]) => channel === DESKTOP_IPC.updatesPresentation)?.[1] as
    (event: unknown, state: unknown) => void
  handler({}, { visible: false })
  expect(listener).toHaveBeenCalledWith({ visible: false })
  dispose()
  expect(electron.ipcRenderer.off).toHaveBeenCalledWith(DESKTOP_IPC.updatesPresentation, handler)
})

it.each(['dsh-app://shell/plugin-manager.html', 'dsh-app://other/index.html', 'https://shell/startup.html', 'http://example.com/'])('exposes only the carrier marker to %s', async (url) => {
  vi.stubGlobal('location', new URL(url))
  await import('../src/preload-app.ts')
  expect(electron.contextBridge.exposeInMainWorld).toHaveBeenCalledWith('dshDesktop', { protocolVersion: 1 })
  expect(electron.ipcRenderer.on.mock.calls.some(([channel]) => channel === DESKTOP_IPC.browserOpenRequested)).toBe(false)
})

it('exposes asynchronous boot only to the local application document', async () => {
  vi.stubGlobal('location', new URL('dsh-app://app/'))
  await import('../src/preload-app.ts')
  const api = electron.contextBridge.exposeInMainWorld.mock.calls.find(([name]) => name === 'dshDesktopBoot')?.[1] as { ready(): Promise<unknown>; failed(message: string): Promise<void> }
  await api.ready()
  await api.failed('client mount failed')
  expect(electron.ipcRenderer.invoke).toHaveBeenCalledWith(DESKTOP_IPC.bootFailed, 'client mount failed')
  expect(electron.ipcRenderer.invoke).toHaveBeenCalledWith(DESKTOP_IPC.boot)
  vi.resetModules()
  electron.contextBridge.exposeInMainWorld.mockClear()
  vi.stubGlobal('location', new URL('https://other.example/'))
  await import('../src/preload-app.ts')
  expect(electron.contextBridge.exposeInMainWorld.mock.calls.some(([name]) => name === 'dshDesktopBoot')).toBe(false)
})

it('exposes a directory picker only to the local application document', async () => {
  vi.stubGlobal('location', new URL('dsh-app://app/'))
  await import('../src/preload-app.ts')
  const api = electron.contextBridge.exposeInMainWorld.mock.calls.find(([name]) => name === '__DSH_DIRECTORY_PICKER__')?.[1] as { pick(): Promise<string | null> }
  electron.ipcRenderer.invoke.mockResolvedValue('/workspace')
  await expect(api.pick()).resolves.toBe('/workspace')
  expect(electron.ipcRenderer.invoke).toHaveBeenCalledExactlyOnceWith(DESKTOP_IPC.directoryPick)
  for (const url of ['dsh-app://shell/startup.html', 'https://example.com/']) {
    vi.resetModules()
    electron.contextBridge.exposeInMainWorld.mockClear()
    vi.stubGlobal('location', new URL(url))
    await import('../src/preload-app.ts')
    expect(electron.contextBridge.exposeInMainWorld.mock.calls.some(([name]) => name === '__DSH_DIRECTORY_PICKER__')).toBe(false)
  }
})

it('reports host paths of picked files only to the local application document', async () => {
  vi.stubGlobal('location', new URL('dsh-app://app/'))
  await import('../src/preload-app.ts')
  const api = electron.contextBridge.exposeInMainWorld.mock.calls.find(([name]) => name === '__DSH_HOST_PATHS__')?.[1] as { pathFor(file: File): string }
  const picked = new File(['x'], 'notes.md')
  electron.webUtils.getPathForFile.mockReturnValue('/Users/me/notes.md')
  expect(api.pathFor(picked)).toBe('/Users/me/notes.md')
  expect(electron.webUtils.getPathForFile).toHaveBeenCalledExactlyOnceWith(picked)
  for (const url of ['dsh-app://shell/startup.html', 'https://example.com/']) {
    vi.resetModules()
    electron.contextBridge.exposeInMainWorld.mockClear()
    vi.stubGlobal('location', new URL(url))
    await import('../src/preload-app.ts')
    expect(electron.contextBridge.exposeInMainWorld.mock.calls.some(([name]) => name === '__DSH_HOST_PATHS__')).toBe(false)
  }
})

it.each(['dsh-app://app/', 'dsh-app://shell/plugin-manager.html', 'https://example.com/'])(
  'installs Windows appearance only for the application document (%s)', async (url) => {
    vi.stubGlobal('location', new URL(url))
    await import('../src/preload-app.ts')
    expect(syncWindowsAppearance).toHaveBeenCalledTimes(url === 'dsh-app://app/' ? 1 : 0)
  },
)

it('moves welcome-entry focus to the document without changing keyboard tab order', async () => {
  const dom = new JSDOM('<body><button>Sidebar</button><input></body>')
  try {
    vi.stubGlobal('document', dom.window.document)
    vi.stubGlobal('location', new URL('dsh-app://app/'))
    await import('../src/preload-app.ts')
    const enter = electron.ipcRenderer.on.mock.calls.find(([channel]) => channel === DESKTOP_IPC.enterWorkspace)![1] as () => void
    const button = dom.window.document.querySelector('button')!
    button.focus()
    enter()
    expect(dom.window.document.activeElement).toBe(dom.window.document.body)
    expect(dom.window.document.body.hasAttribute('tabindex')).toBe(false)
    expect(button.tabIndex).toBe(0)
    dom.window.document.body.setAttribute('tabindex', '-1')
    button.focus()
    enter()
    expect(dom.window.document.body.getAttribute('tabindex')).toBe('-1')
  } finally { dom.window.close() }
})

it.each(['win32', 'darwin'] as const)('installs the embedded mandatory UI only in the Windows app document (%s)', async (platform) => {
  vi.spyOn(process, 'platform', 'get').mockReturnValue(platform)
  for (const url of ['dsh-app://app/', 'dsh-app://shell/mandatory-update.html', 'https://example.com/']) {
    vi.resetModules()
    vi.mocked(installMandatoryUpdateOverlay).mockClear()
    vi.stubGlobal('location', new URL(url))
    await import('../src/preload-app.ts')
    expect(installMandatoryUpdateOverlay).toHaveBeenCalledTimes(platform === 'win32' && url === 'dsh-app://app/' ? 1 : 0)
  }
})
