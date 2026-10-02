import test from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { writeFileSync, readFileSync, existsSync, mkdirSync, chmodSync } from 'node:fs'
import { join } from 'node:path'
import { integrate } from './install-git-integrations.mjs'
import { makeFixture } from './lib/fixture.mjs'
import { selectGates, validateLocalQa, hasAutomaticWorkflow } from './run-final-gates.mjs'

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

test('local selection never defaults to a full matrix or silently omits checks', () => {
  for (const argv of [[], ['--skip', 'test-gui'], ['--only', 'test-gui,test-gui'], ['--only', 'unknown']]) {
    assert.throws(() => selectGates(argv))
  }
  assert.deepEqual(selectGates(['--only', 'test-gui,packaged-smoke']).map(g => g.name), ['test-gui', 'packaged-smoke'])
})

test('actual local runner refuses implicit checks and stops on the first real child failure', t => {
  const runner = readFileSync(new URL('./run-final-gates.mjs', import.meta.url), 'utf8')
  const fakeCommand = process.platform === 'win32'
    ? { 'node_modules/.bin/npm.cmd': '@echo off\r\necho called >> calls.txt\r\nexit /b 7\r\n' }
    : { 'node_modules/.bin/npm': '#!/bin/sh\nprintf "called\\n" >> calls.txt\nexit 7\n' }
  const root = makeFixture(t, { 'scripts/run-final-gates.mjs': runner, ...fakeCommand })
  if (process.platform !== 'win32') chmodSync(join(root, 'node_modules/.bin/npm'), 0o755)
  const invoke = args => spawnSync(process.execPath, [join(root, 'scripts/run-final-gates.mjs'), ...args], { cwd: root, encoding: 'utf8' })
  for (const argv of [[], ['--only', 'unknown'], ['--only', 'test-gui,test-gui'], ['--skip', 'pack']]) {
    assert.notEqual(invoke(argv).status, 0)
    assert.equal(existsSync(join(root, '.final-gates')), false)
  }
  const result = invoke(['--only', 'desktop-tests,pack'])
  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /desktop-tests failed \(exit=7\)/)
  assert.equal(readFileSync(join(root, 'calls.txt'), 'utf8').trim().split(/\r?\n/).length, 1)
  assert.equal(existsSync(join(root, '.final-gates/pack.log')), false)
})

function qaState(sha) {
  return {
    ciNonpassCount: 0, ciCountEvidence: 'isolated fixture has no CI runs',
    localQa: { sourceSha: sha, implementationComplete: true, status: 'pass', scope: 'fixture hook behavior',
      environment: 'isolated temporary Git repository', actualResult: 'local bare repository push observed',
      checks: [{ name: 'fixture operation', status: 'pass', evidence: 'test assertions against local Git refs' }] },
  }
}

test('QA record rejects incomplete, stale, skipped and unknown evidence', () => {
  const sha = 'a'.repeat(40)
  assert.equal(validateLocalQa(qaState(sha), sha).sourceSha, sha)
  for (const change of [
    s => s.localQa.sourceSha = 'b'.repeat(40), s => s.localQa.implementationComplete = false,
    s => s.localQa.status = 'blocked', s => s.localQa.checks = [],
    s => s.localQa.checks[0].status = 'skip', s => s.localQa.checks[0].evidence = '',
    s => s.localQa.actualResult = ' ', s => s.localQa.environment = '',
    s => s.ciNonpassCount = null, s => s.ciCountEvidence = '',
    s => s.localQa.checks.push({ ...s.localQa.checks[0] }),
    s => s.ciNonpassCount = 4,
    s => { s.ciNonpassCount = 5; s.ciRecoveryDecision = '4: fixture user decision and corrected local QA' },
  ]) {
    const state = qaState(sha); change(state)
    assert.throws(() => validateLocalQa(state, sha), /Push blocked/)
  }
})

test('CI recovery retains the count and requires a decision for that exact count', () => {
  const sha = 'a'.repeat(40), state = qaState(sha)
  state.ciNonpassCount = 4
  state.ciRecoveryDecision = '4: fixture user decision reference; corrected local QA evidence'
  assert.equal(validateLocalQa(state, sha).sourceSha, sha)
  assert.equal(state.ciNonpassCount, 4)
  state.ciRecoveryDecision = '4: '
  assert.throws(() => validateLocalQa(state, sha), /CI stopped/)
})

test('automatic and unfamiliar workflow policy cannot be mistaken for manual-only', () => {
  for (const source of ['on:\n  push:\n    branches: [main]\n', 'on:\n  workflow_dispatch:\n  pull_request:\n', 'on: [push, workflow_dispatch]\n', 'name: missing policy\n']) {
    assert.equal(hasAutomaticWorkflow(source), true, source)
  }
  for (const source of ['on:\n  workflow_dispatch:\n    inputs:\n      name:\n        type: string\n\njobs:\n  checks:\n', 'on: workflow_dispatch\n', 'on:\r\n  workflow_dispatch:\r\n']) {
    assert.equal(hasAutomaticWorkflow(source), false, source)
  }
})

test('actual commit starts no QA; actual local push rejects missing/blocked/stale QA and allows complete same-HEAD QA', t => {
  const source = new URL('./', import.meta.url)
  const files = { '.gitignore': '.tmp/\n.final-gates/\n', 'scripts/merge-driver-i18n.mjs': '// fixture\n' }
  files['.github/workflows/test.yml'] = 'on:\n  push:\n    branches: [main]\n'
  for (const rel of ['scripts/git-hooks/pre-commit', 'scripts/git-hooks/pre-push', 'scripts/run-final-gates.mjs']) {
    files[rel] = readFileSync(new URL(rel.replace(/^scripts\//, ''), source), 'utf8')
  }
  const root = makeFixture(t, files)
  git(root, 'init', '--quiet', '--initial-branch=main')
  integrate(root)
  git(root, 'add', '.')
  git(root, '-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '--quiet', '-m', 'fixture implementation')
  assert.equal(existsSync(join(root, '.final-gates')), false, 'commit must not start checks')
  const sha = git(root, 'rev-parse', 'HEAD')
  const remote = makeFixture(t, {})
  git(remote, 'init', '--bare', '--quiet')
  const push = () => spawnSync('git', ['-C', root, 'push', remote, 'main'], { encoding: 'utf8', windowsHide: true })
  const save = state => {
    mkdirSync(join(root, '.tmp/release'), { recursive: true })
    writeFileSync(join(root, '.tmp/release/current-state.json'), JSON.stringify(state))
  }
  assert.notEqual(push().status, 0, 'missing local QA blocks a real push')
  for (const change of [s => s.localQa.status = 'blocked', s => s.localQa.sourceSha = 'a'.repeat(40)]) {
    const state = qaState(sha); change(state); save(state)
    assert.notEqual(push().status, 0)
  }
  assert.equal(spawnSync('git', ['-C', remote, 'rev-parse', '--verify', 'refs/heads/main'], { encoding: 'utf8' }).status, 128)
  save(qaState(sha))
  writeFileSync(join(root, 'scripts/merge-driver-i18n.mjs'), '// unvalidated tracked edit\n')
  const dirtyPush = push()
  assert.notEqual(dirtyPush.status, 0)
  assert.match(dirtyPush.stderr, /uncommitted changes/)
  git(root, 'restore', 'scripts/merge-driver-i18n.mjs')
  writeFileSync(join(root, 'unvalidated-source.js'), '// untracked source\n')
  assert.notEqual(push().status, 0, 'untracked source cannot inherit an earlier clean-version validation')
  git(root, 'add', 'unvalidated-source.js')
  git(root, '-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '--quiet', '-m', 'fixture source')
  const validatedSha = git(root, 'rev-parse', 'HEAD')
  save(qaState(validatedSha))
  const accepted = push()
  assert.equal(accepted.status, 0, accepted.stderr)
  assert.equal(git(remote, 'rev-parse', 'refs/heads/main'), validatedSha)

  // The old destination still has automatic CI: migration cannot skip QA.
  writeFileSync(join(root, '.github/workflows/test.yml'), 'on:\n  workflow_dispatch:\n')
  git(root, 'add', '.')
  git(root, '-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '--quiet', '-m', 'manual workflow migration')
  assert.notEqual(push().status, 0, 'old automatic target policy still requires QA during migration')
  save(qaState(git(root, 'rev-parse', 'HEAD')))
  assert.equal(push().status, 0)

  // Once both policies are manual, docs push with stale QA is an ordinary push.
  writeFileSync(join(root, 'README.md'), 'fixture documentation\n')
  git(root, 'add', '.')
  git(root, '-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '--quiet', '-m', 'fixture docs')
  const ordinary = push()
  assert.equal(ordinary.status, 0, ordinary.stderr)
  assert.equal(git(remote, 'rev-parse', 'refs/heads/main'), git(root, 'rev-parse', 'HEAD'))
  assert.equal(existsSync(join(root, '.final-gates')), false, 'push must only inspect state, without launching suites')
})

test('real maintenance runner combines overlapping modes once and stops at a failed leaf', t => {
  const leaves = ['verify-decision-tree', 'verify-decision-format', 'verify-archived-decisions', 'verify-feature-cards', 'verify-rules-sync', 'verify-md-links', 'verify-translation-pairing']
  const files = { 'scripts/run-gates.mjs': readFileSync(new URL('./run-gates.mjs', import.meta.url), 'utf8') }
  for (const name of leaves) files[`scripts/${name}.mjs`] = `import { appendFileSync } from 'node:fs'; appendFileSync('calls.txt', '${name}\\n');`
  const root = makeFixture(t, files)
  const invoke = args => spawnSync(process.execPath, [join(root, 'scripts/run-gates.mjs'), ...args], { cwd: root, encoding: 'utf8' })
  assert.notEqual(invoke(['governance', 'unknown']).status, 0)
  assert.equal(existsSync(join(root, 'calls.txt')), false)
  const result = invoke(['governance', 'doc-sync'])
  assert.equal(result.status, 0, result.stderr)
  assert.deepEqual(readFileSync(join(root, 'calls.txt'), 'utf8').trim().split(/\r?\n/), leaves)
  writeFileSync(join(root, 'calls.txt'), '')
  writeFileSync(join(root, 'scripts/verify-decision-format.mjs'), "process.exit(9)\n")
  assert.notEqual(invoke(['governance', 'doc-sync']).status, 0)
  assert.equal(readFileSync(join(root, 'calls.txt'), 'utf8').trim(), leaves[0])
})
