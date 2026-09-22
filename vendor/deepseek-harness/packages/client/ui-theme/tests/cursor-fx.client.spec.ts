// @vitest-environment jsdom
/** Pointer-effects layer: clamps, palette, and the shared fullscreen layer lifecycle. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  applyCursorFxLayer, clampCursorEffectSize, clampCursorEffectSpeed,
  CURSOR_FX_ATTR, CURSOR_FX_LAYER_ID, isCursorEffect, isCursorEffectPreset,
  mountCursorFx, resolveCursorFxPalette, sanitizeCursorEffectColors,
} from '../src/cursor-fx.ts'

const EXTRAS = {
  cursorEffectEnabled: true,
  cursorEffect: 'trail',
  cursorEffectColors: ['#112233'],
  cursorEffectSpeed: 100,
  cursorEffectSize: 100,
}

let rafId = 0
const rafCallbacks = new Map<number, FrameRequestCallback>()
let fillRects = 0

/** Run every queued animation frame once with the given timestamp. */
function stepFrames(time = 16): void {
  const callbacks = [...rafCallbacks.values()]
  rafCallbacks.clear()
  for (const cb of callbacks) cb(time)
}

function stub2d(): void {
  const context = {
    setTransform: () => undefined,
    clearRect: () => undefined,
    fillRect: () => { fillRects += 1 },
    globalAlpha: 1,
    fillStyle: '',
  }
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext')
    .mockImplementation(((kind: string) => (kind === '2d' ? context : null)) as never)
}

function sizeCanvas(canvas: HTMLCanvasElement): void {
  Object.defineProperty(canvas, 'clientWidth', { configurable: true, value: 800 })
  Object.defineProperty(canvas, 'clientHeight', { configurable: true, value: 600 })
}

describe('cursor fx clamps and palette', () => {
  it('clamps speed and size into the slider ranges with finite fallbacks', () => {
    expect(clampCursorEffectSpeed(999)).toBe(300)
    expect(clampCursorEffectSpeed(0)).toBe(20)
    expect(clampCursorEffectSpeed(Number.NaN)).toBe(100)
    expect(clampCursorEffectSize(999)).toBe(300)
    expect(clampCursorEffectSize(0)).toBe(25)
    expect(clampCursorEffectSize(Number.NaN)).toBe(100)
  })

  it('sanitizes the palette: hex only, lowercased, capped at six slots', () => {
    expect(sanitizeCursorEffectColors(['#A1B2C3', 'junk', '#102030'])).toEqual(['#a1b2c3', '#102030'])
    expect(sanitizeCursorEffectColors(['#111111', '#222222', '#333333', '#444444', '#555555', '#666666', '#777777']))
      .toHaveLength(6)
    expect(sanitizeCursorEffectColors([])).toEqual([])
    expect(sanitizeCursorEffectColors(undefined)).toEqual([])
  })

  it('accepts only the known effect and preset slugs', () => {
    expect(isCursorEffect('trail')).toBe(true)
    expect(isCursorEffect('splash')).toBe(true)
    expect(isCursorEffect('meteors')).toBe(false)
    expect(isCursorEffectPreset('ocean')).toBe(true)
    expect(isCursorEffectPreset('bogus')).toBe(false)
  })

  it('resolves custom colors and falls back to a neutral palette off-DOM', () => {
    expect(resolveCursorFxPalette(['#A1B2C3', '#102030'])).toEqual(['#a1b2c3', '#102030'])
    // jsdom exposes no theme tokens: the empty palette resolves neutral.
    expect(resolveCursorFxPalette([])).toEqual(['#888888'])
  })
})

describe('resolveCursorFxPalette theme accent', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  function stubTokens(values: Record<string, string>): void {
    vi.stubGlobal('getComputedStyle', () => ({
      getPropertyValue: (name: string) => values[name] ?? '',
    }))
  }

  it('lowercases a hex accent', () => {
    stubTokens({ '--dsw-alias-brand-primary': '#A1B2C3' })
    expect(resolveCursorFxPalette([])).toEqual(['#a1b2c3'])
  })

  it('expands a shorthand hex accent', () => {
    stubTokens({ '--dsw-alias-brand-primary': '#aBc' })
    expect(resolveCursorFxPalette([])).toEqual(['#aabbcc'])
  })

  it('follows var() hops to a concrete color', () => {
    stubTokens({ '--dsw-alias-brand-primary': 'var(--accent-deep)', '--accent-deep': '#102030' })
    expect(resolveCursorFxPalette([])).toEqual(['#102030'])
  })

  it('falls back neutral when var() hops never resolve', () => {
    stubTokens({ '--dsw-alias-brand-primary': 'var(--loop)', '--loop': 'var(--loop)' })
    expect(resolveCursorFxPalette([])).toEqual(['#888888'])
  })
})

describe('mountCursorFx', () => {
  beforeEach(() => {
    rafId = 0
    fillRects = 0
    rafCallbacks.clear()
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
      rafId += 1
      rafCallbacks.set(rafId, cb)
      return rafId
    })
    vi.stubGlobal('cancelAnimationFrame', (id: number) => { rafCallbacks.delete(id) })
    stub2d()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('retunes a live engine and ignores stale ticks after dispose', () => {
    const canvas = document.createElement('canvas')
    sizeCanvas(canvas)
    const handle = mountCursorFx(canvas, 'trail', { colors: [], speed: 100, size: 100 })
    handle.pointerMove(10, 10)
    handle.update({ colors: [], speed: 200, size: 50 })
    handle.pointerMove(60, 60)
    handle.pointerDown(60, 60)
    stepFrames()
    expect(fillRects).toBeGreaterThan(0)
    const stale = rafCallbacks.get(rafId)
    handle.dispose()
    handle.dispose()
    // A frame queued before dispose still runs once: the guard eats it.
    stale?.(16)
  })

  it('returns an inert handle without requestAnimationFrame', () => {
    vi.stubGlobal('requestAnimationFrame', undefined)
    const handle = mountCursorFx(
      document.createElement('canvas'), 'trail',
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

describe('applyCursorFxLayer', () => {
  beforeEach(() => {
    rafId = 0
    fillRects = 0
    rafCallbacks.clear()
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
      rafId += 1
      rafCallbacks.set(rafId, cb)
      return rafId
    })
    vi.stubGlobal('cancelAnimationFrame', (id: number) => { rafCallbacks.delete(id) })
    stub2d()
  })

  afterEach(() => {
    applyCursorFxLayer({ cursorEffectEnabled: false })
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('mounts the layer for the chosen effect and removes it when disabled', () => {
    applyCursorFxLayer(EXTRAS)
    const layer = document.getElementById(CURSOR_FX_LAYER_ID)
    expect(layer).not.toBeNull()
    expect(layer?.getAttribute(CURSOR_FX_ATTR)).toBe('trail')
    applyCursorFxLayer({ ...EXTRAS, cursorEffectEnabled: false })
    expect(document.getElementById(CURSOR_FX_LAYER_ID)).toBeNull()
  })

  it('paints cells on pointer motion and reuses the layer across updates', () => {
    applyCursorFxLayer(EXTRAS)
    const layer = document.getElementById(CURSOR_FX_LAYER_ID)
    sizeCanvas(layer?.querySelector('canvas') as HTMLCanvasElement)
    window.dispatchEvent(new MouseEvent('pointermove', { clientX: 40, clientY: 40 }))
    stepFrames()
    expect(fillRects).toBeGreaterThan(0)
    applyCursorFxLayer({ ...EXTRAS, cursorEffectSpeed: 200 })
    expect(document.getElementById(CURSOR_FX_LAYER_ID)).toBe(layer)
  })

  it('drops the layer entirely when the switched-to effect cannot mount', () => {
    applyCursorFxLayer(EXTRAS)
    applyCursorFxLayer({ ...EXTRAS, cursorEffect: 'splash' })
    // jsdom has no WebGL: the fluid engine fails closed, the old layer is
    // torn down, and no replacement enters the DOM.
    expect(document.getElementById(CURSOR_FX_LAYER_ID)).toBeNull()
  })

  it('interpolates the trail between moves and stamps again on pointerdown', () => {
    applyCursorFxLayer(EXTRAS)
    const layer = document.getElementById(CURSOR_FX_LAYER_ID)
    sizeCanvas(layer?.querySelector('canvas') as HTMLCanvasElement)
    window.dispatchEvent(new MouseEvent('pointermove', { clientX: 10, clientY: 10 }))
    window.dispatchEvent(new MouseEvent('pointermove', { clientX: 300, clientY: 10 }))
    window.dispatchEvent(new MouseEvent('pointerdown', { clientX: 300, clientY: 10 }))
    stepFrames()
    expect(fillRects).toBeGreaterThan(0)
  })

  it('expires stamped cells once their fade lifetime passes', () => {
    const now = vi.spyOn(Date, 'now')
    now.mockReturnValue(1_000)
    applyCursorFxLayer({ ...EXTRAS, cursorEffectSpeed: 300 })
    const layer = document.getElementById(CURSOR_FX_LAYER_ID)
    sizeCanvas(layer?.querySelector('canvas') as HTMLCanvasElement)
    window.dispatchEvent(new MouseEvent('pointermove', { clientX: 40, clientY: 40 }))
    stepFrames()
    expect(fillRects).toBeGreaterThan(0)
    const painted = fillRects
    now.mockReturnValue(10_000)
    stepFrames()
    // Every cell outlived its fade: the frame clears without repainting.
    expect(fillRects).toBe(painted)
  })

  it('stops stamping once the live-cell cap is reached', () => {
    applyCursorFxLayer({ ...EXTRAS, cursorEffectSize: 25 })
    const layer = document.getElementById(CURSOR_FX_LAYER_ID)
    sizeCanvas(layer?.querySelector('canvas') as HTMLCanvasElement)
    // cellPx is 6 at size 25: vertical sweeps 50px apart fill over 4000
    // cells, so the tail sweeps run into the cap guard inside stamp().
    for (let x = 0; x <= 800; x += 50) {
      window.dispatchEvent(new MouseEvent('pointermove', { clientX: x, clientY: 0 }))
      window.dispatchEvent(new MouseEvent('pointermove', { clientX: x, clientY: 600 }))
    }
    stepFrames()
    expect(fillRects).toBeGreaterThan(0)
  })

  it('defaults absent tunables, unknown slugs, and a zero devicePixelRatio', () => {
    const dpr = Object.getOwnPropertyDescriptor(window, 'devicePixelRatio')
    Object.defineProperty(window, 'devicePixelRatio', { configurable: true, value: 0 })
    try {
      applyCursorFxLayer({ cursorEffectEnabled: true, cursorEffect: 'bogus' })
      const layer = document.getElementById(CURSOR_FX_LAYER_ID)
      expect(layer?.getAttribute(CURSOR_FX_ATTR)).toBe('trail')
      sizeCanvas(layer?.querySelector('canvas') as HTMLCanvasElement)
      window.dispatchEvent(new MouseEvent('pointermove', { clientX: 5, clientY: 5 }))
      stepFrames()
      expect(fillRects).toBeGreaterThan(0)
    } finally {
      if (dpr !== undefined) Object.defineProperty(window, 'devicePixelRatio', dpr)
    }
  })

  it('leaves no residue while reduced motion is preferred', () => {
    vi.stubGlobal('matchMedia', (query: string) => ({
      matches: query === '(prefers-reduced-motion: reduce)',
      media: query,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    }))
    applyCursorFxLayer(EXTRAS)
    expect(document.getElementById(CURSOR_FX_LAYER_ID)).toBeNull()
  })

  it('leaves no residue without canvas support', () => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => null)
    applyCursorFxLayer(EXTRAS)
    expect(document.getElementById(CURSOR_FX_LAYER_ID)).toBeNull()
  })
})
