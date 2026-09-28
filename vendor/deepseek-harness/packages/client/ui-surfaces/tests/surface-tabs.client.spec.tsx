// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { en } from '../src/client/locales.ts'
import type { SurfaceTabsProps } from '../src/client/SurfaceTabs.tsx'
import { SurfaceTabs } from '../src/client/SurfaceTabs.tsx'
import type { OpenableKind, Surface } from '../src/client/stores.ts'

const t: SurfaceTabsProps['t'] = key => (en as Record<string, string>)[key] ?? key

const FILES: Surface = { id: 'files', kind: 'files' }
const DIFF: Surface = { id: 'diff', kind: 'diff' }
const FILE: Surface = { id: 'file:README.md', kind: 'file', relativePath: 'README.md' }

const OPENABLE: Record<OpenableKind, boolean> = {
  preview: true,
  terminal: true,
  files: false,
  diff: true,
  agents: true,
}

function mount(opts: {
  surfaces?: readonly Surface[]
  openable?: Record<OpenableKind, boolean>
} = {}) {
  const onActivate = vi.fn()
  const onClose = vi.fn()
  const onCloseOthers = vi.fn()
  const onCloseToRight = vi.fn()
  const onCloseAll = vi.fn()
  const onOpenKind = vi.fn()
  const onMenuOpenChange = vi.fn()
  render(
    <SurfaceTabs
      surfaces={opts.surfaces ?? [FILES, FILE]}
      activeId="files"
      onActivate={onActivate}
      onClose={onClose}
      onCloseOthers={onCloseOthers}
      onCloseToRight={onCloseToRight}
      onCloseAll={onCloseAll}
      onOpenKind={onOpenKind}
      onMenuOpenChange={onMenuOpenChange}
      openable={opts.openable ?? OPENABLE}
      t={t}
    />,
  )
  return { onActivate, onClose, onCloseOthers, onCloseToRight, onCloseAll, onOpenKind, onMenuOpenChange }
}

afterEach(cleanup)

describe('SurfaceTabs', () => {
  it('opens a kind from the add menu and disables kinds that are already open', () => {
    const b = mount()
    fireEvent.click(screen.getByRole('button', { name: 'Open a surface' }))
    expect(b.onMenuOpenChange).toHaveBeenLastCalledWith(true)
    const filesItem = screen.getByRole('menuitem', { name: 'Files' })
    expect(filesItem).toHaveProperty('disabled', true)
    fireEvent.click(screen.getByRole('menuitem', { name: 'Terminal' }))
    expect(b.onMenuOpenChange).toHaveBeenLastCalledWith(false)
    expect(b.onOpenKind).toHaveBeenCalledWith('terminal')
  })

  it('closes a tab on middle click', () => {
    const b = mount()
    const tab = screen.getByRole('button', { name: 'Files' }).parentElement
    fireEvent.mouseDown(tab!, { button: 1 })
    expect(b.onClose).toHaveBeenCalledWith('files')
  })

  it('offers close actions from the tab context menu', () => {
    const b = mount({ surfaces: [FILES, DIFF, FILE] })
    fireEvent.contextMenu(screen.getByRole('button', { name: 'Files' }).parentElement!)
    expect(b.onMenuOpenChange).toHaveBeenLastCalledWith(true)
    fireEvent.click(screen.getByRole('menuitem', { name: 'Close others' }))
    expect(b.onMenuOpenChange).toHaveBeenLastCalledWith(false)
    expect(b.onCloseOthers).toHaveBeenCalledWith('files')
  })

  it('closes this tab, tabs to the right, and all tabs from the context menu', () => {
    const b = mount({ surfaces: [FILES, DIFF, FILE] })
    fireEvent.contextMenu(screen.getByRole('button', { name: 'Diff' }).parentElement!)
    fireEvent.click(screen.getByRole('menuitem', { name: 'Close' }))
    expect(b.onClose).toHaveBeenCalledWith('diff')

    fireEvent.contextMenu(screen.getByRole('button', { name: 'Files' }).parentElement!)
    fireEvent.click(screen.getByRole('menuitem', { name: 'Close to the right' }))
    expect(b.onCloseToRight).toHaveBeenCalledWith('files')

    fireEvent.contextMenu(screen.getByRole('button', { name: 'README.md' }).parentElement!)
    fireEvent.click(screen.getByRole('menuitem', { name: 'Close all' }))
    expect(b.onCloseAll).toHaveBeenCalledOnce()
  })

  it('labels preview, terminal, and agents tabs', () => {
    mount({
      surfaces: [
        { id: 'browser:new', kind: 'preview' },
        { id: 'terminal:new', kind: 'terminal' },
        { id: 'agents', kind: 'agents' },
        { id: 'file:nested/a.ts', kind: 'file', relativePath: 'nested/a.ts' },
      ],
    })
    expect(screen.getByRole('button', { name: 'Browser' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Terminal' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Agents' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'a.ts' })).toBeTruthy()
  })

  it('maps vertical wheel to horizontal scroll when the strip overflows', () => {
    mount()
    const bar = document.querySelector('[data-surfaces-tabs]') as HTMLDivElement
    Object.defineProperty(bar, 'scrollWidth', { configurable: true, value: 400 })
    Object.defineProperty(bar, 'clientWidth', { configurable: true, value: 80 })
    bar.scrollLeft = 0
    bar.dispatchEvent(new WheelEvent('wheel', { deltaY: 30, bubbles: true, cancelable: true }))
    expect(bar.scrollLeft).toBe(30)
    bar.dispatchEvent(new WheelEvent('wheel', { deltaY: 0, deltaX: 10, bubbles: true, cancelable: true }))
    expect(bar.scrollLeft).toBe(30)
    Object.defineProperty(bar, 'scrollWidth', { configurable: true, value: 80 })
    bar.dispatchEvent(new WheelEvent('wheel', { deltaY: 30, bubbles: true, cancelable: true }))
    expect(bar.scrollLeft).toBe(30)
  })

  it('activates a tab on click and ignores primary-button mousedown', () => {
    const b = mount()
    fireEvent.click(screen.getByRole('button', { name: 'README.md' }))
    expect(b.onActivate).toHaveBeenCalledWith('file:README.md')
    fireEvent.mouseDown(screen.getByRole('button', { name: 'Files' }).parentElement!, { button: 0 })
    expect(b.onClose).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Open a surface' }))
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(b.onMenuOpenChange).toHaveBeenLastCalledWith(false)
    fireEvent.contextMenu(screen.getByRole('button', { name: 'Files' }).parentElement!)
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(b.onMenuOpenChange).toHaveBeenLastCalledWith(false)
    expect(screen.queryByRole('menu')).toBeNull()
  })

  it('keeps the bar mounted with no add button when there are zero surfaces', () => {
    mount({ surfaces: [] })
    expect(document.querySelector('[data-surfaces-tabs]')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Open a surface' })).toBeNull()
    expect(document.querySelector('[data-surfaces-tab]')).toBeNull()
  })

  it('closes from a trailing control to the right of the label', () => {
    const b = mount()
    const close = screen.getByRole('button', { name: 'Close Files' })
    const label = screen.getByRole('button', { name: 'Files' })
    expect(label.compareDocumentPosition(close) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    fireEvent.click(close)
    expect(b.onClose).toHaveBeenCalledWith('files')
  })
})
