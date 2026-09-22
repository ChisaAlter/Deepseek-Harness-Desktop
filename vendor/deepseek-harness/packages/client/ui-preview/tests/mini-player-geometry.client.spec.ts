import { describe, expect, it } from 'vitest'
import {
  clampMiniPlayerPosition,
  clampMiniPlayerSize,
  MINI_PLAYER_EDGE_GAP,
  MINI_PLAYER_MIN_SIZE,
  resizeMiniPlayerGeometry,
} from '../src/client/mini-player-geometry.ts'

describe('dshd mini-player geometry', () => {
  it('clamps dimensions to the minimum and chat container', () => {
    expect(clampMiniPlayerSize({ width: 10, height: 10 }, { width: 800, height: 500 })).toEqual(MINI_PLAYER_MIN_SIZE)
    expect(clampMiniPlayerSize({ width: 900, height: 700 }, { width: 800, height: 500 })).toEqual({
      width: 800 - MINI_PLAYER_EDGE_GAP * 2,
      height: 500 - MINI_PLAYER_EDGE_GAP * 2,
    })
  })

  it('keeps a dragged position inside the chat area', () => {
    expect(clampMiniPlayerPosition({ x: -100, y: 999 }, { width: 320, height: 200 }, { width: 800, height: 500 })).toEqual({ x: 12, y: 288 })
  })

  it('resizes from each side while preserving the opposite anchor', () => {
    const base = { x: 100, y: 80, width: 320, height: 200 }
    expect(resizeMiniPlayerGeometry(base, { x: 40, y: 0 }, 'e', { width: 800, height: 500 })).toEqual({ ...base, width: 360 })
    expect(resizeMiniPlayerGeometry(base, { x: 40, y: 0 }, 'w', { width: 800, height: 500 })).toEqual({ x: 140, y: 80, width: 280, height: 200 })
    expect(resizeMiniPlayerGeometry(base, { x: 0, y: -60 }, 'n', { width: 800, height: 500 })).toEqual({ x: 100, y: 20, width: 320, height: 260 })
    expect(resizeMiniPlayerGeometry(base, { x: 40, y: 30 }, 'se', { width: 800, height: 500 })).toEqual({ ...base, width: 360, height: 230 })
    expect(resizeMiniPlayerGeometry(base, { x: 900, y: 0 }, 'e', { width: 800, height: 500 })).toEqual({ x: 100, y: 80, width: 688, height: 200 })
    expect(resizeMiniPlayerGeometry(base, { x: -900, y: 0 }, 'w', { width: 800, height: 500 })).toEqual({ x: 12, y: 80, width: 408, height: 200 })
  })
})
