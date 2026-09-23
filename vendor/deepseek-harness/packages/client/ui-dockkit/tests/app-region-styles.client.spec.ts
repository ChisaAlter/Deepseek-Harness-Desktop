/**
 * macOS drag-band subtraction, asserted against dockkit.module.css on disk:
 * an embedder may pin the surface under the window's top drag band, and
 * Electron composes app-regions from geometry in DOM order — every box that
 * must stay usable subtracts itself. The divider must be listed explicitly:
 * it is a plain div, so ui-web base.css's interactive-element subtraction
 * never matches it, and an unsubtracted vertical divider's top run would
 * drag the window instead of resizing the split.
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const css = readFileSync(resolve(import.meta.dirname, '../src/components/dockkit.module.css'), 'utf8')

describe('macOS app-region subtraction', () => {
  it('subtracts the chip run, strip-end chrome, pane body, and divider; never declares drag', () => {
    const rules = [...css.matchAll(/(?<sel>[^{}]+)\{(?<body>[^{}]*)\}/g)]
      .map(match => [match.groups!['sel']!.trim(), match.groups!['body']!] as const)
      .filter(([, body]) => body.includes('-webkit-app-region'))
    expect(rules).toHaveLength(1)
    const [selector, body] = rules[0]!
    expect(/-webkit-app-region:\s*([^;]+);/.exec(body)?.[1]?.trim()).toBe('no-drag')
    for (const part of ['.stripTabs', '.stripChrome', '.paneBody', '.divider']) {
      expect(selector, part).toContain(`:global(html[data-platform='darwin']) ${part}`)
    }
  })
})
