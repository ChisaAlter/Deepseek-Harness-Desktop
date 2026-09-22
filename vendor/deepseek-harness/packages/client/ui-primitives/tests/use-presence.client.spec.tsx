// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, render } from '@testing-library/react'
import { PRESENCE_EXIT_MS, usePresence } from '../src/usePresence.ts'

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

function Probe({ open, durationMs }: { open: boolean; durationMs?: number }) {
  const { mounted, state } = usePresence(open, durationMs)
  return <div data-mounted={mounted ? '1' : '0'} data-state={state} />
}

function stubReducedMotion(matches: boolean): void {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    writable: true,
    value: (query: string) => ({
      matches: query.includes('prefers-reduced-motion') && matches,
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
    }),
  })
}

describe('usePresence', () => {
  it('stays unmounted while closed, then enters on the second animation frame', () => {
    vi.useFakeTimers()
    stubReducedMotion(false)
    const { rerender, container } = render(<Probe open={false} />)
    expect(container.firstElementChild?.getAttribute('data-mounted')).toBe('0')
    expect(container.firstElementChild?.getAttribute('data-state')).toBe('closed')
    rerender(<Probe open />)
    expect(container.firstElementChild?.getAttribute('data-mounted')).toBe('1')
    expect(container.firstElementChild?.getAttribute('data-state')).toBe('closed')
    act(() => { vi.advanceTimersToNextFrame() })
    expect(container.firstElementChild?.getAttribute('data-state')).toBe('closed')
    act(() => { vi.advanceTimersToNextFrame() })
    expect(container.firstElementChild?.getAttribute('data-state')).toBe('open')
  })

  it('keeps the tree mounted through the exit hold, then unmounts', () => {
    vi.useFakeTimers()
    stubReducedMotion(false)
    const { rerender, container } = render(<Probe open />)
    act(() => { vi.advanceTimersToNextFrame(); vi.advanceTimersToNextFrame() })
    rerender(<Probe open={false} />)
    expect(container.firstElementChild?.getAttribute('data-mounted')).toBe('1')
    expect(container.firstElementChild?.getAttribute('data-state')).toBe('closed')
    act(() => { vi.advanceTimersByTime(PRESENCE_EXIT_MS - 1) })
    expect(container.firstElementChild?.getAttribute('data-mounted')).toBe('1')
    act(() => { vi.advanceTimersByTime(1) })
    expect(container.firstElementChild?.getAttribute('data-mounted')).toBe('0')
  })

  it('skips the hold when reduced motion is requested', () => {
    stubReducedMotion(true)
    const { rerender, container } = render(<Probe open />)
    expect(container.firstElementChild?.getAttribute('data-state')).toBe('open')
    rerender(<Probe open={false} />)
    expect(container.firstElementChild?.getAttribute('data-mounted')).toBe('0')
  })
})
