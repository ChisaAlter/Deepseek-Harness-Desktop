/** Isolated Platform documents owned by the desktop account lifetime. */
import type { EventEmitter } from 'node:events'
import { randomUUID } from 'node:crypto'
import { WebContentsView, session, shell, type View, type WebFrameMain } from 'electron'
import { mergePlatformCookies, type PlatformSession } from '@deepseek-ai/dsh-deepseek-account'

import { PLATFORM_IPC, type PlatformLocale } from './platform-ipc.ts'

export { PLATFORM_IPC } from './platform-ipc.ts'

/** Bounds in desktop content coordinates, supplied by the owned application renderer. */
export interface PlatformBounds { x: number; y: number; width: number; height: number }

/**
 * Decode the renderer rectangle before allocating a native view.
 * @param value - IPC payload.
 * @returns finite, nonnegative integer coordinates.
 */
export function platformBounds(value: unknown): PlatformBounds {
  if (typeof value !== 'object' || value === null) throw new Error('Invalid Platform bounds')
  const row = value as Record<string, unknown>
  const result: PlatformBounds = { x: 0, y: 0, width: 0, height: 0 }
  for (const key of ['x', 'y', 'width', 'height'] as const) {
    const n = row[key]
    if (typeof n !== 'number' || !Number.isFinite(n) || n < 0 || n > 100_000) throw new Error('Invalid Platform bounds')
    result[key] = Math.round(n)
  }
  return result
}

type PlatformOwner = Pick<EventEmitter, 'on' | 'removeListener'> & {
  webContents: Pick<EventEmitter, 'on' | 'removeListener'>
  contentView: Pick<View, 'addChildView' | 'removeChildView'>
  isDestroyed(): boolean
}

type PlatformSender = { sender: object; senderFrame: Pick<WebFrameMain, 'url'> | null }

/** Native view and its credential snapshot are discarded together. */
export class DesktopPlatformView {
  private account: PlatformSession | null = null
  private view: WebContentsView | undefined
  private owner: PlatformOwner | undefined
  private releaseOwner: (() => void) | undefined
  private generation = 0

  /**
   * @param preload - bundled sandboxed Platform preload path.
   * @param getLocale - current resolved Desktop language.
   */
  constructor(private readonly preload: string, private readonly getLocale: () => PlatformLocale) {}

  /** @param next - private Host credential snapshot; replacement invalidates the current document. */
  setSession(next: PlatformSession | null): void {
    if (next?.token === this.account?.token && next?.origin === this.account?.origin
      && next?.embeddedPageDist === this.account?.embeddedPageDist
      && JSON.stringify(next?.requestHeaders) === JSON.stringify(this.account?.requestHeaders)) return
    this.close()
    this.account = next
  }

  /**
   * Create an in-memory browser session after account preparation has completed.
   * @param owner - application window containing the view.
   * @param page - explicit supported Platform page.
   * @param bounds - owned renderer rectangle.
   * @returns when the document finishes loading.
   */
  async open(owner: PlatformOwner, page: 'usage' | 'top-up', bounds: PlatformBounds): Promise<void> {
    this.close()
    const account = this.account
    if (account === null) throw new Error('Platform account unavailable')
    const generation = this.generation
    const browserSession = session.fromPartition(`dsh-platform-${randomUUID()}`)
    browserSession.setPermissionRequestHandler((_contents, _permission, callback) => { callback(false) })
    browserSession.setPermissionCheckHandler(() => false)
    const deploymentHeaders = account.requestHeaders ?? {}
    const injectedRequests = new Set<number>()
    browserSession.webRequest.onCompleted((details) => { injectedRequests.delete(details.id) })
    browserSession.webRequest.onErrorOccurred((details) => { injectedRequests.delete(details.id) })
    browserSession.webRequest.onBeforeSendHeaders((details, callback) => {
      let headers = Object.fromEntries(Object.entries(details.requestHeaders).map(([name, value]) => [name.toLowerCase(), value]))
      if (new URL(details.url).origin === account.origin) {
        injectedRequests.add(details.id)
        const cookie = headers.cookie ?? ''
        Object.assign(headers, deploymentHeaders)
        if (deploymentHeaders.cookie !== undefined) headers.cookie = mergePlatformCookies(cookie, deploymentHeaders.cookie)
      } else if (injectedRequests.has(details.id)) {
        // Redirected subresources must not carry deployment headers to another origin.
        headers = Object.fromEntries(Object.entries(headers).filter(([name]) => !Object.hasOwn(deploymentHeaders, name)))
      }
      callback({ requestHeaders: headers })
    })
    const view = new WebContentsView({ webPreferences: {
      session: browserSession, preload: this.preload, sandbox: true, contextIsolation: true,
      additionalArguments: [`--dsh-platform-origin=${account.origin}`],
      nodeIntegration: false, webSecurity: true,
    } })
    this.view = view
    this.owner = owner
    const closeOwnedView = () => { if (this.view === view) this.close() }
    const navigateOwner = (_event: Electron.Event, _url: string, isInPlace: boolean, isMainFrame: boolean) => {
      if (isMainFrame && !isInPlace) closeOwnedView()
    }
    // Renderer document replacement does not run React effect cleanup.
    owner.webContents.on('did-start-navigation', navigateOwner)
    owner.webContents.on('render-process-gone', closeOwnedView)
    owner.webContents.on('destroyed', closeOwnedView)
    owner.on('closed', closeOwnedView)
    this.releaseOwner = () => {
      owner.webContents.removeListener('did-start-navigation', navigateOwner)
      owner.webContents.removeListener('render-process-gone', closeOwnedView)
      owner.webContents.removeListener('destroyed', closeOwnedView)
      owner.removeListener('closed', closeOwnedView)
    }
    // External payment and documentation pages open without the embedded session or token.
    view.webContents.setWindowOpenHandler(({ url }) => {
      const destination = new URL(url)
      if (destination.protocol === 'https:' && !destination.username && !destination.password) {
        void shell.openExternal(url).catch(() => {
          // An OS browser-launch failure leaves the embedded page available for retry.
        })
      }
      return { action: 'deny' }
    })
    const allowNavigation = (url: string): boolean => {
      try {
        const parsed = new URL(url)
        return parsed.origin === account.origin && !parsed.username && !parsed.password
      } catch { return false }
    }
    view.webContents.on('will-navigate', (event, url) => { if (!allowNavigation(url)) event.preventDefault() })
    view.webContents.on('will-redirect', (event, url) => { if (!allowNavigation(url)) event.preventDefault() })
    view.webContents.on('will-attach-webview', (event) => { event.preventDefault() })
    view.webContents.on('preload-error', () => { if (this.view === view) this.close() })
    view.webContents.on('render-process-gone', () => { if (this.view === view) this.close() })
    view.setVisible(false)
    owner.contentView.addChildView(view)
    view.setBounds(bounds)
    try {
      const url = new URL(page === 'usage' ? '/usage' : '/top_up', account.origin)
      if (account.embeddedPageDist) url.searchParams.set('dist', account.embeddedPageDist)
      await view.webContents.loadURL(url.href)
    } catch (error) {
      // A Platform document may replace its own URL before the first load settles (for example to
      // consume an embedded deployment parameter); that aborts loadURL with ERR_ABORTED instead of
      // reporting a failed document, so the owned view stays open like the application window.
      const aborted = error instanceof Error && 'code' in error && error.code === 'ERR_ABORTED'
      if (!aborted) {
        if (generation === this.generation) this.close()
        throw error
      }
    }
    if (generation === this.generation && this.view === view) view.setVisible(true)
  }

  /** @param bounds - current application viewport rectangle. */
  setBounds(bounds: PlatformBounds): void { this.view?.setBounds(bounds) }

  /**
   * Return prepared credentials and resolved language only to the current Platform main frame.
   * @param event - Electron-provided sender identity.
   * @returns credentials and current language copied into the isolated preload.
   */
  bootstrap(event: PlatformSender): Pick<PlatformSession, 'origin' | 'token'> & { locale: PlatformLocale } {
    const view = this.view
    const account = this.account
    if (view === undefined || account === null || event.sender !== view.webContents
      || event.senderFrame !== view.webContents.mainFrame || new URL(event.senderFrame.url).origin !== account.origin) {
      throw new Error('Rejected Platform bootstrap')
    }
    return { origin: account.origin, token: account.token, locale: this.getLocale() }
  }

  /** Notify the current document after the Desktop language changes. */
  notifyLocaleChanged(): void {
    const view = this.view
    if (view !== undefined && !view.webContents.isDestroyed()) {
      view.webContents.send(PLATFORM_IPC.localeChanged, this.getLocale())
    }
  }

  /** Destroy the document before releasing its temporary browser storage. */
  close(): void {
    this.generation++
    const view = this.view
    this.view = undefined
    this.releaseOwner?.()
    this.releaseOwner = undefined
    if (view === undefined) return
    if (this.owner !== undefined && !this.owner.isDestroyed()) this.owner.contentView.removeChildView(view)
    this.owner = undefined
    const browserSession = view.webContents.session
    if (!view.webContents.isDestroyed()) view.webContents.close()
    void browserSession.clearStorageData().catch(() => {
      // The non-persistent partition is unreachable after its only view is closed.
    })
  }
}
