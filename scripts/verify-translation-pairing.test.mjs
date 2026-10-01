import { test } from 'node:test'
import assert from 'node:assert/strict'
import { collect, pairState, blobHash, signature, writePair, pairs } from './verify-translation-pairing.mjs'
import { makeFixture, DECISION_TREE } from './lib/fixture.mjs'
import { writeFileSync, readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'

const ZH = '# 标题\n\n中文 | [English](x.en.md)\n\n## 问题\n\n段一。\n\n- a\n- b\n\n```js\ncode\n```\n\n[l](l.md)\n'
const EN = '# Title\n\n[中文](x.md) | English\n\n## Problem\n\nPara one.\n\n- a\n- b\n\n```js\ncode\n```\n\n[l](l.md)\n'

import { createHash } from 'node:crypto'
function sc(zh, en) {
  const sigH = createHash('sha256').update(JSON.stringify(signature(zh))).digest('hex')
  return `zh: ${blobHash(zh)}\nen: ${blobHash(en)}\nsignature: ${sigH}\n`
}

const DEC = 'docs/decisions/implemented/process'

test('a clean pair passes', (t) => {
  const root = makeFixture(t, {
    'scripts/decision-tree.json': DECISION_TREE,
    [`${DEC}/2026-09-17-x.md`]: ZH.replaceAll('x.en.md', '2026-09-17-x.en.md'),
    [`${DEC}/2026-09-17-x.en.md`]: EN.replaceAll('x.md', '2026-09-17-x.md'),
    [`${DEC}/2026-09-17-x.i18n.yaml`]: sc(ZH.replaceAll('x.en.md', '2026-09-17-x.en.md'), EN.replaceAll('x.md', '2026-09-17-x.md')),
  })
  assert.deepEqual(collect(root), [])
})

test('CRLF working files verify against LF-recorded hashes (checkout eol is platform-dependent)', (t) => {
  const zhT = ZH.replaceAll('x.en.md', '2026-09-17-x.en.md')
  const enT = EN.replaceAll('x.md', '2026-09-17-x.md')
  const root = makeFixture(t, {
    'scripts/decision-tree.json': DECISION_TREE,
    [`${DEC}/2026-09-17-x.md`]: zhT.replace(/\n/g, '\r\n'),
    [`${DEC}/2026-09-17-x.en.md`]: enT.replace(/\n/g, '\r\n'),
    [`${DEC}/2026-09-17-x.i18n.yaml`]: sc(zhT, enT),
  })
  assert.deepEqual(collect(root), [])
})

test('edited side without re-record is stale → red; pending registration excuses it', (t) => {
  const files = {
    'scripts/decision-tree.json': DECISION_TREE,
    [`${DEC}/2026-09-17-x.md`]: ZH.replaceAll('x.en.md', '2026-09-17-x.en.md'),
    [`${DEC}/2026-09-17-x.en.md`]: EN.replaceAll('x.md', '2026-09-17-x.md'),
    [`${DEC}/2026-09-17-x.i18n.yaml`]: sc(ZH.replaceAll('x.en.md', '2026-09-17-x.en.md'), EN.replaceAll('x.md', '2026-09-17-x.md')),
  }
  const root = makeFixture(t, files)
  writeFileSync(join(root, DEC, '2026-09-17-x.en.md'), EN.replaceAll('x.md', '2026-09-17-x.md') + 'extra line\n')
  assert.match(collect(root).join('\n'), /stale/)
  writeFileSync(join(root, 'scripts/i18n-pending.manifest.json'), JSON.stringify({ pairs: [`${DEC}/2026-09-17-x`] }))
  assert.deepEqual(collect(root), [])
})

test('fresh pair still in pending manifest is red (one-way ratchet)', (t) => {
  const root = makeFixture(t, {
    'scripts/decision-tree.json': DECISION_TREE,
    'scripts/i18n-pending.manifest.json': JSON.stringify({ pairs: [`${DEC}/2026-09-17-x`] }),
    [`${DEC}/2026-09-17-x.md`]: ZH.replaceAll('x.en.md', '2026-09-17-x.en.md'),
    [`${DEC}/2026-09-17-x.en.md`]: EN.replaceAll('x.md', '2026-09-17-x.md'),
    [`${DEC}/2026-09-17-x.i18n.yaml`]: sc(ZH.replaceAll('x.en.md', '2026-09-17-x.en.md'), EN.replaceAll('x.md', '2026-09-17-x.md')),
  })
  assert.match(collect(root).join('\n'), /no longer stale/)
})

test('structural drift (extra list item) is red even with fresh hashes', (t) => {
  const zhT = ZH.replaceAll('x.en.md', '2026-09-17-x.en.md')
  const enT = EN.replaceAll('x.md', '2026-09-17-x.md').replace('- b\n', '- b\n- c\n')
  const root = makeFixture(t, {
    'scripts/decision-tree.json': DECISION_TREE,
    [`${DEC}/2026-09-17-x.md`]: zhT,
    [`${DEC}/2026-09-17-x.en.md`]: enT,
    [`${DEC}/2026-09-17-x.i18n.yaml`]: sc(zhT, enT),
  })
  assert.match(collect(root).join('\n'), /structural signature drift/)
})

test('missing switcher line and zh→en link are red', (t) => {
  const zhT = ZH.replaceAll('x.en.md', '2026-09-17-x.en.md').replace('中文 | [English](2026-09-17-x.en.md)\n\n', '').replace('[l](l.md)', '[l](l.en.md)')
  const enT = EN.replaceAll('x.md', '2026-09-17-x.md')
  const root = makeFixture(t, {
    'scripts/decision-tree.json': DECISION_TREE,
    [`${DEC}/2026-09-17-x.md`]: zhT,
    [`${DEC}/2026-09-17-x.en.md`]: enT,
    [`${DEC}/2026-09-17-x.i18n.yaml`]: sc(zhT, enT),
  })
  const v = collect(root).join('\n')
  assert.match(v, /switcher line/)
  assert.match(v, /zh side must not link/)
})

test('single-language internal records pass, but an opted-in incomplete pair fails', (t) => {
  const root = makeFixture(t, { [`${DEC}/2026-10-02-solo.md`]: '# Decision: single language\n\nStatus: implemented\n' })
  assert.deepEqual(pairs(root), [])
  assert.deepEqual(collect(root), [])
  writeFileSync(join(root, DEC, '2026-10-02-solo.en.md'), '# Translation\n')
  assert.match(collect(root).join('\n'), /incomplete pair/)
})

test('a remaining switcher or orphan counterpart cannot silently opt out', (t) => {
  const root = makeFixture(t, {
    [`${DEC}/2026-10-02-solo.md`]: '中文 | [English](2026-10-02-solo.en.md)\n',
    [`${DEC}/2026-10-02-orphan.en.md`]: '# Orphan\n',
  })
  const errors = collect(root).join('\n')
  assert.match(errors, /solo.*incomplete pair/)
  assert.match(errors, /orphan.*missing.*orphan.md/)
})

test('confirmation refuses structural drift without overwriting the previous record', (t) => {
  const root = makeFixture(t, {
    'docs/x.md': ZH, 'docs/x.en.md': EN,
    'scripts/i18n-pairs.manifest.json': JSON.stringify({ pairs: ['docs/x'] }),
  })
  writePair(root, 'docs', 'x')
  assert.deepEqual(collect(root), [])
  const original = readFileSync(join(root, 'docs/x.i18n.yaml'), 'utf8')
  writeFileSync(join(root, 'docs/x.en.md'), EN + '\n## Additional section\n')
  assert.throws(() => writePair(root, 'docs', 'x'), /structural signature drift/)
  assert.equal(readFileSync(join(root, 'docs/x.i18n.yaml'), 'utf8'), original)
  const solo = makeFixture(t, { 'docs/x.md': ZH })
  assert.throws(() => writePair(solo, 'docs', 'x'), /Cannot confirm/)
  assert.equal(existsSync(join(solo, 'docs/x.i18n.yaml')), false)
})
