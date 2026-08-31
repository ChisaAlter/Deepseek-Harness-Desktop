/**
 * Wallpaper composer-seat fade: opaque only for glass wallpaper, not
 * transparent theme (which must keep the seat at 0% fill).
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
  it('keeps the opaque fade off the transparent-theme root', () => {
    expect(declarations(':global(html[data-dsh-wallpaper]) .root[data-phase=\'active\'] .composerSeat')).toBeUndefined()
    expect(declarations(':global(html[data-dsh-wallpaper] body[data-ds-dark-theme]) .root[data-phase=\'active\'] .composerSeat')).toBeUndefined()
    const light = declarations(':global(html[data-dsh-wallpaper]:not([data-dsh-transparent])) .root[data-phase=\'active\'] .composerSeat')
    const dark = declarations(':global(html[data-dsh-wallpaper]:not([data-dsh-transparent]) body[data-ds-dark-theme]) .root[data-phase=\'active\'] .composerSeat')
    expect(light?.get('background')).toContain('--dsw-static-neutral-bluish-00')
    expect(dark?.get('background')).toContain('--dsw-static-neutral-bluish-950')
  })
})
