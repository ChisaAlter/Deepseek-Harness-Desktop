import type { MiniPlayerGeometry } from './mini-player-state.ts'

export const MINI_PLAYER_EDGE_GAP = 12
export const MINI_PLAYER_DEFAULT_SIZE = { width: 320, height: 200 }
export const MINI_PLAYER_MIN_SIZE = { width: 240, height: 150 }

export interface MiniPlayerContainer {
  width: number
  height: number
}

export type MiniPlayerResizeSide = 'n' | 'e' | 's' | 'w' | 'ne' | 'nw' | 'se' | 'sw'

export function clampMiniPlayerSize(
  size: Pick<MiniPlayerGeometry, 'width' | 'height'>,
  container: MiniPlayerContainer,
): Pick<MiniPlayerGeometry, 'width' | 'height'> {
  return {
    width: Math.round(Math.min(Math.max(MINI_PLAYER_MIN_SIZE.width, size.width), Math.max(1, container.width - MINI_PLAYER_EDGE_GAP * 2))),
    height: Math.round(Math.min(Math.max(MINI_PLAYER_MIN_SIZE.height, size.height), Math.max(1, container.height - MINI_PLAYER_EDGE_GAP * 2))),
  }
}

export function clampMiniPlayerPosition(
  position: Pick<MiniPlayerGeometry, 'x' | 'y'>,
  size: Pick<MiniPlayerGeometry, 'width' | 'height'>,
  container: MiniPlayerContainer,
): Pick<MiniPlayerGeometry, 'x' | 'y'> {
  return {
    x: Math.min(Math.max(position.x, MINI_PLAYER_EDGE_GAP), Math.max(MINI_PLAYER_EDGE_GAP, container.width - size.width - MINI_PLAYER_EDGE_GAP)),
    y: Math.min(Math.max(position.y, MINI_PLAYER_EDGE_GAP), Math.max(MINI_PLAYER_EDGE_GAP, container.height - size.height - MINI_PLAYER_EDGE_GAP)),
  }
}

export function resizeMiniPlayerGeometry(
  base: MiniPlayerGeometry,
  delta: Pick<MiniPlayerGeometry, 'x' | 'y'>,
  side: MiniPlayerResizeSide,
  container: MiniPlayerContainer,
): MiniPlayerGeometry {
  const right = base.x + base.width
  const bottom = base.y + base.height
  const maxRight = Math.max(MINI_PLAYER_EDGE_GAP, container.width - MINI_PLAYER_EDGE_GAP)
  const maxBottom = Math.max(MINI_PLAYER_EDGE_GAP, container.height - MINI_PLAYER_EDGE_GAP)
  const left = side.includes('w')
    ? Math.min(Math.max(base.x + delta.x, MINI_PLAYER_EDGE_GAP), right - MINI_PLAYER_MIN_SIZE.width)
    : base.x
  const nextRight = side.includes('e')
    ? Math.min(Math.max(right + delta.x, base.x + MINI_PLAYER_MIN_SIZE.width), maxRight)
    : right
  const top = side.includes('n')
    ? Math.min(Math.max(base.y + delta.y, MINI_PLAYER_EDGE_GAP), bottom - MINI_PLAYER_MIN_SIZE.height)
    : base.y
  const nextBottom = side.includes('s')
    ? Math.min(Math.max(bottom + delta.y, base.y + MINI_PLAYER_MIN_SIZE.height), maxBottom)
    : bottom
  const size = clampMiniPlayerSize({ width: nextRight - left, height: nextBottom - top }, container)
  return {
    x: side.includes('w') ? right - size.width : left,
    y: side.includes('n') ? bottom - size.height : top,
    ...size,
  }
}
