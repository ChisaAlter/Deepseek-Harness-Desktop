import { test } from 'node:test'
import assert from 'node:assert/strict'
import { collect, pairState, blobHash, signature } from './verify-translation-pairing.mjs'
import { makeFixture, DECISION_TREE } from './lib/fixture.mjs'
import { writeFileSync } from 'node:fs'
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
