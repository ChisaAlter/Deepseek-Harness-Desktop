// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, render } from '@testing-library/react'
import { FlipText, FLIP_TEXT_MS } from '../src/FlipText.tsx'

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

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

describe('FlipText', () => {
  it('keeps the outgoing label through the flip, then drops it', () => {
    vi.useFakeTimers()
    stubReducedMotion(false)
    const { rerender, container } = render(<FlipText text="High" />)
    rerender(<FlipText text="Max" />)
    expect(container.querySelector('[data-dsh-motion-part="outgoing"]')?.textContent).toBe('High')
    expect(container.querySelector('[data-dsh-motion-part="outgoing"]')?.getAttribute('aria-hidden')).toBe('true')
    expect(container.querySelector('[data-dsh-motion-part="current"]')?.textContent).toBe('Max')
    act(() => { vi.advanceTimersByTime(FLIP_TEXT_MS - 1) })
    expect(container.querySelector('[data-dsh-motion-part="outgoing"]')).not.toBeNull()
    act(() => { vi.advanceTimersByTime(1) })
    expect(container.querySelector('[data-dsh-motion-part="outgoing"]')).toBeNull()
  })

  it('replaces the label immediately under reduced motion', () => {
    stubReducedMotion(true)
    const { rerender, container } = render(<FlipText text="Read Only" />)
    rerender(<FlipText text="Full access" />)
    expect(container.querySelector('[data-dsh-motion-part="outgoing"]')).toBeNull()
    expect(container.querySelector('[data-dsh-motion-part="current"]')?.textContent).toBe('Full access')
  })
})
