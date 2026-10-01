import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { makeFixture } from './lib/fixture.mjs'
import { resolveConflicts } from './resolve-pairing-conflicts.mjs'
const conflict = '<<<<<<< ours\nx\n=======\ny\n>>>>>>> theirs\n'
const zh = '# X\n\n中文 | [English](x.en.md)\n\n## A\n\np\n'
const en = '# X\n\n[中文](x.md) | English\n\n## A\n\np\n'
test('only registered pairs are resolved; unrelated dependency sidecars are untouched', t => {
  const root = makeFixture(t, {
    'scripts/i18n-pairs.manifest.json': JSON.stringify({ pairs: ['docs/x'] }),
    'docs/x.md': zh, 'docs/x.en.md': en, 'docs/x.i18n.yaml': conflict,
    'node_modules/private/x.i18n.yaml': conflict,
  })
  assert.deepEqual(resolveConflicts(root), { resolved: 1, blocked: [] })
  assert.doesNotMatch(readFileSync(join(root, 'docs/x.i18n.yaml'), 'utf8'), /<<<<<<</)
  assert.equal(readFileSync(join(root, 'node_modules/private/x.i18n.yaml'), 'utf8'), conflict)
})
test('structural disagreement remains unresolved and archived sidecars are never rewritten', t => {
  const archived = 'docs/decisions/archived/process/x'
  const root = makeFixture(t, {
    'scripts/i18n-pairs.manifest.json': JSON.stringify({ pairs: ['docs/x'] }),
    'docs/x.md': zh, 'docs/x.en.md': en + '\n## Extra\n', 'docs/x.i18n.yaml': conflict,
    [`${archived}.md`]: zh, [`${archived}.en.md`]: en, [`${archived}.i18n.yaml`]: conflict,
  })
  const result = resolveConflicts(root)
  assert.equal(result.resolved, 0)
  assert.equal(result.blocked.length, 2)
  assert.equal(readFileSync(join(root, 'docs/x.i18n.yaml'), 'utf8'), conflict)
  assert.equal(readFileSync(join(root, `${archived}.i18n.yaml`), 'utf8'), conflict)
})
