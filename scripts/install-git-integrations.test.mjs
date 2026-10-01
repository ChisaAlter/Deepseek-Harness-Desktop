import test from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { integrate } from './install-git-integrations.mjs'
import { makeFixture } from './lib/fixture.mjs'

const git = (root, ...args) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', windowsHide: true }).trim()
function fixture(t) {
  const root = makeFixture(t, {
    'scripts/git-hooks/pre-commit': '#!/bin/sh\nexit 0\n',
    'scripts/git-hooks/pre-push': '#!/bin/sh\nexit 0\n',
    'scripts/merge-driver-i18n.mjs': '// fixture\n',
  })
  git(root, 'init', '--quiet')
  return root
}
test('check detects missing integration, installation activates it in the target repository', t => {
  const root = fixture(t)
  assert.throws(() => integrate(root, { check: true }), /not active/)
  integrate(root)
  assert.match(integrate(root, { check: true }), /verified/)
  assert.equal(git(root, 'config', '--local', '--get', 'core.hooksPath'), 'scripts/git-hooks')
  assert.match(integrate(root), /installed/)
})
test('installation does not overwrite a custom hooks path or driver', t => {
  for (const key of ['core.hooksPath', 'merge.dshd-translation-pairing.driver']) {
    const root = fixture(t)
    git(root, 'config', '--local', key, 'user-owned')
    assert.throws(() => integrate(root), /Preserving existing Git configuration/)
    assert.equal(git(root, 'config', '--local', '--get', key), 'user-owned')
  }
})
test('default active hooks are preserved; source archives skip installation but cannot certify hooks', t => {
  const root = fixture(t)
  writeFileSync(join(root, '.git/hooks/pre-commit'), '#!/bin/sh\necho custom\n')
  assert.throws(() => integrate(root), /Preserving existing .git\/hooks/)
  const archive = makeFixture(t, {})
  assert.match(integrate(archive), /skipped/)
  assert.throws(() => integrate(archive, { check: true }), /not active/)
})
