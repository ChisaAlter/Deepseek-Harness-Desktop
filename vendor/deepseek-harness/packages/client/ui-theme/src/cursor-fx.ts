/**
 * Pointer-effects layer (指针特效): paints one of the user-chosen pointer
 * decorations into a shared fullscreen canvas at {@link CURSOR_FX_LAYER_ID}.
 * Ported from the ayase.cn/motion references (ReactBits `PixelTrail` and
 * `SplashCursor`):
 *
 * - `trail` — 2D canvas grid; pointer motion stamps cells that fade out.
 * - `splash` — WebGL Navier-Stokes dye sim in {@link cursor-fluid}.
 *
 * `applyCursorFxLayer` is a singleton re-applied on every theme publish.
 * Swapping the effect or the enabled flag rebuilds the canvas; speed / size
 * / colors flow through the live `update` channel instead. The layer owns
 * its window pointer listeners and ignores pointer capture (`pointermove`
 * keeps firing while a drag is captured, which keeps the trail continuous).
 * Reduced motion or no canvas/WebGL support leaves no DOM residue.
 */

import { mountFluidCursor } from './cursor-fluid.ts'

/** Stable layer id so re-apply replaces instead of stacking. */
export const CURSOR_FX_LAYER_ID = 'dsh-cursor-fx'
/** Data attribute mirrored onto the layer for themes/tests. */
export const CURSOR_FX_ATTR = 'data-dsh-cursor-fx'
/** Layer z-index: below menus (101) is wrong — the trail is a decorative
 *  overlay and must paint above the whole UI like the reference demos. */
const CURSOR_FX_Z_INDEX = 9999

/** Slug union for the pointer decoration. */
export const CURSOR_EFFECTS = ['trail', 'splash'] as const
/** Pointer decoration slug: the 2D grid trail or the WebGL fluid splash. */
export type CursorEffect = (typeof CURSOR_EFFECTS)[number]
/** Effect applied when the stored slug is absent or unknown. */
export const DEFAULT_CURSOR_EFFECT: CursorEffect = 'trail'

/** Persisted preset ids; `custom` means the user tuned a preset's values. */
export const CURSOR_EFFECT_PRESETS = [
  'default', 'rainbow', 'aurora', 'sunset', 'ocean', 'sakura', 'custom',
] as const
/** Persisted pointer-scheme id (`custom` carries hand-tuned values). */
export type CursorEffectPreset = (typeof CURSOR_EFFECT_PRESETS)[number]

/** Speed slider bounds (percent; 100 is the reference look). */
export const MIN_CURSOR_EFFECT_SPEED = 20
/** Fastest selectable speed percent. */
export const MAX_CURSOR_EFFECT_SPEED = 300
/** Speed percent applied when the stored value is absent or invalid. */
export const DEFAULT_CURSOR_EFFECT_SPEED = 100

/** Size slider bounds (percent; scales splat radius / grid cell). */
export const MIN_CURSOR_EFFECT_SIZE = 25
/** Largest selectable size percent. */
export const MAX_CURSOR_EFFECT_SIZE = 300
/** Size percent applied when the stored value is absent or invalid. */
export const DEFAULT_CURSOR_EFFECT_SIZE = 100

/** Custom-palette slots shown in the dialog. */
export const CURSOR_EFFECT_COLOR_SLOTS = 6

/** Pixel-trail cell edge at size 100% (CSS px). */
const BASE_PIXEL_CELL = 24
/** Pixel-trail fade duration at speed 100% (ms). */
const BASE_PIXEL_LIFE = 700
/** Trail stamp radius around the pointer (cell units). */
const PIXEL_STAMP_RADIUS = 1.2
/** Hard cap on live cells so a fast diagonal swipe can't allocate forever. */
const PIXEL_CELL_CAP = 4000

/**
 * Narrow a stored slug to the known pointer decorations.
 * @param value - raw settings value.
 * @returns whether the slug is a mountable effect.
 */
export function isCursorEffect(value: string): value is CursorEffect {
  return (CURSOR_EFFECTS as readonly string[]).includes(value)
}

/** Slugs written by the first shipped version of this feature. */
const LEGACY_CURSOR_EFFECTS: Record<string, CursorEffect> = {
  'pixel-trail': 'trail',
  'splash-cursor': 'splash',
}

/**
 * Resolve a stored slug to a mountable effect: current slugs pass through,
 * slugs from the first shipped version map to their renamed successor, and
 * anything else falls back to the default.
 * @param value - raw settings value.
 * @returns the resolved effect.
 */
export function normalizeCursorEffect(value: unknown): CursorEffect {
  if (typeof value !== 'string') return DEFAULT_CURSOR_EFFECT
  return isCursorEffect(value) ? value : LEGACY_CURSOR_EFFECTS[value] ?? DEFAULT_CURSOR_EFFECT
}

/**
 * Narrow a stored id to the known scheme presets.
 * @param value - raw settings value.
 * @returns whether the id names a preset or `custom`.
 */
export function isCursorEffectPreset(value: string): value is CursorEffectPreset {
  return (CURSOR_EFFECT_PRESETS as readonly string[]).includes(value)
}

/**
 * Clamp a speed percent into the slider range; non-finite input resets.
 * @param value - raw settings value.
 * @returns a bounded speed percent.
 */
export function clampCursorEffectSpeed(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_CURSOR_EFFECT_SPEED
  return Math.min(MAX_CURSOR_EFFECT_SPEED, Math.max(MIN_CURSOR_EFFECT_SPEED, Math.round(value)))
}

/**
 * Clamp a size percent into the slider range; non-finite input resets.
 * @param value - raw settings value.
 * @returns a bounded size percent.
 */
export function clampCursorEffectSize(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_CURSOR_EFFECT_SIZE
  return Math.min(MAX_CURSOR_EFFECT_SIZE, Math.max(MIN_CURSOR_EFFECT_SIZE, Math.round(value)))
}

/**
 * Check whether a palette slot holds a `#rrggbb` color.
 * @param value - raw palette slot.
 * @returns whether the slot is a valid 6-digit hex color.
 */
export function isCursorEffectColor(value: string): boolean {
  return /^#[0-9a-f]{6}$/i.test(value)
}

/**
 * Keep valid #rrggbb slots; an empty array falls back to the theme accent.
 * @param value - stored palette (may be absent or contain invalid slots).
 * @returns at most {@link CURSOR_EFFECT_COLOR_SLOTS} lowercased colors.
 */
export function sanitizeCursorEffectColors(value: readonly string[] | undefined): string[] {
  const out: string[] = []
  for (const item of value ?? []) {
    if (out.length >= CURSOR_EFFECT_COLOR_SLOTS) break
    if (typeof item === 'string' && isCursorEffectColor(item)) out.push(item.toLowerCase())
  }
  return out
}

/** Resolved per-frame inputs for both engines. */
export interface CursorFxConfig {
  /** Resolved #rrggbb palette (≥1 entry); engines pick per splat/cell. */
  colors: readonly string[]
  /** Speed percent, already clamped. */
  speed: number
  /** Size percent, already clamped. */
  size: number
}

/** Engine control channel shared by both decorations and the preview. */
export interface CursorFxHandle {
  /** Re-tune speed / size / palette without rebuilding the engine. */
  update: (config: CursorFxConfig) => void
  /** Feed a pointer position (client-space CSS px). */
  pointerMove: (x: number, y: number) => void
  /** Feed a pointer press (client-space CSS px). */
  pointerDown: (x: number, y: number) => void
  /** Stop loops and release GPU/canvas resources. */
  dispose: () => void
}

const noopCursorFx: CursorFxHandle = {
  update: () => undefined,
  pointerMove: () => undefined,
  pointerDown: () => undefined,
  dispose: () => undefined,
}

/**
 * Mount the trail engine (2D canvas grid; pointer motion stamps cells
 * that fade out over `life` ms). Returns a no-op handle without 2D support.
 * @param canvas - target canvas (fullscreen layer or the settings preview).
 * @param config - resolved palette, speed percent, and size percent.
 * @returns the engine handle.
 */
function mountTrail(canvas: HTMLCanvasElement, config: CursorFxConfig): CursorFxHandle {
  if (typeof window === 'undefined' || typeof requestAnimationFrame !== 'function') return noopCursorFx
  const context = canvas.getContext('2d')
  if (context === null) return noopCursorFx
  const ctx: CanvasRenderingContext2D = context

  let palette = config.colors.length > 0 ? [...config.colors] : ['#888888']
  let cellPx = Math.max(6, Math.round(BASE_PIXEL_CELL * (config.size / 100)))
  let life = Math.max(150, BASE_PIXEL_LIFE * (100 / config.speed))
  const cells = new Map<number, { born: number; color: string }>()
  let last: { x: number; y: number } | null = null
  let frame = 0
  let disposed = false

  /* v8 ignore next -- the bounded index always resolves; the fallback only satisfies noUncheckedIndexedAccess */
  const pick = (): string => palette[Math.floor(Math.random() * palette.length)] ?? '#888888'

  function resize(): void {
    const dpr = window.devicePixelRatio || 1
    const w = Math.max(1, Math.round(canvas.clientWidth * dpr))
    const h = Math.max(1, Math.round(canvas.clientHeight * dpr))
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w
      canvas.height = h
      cells.clear()
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  }

  function stamp(x: number, y: number): void {
    const cols = Math.ceil(canvas.clientWidth / cellPx)
    const r = cellPx * PIXEL_STAMP_RADIUS
    const gx0 = Math.floor((x - r) / cellPx)
    const gx1 = Math.floor((x + r) / cellPx)
    const gy0 = Math.floor((y - r) / cellPx)
    const gy1 = Math.floor((y + r) / cellPx)
    const now = Date.now()
    for (let gy = gy0; gy <= gy1; gy += 1) {
      for (let gx = gx0; gx <= gx1; gx += 1) {
        const cx = gx * cellPx + cellPx / 2
        const cy = gy * cellPx + cellPx / 2
        if ((cx - x) * (cx - x) + (cy - y) * (cy - y) > r * r) continue
        if (cells.size >= PIXEL_CELL_CAP) return
        cells.set(gy * cols + gx, { born: now, color: pick() })
      }
    }
  }

  function tick(): void {
    if (disposed) return
    frame = 0
    resize()
    const now = Date.now()
    ctx.clearRect(0, 0, canvas.clientWidth, canvas.clientHeight)
    const gap = Math.max(1, Math.round(cellPx * 0.12))
    for (const [key, cell] of cells) {
      const age = now - cell.born
      if (age >= life) {
        cells.delete(key)
        continue
      }
      const cols = Math.ceil(canvas.clientWidth / cellPx)
      const gx = key % cols
      const gy = Math.floor(key / cols)
      ctx.globalAlpha = 1 - age / life
      ctx.fillStyle = cell.color
      ctx.fillRect(gx * cellPx + gap, gy * cellPx + gap, cellPx - gap * 2, cellPx - gap * 2)
    }
    ctx.globalAlpha = 1
    if (cells.size > 0) frame = requestAnimationFrame(tick)
  }

  function wake(): void {
    if (frame === 0 && !disposed) frame = requestAnimationFrame(tick)
  }

  function feed(x: number, y: number): void {
    // Reconcile canvas size before stamping so the tick's own resize does not
    // wipe the cells this move just laid.
    resize()
    const rect = canvas.getBoundingClientRect()
    const px = x - rect.left
    const py = y - rect.top
    if (last === null) {
      stamp(px, py)
    } else {
      // Interpolate so fast swipes still lay a continuous trail.
      const dist = Math.hypot(px - last.x, py - last.y)
      const steps = Math.max(1, Math.floor(dist / (cellPx * 0.75)))
      for (let i = 1; i <= steps; i += 1) {
        stamp(last.x + ((px - last.x) * i) / steps, last.y + ((py - last.y) * i) / steps)
      }
    }
    last = { x: px, y: py }
    wake()
  }

  return {
    update(next: CursorFxConfig): void {
      palette = next.colors.length > 0 ? [...next.colors] : ['#888888']
      cellPx = Math.max(6, Math.round(BASE_PIXEL_CELL * (next.size / 100)))
      life = Math.max(150, BASE_PIXEL_LIFE * (100 / next.speed))
    },
    pointerMove: feed,
    pointerDown(x: number, y: number): void {
      feed(x, y)
    },
    dispose(): void {
      if (disposed) return
      disposed = true
      if (frame !== 0) {
        cancelAnimationFrame(frame)
        frame = 0
      }
      cells.clear()
    },
  }
}

/**
 * Mount the configured engine on a canvas. Shared by the fullscreen layer
 * and the settings preview box. Fails closed (no-op handle) when the engine
 * cannot run.
 * @param canvas - target canvas.
 * @param effect - `trail` or `splash`.
 * @param config - resolved palette, speed percent, and size percent.
 * @returns the engine handle.
 */
export function mountCursorFx(
  canvas: HTMLCanvasElement,
  effect: CursorEffect,
  config: CursorFxConfig,
): CursorFxHandle {
  if (effect === 'splash') return mountFluidCursor(canvas, config) ?? noopCursorFx
  return mountTrail(canvas, config)
}

/** Match the wallpaper layer's color resolution: chase `--var` hops so the
 *  engine always receives concrete #rrggbb values. */
function resolveTokenColor(raw: string): string | null {
  let value = raw.trim()
  for (let depth = 0; depth < 4; depth += 1) {
    const hex = value.match(/^#(?:[0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i)
    if (hex) {
      const v = hex[0].slice(1)
      if (v.length === 3) {
        return `#${v[0]}${v[0]}${v[1]}${v[1]}${v[2]}${v[2]}`.toLowerCase()
      }
      return `#${v.slice(0, 6)}`.toLowerCase()
    }
    const ref = value.match(/^var\(\s*(--[-\w]+)\s*\)$/)
    // The only caller (resolveCursorFxPalette) already returned off-DOM, so a
    // matched var() hop always has a document to resolve against.
    if (ref !== null) {
      /* v8 ignore next -- the var() pattern always captures the name group */
      value = getComputedStyle(document.body).getPropertyValue(ref[1] ?? '').trim()
      continue
    }
    return null
  }
  return null
}

/**
 * Resolve the engine palette: sanitized custom colors, or the theme accent
 * when the custom list is empty (the `default` preset). Never returns an
 * empty array.
 * @param colors - sanitized custom palette (may be empty).
 * @returns resolved #rrggbb palette.
 */
export function resolveCursorFxPalette(colors: readonly string[]): string[] {
  const out = colors.filter(isCursorEffectColor).map(c => c.toLowerCase())
  if (out.length > 0) return out
  if (typeof document === 'undefined') return ['#888888']
  const accent = resolveTokenColor(
    getComputedStyle(document.body).getPropertyValue('--dsw-alias-brand-primary'),
  )
  return accent !== null ? [accent] : ['#888888']
}

interface CursorFxState {
  effect: CursorEffect
  layer: HTMLDivElement
  canvas: HTMLCanvasElement
  handle: CursorFxHandle
}

let activeFx: CursorFxState | null = null

function teardownCursorFx(): void {
  if (activeFx === null) return
  activeFx.handle.dispose()
  activeFx.layer.remove()
  activeFx = null
}

function reducedMotion(): boolean {
  return typeof window !== 'undefined'
    && typeof window.matchMedia === 'function'
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

/**
 * Apply the cursor-effect extras to the shared fullscreen layer. Rebuilds the
 * canvas on effect/enabled changes; otherwise pushes the new config through
 * the live `update` channel.
 * @param extras - enabled flag, chosen effect, sanitized colors, speed, size.
 */
export function applyCursorFxLayer(extras: {
  cursorEffectEnabled?: boolean | undefined
  cursorEffect?: string | undefined
  cursorEffectColors?: readonly string[] | undefined
  cursorEffectSpeed?: number | undefined
  cursorEffectSize?: number | undefined
}): void {
  if (typeof document === 'undefined') return
  const effect = normalizeCursorEffect(extras.cursorEffect)
  const enabled = extras.cursorEffectEnabled === true && !reducedMotion()

  if (!enabled) {
    teardownCursorFx()
    return
  }

  const config: CursorFxConfig = {
    colors: resolveCursorFxPalette(extras.cursorEffectColors ?? []),
    speed: clampCursorEffectSpeed(extras.cursorEffectSpeed ?? DEFAULT_CURSOR_EFFECT_SPEED),
    size: clampCursorEffectSize(extras.cursorEffectSize ?? DEFAULT_CURSOR_EFFECT_SIZE),
  }

  if (activeFx !== null && activeFx.effect === effect) {
    activeFx.handle.update(config)
    return
  }

  teardownCursorFx()

  const layer = document.createElement('div')
  layer.id = CURSOR_FX_LAYER_ID
  layer.setAttribute(CURSOR_FX_ATTR, effect)
  Object.assign(layer.style, {
    position: 'fixed',
    inset: '0',
    zIndex: String(CURSOR_FX_Z_INDEX),
    pointerEvents: 'none',
  })
  const canvas = document.createElement('canvas')
  Object.assign(canvas.style, {
    position: 'absolute',
    inset: '0',
    width: '100%',
    height: '100%',
    display: 'block',
  })
  layer.append(canvas)

  const handle = mountCursorFx(canvas, effect, config)
  if (handle === noopCursorFx) return

  const onMove = (e: PointerEvent): void => { handle.pointerMove(e.clientX, e.clientY) }
  const onDown = (e: PointerEvent): void => { handle.pointerDown(e.clientX, e.clientY) }
  window.addEventListener('pointermove', onMove, { passive: true })
  window.addEventListener('pointerdown', onDown, { passive: true })
  // Wrap dispose so the layer's window listeners always leave with it.
  const disposeAll = (): void => {
    window.removeEventListener('pointermove', onMove)
    window.removeEventListener('pointerdown', onDown)
    handle.dispose()
  }

  document.body.append(layer)
  activeFx = {
    effect,
    layer,
    canvas,
    handle: { ...handle, dispose: disposeAll },
  }
}
