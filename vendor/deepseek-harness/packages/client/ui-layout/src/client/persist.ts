/** Persist last-open surfaces width and terminal drawer height. */

import {
  clampWidth, SURFACES_DEFAULT, SURFACES_MAX, SURFACES_MIN,
  TERMINAL_DRAWER_DEFAULT, TERMINAL_DRAWER_MIN,
} from './columns.ts'

/** localStorage key for surfaces / drawer geometry. */
export const LAYOUT_PERSIST_KEY = 'dshd.layout.panels'

/** Last-open sizes plus whether those panels are currently open. */
export interface LayoutPersist {
  lastSurfaces: number
  lastDrawer: number
  surfaces: number
  terminalDrawer: number
}

function storage(): Storage | undefined {
  return typeof globalThis.localStorage === 'undefined' ? undefined : localStorage
}

function clampSurfaces(px: number): number {
  return clampWidth(px, SURFACES_MIN, SURFACES_MAX)
}

function clampDrawer(px: number): number {
  return Math.max(TERMINAL_DRAWER_MIN, Math.round(px))
}

/**
 * Sanitize one persisted pixel field: a finite number clamps through `clamp`,
 * an explicit 0 passes through when it means "panel closed" (`preserveZero`),
 * anything else falls back.
 */
function readPxField(
  value: number | undefined,
  clamp: (px: number) => number,
  fallback: number,
  preserveZero = false,
): number {
  if (preserveZero && value === 0) return 0
  return value !== undefined && Number.isFinite(value) ? clamp(value) : fallback
}

/**
 * Read persisted surfaces / drawer geometry.
 * @param store - `localStorage` in the browser; injectable in tests.
 * @returns sanitized sizes, or undefined when missing or malformed.
 */
export function readLayoutPersist(store: Storage | undefined = storage()): LayoutPersist | undefined {
  if (store === undefined) return undefined
  const raw = store.getItem(LAYOUT_PERSIST_KEY)
  if (raw === null || raw.length === 0) return undefined
  let parsed: unknown
  try {
    parsed = JSON.parse(raw) as unknown
  } catch {
    return undefined
  }
  if (parsed === null || typeof parsed !== 'object') return undefined
  const record = parsed as Partial<LayoutPersist>
  const lastSurfaces = readPxField(record.lastSurfaces, clampSurfaces, SURFACES_DEFAULT)
  const lastDrawer = readPxField(record.lastDrawer, clampDrawer, TERMINAL_DRAWER_DEFAULT)
  const surfaces = readPxField(record.surfaces, clampSurfaces, 0, true)
  const terminalDrawer = readPxField(record.terminalDrawer, clampDrawer, 0, true)
  return { lastSurfaces, lastDrawer, surfaces, terminalDrawer }
}

/**
 * Write surfaces / drawer geometry. Quota or SecurityError is ignored.
 * @param next - fields to merge onto the last successful read.
 * @param store - target storage.
 */
export function writeLayoutPersist(
  next: Partial<LayoutPersist>,
  store: Storage | undefined = storage(),
): void {
  if (store === undefined) return
  const current = readLayoutPersist(store) ?? {
    lastSurfaces: SURFACES_DEFAULT,
    lastDrawer: TERMINAL_DRAWER_DEFAULT,
    surfaces: 0,
    terminalDrawer: 0,
  }
  const merged: LayoutPersist = { ...current, ...next }
  try {
    store.setItem(LAYOUT_PERSIST_KEY, JSON.stringify(merged))
  } catch {
    // QuotaExceededError / SecurityError: keep the in-memory layout.
  }
}

/**
 * Last open surfaces width, or the contract default.
 * @param store - target storage.
 * @returns the persisted width, or the surfaces default.
 */
export function lastSurfacesWidth(store: Storage | undefined = storage()): number {
  return readLayoutPersist(store)?.lastSurfaces ?? SURFACES_DEFAULT
}

/**
 * Last open drawer height, or the contract default.
 * @param store - target storage.
 * @returns the persisted height, or the drawer default.
 */
export function lastDrawerHeight(store: Storage | undefined = storage()): number {
  return readLayoutPersist(store)?.lastDrawer ?? TERMINAL_DRAWER_DEFAULT
}
