import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { encodeSegmentSafe, poolKey, requestSessionHint, resolveMirror } from './binding.js'

function makeRoot(t) {
  const root = mkdtempSync(path.join(os.tmpdir(), 'dsh-remote-binding-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  return root
}

function addMirror(root, hostDir, entry, meta) {
  const mirrorDir = path.join(root, hostDir, entry)
  mkdirSync(mirrorDir, { recursive: true })
  if (meta !== null) {
    writeFileSync(path.join(mirrorDir, '.dsh-remote-meta.json'), JSON.stringify(meta))
  }
  return mirrorDir
}

test('resolveMirror uses the nested mirror metadata, not the active machine', (t) => {
  const root = makeRoot(t)
  const a = addMirror(root, 'one-2222', 'alpha', {
    host: 'synthetic-one.example',
    port: 2222,
    username: 'alice',
    remotePath: '/srv/a',
  })
  const b = addMirror(root, 'two-22', 'beta', {
    host: 'synthetic-two.example',
    port: 22,
    username: 'bob',
    remotePath: '/srv/b',
  })
  const nested = path.join(a, 'src', 'deep')
  mkdirSync(nested, { recursive: true })

  const one = resolveMirror(nested, root)
  assert.equal(one.mirrorDir, a)
  assert.deepEqual(one.machine, { host: 'synthetic-one.example', port: 2222, username: 'alice' })
  assert.equal(one.remotePath, '/srv/a')

  const two = resolveMirror(path.join(b, 'file.txt'), root)
  assert.equal(two.mirrorDir, b)
  assert.equal(two.machine.host, 'synthetic-two.example')
  assert.notEqual(poolKey(one.machine), poolKey(two.machine))
})

test('a revoked mirror binding (missing meta) refuses instead of falling back', (t) => {
  const root = makeRoot(t)
  const live = addMirror(root, 'one-22', 'live', {
    host: 'synthetic.example',
    port: 22,
    username: 'alice',
    remotePath: '/srv/live',
  })
  const revoked = addMirror(root, 'one-22', 'revoked', null)

  assert.equal(resolveMirror(path.join(live, 'x'), root).machine.host, 'synthetic.example')
  assert.deepEqual(resolveMirror(path.join(revoked, 'x'), root), {
    mirrorDir: null,
    remotePath: '',
    machine: null,
  })
})

test('malformed or hostless mirror metadata is skipped rather than guessed', (t) => {
  const root = makeRoot(t)
  const broken = addMirror(root, 'one-22', 'broken', null)
  writeFileSync(path.join(broken, '.dsh-remote-meta.json'), '{not json')
  const hostless = addMirror(root, 'one-22', 'hostless', { port: 22, username: 'alice', remotePath: '/srv/x' })
  assert.equal(resolveMirror(path.join(broken, 'x'), root).machine, null)
  assert.equal(resolveMirror(path.join(hostless, 'x'), root).machine, null)
})

test('mirror containment is separator-aware for sibling names sharing a prefix', (t) => {
  const root = makeRoot(t)
  const mirror = addMirror(root, 'one-22', 'repo', {
    host: 'synthetic.example',
    port: 22,
    username: 'alice',
    remotePath: '/srv/repo',
  })
  const sibling = `${mirror}-fork`
  mkdirSync(sibling, { recursive: true })
  assert.equal(resolveMirror(path.join(sibling, 'x'), root).machine, null)
})

test('a missing registry root or empty local path has no binding', (t) => {
  const root = makeRoot(t)
  assert.deepEqual(resolveMirror(path.join(root, 'x'), path.join(root, 'does-not-exist')), {
    mirrorDir: null,
    remotePath: '',
    machine: null,
  })
  assert.deepEqual(resolveMirror('', root), { mirrorDir: null, remotePath: '', machine: null })
})

test('poolKey normalizes the default port and keeps identities separate', () => {
  assert.equal(poolKey({ username: 'alice', host: 'synthetic.example' }), 'alice@synthetic.example:22')
  assert.equal(poolKey({ username: 'alice', host: 'synthetic.example', port: '22' }), 'alice@synthetic.example:22')
  assert.notEqual(
    poolKey({ username: 'alice', host: 'synthetic.example', port: 22 }),
    poolKey({ username: 'bob', host: 'synthetic.example', port: 22 }),
  )
})

test('session hints prefer query values, then body values', () => {
  const req = { url: '/dsh-remote/mirror?sessionId=abc&local=%2Ftmp%2Fmirror' }
  assert.deepEqual(requestSessionHint(req, { sessionId: 'body', local: '/body' }), {
    sessionId: 'abc',
    local: '/tmp/mirror',
  })
  assert.deepEqual(requestSessionHint({ url: '/dsh-remote/mirror' }, { sessionId: 'body', local: '/body' }), {
    sessionId: 'body',
    local: '/body',
  })
})

test('encodeSegmentSafe never returns an empty path segment', () => {
  assert.equal(encodeSegmentSafe(''), 'session')
  assert.equal(encodeSegmentSafe('a/b c'), 'a_b_c')
})
