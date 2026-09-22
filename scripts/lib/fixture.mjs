// Spec helper: materialize a {relpath: content} map into a temp dir and
// return its root. Gate collect() functions take the root explicitly.
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'

export function makeFixture(t, files) {
  const root = mkdtempSync(join(tmpdir(), 'dshd-gate-'))
  for (const [rel, content] of Object.entries(files)) {
    const p = join(root, rel)
    mkdirSync(dirname(p), { recursive: true })
    writeFileSync(p, content)
  }
  t.after(() => rmSync(root, { recursive: true, force: true }))
  return root
}

export const DECISION_TREE = JSON.stringify({
  lifecycle: ['proposed', 'implemented', 'rejected', 'archived'],
  class: ['product', 'architecture', 'process', 'bug-fix', 'testing'],
})

const note = (status, sections) =>
  `# Decision: t\n\nStatus: ${status}\n\n中文 | [English](x.en.md)\n\n${sections}`

export const GOOD_NOTE = note('implemented', '## Problem\n\np\n\n## Decision\n\nd\n\n## Alternatives considered\n\n- **x** — rejected: y\n\n## Consequences\n\nc\n')
export const GOOD_NOTE_EN = note('implemented', '## Problem\n\np\n\n## Decision\n\nd\n\n## Alternatives considered\n\n- **x** — rejected: y\n\n## Consequences\n\nc\n').replace('中文 | [English](x.en.md)', '[中文](x.md) | English')
