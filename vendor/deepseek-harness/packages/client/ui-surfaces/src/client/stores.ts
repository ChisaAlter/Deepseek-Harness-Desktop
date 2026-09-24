/**
 * Session-scoped right-panel surface descriptors. Layout width lives on
 * ctx.layout; this store only owns the ordered surfaces and the active id.
 */
import { defineStore } from '@deepseek-ai/dsh-client-store'
import type { EngineStoreHandle } from '@deepseek-ai/dsh-client-store'
import { loadPersistedState } from './persist.ts'

/** Surface kinds the empty-state cards and later occupants can open. */
export type SurfaceKind = 'preview' | 'terminal' | 'files' | 'diff' | 'agents' | 'file'

/** Kinds `open` accepts; a file surface needs a path from a later occupant. */
export type OpenableKind = Exclude<SurfaceKind, 'file'>

/** One right-panel surface descriptor. */
export type Surface =
  | { id: string; kind: 'preview' }
  | { id: string; kind: 'terminal' }
  | { id: 'files'; kind: 'files' }
  | { id: 'diff'; kind: 'diff' }
  | { id: 'agents'; kind: 'agents' }
  | {
    id: string
    kind: 'file'
    relativePath: string
    revealLine?: number
    revealRequestId?: number
  }

/** Per-session active id and ordered surface list. */
export type SessionSurfaces = {
  activeId: string | null
  surfaces: Surface[]
}

/** Surfaces store state: session id is the key. */
export type SurfacesState = {
  bySession: Record<string, SessionSurfaces>
}

type SurfacesActions = {
  open: (draft: SurfacesState, sessionId: string, kind: OpenableKind) => void
  openFile: (
    draft: SurfacesState,
    sessionId: string,
    relativePath: string,
    options?: { revealLine?: number },
  ) => void
  activate: (draft: SurfacesState, sessionId: string, id: string) => void
  close: (draft: SurfacesState, sessionId: string, id: string) => void
  closeOthers: (draft: SurfacesState, sessionId: string, id: string) => void
  closeToRight: (draft: SurfacesState, sessionId: string, id: string) => void
  closeAll: (draft: SurfacesState, sessionId: string) => void
}

const EMPTY_SESSION: SessionSurfaces = { activeId: null, surfaces: [] }

/**
 * Live per-session bucket, or the empty snapshot when the session has none.
 * @param state - the store snapshot.
 * @param sessionId - session key.
 * @returns the session's surfaces, or the empty bucket.
 */
export function sessionSurfaces(state: SurfacesState, sessionId: string): SessionSurfaces {
  return state.bySession[sessionId] ?? EMPTY_SESSION
}

function ensure(draft: SurfacesState, sessionId: string): SessionSurfaces {
  const current = draft.bySession[sessionId]
  if (current !== undefined) return current
  const created: SessionSurfaces = { activeId: null, surfaces: [] }
  draft.bySession[sessionId] = created
  return created
}

function prune(draft: SurfacesState, sessionId: string): void {
  const current = draft.bySession[sessionId]
  /* v8 ignore next -- close returns before prune when the session is missing. */
  if (current === undefined) return
  if (current.surfaces.length === 0 && current.activeId === null) {
    // Computed-key delete is lint-forbidden; rebuild the record without the key.
    draft.bySession = Object.fromEntries(
      Object.entries(draft.bySession).filter(([key]) => key !== sessionId),
    )
  }
}

function singleton(kind: 'files' | 'diff' | 'agents'): Surface {
  switch (kind) {
    case 'files': return { id: 'files', kind: 'files' }
    case 'diff': return { id: 'diff', kind: 'diff' }
    case 'agents': return { id: 'agents', kind: 'agents' }
  }
}

function surfaceFor(kind: OpenableKind, current: SessionSurfaces): Surface {
  switch (kind) {
    case 'files':
    case 'diff':
    case 'agents':
      return singleton(kind)
    case 'preview': {
      const existing = current.surfaces.find(surface => surface.kind === 'preview')
      return existing ?? { id: 'browser:new', kind: 'preview' }
    }
    case 'terminal': {
      const existing = current.surfaces.find(surface => surface.kind === 'terminal')
      return existing ?? { id: 'terminal:new', kind: 'terminal' }
    }
    /* v8 ignore next -- OpenableKind is a closed union; the never arm is uninhabited. */
    default: {
      const _never: never = kind
      return _never
    }
  }
}

/**
 * Create the surfaces store handle. Production declares the factory at
 * register; tests call create().
 * @returns the store handle.
 */
export function createSurfacesStore(): EngineStoreHandle<SurfacesState, SurfacesActions> {
  return defineStore({
    init: (): SurfacesState => loadPersistedState(
      typeof globalThis.localStorage === 'undefined' ? undefined : localStorage,
    ),
    actions: {
      open: (draft, sessionId: string, kind: OpenableKind) => {
        const bucket = ensure(draft, sessionId)
        const surface = surfaceFor(kind, bucket)
        if (!bucket.surfaces.some(entry => entry.id === surface.id)) {
          bucket.surfaces.push(surface)
        }
        bucket.activeId = surface.id
      },
      openFile: (
        draft,
        sessionId: string,
        relativePath: string,
        options?: { revealLine?: number },
      ) => {
        const bucket = ensure(draft, sessionId)
        if (!bucket.surfaces.some(surface => surface.kind === 'files')) {
          bucket.surfaces.push(singleton('files'))
        }
        const id = `file:${relativePath}`
        const existingIndex = bucket.surfaces.findIndex(surface => surface.id === id)
        if (existingIndex < 0) {
          bucket.surfaces.push({
            id,
            kind: 'file',
            relativePath,
            ...(options?.revealLine !== undefined
              ? { revealLine: options.revealLine, revealRequestId: 1 }
              : {}),
          })
        } else if (options?.revealLine !== undefined) {
          const existing = bucket.surfaces[existingIndex] as Extract<Surface, { kind: 'file' }>
          existing.revealLine = options.revealLine
          existing.revealRequestId = (existing.revealRequestId ?? 0) + 1
        }
        bucket.activeId = id
      },
      activate: (draft, sessionId: string, id: string) => {
        const bucket = draft.bySession[sessionId]
        if (bucket === undefined) return
        if (!bucket.surfaces.some(surface => surface.id === id)) return
        bucket.activeId = id
      },
      close: (draft, sessionId: string, id: string) => {
        const bucket = draft.bySession[sessionId]
        if (bucket === undefined) return
        const index = bucket.surfaces.findIndex(surface => surface.id === id)
        if (index < 0) return
        bucket.surfaces.splice(index, 1)
        if (bucket.activeId === id) {
          const fallback = bucket.surfaces[Math.min(index, bucket.surfaces.length - 1)]
          bucket.activeId = fallback?.id ?? null
        }
        prune(draft, sessionId)
      },
      closeOthers: (draft, sessionId: string, id: string) => {
        const bucket = draft.bySession[sessionId]
        if (bucket === undefined) return
        const kept = bucket.surfaces.find(surface => surface.id === id)
        if (kept === undefined || bucket.surfaces.length === 1) return
        bucket.surfaces = [kept]
        bucket.activeId = kept.id
      },
      closeToRight: (draft, sessionId: string, id: string) => {
        const bucket = draft.bySession[sessionId]
        if (bucket === undefined) return
        const index = bucket.surfaces.findIndex(surface => surface.id === id)
        if (index < 0 || index === bucket.surfaces.length - 1) return
        bucket.surfaces = bucket.surfaces.slice(0, index + 1)
        if (!bucket.surfaces.some(surface => surface.id === bucket.activeId)) {
          bucket.activeId = id
        }
      },
      closeAll: (draft, sessionId: string) => {
        if (draft.bySession[sessionId] === undefined) return
        // Computed-key delete is lint-forbidden; rebuild the record without the key.
        draft.bySession = Object.fromEntries(
          Object.entries(draft.bySession).filter(([key]) => key !== sessionId),
        )
      },
    },
  })
}
