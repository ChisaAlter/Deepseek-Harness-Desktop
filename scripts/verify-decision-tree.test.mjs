import { test } from 'node:test'
import assert from 'node:assert/strict'
import { collect } from './verify-decision-tree.mjs'
import { makeFixture, DECISION_TREE, GOOD_NOTE, GOOD_NOTE_EN } from './lib/fixture.mjs'

const BASE = { 'scripts/decision-tree.json': DECISION_TREE }

test('accepts a clean tree', (t) => {
  const root = makeFixture(t, {
    ...BASE,
    'docs/decisions/README.md': '# x\n',
    'docs/decisions/implemented/process/2026-09-17-a.md': GOOD_NOTE,
    'docs/decisions/implemented/process/2026-09-17-a.en.md': GOOD_NOTE_EN,
    'docs/decisions/implemented/process/2026-09-17-a.i18n.yaml': 'x\n',
  })
  assert.deepEqual(collect(root), [])
})

test('rejects unknown lifecycle and class dirs', (t) => {
  const root = makeFixture(t, {
    ...BASE,
    'docs/decisions/done/process/2026-09-17-a.md': GOOD_NOTE,
    'docs/decisions/implemented/vibes/2026-09-17-a.md': GOOD_NOTE,
  })
  const v = collect(root)
  assert.equal(v.length, 2)
  assert.match(v.join('\n'), /not a lifecycle/)
  assert.match(v.join('\n'), /not a class/)
})

test('rejects bad filenames and orphan sidecars', (t) => {
  const root = makeFixture(t, {
    ...BASE,
    'docs/decisions/implemented/process/no-date.md': GOOD_NOTE,
    'docs/decisions/implemented/process/2026-09-17-b.en.md': GOOD_NOTE_EN,
  })
  const v = collect(root)
  assert.equal(v.length, 2)
  assert.match(v.join('\n'), /yyyy-mm-dd-slug/)
  assert.match(v.join('\n'), /without a Chinese source/)
})
