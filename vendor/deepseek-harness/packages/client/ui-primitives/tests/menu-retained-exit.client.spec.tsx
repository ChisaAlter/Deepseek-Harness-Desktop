// @vitest-environment jsdom
/**
 * A menu keeps its DOM through the exit recipe (usePresence). That retained
 * frame must be fully deactivated on the LOGICAL close — out of the a11y tree,
 * no tab stop, no keyboard activation — while the documented entrance (whose
 * first frame already reads `data-state="closed"`) stays reachable.
 */
import { useState } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { Menu } from '../src/Menu.tsx'
import { PRESENCE_EXIT_MS } from '../src/usePresence.ts'

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

const items = [
  { id: 'a', label: 'Alpha' },
  { id: 'b', label: 'Beta' },
]

function Harness({ onClose, onSelect }: { onClose: () => void; onSelect: (id: string) => void }) {
  const [open, setOpen] = useState(true)
  return (
    <Menu
      open={open}
      anchor={<button type="button">trigger</button>}
      items={items}
      onSelect={onSelect}
      onClose={() => { setOpen(false); onClose() }}
    />
  )
}

describe('Menu retained exit frame', () => {
  it('deactivates the logical close while the entrance frame stays interactive', () => {
    vi.useFakeTimers()
    const onClose = vi.fn()
    const onSelect = vi.fn()
    const view = render(<Harness onClose={onClose} onSelect={onSelect} />)
    const menu = screen.getByRole('menu')
    // Entrance: the first frames read `data-state="closed"` yet the menu is
    // logically open, so it must stay reachable — inert is gated on `open`.
    expect(menu.getAttribute('data-state')).toBe('closed')
    expect(menu.hasAttribute('inert')).toBe(false)
    const alpha = screen.getByRole('menuitem', { name: 'Alpha' })
    expect(alpha.hasAttribute('inert')).toBe(false)

    // A row holds the keyboard, then the owner closes (selection/Escape/external).
    alpha.focus()
    expect(document.activeElement).toBe(alpha)
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(1)

    const retired = screen.getByRole('menu')
    expect(retired.isConnected).toBe(true)
    expect(retired.getAttribute('data-state')).toBe('closed')
    expect(retired.getAttribute('aria-hidden')).toBe('true')
    expect(retired.hasAttribute('inert')).toBe(true)
    // Retired rows leave the a11y tree with the surface's aria-hidden.
    expect(screen.queryByRole('menuitem')).toBeNull()

    // A keyboard still parked on a retired row cannot activate or navigate it.
    const retiredAlpha = view.container.querySelector('[role="menu"] button') as HTMLButtonElement
    fireEvent.keyDown(retiredAlpha, { key: 'Enter' })
    fireEvent.keyDown(retiredAlpha, { key: ' ' })
    fireEvent.keyDown(retiredAlpha, { key: 'Tab' })
    fireEvent.keyDown(retiredAlpha, { key: 'ArrowDown' })
    fireEvent.click(retiredAlpha)
    expect(onSelect).not.toHaveBeenCalled()

    act(() => { vi.advanceTimersByTime(PRESENCE_EXIT_MS) })
    expect(screen.queryByRole('menu')).toBeNull()
  })

  it('keeps the post-selection refocus when a row activation closes the menu', async () => {
    const onSelect = vi.fn()
    function Selecting() {
      const [open, setOpen] = useState(true)
      return (
        <Menu
          open={open}
          autoFocus
          anchor={<button type="button">trigger</button>}
          items={items}
          onSelect={onSelect}
          onClose={() => { setOpen(false) }}
        />
      )
    }
    render(<Selecting />)
    const trigger = screen.getByRole('button', { name: 'trigger' })
    const alpha = screen.getByRole('menuitem', { name: 'Alpha' })
    expect(document.activeElement).toBe(alpha)
    fireEvent.click(alpha)
    expect(onSelect).toHaveBeenCalledWith('a')
    await act(async () => { await Promise.resolve() })
    expect(document.activeElement).toBe(trigger)
  })
})
