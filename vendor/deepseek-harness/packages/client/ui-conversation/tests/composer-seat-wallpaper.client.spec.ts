/**
 * Wallpaper composer seat: explicit transparent fill overrides the
 * non-wallpaper transcript mask so no banded fill ever reads as a cast
 * shadow behind the input box. Transparent theme stays 0% (separate
 * glass-opacity path).
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const css = readFileSync(fileURLToPath(new URL('../src/client/skeleton/ConversationRoot.module.css', import.meta.url)), 'utf8')

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

describe('ConversationRoot.module.css wallpaper composer seat', () => {
  it('is transparent in wallpaper mode, no solidity dial', () => {
    const light = declarations(':global(html[data-dsh-wallpaper]:not([data-dsh-transparent])) .root[data-phase=\'active\'] .composerSeat')
    const dark = declarations(':global(html[data-dsh-wallpaper]:not([data-dsh-transparent]) body[data-ds-dark-theme]) .root[data-phase=\'active\'] .composerSeat')
    expect(light?.get('background')).toBe('transparent')
    expect(dark?.get('background')).toBe('transparent')
    expect(css).not.toContain('--dsh-composer-seat-wallpaper-solidity')
  })

  it('keeps the non-wallpaper transcript mask', () => {
    const base = declarations('.root[data-phase=\'active\'] .composerSeat')
    expect(base?.get('background')).toContain('--dsw-alias-bg-base')
  })
})