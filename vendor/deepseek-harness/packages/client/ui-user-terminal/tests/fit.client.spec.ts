// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { hostHasFitSize, shouldFollowOutput, TERMINAL_MINIMUM_CONTRAST } from '../src/client/fit.ts'

describe('hostHasFitSize', () => {
  it('rejects a 0×0 host and accepts a used box', () => {
    const el = document.createElement('div')
    expect(hostHasFitSize(el)).toBe(false)
    Object.defineProperty(el, 'clientWidth', { configurable: true, value: 80 })
    Object.defineProperty(el, 'clientHeight', { configurable: true, value: 24 })
    expect(hostHasFitSize(el)).toBe(true)
    Object.defineProperty(el, 'clientHeight', { configurable: true, value: 0 })
    expect(hostHasFitSize(el)).toBe(false)
  })

  it('rejects a host that is only padding (collapsed surfaces column)', () => {
    const el = document.createElement('div')
    document.body.appendChild(el)
    el.style.padding = '4px'
    Object.defineProperty(el, 'clientWidth', { configurable: true, value: 8 })
    Object.defineProperty(el, 'clientHeight', { configurable: true, value: 874 })
    expect(hostHasFitSize(el)).toBe(false)
    Object.defineProperty(el, 'clientWidth', { configurable: true, value: 520 })
    expect(hostHasFitSize(el)).toBe(true)
    el.remove()
  })
})

describe('shouldFollowOutput', () => {
  it('follows at the bottom and holds position above it', () => {
    expect(shouldFollowOutput({ viewportY: 10, baseY: 10 })).toBe(true)
    expect(shouldFollowOutput({ viewportY: 4, baseY: 10 })).toBe(false)
  })

  it('follows when the buffer or its offsets are unavailable', () => {
    expect(shouldFollowOutput(undefined)).toBe(true)
    expect(shouldFollowOutput({})).toBe(true)
    expect(shouldFollowOutput({ viewportY: 3 })).toBe(true)
  })
})

describe('TERMINAL_MINIMUM_CONTRAST', () => {
  it('does not boost TUI colors (Ghostty has no contrast remapping)', () => {
    expect(TERMINAL_MINIMUM_CONTRAST).toBe(1)
  })
})
