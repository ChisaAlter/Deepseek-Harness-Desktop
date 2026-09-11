import { useSyncExternalStore } from 'react'
import type { PreviewBounds } from './shell.ts'

export interface MiniPlayerGeometry {
  x: number
  y: number
  width: number
  height: number
}

export interface MiniPlayerRuntime {
  readonly previewShow: (id: string, bounds: PreviewBounds) => Promise<void>
  readonly previewResize: (id: string, bounds: PreviewBounds) => Promise<void>
  readonly previewHide: (id: string) => Promise<void>
  readonly restore?: () => void
}

export interface MiniPlayerSnapshot {
  readonly previewId: string | null
  readonly open: boolean
  readonly suspended: boolean
  readonly geometry: MiniPlayerGeometry | null
  readonly runtime: MiniPlayerRuntime | null
  readonly revision: number
}

const EMPTY: MiniPlayerSnapshot = { previewId: null, open: false, suspended: false, geometry: null, runtime: null, revision: 0 }
let snapshot = EMPTY
const listeners = new Set<() => void>()

function publish(next: MiniPlayerSnapshot): void {
  snapshot = next
  for (const listener of listeners) listener()
}

export function readMiniPlayer(): MiniPlayerSnapshot { return snapshot }

export function subscribeMiniPlayer(listener: () => void): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

export function useMiniPlayer(): MiniPlayerSnapshot {
  return useSyncExternalStore(subscribeMiniPlayer, readMiniPlayer, readMiniPlayer)
}

export function setMiniPlayerRuntime(previewId: string, runtime: MiniPlayerRuntime): void {
  if (snapshot.previewId === previewId && snapshot.runtime === runtime) return
  publish({ ...snapshot, previewId, runtime })
}

export function openMiniPlayer(previewId: string): void {
  publish({ ...snapshot, previewId, open: true })
}

export function closeMiniPlayer(): void {
  if (!snapshot.open) return
  publish({ ...snapshot, open: false })
}

export function setMiniPlayerSuspended(suspended: boolean): void {
  if (snapshot.suspended === suspended) return
  publish({ ...snapshot, suspended })
}

export function setMiniPlayerGeometry(geometry: MiniPlayerGeometry): void {
  if (snapshot.geometry !== null
    && snapshot.geometry.x === geometry.x
    && snapshot.geometry.y === geometry.y
    && snapshot.geometry.width === geometry.width
    && snapshot.geometry.height === geometry.height) return
  publish({ ...snapshot, geometry })
}

export function notifyMiniPlayerLayout(): void {
  publish({ ...snapshot, revision: snapshot.revision + 1 })
}

export function clearMiniPlayer(previewId?: string): void {
  if (previewId !== undefined && snapshot.previewId !== previewId) return
  publish(EMPTY)
}
