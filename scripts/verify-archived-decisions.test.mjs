import { test } from 'node:test'
import assert from 'node:assert/strict'
import { writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { collect, writeManifest } from './verify-archived-decisions.mjs'
import { makeFixture } from './lib/fixture.mjs'

const SEALED = `# Decision: old\n\nStatus: implemented\n\nArchived: 2026-09-17\n\n## Problem\n\np\n\n## Decision\n\nd\n\n## Alternatives considered\n\n- **x** — rejected: y\n\n## Consequences\n\nc\n`

test('sealed content passes; tampering fails', (t) => {
  const files = {
    'docs/decisions/archived/process/2026-09-17-a.md': SEALED,
    'docs/decisions/archived/process/2026-09-17-a.en.md': SEALED,
    'docs/decisions/archived/process/2026-09-17-a.i18n.yaml': 'a.md: x\na.en.md: y\n',
  }
  const root = makeFixture(t, files)
  writeManifest(root)
  assert.deepEqual(collect(root), [])
  writeFileSync(join(root, 'docs/decisions/archived/process/2026-09-17-a.md'), SEALED + 'tampered\n')
  assert.match(collect(root).join('\n'), /sealed manifest/)
})

test('incomplete triplet inside archived fails', (t) => {
  const root = makeFixture(t, { 'docs/decisions/archived/process/2026-09-17-a.md': SEALED })
  writeManifest(root)
  assert.match(collect(root).join('\n'), /incomplete archived triplet/)
})

test('manifest entry for a missing file fails', (t) => {
  const root = makeFixture(t, { 'docs/decisions/archived/process/2026-09-17-a.md': SEALED })
  writeManifest(root)
  mkdirSync(join(root, 'docs/decisions/archived/process'), { recursive: true })
  writeFileSync(join(root, 'docs/decisions/archived/process/2026-09-17-b.md'), SEALED)
  assert.match(collect(root).join('\n'), /unrecorded|sealed/)
})
