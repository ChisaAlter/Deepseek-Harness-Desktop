/**
 * Motion stylesheet contract: recipes transition only opacity and transform,
 * and reduced-motion zeros every duration token the recipes read.
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const STYLES = new URL('../src/styles/', import.meta.url)
const read = (name: string): string => readFileSync(fileURLToPath(new URL(name, STYLES)), 'utf8')

const baseCss = read('base.css')
const motionCss = read('motion.css')

describe('motion recipes', () => {
  it('declares overlay, popover, fade, swap, and flip recipes', () => {
    expect(motionCss).toContain("[data-dsh-motion='overlay']")
    expect(motionCss).toContain("[data-dsh-motion='popover']")
    expect(motionCss).toContain("[data-dsh-motion='fade']")
    expect(motionCss).toContain("[data-dsh-motion='swap']")
    expect(motionCss).toContain("[data-dsh-motion='flip']")
    expect(motionCss).toContain('data-dsh-motion-part')
  })

  it('transitions only opacity and transform', () => {
    const transitions = [...motionCss.matchAll(/transition(?:-property)?:\s*([^;]+);/g)]
      .map(([, value = '']) => value)
    expect(transitions.length).toBeGreaterThan(0)
    for (const value of transitions) {
      const properties = value
        .split(',')
        .map(part => part.trim().split(/\s+/)[0])
        .filter(name => name !== undefined && name !== 'opacity' && name !== 'transform')
      expect(properties, value).toEqual([])
    }
  })

  it('zeros duration tokens under prefers-reduced-motion', () => {
    expect(baseCss).toContain('@media (prefers-reduced-motion: reduce)')
    expect(baseCss).toMatch(/--ds-motion-duration-overlay:\s*0s/)
    expect(baseCss).toMatch(/--ds-motion-duration-popover:\s*0s/)
    expect(baseCss).toMatch(/--ds-motion-duration-swap:\s*0s/)
    expect(baseCss).toMatch(/--ds-motion-duration-flip:\s*0s/)
    expect(motionCss).toContain('@media (prefers-reduced-motion: reduce)')
  })
})
