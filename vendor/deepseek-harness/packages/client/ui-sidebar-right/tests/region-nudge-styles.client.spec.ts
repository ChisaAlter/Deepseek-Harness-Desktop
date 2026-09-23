/**
 * App-region nudge pulse, asserted against SidebarRight.module.css on disk:
 * Electron recollects the window's drag rects only when a style pass changes
 * a computed app-region value (electron#32341), so the panel's steady state
 * must declare NO app-region in either presentation — the open/close no-drag
 * pulse is then a real computed-value change at both edges, including a
 * hidden panel opening straight into fullscreen (a narrow window's first
 * open, whose rects were skipped while hidden). A steady-state value on the
 * panel (the old fullscreen whole-box no-drag) makes the pulse a silent
 * no-op and leaves the frame's drag band swallowing the strip's top-right
 * controls; fine-grained subtraction belongs to ui-dockkit (tabs, strip-end
 * chrome, pane bodies, dividers), leaving the strips' blank runs draggable.
 */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const css = readFileSync(new URL('../src/client/shell/SidebarRight.module.css', import.meta.url), 'utf8')

/**
 * Every `<selector> -> value` pair of rules declaring `-webkit-app-region`.
 * @returns one entry per declaring rule, in source order.
 */
function appRegionRules(): [selector: string, value: string][] {
  const rules: [string, string][] = []
  for (const match of css.matchAll(/(?<sel>[^{}]+)\{(?<body>[^{}]*)\}/g)) {
    const value = /-webkit-app-region:\s*([^;]+);/.exec(match.groups!['body']!)?.[1]
    if (value !== undefined) rules.push([match.groups!['sel']!.trim(), value.trim()])
  }
  return rules
}

describe('app-region nudge pulse styles', () => {
  it('pulses the panel to no-drag', () => {
    const pulses = appRegionRules()
      .filter(([selector]) => selector.includes('[data-sidebar-right-region-nudge]'))
    expect(pulses).toHaveLength(1)
    expect(pulses[0]![0]).toMatch(/\.panel\[data-sidebar-right-region-nudge\]\s*$/)
    expect(pulses[0]![1]).toBe('no-drag')
  })

  it('declares no steady-state app-region, so the pulse is a real change', () => {
    const steady = appRegionRules()
      .filter(([selector]) => !selector.includes('[data-sidebar-right-region-nudge]'))
    expect(steady).toEqual([])
  })
})
