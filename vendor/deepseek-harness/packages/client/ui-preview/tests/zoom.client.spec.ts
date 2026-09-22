import { describe, expect, it } from 'vitest'
import {
  DEFAULT_ZOOM_FACTOR,
  ZOOM_EPSILON,
  ZOOM_LEVELS,
  nextZoomLevel,
} from '../src/client/zoom.ts'

describe('preview zoom table', () => {
  it('matches the Chrome preset list', () => {
    expect([...ZOOM_LEVELS]).toEqual([
      0.25, 0.33, 0.5, 0.67, 0.75, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3, 4, 5,
    ])
    expect(DEFAULT_ZOOM_FACTOR).toBe(1)
    expect(ZOOM_EPSILON).toBe(0.001)
  })

  it('steps in from 1.0 to 1.1 and out to 0.9', () => {
    expect(nextZoomLevel(1, 'in')).toBe(1.1)
    expect(nextZoomLevel(1, 'out')).toBe(0.9)
  })

  it('clamps at the table ends', () => {
    expect(nextZoomLevel(0.25, 'out')).toBe(0.25)
    expect(nextZoomLevel(5, 'in')).toBe(5)
    expect(nextZoomLevel(10, 'in')).toBe(5)
  })

  it('treats an off-grid factor as the lower step', () => {
    expect(nextZoomLevel(1.05, 'in')).toBe(1.1)
    expect(nextZoomLevel(1.05, 'out')).toBe(0.9)
  })
})
