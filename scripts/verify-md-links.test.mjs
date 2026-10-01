import { test } from 'node:test'
import assert from 'node:assert/strict'
import { collect } from './verify-md-links.mjs'
import { makeFixture } from './lib/fixture.mjs'

test('resolving links and anchors pass', (t) => {
  const root = makeFixture(t, {
    'docs/a.md': '# A\n\n[b](b.md#sec-2) and [self](#a)\n\n## sec 1\n',
    'docs/b.md': '# B\n\n## sec 2\n',
  })
  assert.deepEqual(collect(root), [])
})

test('dead links and dead anchors fail', (t) => {
  const root = makeFixture(t, {
    'docs/a.md': '# A\n\n[dead](gone.md) [anchor](b.md#nope) [self](#missing)\n',
    'docs/b.md': '# B\n',
  })
  const v = collect(root).join('\n')
  assert.match(v, /dead link gone\.md/)
  assert.match(v, /dead anchor b\.md#nope/)
  assert.match(v, /dead same-file anchor #missing/)
})

test('links inside fenced code and comments are not checked', (t) => {
  const root = makeFixture(t, {
    'docs/a.md': '# A\n\n```markdown\n[x](y.md)\n```\n\n<!-- [z](w.md) -->\n',
  })
  assert.deepEqual(collect(root), [])
})

test('maintenance skill links are checked while frozen historical references remain untouched', (t) => {
  const root = makeFixture(t, {
    '.devin/skills/dshd-maintenance/SKILL.md': '[overview](../../../docs/maintenance/README.md)',
    'docs/maintenance/README.md': '# Maintenance\n',
    'docs/decisions/archived/process/old.md': '[historical](removed.md)',
  })
  assert.deepEqual(collect(root), [])
  const bad = makeFixture(t, { '.devin/skills/dshd-checks/SKILL.md': '[bad](../../docs/maintenance/README.md)' })
  assert.match(collect(bad).join('\n'), /dead link/)
})
