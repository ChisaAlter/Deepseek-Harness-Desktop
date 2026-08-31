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
  it('keeps the beam layer pointer-inert and under the card body', () => {
    expect(declarations('.beamLayer')?.get('pointer-events')).toBe('none')
    expect(declarations('.beamLayer')?.get('position')).toBe('absolute')
    expect(declarations('.beamLayer')?.get('overflow')).toBe('hidden')
    expect(declarations('.beamLayer')?.get('z-index')).toBe('0')
    expect(declarations('.cardBody')?.get('position')).toBe('relative')
    expect(declarations('.cardBody')?.get('z-index')).toBe('1')
  })
})
