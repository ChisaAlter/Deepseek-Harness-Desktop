import { test } from 'node:test'
import assert from 'node:assert/strict'
import { collect, wordsOf } from './verify-doc-budgets.mjs'
import { makeFixture } from './lib/fixture.mjs'

test('wordsOf counts CJK chars and latin words, ignores fences', (t) => {
  void t
  assert.equal(wordsOf('你好 world'), 3)
  assert.equal(wordsOf('```\nignored entirely\n```\nok'), 1)
})

test('over-ceiling and missing files fail', (t) => {
  const root = makeFixture(t, {
    'scripts/doc-budgets.manifest.json': JSON.stringify({ 'a.md': 3, 'gone.md': 10 }),
    'a.md': 'one two three four five\n',
  })
  const v = collect(root).join('\n')
  assert.match(v, /a\.md.*over ceiling 3/)
  assert.match(v, /gone\.md.*missing/)
})
