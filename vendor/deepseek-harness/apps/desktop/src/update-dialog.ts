/** Main-owned update confirmations; closing or replacing a dialog never grants installation permission. */
import { ipcMain, type BrowserWindow, type IpcMainInvokeEvent, type MessageBoxOptions, type MessageBoxReturnValue } from 'electron'
import type { DesktopLocale } from './locale.ts'
import { createUpdateOverlay } from './update-overlay.ts'

/** Channels available only to the isolated update-dialog document. */
export const UPDATE_DIALOG_IPC = { status: 'dsh-update-dialog:status', respond: 'dsh-update-dialog:respond' } as const

/** Text and choices supplied by the main process, never by product documents. */
export interface UpdateDialogView {
  readonly locale: string
  readonly title: string
  readonly message: string
  readonly detail: string
  readonly buttons: readonly string[]
  readonly cancelId: number
  readonly closeLabel: string
  readonly technicalDetails: string
  readonly technicalDetailsLabel: string
}

/** Electron message options with separately expandable, main-owned diagnostics. */
export interface UpdateDialogOptions extends MessageBoxOptions {
  readonly technicalDetails?: string
}

/** The document can select only a displayed response index. */
export interface UpdateDialogApi {
  status(): Promise<UpdateDialogView>
  respond(index: number): Promise<void>
}

const page = 'dsh-app://shell/update-dialog.html'

/** One replaceable confirmation window; aborted checks and mandatory policy cancel ordinary prompts. */
export class DesktopUpdateDialog {
  private disposed = false
  private active: { window: BrowserWindow; view: UpdateDialogView; finish: (index: number) => void } | undefined

  /** Focus the current explanation or confirmation without replacing it or granting permission. */
  focus(): void { this.active?.window.focus() }

  /**
   * @param preload - Bundled isolated preload.
   * @param locale - Shell-owned copy.
   */
  constructor(private readonly preload: string, private readonly locale: DesktopLocale) {
    ipcMain.handle(UPDATE_DIALOG_IPC.status, event => this.owned(event).view)
    ipcMain.handle(UPDATE_DIALOG_IPC.respond, (event, index: unknown) => {
      const active = this.owned(event)
      if (typeof index !== 'number' || !Number.isInteger(index)
        || (index !== active.view.cancelId && (index < 0 || index >= active.view.buttons.length))) {
        throw new Error('desktop update: invalid dialog response')
      }
      active.finish(index)
    })
  }

  /**
   * @param parent - Window blocked by this confirmation.
   * @param options - Main-owned localized content, response choices, and optional cancellation signal.
   * @returns A displayed response, or the cancel response when closed, replaced, aborted, or unable to load.
   */
  show(parent: BrowserWindow, options: UpdateDialogOptions): Promise<MessageBoxReturnValue> {
    this.cancel()
    const buttons = options.buttons ?? [this.locale.messages.updateAcknowledge]
    const cancelId = options.cancelId ?? buttons.length - 1
    if (this.disposed || options.signal?.aborted === true || parent.isDestroyed()) {
      return Promise.resolve({ response: cancelId, checkboxChecked: false })
    }
    const window = createUpdateOverlay(parent, this.preload, options.title ?? this.locale.messages.updateTitle)
    const view: UpdateDialogView = { locale: this.locale.id, title: options.title ?? '', message: options.message,
      detail: options.detail ?? '', buttons, cancelId, closeLabel: this.locale.messages.updateClose,
      technicalDetails: options.technicalDetails ?? '', technicalDetailsLabel: this.locale.messages.updateTechnicalDetails }
    return new Promise((resolve) => {
      const abort = (): void => { finish(cancelId) }
      const finish = (response: number): void => {
        if (this.active?.window !== window) return
        this.active = undefined
        options.signal?.removeEventListener('abort', abort)
        if (!window.isDestroyed()) window.destroy()
        resolve({ response, checkboxChecked: false })
      }
      this.active = { window, view, finish }
      options.signal?.addEventListener('abort', abort, { once: true })
      window.once('closed', abort)
      window.webContents.on('will-navigate', (event, url) => { if (url !== page) event.preventDefault() })
      window.webContents.once('render-process-gone', abort)
      void window.loadURL(page).catch(abort)
    })
  }

  /** Cancel the displayed prompt without authorizing any operation. */
  cancel(): void { this.active?.finish(this.active.view.cancelId) }

  /** Close the document and detach its private IPC handlers. */
  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.cancel()
    ipcMain.removeHandler(UPDATE_DIALOG_IPC.status)
    ipcMain.removeHandler(UPDATE_DIALOG_IPC.respond)
  }

  private owned(event: IpcMainInvokeEvent): NonNullable<DesktopUpdateDialog['active']> {
    const active = this.active
    if (active === undefined || event.sender !== active.window.webContents
      || event.senderFrame !== active.window.webContents.mainFrame || event.senderFrame.url !== page) {
      throw new Error('desktop update: rejected unowned dialog renderer')
    }
    return active
  }
}
