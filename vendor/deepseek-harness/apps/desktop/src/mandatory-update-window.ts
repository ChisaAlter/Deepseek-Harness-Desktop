/** Shell-owned modal policy UI; only explicit actions authorize downloads or browser navigation. */

import { app, BrowserWindow, clipboard, ipcMain, shell, type IpcMainInvokeEvent } from 'electron'
import type { DesktopLocale } from './locale.ts'
import type { DesktopUpdateState } from './ipc.ts'
import { desktopPolicyPage, type DesktopPolicyState } from './mandatory-update-policy.ts'
import { MANDATORY_IPC } from './mandatory-update-ipc.ts'
import { createMandatoryUpdateWindow } from './update-overlay.ts'
import { DesktopUpdateAttention } from './update-attention.ts'

/** A renderer action never carries a URL or authorizes a different version. */
export type MandatoryUpdateAction = 'refresh' | 'download' | 'install' | 'later' | 'page' | 'copy'

/** Combined view rendered as text by the shell-owned page. */
export interface MandatoryUpdateView {
  readonly locale: DesktopLocale
  readonly policy: DesktopPolicyState
  readonly update: DesktopUpdateState
  readonly error?: string
  readonly confirmation?: { readonly version: string; readonly active: boolean; readonly revision: number }
  readonly deferred: boolean
  readonly restart?: 'stopping-tasks' | 'preparing'
  readonly navigation?: { readonly page: 'requested' | 'failed'; readonly copy?: 'copied' | 'failed' }
}

/** Narrow isolated bridge, absent from product and plugin documents. */
export interface MandatoryUpdateApi {
  status(): Promise<MandatoryUpdateView>
  action(action: MandatoryUpdateAction, version?: string, confirmationRevision?: number): Promise<void>
  subscribe(listener: (state: MandatoryUpdateView) => void): () => void
}

/** Main-process operations owned by the policy client, updater, and application lifecycle. */
export interface MandatoryUpdateWindowOptions {
  readonly preload: string
  readonly locale: DesktopLocale
  readonly allowedPageOrigins: readonly string[]
  readonly parent: () => BrowserWindow | undefined
  readonly policy: () => DesktopPolicyState
  readonly update: () => DesktopUpdateState
  readonly refresh: () => Promise<void>
  readonly download: (version: string) => Promise<DesktopUpdateState>
  readonly install: (version: string) => Promise<DesktopUpdateState>
}

const page = 'dsh-app://shell/mandatory-update.html'

/** A modal child blocks the product window without cancelling work in the Host. */
export class DesktopMandatoryUpdateWindow {
  private window: BrowserWindow | undefined
  private disposed = false
  private error: string | undefined
  private action: Promise<void> | undefined
  private confirmation: { version: string; active: boolean; revision: number; resolve: (approved: boolean) => void } | undefined
  private confirmationRevision = 0
  private deferred = false
  private restart: MandatoryUpdateView['restart']
  private navigation: MandatoryUpdateView['navigation']
  private navigationUrl: string | undefined
  private navigationEpoch = 0
  private readonly attention: DesktopUpdateAttention

  /** @param options - Main-process actions and immutable deployment/navigation settings. */
  constructor(private readonly options: MandatoryUpdateWindowOptions) {
    this.attention = new DesktopUpdateAttention(options.locale)
    ipcMain.handle(MANDATORY_IPC.status, (event) => { this.assertSender(event); return this.view() })
    ipcMain.handle(MANDATORY_IPC.action, (event, action: unknown, version: unknown, confirmationRevision: unknown) => {
      this.assertSender(event)
      if (!this.options.policy().blocking) throw new Error('desktop policy: no mandatory decision is active')
      if (typeof action !== 'string' || !['refresh', 'download', 'install', 'later', 'page', 'copy'].includes(action)) throw new Error('desktop policy: invalid action')
      if (['download', 'install', 'later'].includes(action) && typeof version !== 'string') throw new Error('desktop policy: missing confirmed version')
      if (action === 'page' || action === 'copy') return this.navigate(action)
      if (this.confirmation !== undefined && (action === 'install' || action === 'later')) {
        if (version !== this.confirmation.version || confirmationRevision !== this.confirmation.revision) {
          throw new Error('desktop policy: stale installation confirmation')
        }
        if (action === 'later' && !this.confirmation.active) throw new Error('desktop policy: no task deferral is offered')
        this.deferred = action === 'later'
        this.finishConfirmation(action === 'install')
        this.sync()
        return Promise.resolve()
      }
      if (action === 'later') throw new Error('desktop policy: no installation confirmation')
      this.action ??= Promise.resolve().then(async () => {
        this.error = undefined
        this.restart = undefined
        this.deferred = false
        this.clearNavigation()
        if (action === 'download') this.attention.reset()
        this.sync()
        switch (action) {
          case 'refresh': await this.options.refresh(); break
          case 'download': await this.options.download(version as string); break
          case 'install': await this.options.install(version as string); break
        }
      }).catch(() => {
        this.error = this.options.locale.messages.mandatoryActionFailed
      }).finally(() => { this.action = undefined; this.sync() })
      return this.action
    })
  }

  /** Active modal used as the owner of shell installation-confirmation dialogs. */
  get confirmationWindow(): BrowserWindow | undefined { return this.window }

  /**
   * @param version - Updater-owned target, already downloaded and verified.
   * @param active - Fresh Host task inspection; unknown state must fail before calling.
   * @returns Explicit approval from this same modal, or false on deferral, policy clearance, or disposal.
   */
  confirm(version: string, active: boolean): Promise<boolean> {
    if (this.disposed || !this.options.policy().blocking) return Promise.resolve(false)
    this.finishConfirmation(false)
    this.deferred = false
    this.restart = undefined
    return new Promise((resolve) => {
      this.confirmation = { version, active, revision: ++this.confirmationRevision, resolve }
      this.sync()
      const parent = this.options.parent()
      if (parent !== undefined && this.window !== undefined) {
        this.attention.ready(version, parent, this.window, () => {
          if (!this.disposed && this.options.policy().blocking && this.confirmation !== undefined) this.focus()
        })
      } else this.finishConfirmation(false)
    })
  }

  /** @param active - Whether admitted tasks are actually being stopped after installation approval. */
  preparingRestart(active: boolean): void {
    this.restart = active ? 'stopping-tasks' : 'preparing'
    this.attention.clear()
    this.sync()
  }

  /** Publish current status, create the block immediately, or close it only after policy clearance. */
  sync(): void {
    if (this.disposed) return
    if (!this.options.policy().blocking) {
      this.finishConfirmation(false)
      this.attention.reset()
      this.clearNavigation()
      this.restart = undefined
      this.deferred = false
      this.window?.destroy()
      this.window = undefined
      this.error = undefined
      return
    }
    if (this.navigationUrl !== this.options.policy().page) this.clearNavigation()
    if (this.options.update().phase === 'error') this.restart = undefined
    if (this.window === undefined) {
      const parent = this.options.parent()
      if (parent === undefined) return
      const window = createMandatoryUpdateWindow(parent, this.options.preload, this.options.locale.messages.mandatoryTitle)
      this.window = window
      window.setMenu(null)
      window.on('close', (event) => { if (!this.disposed && this.options.policy().blocking) { event.preventDefault(); app.quit() } })
      window.on('closed', () => { if (this.window === window) this.window = undefined })
      window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
      window.webContents.on('will-navigate', (event, url) => { if (url !== page) event.preventDefault() })
      window.webContents.on('render-process-gone', () => {
        if (!this.disposed) void window.loadURL(page).catch(() => {
          // A failed recovery keeps the parent blocked and leaves application exit available.
          if (!window.isDestroyed()) window.setTitle(this.options.locale.messages.mandatoryActionFailed)
        })
      })
      void window.loadURL(page).catch(() => {
        // The parent stays modal-blocked if its dedicated recovery document cannot load.
        if (!window.isDestroyed()) window.setTitle(this.options.locale.messages.mandatoryActionFailed)
      })
    }
    this.window.webContents.send(MANDATORY_IPC.state, this.view())
  }

  /** Focus the block instead of opening ordinary product or plugin interactions. */
  focus(): void {
    this.sync()
    const parent = this.options.parent()
    if (parent?.isMinimized()) parent.restore()
    parent?.show()
    this.window?.show()
    this.window?.focus()
  }

  /** Detach IPC and release the modal during application shutdown. */
  dispose(): void {
    this.disposed = true
    this.finishConfirmation(false)
    this.attention.reset()
    this.clearNavigation()
    ipcMain.removeHandler(MANDATORY_IPC.status)
    ipcMain.removeHandler(MANDATORY_IPC.action)
    this.window?.destroy()
    this.window = undefined
  }

  private view(): MandatoryUpdateView {
    return { locale: this.options.locale, policy: this.options.policy(), update: this.options.update(),
      deferred: this.deferred,
      ...(this.confirmation === undefined ? {}
        : { confirmation: { version: this.confirmation.version, active: this.confirmation.active, revision: this.confirmation.revision } }),
      ...(this.restart === undefined ? {} : { restart: this.restart }),
      ...(this.navigation === undefined ? {} : { navigation: this.navigation }),
      ...(this.error === undefined ? {} : { error: this.error }) }
  }

  private finishConfirmation(approved: boolean): void {
    const confirmation = this.confirmation
    this.confirmation = undefined
    this.attention.clear()
    confirmation?.resolve(approved)
  }

  private clearNavigation(): void {
    this.navigation = undefined
    this.navigationUrl = undefined
    this.navigationEpoch++
  }

  private async navigate(action: 'page' | 'copy'): Promise<void> {
    const url = desktopPolicyPage(this.options.policy().page, this.options.allowedPageOrigins)
    if (url === undefined) throw new Error('desktop policy: no allowed download page')
    if (this.navigationUrl !== url) this.clearNavigation()
    this.navigationUrl = url
    if (action === 'page') {
      this.navigation = { page: 'requested' }
      this.navigationEpoch++
    }
    const epoch = this.navigationEpoch
    this.sync()
    try {
      if (action === 'copy') {
        await clipboard.writeText(url)
        if (await clipboard.readText() !== url) throw new Error('desktop policy: clipboard did not retain download address')
      }
      else await shell.openExternal(url)
      if (epoch !== this.navigationEpoch || this.disposed) return
      if (action === 'copy') this.navigation = { page: this.navigation?.page ?? 'requested', copy: 'copied' }
    } catch {
      if (epoch !== this.navigationEpoch || this.disposed) return
      this.navigation = action === 'page' ? { ...this.navigation, page: 'failed' }
        : { page: this.navigation?.page ?? 'requested', copy: 'failed' }
    }
    this.sync()
  }

  private assertSender(event: IpcMainInvokeEvent): void {
    if (event.sender !== this.window?.webContents || event.senderFrame !== this.window.webContents.mainFrame
      || event.senderFrame.url !== page) throw new Error('desktop policy: rejected unowned renderer')
  }
}
