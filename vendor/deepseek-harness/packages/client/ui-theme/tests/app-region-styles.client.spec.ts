/**
 * Window drag-region ownership, asserted against the CSS text on disk:
 * `-webkit-app-region: drag` belongs to window chrome: the frame band,
 * sidebar logo row, and the full-window Platform overlay's return bar.
 * Electron composes app-regions from window geometry in DOM order, ignoring
 * stacking: a drag rule on a content container overrides the no-drag of any
 * overlay mounted earlier, so its controls drag the window instead of
 * receiving clicks. Everything interactive opts out through ui-web base.css.
 */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { packageStylesheets, parseRules } from './stylesheet-scan.ts'

/** The only stylesheets allowed to declare a window drag region, relative to packages/. */
const DRAG_OWNERS = [
  'client/ui-layout/src/client/AppFrame.module.css',
  'client/ui-sidebar/src/client/SidebarRoot.module.css',
  'client/ui-settings-account/src/client/PlatformOverlay.module.css',
]

/**
 * Selectors of rules declaring a window drag region. Matches the prefixed and
 * unprefixed property and tolerates `!important`, so a creative spelling
 * cannot slip a drag surface past the allowlist.
 * @param css - stylesheet text.
 * @returns the declaring selectors, in source order.
 */
function dragSelectors(css: string): string[] {
  return parseRules(css)
    .filter(rule => rule.declarations
      .some(([property, value]) => /^(-webkit-)?app-region$/.test(property) && /^drag(\s|!|$)/.test(value)))
    .map(rule => rule.selectors.join(', '))
}

/**
 * Allowlist violations across a stylesheet set.
 * @param files - stylesheet paths to scan.
 * @param read - returns one stylesheet's text.
 * @returns `path selectors` for each drag rule outside DRAG_OWNERS.
 */
function offenders(files: string[], read: (file: string) => string): string[] {
  return files
    .filter(file => !DRAG_OWNERS.some(owner => file.endsWith(`/${owner}`)))
    .flatMap(file => dragSelectors(read(file)).map(selectors => `${file} ${selectors}`))
}

describe('window drag-region ownership', () => {
  it('rejects a drag declaration and passes no-drag', () => {
    expect(dragSelectors('.a { -webkit-app-region: drag; }')).toEqual(['.a'])
    expect(dragSelectors('.a { -webkit-app-region: drag !important; }')).toEqual(['.a'])
    expect(dragSelectors('.a { app-region: drag; }')).toEqual(['.a'])
    expect(dragSelectors('.a { -webkit-app-region: no-drag; }')).toEqual([])
    expect(dragSelectors('.a { app-region: no-drag !important; }')).toEqual([])
  })

  it('reports a drag rule outside the allowlist and exempts the owners', () => {
    const drag = '.evil { -webkit-app-region: drag; }'
    // Fixture path avoids the packages/ prefix: verify-package-paths checks such references against disk.
    expect(offenders(['/elsewhere/client/ui-evil/src/client/Evil.module.css'], () => drag))
      .toEqual(['/elsewhere/client/ui-evil/src/client/Evil.module.css .evil'])
    expect(offenders([`/packages/${DRAG_OWNERS[0]!}`], () => drag)).toEqual([])
  })

  it('keeps -webkit-app-region: drag inside the owned chrome bands', () => {
    expect(offenders(packageStylesheets(), file => readFileSync(file, 'utf8'))).toEqual([])
  })

  it('limits the Platform overlay drag region to its return bar and excludes the return button', () => {
    const file = packageStylesheets().find(candidate => candidate.endsWith('/client/ui-settings-account/src/client/PlatformOverlay.module.css'))!
    const css = readFileSync(file, 'utf8')
    expect(dragSelectors(css)).toEqual(['.header'])
    expect(parseRules(css).find(rule => rule.selectors.includes('.back'))?.declarations)
      .toContainEqual(['app-region', 'no-drag'])
  })

  it('still finds a drag band in every allowlisted owner', () => {
    // An owner that stops declaring drag should leave the allowlist with it.
    for (const owner of DRAG_OWNERS) {
      const file = packageStylesheets().find(candidate => candidate.endsWith(`/${owner}`))
      expect(file, owner).toBeDefined()
      expect(dragSelectors(readFileSync(file!, 'utf8')), owner).not.toEqual([])
    }
  })
})
