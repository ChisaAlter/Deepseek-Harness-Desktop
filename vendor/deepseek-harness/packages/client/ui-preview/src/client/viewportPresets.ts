/** Chrome DevTools standard-device catalog. Labels stay English (same as EDITORS.label). */

import type { PreviewViewportSetting } from './viewport.ts'

export interface PreviewViewportPreset {
  readonly id: string
  readonly label: string
  readonly category: 'Desktop' | 'Tablet' | 'Phone'
  readonly detail: string
  readonly width: number
  readonly height: number
}

/**
 * Default setting when the device toolbar is turned on.
 * iPhone SE native CSS viewport from Chromium EmulatedDevices.ts.
 */
export const DEFAULT_DEVICE_VIEWPORT = {
  _tag: 'preset',
  presetId: 'iphone-se',
  width: 375,
  height: 667,
} as const satisfies Exclude<PreviewViewportSetting, { readonly _tag: 'fill' }>

// Keep this in Chrome DevTools' default-device order. Dimensions are CSS
// viewport sizes from Chromium's EmulatedDevices.ts standard catalog.
export const PREVIEW_VIEWPORT_PRESETS: readonly PreviewViewportPreset[] = [
  {
    id: 'iphone-se',
    label: 'iPhone SE',
    category: 'Phone',
    detail: '375 × 667',
    width: 375,
    height: 667,
  },
  {
    id: 'iphone-xr',
    label: 'iPhone XR',
    category: 'Phone',
    detail: '414 × 896',
    width: 414,
    height: 896,
  },
  {
    id: 'iphone-12-pro',
    label: 'iPhone 12 Pro',
    category: 'Phone',
    detail: '390 × 844',
    width: 390,
    height: 844,
  },
  {
    id: 'iphone-14-pro-max',
    label: 'iPhone 14 Pro Max',
    category: 'Phone',
    detail: '430 × 932',
    width: 430,
    height: 932,
  },
  {
    id: 'pixel-7',
    label: 'Pixel 7',
    category: 'Phone',
    detail: '412 × 915',
    width: 412,
    height: 915,
  },
  {
    id: 'samsung-galaxy-s8-plus',
    label: 'Samsung Galaxy S8+',
    category: 'Phone',
    detail: '360 × 740',
    width: 360,
    height: 740,
  },
  {
    id: 'samsung-galaxy-s20-ultra',
    label: 'Samsung Galaxy S20 Ultra',
    category: 'Phone',
    detail: '412 × 915',
    width: 412,
    height: 915,
  },
  {
    id: 'ipad-mini',
    label: 'iPad Mini',
    category: 'Tablet',
    detail: '768 × 1024',
    width: 768,
    height: 1024,
  },
  {
    id: 'ipad-air',
    label: 'iPad Air',
    category: 'Tablet',
    detail: '820 × 1180',
    width: 820,
    height: 1180,
  },
  {
    id: 'ipad-pro',
    label: 'iPad Pro',
    category: 'Tablet',
    detail: '1024 × 1366',
    width: 1024,
    height: 1366,
  },
  {
    id: 'surface-pro-7',
    label: 'Surface Pro 7',
    category: 'Tablet',
    detail: '912 × 1368',
    width: 912,
    height: 1368,
  },
  {
    id: 'surface-duo',
    label: 'Surface Duo',
    category: 'Phone',
    detail: '540 × 720',
    width: 540,
    height: 720,
  },
  {
    id: 'galaxy-z-fold-5',
    label: 'Galaxy Z Fold 5',
    category: 'Phone',
    detail: '344 × 882',
    width: 344,
    height: 882,
  },
  {
    id: 'asus-zenbook-fold',
    label: 'Asus Zenbook Fold',
    category: 'Tablet',
    detail: '853 × 1280',
    width: 853,
    height: 1280,
  },
  {
    id: 'samsung-galaxy-a51-71',
    label: 'Samsung Galaxy A51/71',
    category: 'Phone',
    detail: '412 × 914',
    width: 412,
    height: 914,
  },
  {
    id: 'nest-hub',
    label: 'Nest Hub',
    category: 'Tablet',
    detail: '1024 × 600',
    width: 1024,
    height: 600,
  },
  {
    id: 'nest-hub-max',
    label: 'Nest Hub Max',
    category: 'Tablet',
    detail: '1280 × 800',
    width: 1280,
    height: 800,
  },
]
