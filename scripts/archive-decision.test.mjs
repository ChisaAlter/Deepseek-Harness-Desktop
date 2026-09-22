import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { archive } from './archive-decision.mjs'
import { collect as archivedCollect } from './verify-archived-decisions.mjs'
import { collect as formatCollect } from './verify-decision-format.mjs'
import { collect as treeCollect } from './verify-decision-tree.mjs'
import { makeFixture, DECISION_TREE, GOOD_NOTE, GOOD_NOTE_EN } from './lib/fixture.mjs'

const DEC = 'docs/decisions/implemented/process'
const ARC = 'docs/decisions/archived/process'

function fixture(t, extra = {}) {
  return makeFixture(t, {
    'scripts/decision-tree.json': DECISION_TREE,
    [`${DEC}/2026-09-17-old.md`]: GOOD_NOTE,
    [`${DEC}/2026-09-17-old.en.md`]: GOOD_NOTE_EN,
    [`${DEC}/2026-09-17-old.i18n.yaml`]: 'x\n',
    'docs/handbook/x.md': `see [old](../decisions/implemented/process/2026-09-17-old.md) here\n`,
    ...extra,
  })
}

test('archive moves the triplet, stamps Archived, rewires inbound links, seals', (t) => {
  const root = fixture(t)
  const { moved, rewired } = archive(root, `${DEC}/2026-09-17-old.md`)
  assert.equal(moved.length, 3)
  assert.equal(rewired, 1)
  assert.ok(existsSync(join(root, ARC, '2026-09-17-old.md')))
  const text = readFileSync(join(root, ARC, '2026-09-17-old.md'), 'utf8')
  assert.match(text, /Status: implemented\n\nArchived: \d{4}-\d{2}-\d{2}/)
  assert.match(readFileSync(join(root, 'docs/handbook/x.md'), 'utf8'), /archived\/process\/2026-09-17-old\.md/)
  // The sealed tree now passes both the seal gate and the format gate.
  assert.deepEqual(archivedCollect(root), [])
  assert.deepEqual(formatCollect(root), [])
  assert.deepEqual(treeCollect(root), [])
})

test('refuses non-archivable paths and missing triplet members', (t) => {
  const root = fixture(t)
  assert.throws(() => archive(root, 'docs/decisions/proposed/process/x.md'), /not an archivable/)
  assert.throws(() => archive(root, 'docs/handbook/x.md'), /not an archivable/)
  const partial = makeFixture(t, {
    'scripts/decision-tree.json': DECISION_TREE,
    [`${DEC}/2026-09-17-solo.md`]: GOOD_NOTE,
  })
  assert.throws(() => archive(partial, `${DEC}/2026-09-17-solo.md`), /missing triplet member/)
})
