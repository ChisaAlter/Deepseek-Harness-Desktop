/** Seed-color derivation into `--dsw-alias-*` token overrides. */

import type { ThemeSeeds, ThemeTokens } from './theme-family.ts'

type Rgb = { r: number; g: number; b: number }

const STATUS_PALETTE = {
  light: {
    destructive: '#c53b2c',
    success: '#0a7d5d',
    warning: '#a95a00',
  },
  dark: {
    destructive: '#ff7b72',
    success: '#3fb950',
    warning: '#d29922',
  },
} as const

/**
 * Minimum WCAG contrast of `--dsw-specific-sidebar-nav-item-active` against
 * `--dsw-alias-bg-layer-2` (settings nav and chat sidebar sit on raised fills).
 */
export const NAV_ITEM_ACTIVE_MIN_CONTRAST = 1.25

/** Stronger selected-row wash used by settings nav and accented session rows. */
export const NAV_ITEM_ACTIVE_ACCENT_MIN_CONTRAST = 1.4

/**
 * Derive alias-layer tokens from three seed colors and contrast.
 * The canvas stays `seeds.background`. Accent paints every colorful chrome
 * token the sheets otherwise pin to DeepSeek blue (send, links, user bubble,
 * sidebar selection) and tints raised surfaces so a custom family is visible
 * without opening Settings. Incomplete coverage is intentional: unset names
 * keep the CSS-sheet values.
 * @param seeds - accent / background / foreground plus optional overrides.
 * @returns `--dsw-*` variable map for the active half.
 */
export function deriveThemeTokens(seeds: ThemeSeeds): ThemeTokens {
  const contrastFactor = clamp(seeds.contrast / 100, 0, 1)
  const isDark = getRelativeLuminance(seeds.background) < getRelativeLuminance(seeds.foreground)
  const wash = isDark ? 0.14 + contrastFactor * 0.10 : 0.10 + contrastFactor * 0.08
  const washStrong = isDark ? 0.26 + contrastFactor * 0.12 : 0.18 + contrastFactor * 0.10
  const accentWash = mixColors(seeds.background, seeds.accent, wash)
  const accentWashStrong = mixColors(seeds.background, seeds.accent, washStrong)
  const card = mixColors(
    mixColors(
      seeds.background,
      seeds.foreground,
      isDark ? 0.02 + contrastFactor * 0.04 : 0.006 + contrastFactor * 0.016,
    ),
    seeds.accent,
    isDark ? 0.08 + contrastFactor * 0.05 : 0.05 + contrastFactor * 0.04,
  )
  const overlay = mixColors(
    mixColors(
      seeds.background,
      seeds.foreground,
      isDark ? 0.035 + contrastFactor * 0.05 : 0.012 + contrastFactor * 0.02,
    ),
    seeds.accent,
    isDark ? 0.10 + contrastFactor * 0.05 : 0.06 + contrastFactor * 0.04,
  )
  const layer2 = mixColors(
    mixColors(
      seeds.background,
      seeds.foreground,
      isDark ? 0.05 + contrastFactor * 0.05 : 0.02 + contrastFactor * 0.02,
    ),
    seeds.accent,
    isDark ? 0.12 + contrastFactor * 0.06 : 0.07 + contrastFactor * 0.04,
  )
  const mutedForeground = mixColors(
    seeds.foreground,
    seeds.background,
    0.38 - contrastFactor * 0.14,
  )
  const border = withAlpha(seeds.foreground, 0.08 + contrastFactor * 0.18)
  const input = withAlpha(seeds.foreground, 0.1 + contrastFactor * 0.2)
  const sidebar = mixColors(seeds.background, seeds.accent, washStrong)
  const navActive = mixUntilContrast(
    seeds.background, seeds.accent, wash, layer2, NAV_ITEM_ACTIVE_MIN_CONTRAST,
  )
  const navActiveAccent = mixUntilContrast(
    seeds.background,
    seeds.accent,
    Math.max(washStrong, wash + 0.08),
    layer2,
    NAV_ITEM_ACTIVE_ACCENT_MIN_CONTRAST,
  )
  const accentHover = mixColors(seeds.accent, isDark ? '#ffffff' : '#000000', 0.18)
  const onAccent = pickReadableText(seeds.accent, [seeds.foreground, seeds.background, '#ffffff', '#0f1115'])
  const status = isDark ? STATUS_PALETTE.dark : STATUS_PALETTE.light
  const tokens: ThemeTokens = {
    '--dsw-alias-bg-base': seeds.background,
    '--dsw-alias-bg-layer-1': card,
    '--dsw-alias-bg-layer-2': layer2,
    '--dsw-alias-bg-overlay': overlay,
    '--dsw-alias-label-primary': seeds.foreground,
    '--dsw-alias-label-secondary': mutedForeground,
    '--dsw-alias-label-primary-foreground': onAccent,
    '--dsw-alias-brand-primary': seeds.accent,
    '--dsw-alias-brand-primary-invert': onAccent,
    '--dsw-alias-brand-text': seeds.accent,
    '--dsw-alias-brand-primary-new-colorprimary-new-color': seeds.accent,
    '--dsw-alias-button-primary-fill': seeds.accent,
    '--dsw-alias-button-primary-hover': accentHover,
    '--dsw-alias-button-info-fill': seeds.accent,
    '--dsw-alias-button-info-hover': accentHover,
    '--dsw-alias-state-business-primary': seeds.accent,
    '--dsw-alias-state-business-tertiary': accentWash,
    '--dsw-alias-border-l1': border,
    '--dsw-alias-border-l2': input,
    '--dsw-alias-state-error-primary': status.destructive,
    '--dsw-alias-state-success-primary': status.success,
    '--dsw-alias-state-warn-primary': status.warning,
    '--dsw-specific-bubble': accentWash,
    '--dsw-specific-bubble-highlight': accentWashStrong,
    '--dsw-specific-sidebar-fill': sidebar,
    '--dsw-specific-sidebar-nav-item-active': navActive,
    '--dsw-specific-sidebar-nav-item-active-accent': navActiveAccent,
    '--dsw-alias-interactive-bg-hover-accent': withAlpha(seeds.accent, isDark ? 0.22 : 0.14),
  }
  if (seeds.overrides) {
    for (const [name, value] of Object.entries(seeds.overrides)) {
      if (value) tokens[name] = value
    }
  }
  return tokens
}

/**
 * WCAG contrast ratio of two hex colors (8-digit hex drops alpha).
 * @param left - one color.
 * @param right - the other color.
 * @returns the ratio, 1–21.
 */
export function contrastRatio(left: string, right: string): number {
  return getContrastRatio(left, right)
}

/**
 * Mix `tint` into `base` from `startRatio` until contrast against `against`
 * meets `minContrast`, or the mix is fully `tint`.
 * @param base - starting fill.
 * @param tint - accent mixed in.
 * @param startRatio - initial mix amount, 0–1.
 * @param against - color the result must contrast with.
 * @param minContrast - WCAG contrast floor.
 * @returns the mixed hex color.
 */
function mixUntilContrast(
  base: string,
  tint: string,
  startRatio: number,
  against: string,
  minContrast: number,
): string {
  let amount = clamp(startRatio, 0, 1)
  let color = mixColors(base, tint, amount)
  while (getContrastRatio(color, against) < minContrast && amount < 1) {
    amount = Math.min(1, amount + 0.04)
    color = mixColors(base, tint, amount)
  }
  return color
}

/**
 * Sort candidates by WCAG contrast against `background` and pick the winner.
 * @param background - surface the text sits on.
 * @param candidates - candidate text colors.
 * @returns the most readable candidate.
 */
export function pickReadableText(background: string, candidates: readonly string[]): string {
  return candidates.toSorted(
    (left, right) => getContrastRatio(background, right) - getContrastRatio(background, left),
  )[0] ?? candidates[0] as string
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function parseHexColor(hex: string): Rgb {
  const normalized = hex.replace('#', '')
  const expanded = normalized.length === 8 ? normalized.slice(0, 6) : normalized
  return {
    r: Number.parseInt(expanded.slice(0, 2), 16),
    g: Number.parseInt(expanded.slice(2, 4), 16),
    b: Number.parseInt(expanded.slice(4, 6), 16),
  }
}

function toHexColor({ r, g, b }: Rgb): string {
  const channel = (value: number) => Math.round(clamp(value, 0, 255)).toString(16).padStart(2, '0')
  return `#${channel(r)}${channel(g)}${channel(b)}`
}

function mixColors(left: string, right: string, ratio: number): string {
  const from = parseHexColor(left)
  const to = parseHexColor(right)
  const amount = clamp(ratio, 0, 1)
  return toHexColor({
    r: from.r + (to.r - from.r) * amount,
    g: from.g + (to.g - from.g) * amount,
    b: from.b + (to.b - from.b) * amount,
  })
}

function withAlpha(color: string, alpha: number): string {
  const { r, g, b } = parseHexColor(color)
  return `rgb(${r} ${g} ${b} / ${clamp(alpha, 0, 1).toFixed(3)})`
}

function transformGammaChannel(channel: number): number {
  const normalized = channel / 255
  return normalized <= 0.03928 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4
}

function getRelativeLuminance(color: string): number {
  const { r, g, b } = parseHexColor(color)
  return 0.2126 * transformGammaChannel(r) + 0.7152 * transformGammaChannel(g) + 0.0722 * transformGammaChannel(b)
}

function getContrastRatio(left: string, right: string): number {
  const leftLuminance = getRelativeLuminance(left)
  const rightLuminance = getRelativeLuminance(right)
  const lighter = Math.max(leftLuminance, rightLuminance)
  const darker = Math.min(leftLuminance, rightLuminance)
  return (lighter + 0.05) / (darker + 0.05)
}
