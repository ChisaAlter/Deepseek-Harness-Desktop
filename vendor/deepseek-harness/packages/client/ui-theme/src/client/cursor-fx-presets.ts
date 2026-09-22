/**
 * Named pointer-effect schemes offered by the Appearance cursor dialog
 * (指针特效). A preset bundles the palette, speed, and size into one look;
 * editing any of the three marks the scheme `custom`. An empty `colors`
 * list resolves to the theme accent at paint time, so `default` keeps
 * adapting to light/dark themes.
 */

import type { ThemeSettings } from '../theme-settings.ts'

/** Tunables the dialog draft carries (and the runtime consumes). */
export interface CursorFxScheme {
  /** Palette overrides; empty falls back to the theme accent. */
  colors: readonly string[]
  /** Speed percent (trail fade / dye dissipation). */
  speed: number
  /** Size percent (grid cell / splat radius). */
  size: number
}

/** One selectable preset: a stable id plus the scheme bundle it writes. */
export interface CursorFxPreset extends CursorFxScheme {
  /** Persisted `cursorEffectPreset` value. */
  id: ThemeSettings['cursorEffectPreset']
}

/** The theme-accent look (empty palette, authored speed and size). */
export const DEFAULT_CURSOR_FX_PRESET: CursorFxPreset = {
  id: 'default',
  colors: [],
  speed: 100,
  size: 100,
}

/**
 * Built-in palettes. `default` follows the theme accent; the rest tint the
 * splats / cells with an authored bundle.
 */
export const CURSOR_FX_PRESETS: readonly CursorFxPreset[] = [
  DEFAULT_CURSOR_FX_PRESET,
  {
    id: 'rainbow',
    colors: ['#f87171', '#fbbf24', '#4ade80', '#38bdf8', '#a78bfa', '#f472b6'],
    speed: 120,
    size: 100,
  },
  {
    id: 'aurora',
    colors: ['#34d399', '#22d3ee', '#a78bfa', '#4ade80', '#38bdf8', '#818cf8'],
    speed: 100,
    size: 110,
  },
  {
    id: 'sunset',
    colors: ['#fb923c', '#fb7185', '#f472b6', '#fbbf24', '#f87171', '#fdba74'],
    speed: 90,
    size: 120,
  },
  {
    id: 'ocean',
    colors: ['#38bdf8', '#2dd4bf', '#60a5fa', '#818cf8', '#22d3ee', '#67e8f9'],
    speed: 100,
    size: 100,
  },
  {
    id: 'sakura',
    colors: ['#f9a8d4', '#f472b6', '#c4b5fd', '#fda4af', '#fbcfe8', '#e879f9'],
    speed: 80,
    size: 90,
  },
]

/**
 * Resolve a stored scheme id to its preset; `custom` and unknown ids have
 * no bundle (the stored values are used as-is).
 * @param id - persisted preset id.
 * @returns the matching preset, or undefined.
 */
export function cursorFxPreset(id: string): CursorFxPreset | undefined {
  return CURSOR_FX_PRESETS.find(preset => preset.id === id)
}
