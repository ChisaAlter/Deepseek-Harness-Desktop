import { test } from 'node:test'
import assert from 'node:assert/strict'
import { collect } from './verify-decision-format.mjs'
import { makeFixture, GOOD_NOTE, GOOD_NOTE_EN } from './lib/fixture.mjs'

const N = 'docs/decisions/implemented/process/2026-09-17-a.md'

test('accepts a well-formed implemented note', (t) => {
  const root = makeFixture(t, { [N]: GOOD_NOTE, [N.replace('.md', '.en.md')]: GOOD_NOTE_EN })
  assert.deepEqual(collect(root), [])
})

test('rejects proposal-era sections in implemented notes', (t) => {
  const bad = GOOD_NOTE.replace('## Decision', '## Proposal')
  const root = makeFixture(t, { [N]: bad })
  assert.match(collect(root).join('\n'), /Proposal.*not allowed/)
})

test('rejects missing Alternatives considered', (t) => {
  const bad = GOOD_NOTE.replace(/## Alternatives considered[\s\S]*?## Consequences/, '## Consequences')
  const root = makeFixture(t, { [N]: bad })
  assert.match(collect(root).join('\n'), /Alternatives considered/)
})

test('rejects a Status that disagrees with the folder', (t) => {
  const bad = GOOD_NOTE.replace('Status: implemented', 'Status: proposed')
  const root = makeFixture(t, { [N]: bad })
  assert.match(collect(root).join('\n'), /does not match lifecycle/)
})

test('archived notes need the Archived line', (t) => {
  const p = 'docs/decisions/archived/process/2026-09-17-a.md'
  const root = makeFixture(t, { [p]: GOOD_NOTE })
  assert.match(collect(root).join('\n'), /Archived:/)
  const ok = GOOD_NOTE.replace('Status: implemented', 'Status: implemented\n\nArchived: 2026-09-17')
  const root2 = makeFixture(t, { [p]: ok })
  assert.deepEqual(collect(root2), [])
})
