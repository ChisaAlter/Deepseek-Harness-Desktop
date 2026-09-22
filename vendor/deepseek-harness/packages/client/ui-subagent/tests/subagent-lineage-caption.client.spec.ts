/**
 * Subagent lineage caption: the control renders inside AppFrame's caption
 * band; without a no-drag hole the window drag region swallows the hover and
 * clicks that open the catalog.
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const css = readFileSync(
  fileURLToPath(new URL('../src/client/SubagentHeaderLineage.module.css', import.meta.url)),
  'utf8',
)

describe('SubagentHeaderLineage.module.css caption regions', () => {
  it('keeps the in-band lineage root no-drag', () => {
    expect(css).toMatch(/\.root\s*\{[^}]*-webkit-app-region:\s*no-drag/)
  })
})
