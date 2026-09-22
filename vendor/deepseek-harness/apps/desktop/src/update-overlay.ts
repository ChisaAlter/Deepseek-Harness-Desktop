/** Shell-owned modal windows cover the parent's content without replacing its native window controls. */
import { BrowserWindow } from 'electron'

/**
 * @param parent - Product window whose content is blocked while the overlay is open.
 * @param preload - Isolated shell-only preload.
 * @param title - Localized window title.
 * @returns A transparent child that follows its parent's content bounds and releases its listeners on close.
 */
export function createUpdateOverlay(parent: BrowserWindow, preload: string, title: string): BrowserWindow {
  const window = new BrowserWindow({
    parent, modal: true, show: false, frame: false, transparent: true,
    ...parent.getContentBounds(), resizable: false, minimizable: false, maximizable: false,
    skipTaskbar: true, hasShadow: false, title,
    webPreferences: { preload, contextIsolation: true, sandbox: true, nodeIntegration: false, webSecurity: true },
  })
  const follow = (): void => { if (!window.isDestroyed()) window.setBounds(parent.getContentBounds()) }
  parent.on('move', follow)
  parent.on('resize', follow)
  let closed = false
  let blur: string | undefined
  const unblur = (): void => {
    if (blur === undefined || parent.isDestroyed()) return
    void parent.webContents.removeInsertedCSS(blur).catch((error: unknown) => { console.warn('desktop update: could not remove background blur', error) })
    blur = undefined
  }
  void parent.webContents.insertCSS('body { filter: blur(2px) !important; }').then((key) => {
    blur = key
    if (closed) unblur()
  }).catch((error: unknown) => { console.warn('desktop update: could not blur background', error) })
  window.once('closed', () => { closed = true; unblur() })
  window.once('closed', () => { parent.off('move', follow); parent.off('resize', follow) })
  window.once('ready-to-show', () => { if (!window.isDestroyed()) window.show() })
  window.setMenu(null)
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  return window
}

/** A native Windows modal retains its own title bar while the product window remains blocked. */
export function createMandatoryUpdateWindow(parent: BrowserWindow, preload: string, title: string,
  platform: NodeJS.Platform = process.platform): BrowserWindow {
  if (platform !== 'win32') return createUpdateOverlay(parent, preload, title)
  const window = new BrowserWindow({
    parent, modal: true, show: false, title,
    width: 640, height: 560, minWidth: 480, minHeight: 360,
    movable: true, resizable: true, maximizable: true,
    backgroundColor: '#f5f5f5',
    webPreferences: { preload, contextIsolation: true, sandbox: true, nodeIntegration: false, webSecurity: true },
  })
  window.once('ready-to-show', () => { if (!window.isDestroyed()) window.show() })
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  return window
}
