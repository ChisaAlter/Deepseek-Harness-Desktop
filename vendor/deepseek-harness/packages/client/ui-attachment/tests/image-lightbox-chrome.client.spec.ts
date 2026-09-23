/**
 * Desktop caption accommodation: the frameless window-control plate owns the
 * top --dshd-wco-caption strip (published by the desktop chrome inject), so
 * the lightbox close control drops below it instead of stacking under the
 * window close button. A plain browser has no published var and keeps the
 * 20px inset.
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const css = readFileSync(fileURLToPath(new URL('../src/ImageLightbox.module.css', import.meta.url)), 'utf8')

describe('ImageLightbox.module.css caption clearance', () => {
  it('drops the close control below the desktop caption band', () => {
    const close = /\.close\s*\{([\s\S]*?)\}/.exec(css)
    expect(close?.[1]).toContain('top: calc(20px + var(--dshd-wco-caption, 0px))')
    expect(close?.[1]).toContain('right: 20px')
    expect(close?.[1]).toContain('-webkit-app-region: no-drag')
  })
})
