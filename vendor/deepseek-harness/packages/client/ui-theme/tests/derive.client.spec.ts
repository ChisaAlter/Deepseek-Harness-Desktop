import { describe, expect, it } from 'vitest'
import { deriveThemeTokens, contrastRatio, NAV_ITEM_ACTIVE_ACCENT_MIN_CONTRAST, NAV_ITEM_ACTIVE_MIN_CONTRAST, pickReadableText } from '../src/derive.ts'

const LIGHT = {
  accent: '#4176e6',
  background: '#ffffff',
  foreground: '#0f1115',
  contrast: 46,
}

const DARK = {
  accent: '#6ea8ff',
  background: '#151517',
  foreground: '#f5f5f5',
  contrast: 41,
}

describe('deriveThemeTokens', () => {
  it('maps seeds onto the alias-layer names used by ThemePresenter', () => {
    const tokens = deriveThemeTokens(LIGHT)
    expect(tokens['--dsw-alias-bg-base']).toBe('#ffffff')
    expect(tokens['--dsw-alias-label-primary']).toBe('#0f1115')
    expect(tokens['--dsw-alias-brand-primary']).toBe('#4176e6')
    expect(tokens['--dsw-alias-state-business-primary']).toBe('#4176e6')
    expect(tokens['--dsw-alias-button-info-fill']).toBe('#4176e6')
    expect(tokens['--dsw-specific-bubble']).toMatch(/^#/)
    expect(tokens['--dsw-specific-bubble']).not.toBe('#ffffff')
    expect(tokens['--dsw-specific-sidebar-fill']).not.toBe('#ffffff')
    expect(tokens['--dsw-alias-bg-layer-1']).toMatch(/^#/)
    expect(tokens['--dsw-alias-bg-layer-2']).toMatch(/^#/)
    expect(tokens['--dsw-alias-bg-overlay']).toMatch(/^#/)
    expect(tokens['--dsw-alias-label-secondary']).toMatch(/^#/)
    expect(tokens['--dsw-alias-border-l1']).toMatch(/^rgb\(/)
    expect(tokens['--dsw-alias-border-l2']).toMatch(/^rgb\(/)
    expect(tokens['--dsw-alias-state-error-primary']).toBe('#c53b2c')
    expect(tokens['--dsw-specific-sidebar-fill']).toMatch(/^#/)
  })

  it('uses the dark status palette on a dark canvas', () => {
    const tokens = deriveThemeTokens(DARK)
    expect(tokens['--dsw-alias-state-error-primary']).toBe('#ff7b72')
    expect(tokens['--dsw-alias-state-success-primary']).toBe('#3fb950')
    expect(tokens['--dsw-alias-state-warn-primary']).toBe('#d29922')
  })

  it('accepts 8-digit hex by dropping the alpha channel', () => {
    const tokens = deriveThemeTokens({
      accent: '#4176e6ff',
      background: '#ffffffff',
      foreground: '#0f1115aa',
      contrast: 46,
    })
    expect(tokens['--dsw-alias-bg-layer-1']).toMatch(/^#[0-9a-f]{6}$/)
  })

  it('lets seed overrides win after derivation', () => {
    const tokens = deriveThemeTokens({
      ...LIGHT,
      overrides: {
        '--dsw-alias-brand-primary': '#ff00aa',
        '--dsw-alias-bg-base': '',
      },
    })
    expect(tokens['--dsw-alias-brand-primary']).toBe('#ff00aa')
    expect(tokens['--dsw-alias-bg-base']).toBe('#ffffff')
  })

  it('raises contrast by mixing more foreground into surfaces', () => {
    const soft = deriveThemeTokens({ ...LIGHT, contrast: 0 })
    const hard = deriveThemeTokens({ ...LIGHT, contrast: 100 })
    expect(soft['--dsw-alias-bg-layer-1']).not.toBe(hard['--dsw-alias-bg-layer-1'])
  })

  it('keeps paper nav-item active fills above the layer-2 contrast floor', () => {
    const tokens = deriveThemeTokens({
      accent: '#0f766e',
      background: '#f3efe6',
      foreground: '#1c1915',
      contrast: 50,
    })
    const layer2 = tokens['--dsw-alias-bg-layer-2']!
    const active = tokens['--dsw-specific-sidebar-nav-item-active']!
    const accent = tokens['--dsw-specific-sidebar-nav-item-active-accent']!
    expect(contrastRatio(active, layer2)).toBeGreaterThanOrEqual(NAV_ITEM_ACTIVE_MIN_CONTRAST)
    expect(contrastRatio(accent, layer2)).toBeGreaterThanOrEqual(NAV_ITEM_ACTIVE_ACCENT_MIN_CONTRAST)
    expect(contrastRatio(accent, layer2)).toBeGreaterThan(contrastRatio(active, layer2))
  })
})

describe('pickReadableText', () => {
  it('prefers the candidate with the higher contrast against the background', () => {
    expect(pickReadableText('#ffffff', ['#eeeeee', '#111111'])).toBe('#111111')
    expect(pickReadableText('#111111', ['#0a0a0a', '#f5f5f5'])).toBe('#f5f5f5')
  })

  it('returns the first candidate when the list is empty-safe', () => {
    expect(pickReadableText('#ffffff', ['#222222'])).toBe('#222222')
    expect(pickReadableText('#ffffff', [])).toBeUndefined()
  })
})
