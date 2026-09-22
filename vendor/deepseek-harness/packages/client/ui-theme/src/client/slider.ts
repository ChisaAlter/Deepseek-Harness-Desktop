/** Filled-track support for the custom range slider style in AppearanceSection.module.css. */
import type { CSSProperties } from 'react'

/**
 * Inline style carrying the filled-track percent consumed by `.slider`'s
 * track gradient.
 * @param value - current slider value.
 * @param min - slider minimum.
 * @param max - slider maximum.
 * @returns a style object setting `--dsh-slider-fill`.
 */
export function sliderFillStyle(value: number, min: number, max: number): CSSProperties {
  const span = max - min
  const percent = span <= 0 ? 0 : Math.min(100, Math.max(0, ((value - min) / span) * 100))
  return { '--dsh-slider-fill': `${percent}%` } as CSSProperties
}
