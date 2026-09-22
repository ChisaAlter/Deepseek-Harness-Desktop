import { EventEmitter } from 'node:events'
import { expect, it, vi } from 'vitest'
import type { BrowserWindow, BrowserWindowConstructorOptions } from 'electron'
import { createMandatoryUpdateWindow } from '../src/update-overlay.ts'

const native = vi.hoisted(() => ({ create: vi.fn<(options: BrowserWindowConstructorOptions) => object>() }))
vi.mock('electron', () => ({ BrowserWindow: function (options: object) { return native.create(options) } }))

it('gives the Windows mandatory modal native move, resize, and maximize controls', () => {
  const window = Object.assign(new EventEmitter(), {
    webContents: { setWindowOpenHandler: vi.fn() }, show: vi.fn(), isDestroyed: () => false,
  })
  native.create.mockReturnValue(window)
  const parent = {} as BrowserWindow
  expect(createMandatoryUpdateWindow(parent, 'owned', 'Update required', 'win32')).toBe(window)
  expect(native.create).toHaveBeenCalledWith(expect.objectContaining({
    parent, modal: true, show: false, title: 'Update required',
    movable: true, resizable: true, maximizable: true,
    minWidth: 480, minHeight: 360,
  }))
  const options = native.create.mock.calls[0]![0]
  expect(options.webPreferences).toMatchObject({ preload: 'owned', sandbox: true, nodeIntegration: false })
  expect(options).not.toHaveProperty('frame', false)
  window.emit('ready-to-show')
  expect(window.show).toHaveBeenCalledOnce()
  expect(window.webContents.setWindowOpenHandler).toHaveBeenCalledOnce()
})
