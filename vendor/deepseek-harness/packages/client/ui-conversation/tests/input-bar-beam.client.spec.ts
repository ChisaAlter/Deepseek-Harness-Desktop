/**
 * Composer send/think beam hit-testing contract: the unfiltered wrapper is
 * pointer-inert and the card body stacks above it.
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const css = readFileSync(fileURLToPath(new URL('../src/client/skeleton/InputBar.module.css', import.meta.url)), 'utf8')

function declarations(selector: string): Map<string, string> | undefined {
  const withoutComments = css.replace(/\/\*[\s\S]*?\*\//g, ' ')
  const found = new Map<string, string>()
  for (const [, selectorList = '', body = ''] of withoutComments.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (!selectorList.split(',').map(value => value.trim()).includes(selector)) continue
    for (const part of body.split(';')) {
      const colon = part.indexOf(':')
      if (colon === -1) continue
      found.set(part.slice(0, colon).trim(), part.slice(colon + 1).trim().replace(/\s+/g, ' '))
    }
  }
  return found.size === 0 ? undefined : found
}

describe('InputBar.module.css thinking beam hit testing', () => {
  it('keeps the resting rim and every beam layer on matching circular corners', () => {
    for (const selector of ['.card', '.beamLayer', '.beamInner', '.beamStroke', '.beamBloom::before']) {
      expect(declarations(selector)?.get('corner-shape'), selector).toBe('round')
    }
  })

  it('keeps a bounded corner halo in the pointer-inert layer under the card body', () => {
    const layer = declarations('.beamLayer')
    expect(layer?.get('pointer-events')).toBe('none')
    expect(layer?.get('position')).toBe('absolute')
    expect(layer?.get('inset')).toBe('-4px')
    expect(layer?.get('overflow')).toBe('hidden')
    expect(layer?.get('border-radius')).toBe('26px')
    expect(layer?.get('z-index')).toBe('0')
    expect(declarations('.beamInner')?.get('inset')).toBe('4px')
    expect(declarations('.beamStroke')?.get('inset')).toBe('4px')
    expect(declarations('.beamInner')?.get('border-radius')).toBe('22px')
    expect(declarations('.beamStroke')?.get('border-radius')).toBe('22px')
    expect(declarations('.cardBody')?.get('position')).toBe('relative')
    expect(declarations('.cardBody')?.get('z-index')).toBe('1')
  })

  it('masks the bloom source before the outer container blurs it', () => {
    const bloom = declarations('.beamBloom')
    const source = declarations('.beamBloom::before')
    expect(bloom?.get('inset')).toBe('0')
    expect(bloom?.get('filter')).toBe('blur(8px) brightness(1.3) saturate(1.2)')
    expect(bloom?.has('clip-path')).toBe(false)
    expect(bloom?.has('mask')).toBe(false)
    expect(source?.get('content')).toBe("''")
    expect(source?.get('inset')).toBe('4px')
    expect(source?.get('padding')).toBe('1.5px')
    expect(source?.get('border-radius')).toBe('22px')
    expect(source?.get('mask-composite')).toBe('exclude')
    expect(declarations('.cardBeam .beamBloom')?.get('opacity')).toBe('0.36')
  })

  it('uses the reference rotating intensity window without clipping the corner arcs twice', () => {
    const stroke = declarations('.beamStroke')
    expect(stroke?.get('padding')).toBe('2px')
    for (const property of ['-webkit-mask', 'mask']) {
      const mask = stroke?.get(property)
      expect(mask).toBeDefined()
      expect(mask).toContain('conic-gradient')
      expect(mask).toContain('transparent 30%')
      expect(mask).toContain('#fff 52%')
      expect(mask).toContain('transparent 96%')
      expect(mask?.match(/linear-gradient/g)).toHaveLength(2)
    }
    expect(stroke?.has('clip-path')).toBe(false)
    expect(stroke?.get('-webkit-mask-composite')).toBe('source-in, xor')
    expect(stroke?.get('mask-composite')).toBe('intersect, exclude')
    expect(declarations('.cardBeam .beamStroke')?.get('opacity')).toBe('0.6')

    const inner = declarations('.beamInner')
    for (const property of ['-webkit-mask', 'mask']) {
      expect(inner?.get(property)?.match(/conic-gradient/g)).toHaveLength(2)
    }
    expect(inner?.get('-webkit-mask-composite')).toBe('source-over')
    expect(inner?.get('mask-composite')).toBe('add')
  })

  it('uses only the documented inset resting rim plus the hairline', () => {
    const shadow = declarations('.card')?.get('box-shadow')
    expect(shadow).toContain('inset 0 0 12px 1px rgba(255, 255, 255, 0.25)')
    expect(shadow).toContain('var(--dsw-elevation-stroke)')
    expect(shadow).not.toContain('0 0 30px')
    expect(shadow).not.toContain('--dsw-elevation-soft')
  })
})
