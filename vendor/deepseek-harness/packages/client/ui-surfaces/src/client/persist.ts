/** Session-scoped surfaces tab persistence in localStorage. */

import type { SessionSurfaces, Surface, SurfacesState } from './stores.ts'

/** localStorage key prefix; the session id is the suffix. */
export const SURFACES_PERSIST_PREFIX = 'dsh-surfaces:v1:'

const WRITE_DELAY_MS = 80
/** Dirty draft utf8 bytes per field; matches workspace-fs MAX_WRITE_BYTES (1 MiB). */
const DRAFT_MAX_BYTES = 1024 * 1024

const draftEncoder = new TextEncoder()

const timers = new Map<string, ReturnType<typeof setTimeout>>()

function resolveStorage(storage: Storage | undefined): Storage | undefined {
  return storage ?? (typeof globalThis.localStorage === 'undefined' ? undefined : localStorage)
}

/** Unsaved file buffer persisted with the tab list so reload/quit does not drop it. */
export type FileDraftBuffer = { text: string; draft: string }

/**
 * Cancel a pending debounced write for one session.
 * @param sessionId - store key.
 */
export function cancelPersist(sessionId: string): void {
  const existing = timers.get(sessionId)
  if (existing === undefined) return
  clearTimeout(existing)
  timers.delete(sessionId)
}

/**
 * Load every persisted session bucket, dropping unknown kinds and malformed rows.
 * @param storage - `localStorage` in the browser; injectable in tests.
 * @returns a SurfacesState with only sanitized buckets.
 */
export function loadPersistedState(storage: Storage | undefined = undefined): SurfacesState {
  const resolved = resolveStorage(storage)
  if (resolved === undefined) return { bySession: {} }
  const bySession: SurfacesState['bySession'] = {}
  for (let i = 0; i < resolved.length; i += 1) {
    const key = resolved.key(i)
    if (key === null || !key.startsWith(SURFACES_PERSIST_PREFIX)) continue
    const sessionId = key.slice(SURFACES_PERSIST_PREFIX.length)
    if (sessionId.length === 0) continue
    const bucket = readBucket(resolved.getItem(key))
    if (bucket !== undefined) bySession[sessionId] = bucket
  }
  return { bySession }
}

/**
 * Load dirty file drafts from every persisted session bucket.
 * @param storage - `localStorage` in the browser; injectable in tests.
 * @returns map keyed by `sessionId:surfaceId`.
 */
export function loadPersistedDrafts(storage: Storage | undefined = undefined): Map<string, FileDraftBuffer> {
  const drafts = new Map<string, FileDraftBuffer>()
  const resolved = resolveStorage(storage)
  if (resolved === undefined) return drafts
  for (let i = 0; i < resolved.length; i += 1) {
    const key = resolved.key(i)
    if (key === null || !key.startsWith(SURFACES_PERSIST_PREFIX)) continue
    const sessionId = key.slice(SURFACES_PERSIST_PREFIX.length)
    if (sessionId.length === 0) continue
    for (const [id, buffer] of Object.entries(readDrafts(resolved.getItem(key)))) {
      drafts.set(`${sessionId}:${id}`, buffer)
    }
  }
  return drafts
}

/**
 * Debounced write of one session bucket. An empty list removes the key.
 * @param sessionId - store key.
 * @param bucket - live surfaces for that session.
 * @param storage - `localStorage` in the browser; injectable in tests. `undefined` uses `localStorage` when it exists.
 * @param drafts - dirty file buffers keyed by surface id.
 */
export function persistSession(
  sessionId: string,
  bucket: SessionSurfaces,
  storage: Storage | undefined = undefined,
  drafts: Record<string, FileDraftBuffer> = {},
): void {
  const resolved = resolveStorage(storage)
  if (resolved === undefined) return
  if (sessionId.length === 0) return
  const existing = timers.get(sessionId)
  if (existing !== undefined) clearTimeout(existing)
  timers.set(sessionId, setTimeout(() => {
    timers.delete(sessionId)
    writeSession(sessionId, bucket, resolved, drafts)
  }, WRITE_DELAY_MS))
}

/**
 * Write one session bucket immediately (tests and flush).
 * @param sessionId - store key.
 * @param bucket - live surfaces for that session.
 * @param storage - target storage. `undefined` uses `localStorage` when it exists.
 * @param drafts - dirty file buffers keyed by surface id.
 */
export function writeSession(
  sessionId: string,
  bucket: SessionSurfaces,
  storage: Storage | undefined = undefined,
  drafts: Record<string, FileDraftBuffer> = {},
): void {
  const resolved = resolveStorage(storage)
  if (resolved === undefined) return
  const key = `${SURFACES_PERSIST_PREFIX}${sessionId}`
  if (bucket.surfaces.length === 0) {
    resolved.removeItem(key)
    return
  }
  const openFiles = new Set(
    bucket.surfaces.filter(surface => surface.kind === 'file').map(surface => surface.id),
  )
  const kept: Record<string, FileDraftBuffer> = {}
  for (const [id, buffer] of Object.entries(drafts)) {
    if (!openFiles.has(id)) continue
    const sanitized = sanitizeDraft(buffer)
    if (sanitized !== undefined) kept[id] = sanitized
  }
  resolved.setItem(key, JSON.stringify({
    activeId: bucket.activeId,
    surfaces: bucket.surfaces,
    ...(Object.keys(kept).length > 0 ? { drafts: kept } : {}),
  }))
}

/**
 * Parse and sanitize one stored bucket.
 * @param raw - JSON text, or null when the key is missing.
 * @returns a valid bucket, or undefined to drop the key.
 */
export function readBucket(raw: string | null): SessionSurfaces | undefined {
  if (raw === null || raw.length === 0) return undefined
  let parsed: unknown
  try {
    parsed = JSON.parse(raw) as unknown
  } catch {
    return undefined
  }
  if (parsed === null || typeof parsed !== 'object') return undefined
  const record = parsed as { activeId?: unknown; surfaces?: unknown }
  if (!Array.isArray(record.surfaces)) return undefined
  const surfaces: Surface[] = []
  for (const entry of record.surfaces) {
    const surface = sanitizeSurface(entry)
    if (surface !== undefined) surfaces.push(surface)
  }
  const first = surfaces[0]
  if (first === undefined) return undefined
  const activeId = typeof record.activeId === 'string' && surfaces.some(surface => surface.id === record.activeId)
    ? record.activeId
    : first.id
  return { activeId, surfaces }
}

/**
 * Parse dirty drafts from one stored bucket JSON.
 * @param raw - JSON text, or null when the key is missing.
 * @returns surface-id keyed dirty buffers.
 */
export function readDrafts(raw: string | null): Record<string, FileDraftBuffer> {
  if (raw === null || raw.length === 0) return {}
  let parsed: unknown
  try {
    parsed = JSON.parse(raw) as unknown
  } catch {
    return {}
  }
  if (parsed === null || typeof parsed !== 'object') return {}
  const drafts = (parsed as { drafts?: unknown }).drafts
  if (drafts === null || typeof drafts !== 'object' || Array.isArray(drafts)) return {}
  const kept: Record<string, FileDraftBuffer> = {}
  for (const [id, buffer] of Object.entries(drafts as Record<string, unknown>)) {
    const sanitized = sanitizeDraft(buffer)
    if (sanitized !== undefined) kept[id] = sanitized
  }
  return kept
}

function sanitizeDraft(raw: unknown): FileDraftBuffer | undefined {
  if (raw === null || typeof raw !== 'object') return undefined
  const entry = raw as { text?: unknown; draft?: unknown }
  if (typeof entry.text !== 'string' || typeof entry.draft !== 'string') return undefined
  if (entry.draft === entry.text) return undefined
  if (draftEncoder.encode(entry.text).length > DRAFT_MAX_BYTES) return undefined
  if (draftEncoder.encode(entry.draft).length > DRAFT_MAX_BYTES) return undefined
  return { text: entry.text, draft: entry.draft }
}

/**
 * Dirty buffers for one session, keyed by surface id, for persist.
 * @param sessionId - store key.
 * @param buffers - live `sessionId:surfaceId` map.
 * @param surfaces - open surfaces in that session.
 * @returns drafts to store; omits clean and closed files.
 */
export function collectDirtyDrafts(
  sessionId: string,
  buffers: ReadonlyMap<string, FileDraftBuffer>,
  surfaces: readonly Surface[],
): Record<string, FileDraftBuffer> {
  const openFiles = new Set(
    surfaces.filter(surface => surface.kind === 'file').map(surface => surface.id),
  )
  const prefix = `${sessionId}:`
  const kept: Record<string, FileDraftBuffer> = {}
  for (const [key, buffer] of buffers) {
    if (!key.startsWith(prefix)) continue
    const id = key.slice(prefix.length)
    if (!openFiles.has(id)) continue
    const sanitized = sanitizeDraft(buffer)
    if (sanitized !== undefined) kept[id] = sanitized
  }
  return kept
}

function sanitizeSurface(raw: unknown): Surface | undefined {
  if (raw === null || typeof raw !== 'object') return undefined
  const entry = raw as { id?: unknown; kind?: unknown }
  if (typeof entry.id !== 'string' || typeof entry.kind !== 'string') return undefined
  switch (entry.kind) {
    case 'files':
      return entry.id === 'files' ? { id: 'files', kind: 'files' } : undefined
    case 'diff':
      return entry.id === 'diff' ? { id: 'diff', kind: 'diff' } : undefined
    case 'agents':
      return entry.id === 'agents' ? { id: 'agents', kind: 'agents' } : undefined
    // preview/terminal: older buckets carried resourceId / terminalIds /
    // activeTerminalId; nothing ever read them, so loads drop the extras.
    case 'preview':
      return { id: entry.id, kind: 'preview' }
    case 'terminal':
      return { id: entry.id, kind: 'terminal' }
    case 'file': {
      const relativePath = (entry as { relativePath?: unknown }).relativePath
      if (typeof relativePath !== 'string' || relativePath.length === 0) return undefined
      return { id: entry.id, kind: 'file', relativePath }
    }
    default:
      return undefined
  }
}
