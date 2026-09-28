/**
 * Surfaces tab bar caption: AppFrame owns the drag band; interactive
 * children stay no-drag so they punch holes in that band.
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const css = readFileSync(fileURLToPath(new URL('../src/client/SurfaceTabs.module.css', import.meta.url)), 'utf8')

describe('SurfaceTabs.module.css caption regions', () => {
  it('does not mark the tab bar drag and keeps tab, add, and close controls no-drag', () => {
    expect(css).not.toMatch(/\.bar[\s\S]*?-webkit-app-region:\s*drag/)
    expect(css).toMatch(/\.interactive,[\s\S]*?\.tab,[\s\S]*?\.add,[\s\S]*?\.close,[\s\S]*?\.label[\s\S]*?-webkit-app-region:\s*no-drag/)
  })
})
