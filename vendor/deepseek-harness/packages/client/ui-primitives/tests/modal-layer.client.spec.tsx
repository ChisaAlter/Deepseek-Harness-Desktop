// @vitest-environment jsdom
import { useState } from 'react'
import { afterEach, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { Modal } from '../src/Modal.tsx'
import { closeTopModal, isBehindModal } from '../src/useModalLayer.ts'
import { Menu } from '../src/Menu.tsx'

afterEach(cleanup)
function Nested({ withSearch = true }: { withSearch?: boolean }) {
  const [settings, setSettings] = useState(false)
  const [reference, setReference] = useState(false)
  const [menu, setMenu] = useState(false)
  return <>
    <button onClick={() => { setSettings(true) }}>Settings</button>
    <Modal open={settings} title="Settings" closeLabel="Close settings" onClose={() => { setSettings(false) }}>
      <button onClick={() => { setReference(true) }}>Reference</button>
    </Modal>
    <Modal open={reference} title="Reference" closeLabel="Close reference" onClose={() => { setReference(false) }}>
      {withSearch && <input data-modal-autofocus aria-label="Search" />}
      <Menu open={menu} autoFocus anchor={<button onClick={() => { setMenu(true) }}>Menu</button>}
        items={[{ id: 'item', label: 'Item' }]} onSelect={() => { setMenu(false) }} onClose={() => { setMenu(false) }} />
    </Modal>
  </>
}
const escape = (init = {}) => fireEvent.keyDown(document.activeElement ?? document, { key: 'Escape', code: 'Escape', ...init })
it('closes only the top modal through application commands and restores each opener', () => {
  render(<Nested />)
  const settings = screen.getByRole('button', { name: 'Settings' }); settings.focus(); fireEvent.click(settings)
  const reference = screen.getByRole('button', { name: 'Reference' }); reference.focus(); fireEvent.click(reference)
  act(() => { closeTopModal(document) })
  expect(screen.queryByRole('dialog', { name: 'Reference' })).toBeNull()
  expect(screen.getByRole('dialog', { name: 'Settings' })).toBeTruthy()
  expect(document.activeElement).toBe(reference)
  act(() => { closeTopModal(document) })
  expect(screen.queryByRole('dialog')).toBeNull()
  expect(document.activeElement).toBe(settings)
  closeTopModal(document)
  expect(document.activeElement).toBe(settings)
})

it.each(['menu', 'dialog'])('does not dismiss a modal behind a newer %s', (role) => {
  const onClose = vi.fn()
  render(<Modal open title="Settings" closeLabel="Close" onClose={onClose} />)
  const overlay = document.createElement('div')
  overlay.setAttribute('role', role)
  overlay.setAttribute('aria-modal', 'true')
  document.body.append(overlay)
  try { closeTopModal(document); expect(onClose).not.toHaveBeenCalled() }
  finally { overlay.remove() }
  closeTopModal(document)
  expect(onClose).toHaveBeenCalledTimes(1)
})

it('uses the latest close callback and retains a modal whose owner declines dismissal', () => {
  const first = vi.fn(), busy = vi.fn()
  const view = render(<Modal open title="Settings" closeLabel="Close" onClose={first} />)
  view.rerender(<Modal open title="Settings" closeLabel="Close" onClose={busy} />)
  closeTopModal(document)
  expect(first).not.toHaveBeenCalled()
  expect(busy).toHaveBeenCalledTimes(1)
  expect(screen.getByRole('dialog')).toBeTruthy()
})

it('closes one layer per Escape, honors local menus and IME, and restores the real opener', () => {
  expect(isBehindModal(null)).toBe(false)
  render(<Nested />)
  const settings = screen.getByRole('button', { name: 'Settings' }); settings.focus(); fireEvent.click(settings)
  const reference = screen.getByRole('button', { name: 'Reference' }); reference.focus(); fireEvent.click(reference)
  expect(document.activeElement).toBe(screen.getByRole('textbox'))
  fireEvent.compositionStart(screen.getByRole('textbox'))
  escape()
  fireEvent.compositionEnd(screen.getByRole('textbox'))
  escape()
  escape({ isComposing: true }); escape({ ctrlKey: true }); escape({ repeat: true })
  expect(screen.getAllByRole('dialog')).toHaveLength(2)
  fireEvent.click(screen.getByRole('button', { name: 'Menu' }))
  fireEvent.compositionStart(document.activeElement!)
  fireEvent.compositionEnd(document.activeElement!)
  escape()
  expect(screen.getByRole('menu')).toBeTruthy()
  fireEvent.keyUp(document.activeElement!, { key: 'Escape' })
  escape()
  expect(screen.queryByRole('menu')).toBeNull()
  expect(screen.getAllByRole('dialog')).toHaveLength(2)
  escape()
  expect(screen.getAllByRole('dialog')).toHaveLength(1)
  expect(document.activeElement).toBe(reference)
  escape()
  expect(screen.queryByRole('dialog')).toBeNull()
  expect(document.activeElement).toBe(settings)
})

it('keeps Tab within the top dialog and releases listeners after unmount', () => {
  const view = render(<Nested />)
  fireEvent.click(screen.getByRole('button', { name: 'Settings' }))
  const last = screen.getByRole('button', { name: 'Reference' }); last.focus()
  fireEvent.keyDown(last, { key: 'Tab' })
  expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Close settings' }))
  fireEvent.keyDown(document.activeElement!, { key: 'Tab', shiftKey: true })
  expect(document.activeElement).toBe(last)
  view.unmount()
  const event = new KeyboardEvent('keydown', { key: 'Escape', cancelable: true })
  document.dispatchEvent(event)
  expect(event.defaultPrevented).toBe(false)
})

it.each([
  { direction: 'forward', shiftKey: false, target: 'Close reference' },
  { direction: 'backward', shiftKey: true, target: 'Menu' },
])('moves $direction from the top dialog container into its controls', ({ shiftKey, target }) => {
  render(<Nested withSearch={false} />)
  fireEvent.click(screen.getByRole('button', { name: 'Settings' }))
  const reference = screen.getByRole('button', { name: 'Reference' })
  reference.focus()
  fireEvent.click(reference)
  const dialog = screen.getByRole('dialog', { name: 'Reference' })
  dialog.focus()

  expect(fireEvent.keyDown(dialog, { key: 'Tab', shiftKey })).toBe(false)
  expect(document.activeElement).toBe(screen.getByRole('button', { name: target }))
  escape()
  expect(screen.queryByRole('dialog', { name: 'Reference' })).toBeNull()
  expect(document.activeElement).toBe(reference)
})

it('keeps focus in a headless empty dialog and leaves portaled menu traversal to its owner', () => {
  render(<Modal open headless title="Empty" onClose={() => {}} />)
  const dialog = screen.getByRole('dialog')
  expect(document.activeElement).toBe(dialog)
  fireEvent.keyDown(dialog, { key: 'Tab' })
  expect(document.activeElement).toBe(dialog)
  fireEvent.keyDown(dialog, { key: 'Tab', shiftKey: true })
  expect(document.activeElement).toBe(dialog)
  const menu = document.createElement('div')
  menu.setAttribute('role', 'menu')
  const button = document.createElement('button')
  menu.append(button); document.body.append(menu)
  try {
    button.focus()
    expect(fireEvent.keyDown(button, { key: 'Tab' })).toBe(true)
    fireEvent.blur(window)
  } finally { menu.remove() }
})

it('does not steal focus when a lower layer disappears and restores a remaining parent after opener removal', () => {
  const tree = (parent: boolean, child: boolean, opener: boolean) => <>
    <Modal open={parent} title="Parent" closeLabel="Close parent" onClose={() => {}}>
      {opener && <button>Child opener</button>}
    </Modal>
    <Modal open={child} title="Child" closeLabel="Close child" onClose={() => {}}><input data-modal-autofocus aria-label="Child input" /></Modal>
  </>
  const view = render(tree(true, false, true))
  screen.getByRole('button', { name: 'Child opener' }).focus()
  view.rerender(tree(true, true, true))
  view.rerender(tree(true, true, false))
  view.rerender(tree(true, false, false))
  expect(document.activeElement).toBe(screen.getByRole('dialog', { name: 'Parent' }))
  view.rerender(tree(true, false, true))
  screen.getByRole('button', { name: 'Child opener' }).focus()
  view.rerender(tree(true, true, true))
  const input = screen.getByRole('textbox')
  view.rerender(tree(false, true, true))
  expect(document.activeElement).toBe(input)
  view.rerender(tree(false, false, true))
  expect(screen.queryByRole('dialog')).toBeNull()
})

it('gives a new modal Escape ahead of an older menu', () => {
  let menuClosed = false
  let childClosed = false
  render(<>
    <Modal open title="Parent" closeLabel="Close parent" onClose={() => {}}>
      <Menu open anchor={<button>Menu</button>} items={[{ id: 'item', label: 'Item' }]}
        onSelect={() => {}} onClose={() => { menuClosed = true }} />
    </Modal>
    <Modal open title="Child" closeLabel="Close child" onClose={() => { childClosed = true }}><input data-modal-autofocus /></Modal>
  </>)
  escape()
  expect(menuClosed).toBe(false)
  expect(childClosed).toBe(true)
})

it('does not let a retiring modal steal focus from a modal opened in the same commit', () => {
  const tree = (showA: boolean, showB: boolean) => <>
    <Modal open={showB} title="B" closeLabel="Close B" onClose={() => {}}><input data-modal-autofocus aria-label="B input" /></Modal>
    <Modal open={showA} title="A" closeLabel="Close A" onClose={() => {}}><input data-modal-autofocus aria-label="A input" /></Modal>
  </>
  const view = render(tree(true, false))
  expect(screen.getByRole('dialog', { name: 'A' })).toBeTruthy()
  // One commit closes A and opens B. B registers after A's cleanup, so A's
  // deferred restore must not pull focus back out of B.
  view.rerender(tree(false, true))
  expect(document.activeElement).toBe(screen.getByLabelText('B input'))
})

it('keeps Tab traversal inside the dialog when focus sits in a retired menu', () => {
  const view = render(<Modal open title="Settings" closeLabel="Close settings" onClose={() => {}}>
    <button>First</button>
    <Menu open anchor={<button>Menu</button>} items={[{ id: 'item', label: 'Item' }]}
      onSelect={() => {}} onClose={() => {}} />
  </Modal>)
  const dialog = screen.getByRole('dialog', { name: 'Settings' })
  // A logically closed menu is retained for its exit recipe; focus left inside
  // it must not suppress this dialog's own traversal.
  const row = document.querySelector<HTMLButtonElement>('[role="menu"] button')
  expect(row).not.toBeNull()
  row!.focus()
  view.rerender(<Modal open title="Settings" closeLabel="Close settings" onClose={() => {}}>
    <button>First</button>
    <Menu open={false} anchor={<button>Menu</button>} items={[{ id: 'item', label: 'Item' }]}
      onSelect={() => {}} onClose={() => {}} />
  </Modal>)
  const retiredMenu = document.querySelector('[role="menu"][aria-hidden="true"]')
  expect(retiredMenu).not.toBeNull()
  row!.focus()
  expect(retiredMenu!.contains(document.activeElement)).toBe(true)
  fireEvent.keyDown(row!, { key: 'Tab' })
  // The key must be consumed AND focus must leave the retired subtree for an
  // exact eligible control; "still inside the dialog" would also hold while
  // focus stays on the retired row.
  expect(retiredMenu!.contains(document.activeElement)).toBe(false)
  expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Close settings' }))
})

it('falls back to the surviving modal when the recorded opener is inside a hidden parent', () => {
  // Close the child while its opener is hidden inside a still-open parent: the
  // parent is a valid destination, so focus must not be stranded in the
  // child's retained exit frame.
  const tree = (parentOpen: boolean, childOpen: boolean, openerHidden: boolean) => <>
    <Modal open={parentOpen} title="Parent" closeLabel="Close parent" onClose={() => {}}>
      <div hidden={openerHidden}><button>Child opener</button></div>
    </Modal>
    <Modal open={childOpen} title="Child" closeLabel="Close child" onClose={() => {}}>
      <input data-modal-autofocus aria-label="Child input" />
    </Modal>
  </>
  const view = render(tree(true, false, false))
  screen.getByRole('button', { name: 'Child opener' }).focus()
  view.rerender(tree(true, true, false))
  // Hide the opener, then retire the child in one commit.
  view.rerender(tree(true, false, true))
  const parent = screen.getByRole('dialog', { name: 'Parent' })
  expect(parent.contains(document.activeElement)).toBe(true)
})
