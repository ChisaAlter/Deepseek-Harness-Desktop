import { test } from 'node:test'
import assert from 'node:assert/strict'
import { collect } from './verify-rules-sync.mjs'
import { makeFixture } from './lib/fixture.mjs'

test('a product rule anchored to an existing card passes', (t) => {
  const root = makeFixture(t, {
    '.cursor/rules/x-product.mdc': '# x\n\nFull card: [docs/features/x.md](../../docs/features/x.md)\n',
    'docs/features/x.md': '# Feature: x\n',
  })
  assert.deepEqual(collect(root), [])
})

test('a product rule with no card link or a dead link fails', (t) => {
  const root = makeFixture(t, {
    '.cursor/rules/a-product.mdc': '# a\n\nno link here\n',
    '.cursor/rules/b-product.mdc': 'Full card: [docs/features/gone.md](../../docs/features/gone.md)\n',
  })
  const v = collect(root).join('\n')
  assert.match(v, /a-product.*must anchor a card/)
  assert.match(v, /b-product.*missing card/)
})
