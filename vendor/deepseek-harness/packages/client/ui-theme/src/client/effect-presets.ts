/**
 * Named ambient-gradient color schemes offered by the Appearance backdrop
 * dialog. A preset is only a color bundle — speed, bloom count, and the
 * bloom variant stay user-adjustable whatever scheme is selected. Color
 * slots left empty fall back to the theme's `--dsw-specific-gradient-*`
 * tokens, so presets keep adapting to light/dark through the base wash.
 */

import type { ThemeSettings } from '../theme-settings.ts'

/** Tunables the dialog draft carries (and the runtime consumes). */
export interface EffectScheme {
  /** Color overrides per slot; `''` keeps the theme token. */
  colors: readonly string[]
  /** Flow speed percent. */
  speed: number
  /** Visible bloom count. */
  count: number
  /** Bloom shape variant. */
  variant: ThemeSettings['backgroundEffectVariant']
}

/** One selectable preset: a stable id plus the color bundle it writes. */
export interface EffectPreset {
  /** Persisted `backgroundEffectPreset` value. */
  id: ThemeSettings['backgroundEffectPreset']
  /** Color overrides per slot; `''` keeps the theme token. */
  colors: readonly string[]
}

/** The theme-token palette (all slots empty). */
export const DEFAULT_EFFECT_PRESET: EffectPreset = {
  id: 'default',
  colors: [],
}

/**
 * Built-in palettes. `default` is the theme-token look; the rest tint the
 * blooms while leaving the base wash on the theme tokens.
 */
export const EFFECT_PRESETS: readonly EffectPreset[] = [
  DEFAULT_EFFECT_PRESET,
  {
    id: 'aurora',
    colors: ['', '', '#34d399', '#22d3ee', '#a78bfa', '#4ade80', '#38bdf8'],
  },
  {
    id: 'sunset',
    colors: ['', '', '#fb923c', '#fb7185', '#f472b6', '#fbbf24', '#f87171'],
  },
  {
    id: 'ocean',
    colors: ['', '', '#38bdf8', '#2dd4bf', '#60a5fa', '#818cf8', '#22d3ee'],
  },
  {
    id: 'sakura',
    colors: ['', '', '#f9a8d4', '#f472b6', '#c4b5fd', '#fda4af', '#fbcfe8'],
  },
]

/**
 * Resolve a stored scheme id to its preset; `custom` and unknown ids have
 * no bundle (the stored colors are used as-is).
 * @param id - persisted preset id.
 * @returns the matching preset, or undefined.
 */
export function effectPreset(id: string): EffectPreset | undefined {
  return EFFECT_PRESETS.find(preset => preset.id === id)
}
