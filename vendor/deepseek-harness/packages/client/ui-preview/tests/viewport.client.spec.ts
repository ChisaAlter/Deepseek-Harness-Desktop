import { describe, expect, it } from 'vitest'
import {
  BROWSER_DEVICE_TOOLBAR_HEIGHT,
  BROWSER_VIEWPORT_RESIZE_RAIL_SIZE,
  PREVIEW_VIEWPORT_MAX_AREA,
  PREVIEW_VIEWPORT_MAX_DIMENSION,
  PREVIEW_VIEWPORT_MIN_DIMENSION,
  browserViewportSettingKey,
  resizeBrowserViewportFromRail,
  resizeFreeformViewport,
  resolveBrowserDeviceViewportLayout,
  resolveFittedBrowserViewport,
  resolveBrowserViewportLayout,
  resolvePreviewGuestBounds,
  resolveResponsiveBrowserViewportSize,
} from '../src/client/viewport.ts'
import { PREVIEW_VIEWPORT_PRESETS } from '../src/client/viewportPresets.ts'

describe('resolveBrowserViewportLayout', () => {
  it('uses the current fixed viewport instead of stale fitted source dimensions', () => {
    expect(
      resolveFittedBrowserViewport(
        { _tag: 'freeform', width: 900, height: 600 },
        { width: 1280, height: 800, scale: 1 },
      ),
    ).toEqual({ _tag: 'freeform', width: 900, height: 600 })
  })

  it('preserves the last logical viewport when fitting a fill-mode surface', () => {
    expect(
      resolveFittedBrowserViewport({ _tag: 'fill' }, { width: 320, height: 200, scale: 0.25 }),
    ).toEqual({ _tag: 'freeform', width: 1280, height: 800 })
  })

  it('fills the available surface in fill mode', () => {
    expect(resolveBrowserViewportLayout({ width: 700, height: 500 }, { _tag: 'fill' })).toEqual({
      canvasWidth: 700,
      canvasHeight: 500,
      viewportX: 0,
      viewportY: 0,
      viewportWidth: 700,
      viewportHeight: 500,
      viewportScale: 1,
      fillsPanel: true,
    })
  })

  it('centers a smaller fixed viewport', () => {
    expect(
      resolveBrowserViewportLayout(
        { width: 700, height: 1000 },
        { _tag: 'freeform', width: 393, height: 852 },
      ),
    ).toMatchObject({
      canvasWidth: 700,
      canvasHeight: 1000,
      viewportX: 154,
      viewportY: 74,
      viewportWidth: 393,
      viewportHeight: 852,
    })
  })

  it('scales a larger fixed viewport down to fit without creating overflow', () => {
    const layout = resolveBrowserViewportLayout(
      { width: 600, height: 700 },
      { _tag: 'freeform', width: 1440, height: 900 },
    )
    expect(layout).toMatchObject({
      canvasWidth: 600,
      canvasHeight: 700,
      viewportX: 0,
      viewportY: 163,
      viewportWidth: 600,
      viewportHeight: 375,
    })
    expect(layout.viewportScale).toBeCloseTo(5 / 12)
  })

  it('keeps fixed dimensions in page CSS pixels when browser zoom changes', () => {
    expect(
      resolveBrowserViewportLayout(
        { width: 800, height: 700 },
        { _tag: 'freeform', width: 400, height: 300 },
        1.5,
      ),
    ).toMatchObject({
      viewportX: 100,
      viewportY: 125,
      viewportWidth: 600,
      viewportHeight: 450,
    })
    expect(resizeFreeformViewport({ width: 400, height: 300 }, { x: 150, y: 75 }, 1.5)).toEqual({
      width: 500,
      height: 350,
    })
  })

  it('bounds freeform drag sizes and total render area', () => {
    expect(resizeFreeformViewport({ width: 1024, height: 768 }, { x: -2000, y: -2000 })).toEqual({
      width: 240,
      height: 240,
    })
    const large = resizeFreeformViewport({ width: 1920, height: 1080 }, { x: 2000, y: 2000 })
    expect(large.width * large.height).toBeLessThanOrEqual(3840 * 2160)
  })

  it('resizes only the axes controlled by each edge', () => {
    expect(
      resizeFreeformViewport({ width: 800, height: 600 }, { x: -100, y: 500 }, 1, 'west'),
    ).toEqual({ width: 900, height: 600 })
    expect(
      resizeFreeformViewport({ width: 800, height: 600 }, { x: 500, y: 100 }, 1, 'north'),
    ).toEqual({ width: 800, height: 500 })
    expect(
      resizeFreeformViewport({ width: 800, height: 600 }, { x: -100, y: -50 }, 1, 'northwest'),
    ).toEqual({ width: 900, height: 650 })
  })

  it('preserves a locked aspect ratio from either axis', () => {
    expect(
      resizeFreeformViewport({ width: 800, height: 600 }, { x: 200, y: 0 }, 1, 'east', 4 / 3),
    ).toEqual({ width: 1000, height: 750 })
    expect(
      resizeFreeformViewport({ width: 800, height: 600 }, { x: 0, y: 150 }, 1, 'south', 4 / 3),
    ).toEqual({ width: 1000, height: 750 })
  })

  it('reserves persistent device-toolbar rails around the guest viewport', () => {
    expect(
      resolveBrowserDeviceViewportLayout(
        { width: 1200, height: 900 },
        { _tag: 'freeform', width: 1180, height: 858 },
      ),
    ).toEqual({
      canvasWidth: 1200,
      canvasHeight: 900,
      viewportX: 10,
      viewportY: 32,
      viewportWidth: 1180,
      viewportHeight: 858,
      viewportScale: 1,
      fillsPanel: false,
    })
  })

  it('captures the available framed area when responsive mode is enabled', () => {
    expect(resolveResponsiveBrowserViewportSize({ width: 1200, height: 900 })).toEqual({
      width: 1180,
      height: 858,
    })
    expect(resolveResponsiveBrowserViewportSize({ width: 1200, height: 900 }, 2)).toEqual({
      width: 590,
      height: 429,
    })
  })

  it('keeps the grabbed rail under the pointer across centered layout boundaries', () => {
    const available = { width: 1120, height: 818 }
    expect(
      resizeBrowserViewportFromRail(
        { width: 1120, height: 818 },
        { x: -100, y: -50 },
        available,
        1,
        'southeast',
      ),
    ).toEqual({ width: 920, height: 718 })
    expect(
      resizeBrowserViewportFromRail(
        { width: 800, height: 600 },
        { x: 300, y: 0 },
        { width: 1200, height: 800 },
        1,
        'east',
      ),
    ).toEqual({ width: 1300, height: 600 })
    expect(
      resizeBrowserViewportFromRail(
        { width: 560, height: 409 },
        { x: -100, y: 0 },
        available,
        2,
        'east',
      ),
    ).toEqual({ width: 460, height: 409 })
  })
})

describe('device toolbar constants and guest setBounds mapping', () => {
  it('pins the local dimension, area, toolbar, and rail constants', () => {
    expect(PREVIEW_VIEWPORT_MIN_DIMENSION).toBe(240)
    expect(PREVIEW_VIEWPORT_MAX_DIMENSION).toBe(3840)
    expect(PREVIEW_VIEWPORT_MAX_AREA).toBe(3840 * 2160)
    expect(BROWSER_DEVICE_TOOLBAR_HEIGHT).toBe(32)
    expect(BROWSER_VIEWPORT_RESIZE_RAIL_SIZE).toBe(10)
  })

  it('maps fill mode to the occupant rectangle', () => {
    expect(
      resolvePreviewGuestBounds(
        { x: 0, y: 0, width: 800, height: 600 },
        { _tag: 'fill' },
      ),
    ).toEqual({ x: 0, y: 0, width: 800, height: 600 })
  })

  it('insets setBounds by toolbar and rails for a device preset', () => {
    const occupant = { x: 40, y: 80, width: 800, height: 600 }
    const bounds = resolvePreviewGuestBounds(occupant, {
      _tag: 'preset',
      presetId: 'iphone-se',
      width: 375,
      height: 667,
    })
    expect(bounds.width).toBeLessThan(occupant.width)
    expect(bounds.height).toBeLessThan(occupant.height)
    expect(bounds.x).toBeGreaterThan(occupant.x)
    expect(bounds.y).toBeGreaterThan(occupant.y)
    const layout = resolveBrowserDeviceViewportLayout(
      { width: occupant.width, height: occupant.height },
      { _tag: 'preset', presetId: 'iphone-se', width: 375, height: 667 },
    )
    expect(bounds).toEqual({
      x: occupant.x + layout.viewportX,
      y: occupant.y + layout.viewportY,
      width: Math.round(layout.viewportWidth),
      height: Math.round(layout.viewportHeight),
    })
  })

  it('keys fill and sized settings for drag identity', () => {
    expect(browserViewportSettingKey({ _tag: 'fill' })).toBe('fill')
    expect(
      browserViewportSettingKey({ _tag: 'preset', presetId: 'iphone-se', width: 375, height: 667 }),
    ).toBe('preset:375:667:iphone-se')
    expect(
      browserViewportSettingKey({ _tag: 'freeform', width: 800, height: 600 }),
    ).toBe('freeform:800:600:')
  })
})

describe('PREVIEW_VIEWPORT_PRESETS', () => {
  it('matches Chrome DevTools standard device catalog ordering', () => {
    expect(PREVIEW_VIEWPORT_PRESETS.map(preset => preset.label)).toEqual([
      'iPhone SE',
      'iPhone XR',
      'iPhone 12 Pro',
      'iPhone 14 Pro Max',
      'Pixel 7',
      'Samsung Galaxy S8+',
      'Samsung Galaxy S20 Ultra',
      'iPad Mini',
      'iPad Air',
      'iPad Pro',
      'Surface Pro 7',
      'Surface Duo',
      'Galaxy Z Fold 5',
      'Asus Zenbook Fold',
      'Samsung Galaxy A51/71',
      'Nest Hub',
      'Nest Hub Max',
    ])
    const se = PREVIEW_VIEWPORT_PRESETS.find(preset => preset.id === 'iphone-se')
    expect(se).toEqual({
      id: 'iphone-se',
      label: 'iPhone SE',
      category: 'Phone',
      detail: '375 × 667',
      width: 375,
      height: 667,
    })
  })
})

describe('layout helpers beyond the copied viewport cases', () => {
  it('treats a missing fitted source as 1280×800 and ignores non-positive zoom', () => {
    expect(resolveFittedBrowserViewport({ _tag: 'fill' }, null)).toEqual({
      _tag: 'freeform',
      width: 1280,
      height: 800,
    })
    expect(
      resolveFittedBrowserViewport(
        { _tag: 'fill' },
        { width: 200, height: 100, scale: 0.5 },
        0,
      ),
    ).toEqual({ _tag: 'freeform', width: 400, height: 200 })
    expect(
      resolveBrowserViewportLayout(
        { width: 400, height: 300 },
        { _tag: 'freeform', width: 400, height: 300 },
        Number.NaN,
      ),
    ).toMatchObject({ viewportWidth: 400, viewportHeight: 300, viewportScale: 1 })
  })

  it('picks the larger relative axis when a locked diagonal drag moves both edges', () => {
    expect(
      resizeFreeformViewport({ width: 800, height: 600 }, { x: 200, y: 10 }, 1, 'southeast', 4 / 3),
    ).toEqual({ width: 1000, height: 750 })
    expect(
      resizeFreeformViewport({ width: 800, height: 600 }, { x: 10, y: 150 }, 1, 'southeast', 4 / 3),
    ).toEqual({ width: 1000, height: 750 })
  })

  it('shrinks the vertical axis when an unlocked south drag exceeds the area cap', () => {
    const next = resizeFreeformViewport(
      { width: 3840, height: 2160 },
      { x: 0, y: 2000 },
      1,
      'south',
    )
    expect(next.width).toBe(3840)
    expect(next.width * next.height).toBeLessThanOrEqual(3840 * 2160)
  })

  it('walks the area loop when rounding a locked size exceeds the cap', () => {
    const wide = resizeFreeformViewport(
      { width: 240, height: 240 },
      { x: 1e12, y: 0 },
      1,
      'east',
      0.573,
    )
    expect(wide.width * wide.height).toBeLessThanOrEqual(3840 * 2160)
    const tall = resizeFreeformViewport(
      { width: 240, height: 240 },
      { x: 0, y: 1e12 },
      1,
      'south',
      0.566,
    )
    expect(tall.width * tall.height).toBeLessThanOrEqual(3840 * 2160)
  })

  it('resizes from the start rails when the guest is larger than the available frame', () => {
    expect(
      resizeBrowserViewportFromRail(
        { width: 1400, height: 900 },
        { x: 40, y: 0 },
        { width: 1200, height: 800 },
        1,
        'west',
      ),
    ).toEqual({ width: 1360, height: 900 })
    expect(
      resizeBrowserViewportFromRail(
        { width: 1400, height: 900 },
        { x: 300, y: 0 },
        { width: 1200, height: 800 },
        1,
        'west',
      ),
    ).toEqual({ width: 1000, height: 900 })
    expect(
      resizeBrowserViewportFromRail(
        { width: 800, height: 600 },
        { x: -200, y: 0 },
        { width: 1200, height: 800 },
        1,
        'west',
      ),
    ).toEqual({ width: 1200, height: 600 })
    expect(
      resizeBrowserViewportFromRail(
        { width: 800, height: 600 },
        { x: 0, y: -200 },
        { width: 1200, height: 800 },
        1,
        'north',
      ),
    ).toEqual({ width: 800, height: 900 })
    expect(
      resizeBrowserViewportFromRail(
        { width: 800, height: 900 },
        { x: 0, y: 40 },
        { width: 1200, height: 800 },
        1,
        'north',
      ).height,
    ).toBeLessThan(900)
  })
})
