import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { join } from 'node:path'
import { archive } from './archive-decision.mjs'
import { collect as archivedCollect, writeManifest } from './verify-archived-decisions.mjs'
import { collect as pairingCollect } from './verify-translation-pairing.mjs'
import { collect as formatCollect } from './verify-decision-format.mjs'
import { collect as treeCollect } from './verify-decision-tree.mjs'
import { makeFixture, DECISION_TREE, GOOD_NOTE, GOOD_NOTE_EN } from './lib/fixture.mjs'

const DEC = 'docs/decisions/implemented/process'
const ARC = 'docs/decisions/archived/process'

function fixture(t, extra = {}) {
  return makeFixture(t, {
    'scripts/decision-tree.json': DECISION_TREE,
    [`${DEC}/2026-09-17-old.md`]: GOOD_NOTE.replace('x.en.md', '2026-09-17-old.en.md'),
    [`${DEC}/2026-09-17-old.en.md`]: GOOD_NOTE_EN.replace('x.md', '2026-09-17-old.md'),
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

test('refuses non-archivable paths and validates a whole pair before moving any file', (t) => {
  const root = fixture(t)
  assert.throws(() => archive(root, 'docs/decisions/proposed/process/x.md'), /not an archivable/)
  assert.throws(() => archive(root, 'docs/handbook/x.md'), /not an archivable/)
  const partial = makeFixture(t, {
    'scripts/decision-tree.json': DECISION_TREE,
    [`${DEC}/2026-09-17-solo.md`]: GOOD_NOTE,
    [`${DEC}/2026-09-17-solo.en.md`]: GOOD_NOTE_EN,
  })
  assert.throws(() => archive(partial, `${DEC}/2026-09-17-solo.md`), /missing triplet member/)
  assert.equal(readFileSync(join(partial, DEC, '2026-09-17-solo.md'), 'utf8'), GOOD_NOTE)
  assert.equal(existsSync(join(partial, ARC, '2026-09-17-solo.md')), false)
})

const SOLO = GOOD_NOTE.replace(/中文 \|[^\n]*\n\n/, '').replace(/## Alternatives considered[\s\S]*?## Consequences/, '## Consequences')

test('single-language CLI archival works without translation or a superseded-by option', (t) => {
  const root = makeFixture(t, { 'scripts/decision-tree.json': DECISION_TREE, [`${DEC}/2026-10-02-solo.md`]: SOLO })
  execFileSync(process.execPath, [join(import.meta.dirname, 'archive-decision.mjs'), `${DEC}/2026-10-02-solo.md`, '--root', root])
  assert.equal(existsSync(join(root, DEC, '2026-10-02-solo.md')), false)
  assert.equal(existsSync(join(root, ARC, '2026-10-02-solo.en.md')), false)
  assert.deepEqual(archivedCollect(root), [])
  assert.deepEqual(formatCollect(root), [])
  assert.deepEqual(pairingCollect(root), [])
})

test('invalid successor leaves source and incoming references untouched', (t) => {
  const root = fixture(t)
  const old = readFileSync(join(root, DEC, '2026-09-17-old.md'), 'utf8')
  const link = readFileSync(join(root, 'docs/handbook/x.md'), 'utf8')
  assert.throws(() => archive(root, `${DEC}/2026-09-17-old.md`, { supersededBy: `${DEC}/2026-10-02-missing.md` }), /missing record/)
  assert.equal(readFileSync(join(root, DEC, '2026-09-17-old.md'), 'utf8'), old)
  assert.equal(readFileSync(join(root, 'docs/handbook/x.md'), 'utf8'), link)
})

test('confirmation failure rolls back the moved record and rewritten links', (t) => {
  const root = fixture(t)
  writeFileSync(join(root, DEC, '2026-09-17-old.en.md'), GOOD_NOTE_EN.replace('x.md', '2026-09-17-old.md') + '\n## Mismatched section\n')
  const before = readFileSync(join(root, DEC, '2026-09-17-old.en.md'), 'utf8')
  assert.throws(() => archive(root, `${DEC}/2026-09-17-old.md`), /structural signature drift/)
  assert.equal(readFileSync(join(root, DEC, '2026-09-17-old.en.md'), 'utf8'), before)
  assert.match(readFileSync(join(root, 'docs/handbook/x.md'), 'utf8'), /implemented\/process/)
  assert.equal(existsSync(join(root, ARC, '2026-09-17-old.md')), false)
})

test('archival preserves already sealed references and refuses to bless modified history', (t) => {
  const history = SOLO.replace('Status: implemented', 'Status: implemented\n\nArchived: 2026-10-01') + `\n[historical](../../implemented/process/2026-09-17-old.md)\n`
  const root = fixture(t, { [`${ARC}/2026-09-17-history.md`]: history })
  writeManifest(root)
  archive(root, `${DEC}/2026-09-17-old.md`)
  assert.equal(readFileSync(join(root, ARC, '2026-09-17-history.md'), 'utf8'), history)
  assert.deepEqual(archivedCollect(root), [])
  const bad = fixture(t, { [`${ARC}/2026-09-17-history.md`]: history })
  writeManifest(bad)
  writeFileSync(join(bad, ARC, '2026-09-17-history.md'), history + 'unsealed change\n')
  assert.throws(() => archive(bad, `${DEC}/2026-09-17-old.md`), /archive seal is invalid/)
  assert.equal(existsSync(join(bad, DEC, '2026-09-17-old.md')), true)
})

test('a single-language successor gets a valid pointer without requiring an English copy', (t) => {
  const root = fixture(t, { [`${DEC}/2026-10-02-new.md`]: SOLO })
  archive(root, `${DEC}/2026-09-17-old.md`, { supersededBy: `${DEC}/2026-10-02-new.md` })
  assert.match(readFileSync(join(root, DEC, '2026-10-02-new.md'), 'utf8'), /Supersedes.*\.\.\/\.\.\/archived\/process\/2026-09-17-old.md/)
  assert.deepEqual(pairingCollect(root), [])
})
