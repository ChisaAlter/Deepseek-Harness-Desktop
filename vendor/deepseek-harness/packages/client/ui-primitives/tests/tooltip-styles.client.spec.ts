/**
 * Tooltip's placement and recipe ownership as CSS text. jsdom resolves CSS
 * Modules to class-name maps, so the stylesheet itself is the only place to
 * pin the per-side transforms and prove the old private entrance keyframe is
 * gone.
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const css = readFileSync(fileURLToPath(new URL('../src/Tooltip.module.css', import.meta.url)), 'utf8')

describe('Tooltip.module.css', () => {
  it('keeps the placement transforms intact', () => {
    expect(css).toMatch(/\.bubble\[data-side='right'\]\s*\{\s*transform: translateY\(-50%\);/u)
    expect(css).toMatch(/\.bubble\[data-side='bottom'\]\s*\{\s*transform: translateX\(-50%\);/u)
    expect(css).toMatch(/\.bubble\[data-side='top'\]\s*\{\s*transform: translate\(-50%, -100%\);/u)
    expect(css).toMatch(/\.bubble\[data-side='bottom'\]\[data-align='end'\]\s*\{\s*transform: translateX\(-100%\);/u)
    expect(css).toMatch(/\.bubble\[data-side='top'\]\[data-align='end'\]\s*\{\s*transform: translate\(-100%, -100%\);/u)
  })

  it('defines no private entrance animation beside the shared fade recipe', () => {
    expect(css).not.toContain('@keyframes tooltip-in')
    expect(css).not.toMatch(/\.bubble\s*\{[^}]*animation:/su)
  })
})
