/** Off-DOM paths: the palette, layer, and engines fail closed without a document. */
import { describe, expect, it } from 'vitest'
import {
  applyCursorFxLayer, mountCursorFx, resolveCursorFxPalette,
} from '../src/cursor-fx.ts'

describe('cursor fx off-DOM', () => {
  it('resolves the neutral palette and leaves the DOM untouched', () => {
    expect(resolveCursorFxPalette([])).toEqual(['#888888'])
    expect(() => {
      applyCursorFxLayer({ cursorEffectEnabled: true, cursorEffect: 'trail' })
    }).not.toThrow()
  })

  it('mounts an inert handle without a window', () => {
    const handle = mountCursorFx(
      {} as HTMLCanvasElement,
      'trail',
      { colors: ['#112233'], speed: 100, size: 100 },
    )
    expect(() => {
      handle.update({ colors: ['#112233'], speed: 100, size: 100 })
      handle.pointerMove(1, 2)
      handle.pointerDown(1, 2)
      handle.dispose()
    }).not.toThrow()
  })
})
