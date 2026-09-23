import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import {
  blobAlgorithm,
  createHostKeyGuard,
  isHostKeyKnown,
  keyFingerprint,
  makeKeyBlob,
} from './hostkey.js'

function tempFile(name = 'known_hosts.json') {
  const root = mkdtempSync(path.join(os.tmpdir(), 'dsh-remote-hostkey-'))
  return { root, file: path.join(root, name) }
}

test('accept-new trusts the first key, records it, and accepts the same key again', (t) => {
  const { root, file } = tempFile()
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const guard = createHostKeyGuard({ host: 'synthetic.example', port: 2222, hostKeyMode: 'accept-new' }, file)
  const blob = makeKeyBlob('ssh-ed25519', 7)

  assert.equal(blobAlgorithm(blob), 'ssh-ed25519')
  assert.equal(keyFingerprint(blob), keyFingerprint(Buffer.from(blob)))
  assert.equal(guard.verifier(blob), true)
  assert.equal(isHostKeyKnown(file, 'synthetic.example', 2222), true)
  assert.equal(guard.verifier(Buffer.from(blob)), true)

  const stored = JSON.parse(readFileSync(file, 'utf8'))
  assert.equal(stored['synthetic.example:2222'].algo, 'ssh-ed25519')
  assert.equal(stored['synthetic.example:2222'].fingerprint, keyFingerprint(blob))
})

test('accept-new rejects a changed fingerprint and leaves the trusted entry untouched', (t) => {
  const { root, file } = tempFile()
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const guard = createHostKeyGuard({ host: 'synthetic.example', port: 22, hostKeyMode: 'accept-new' }, file)
  const trusted = makeKeyBlob('ssh-ed25519', 11)
  const changed = makeKeyBlob('ssh-ed25519', 12)
  assert.equal(guard.verifier(trusted), true)
  const before = readFileSync(file, 'utf8')

  assert.equal(guard.verifier(changed), false)
  assert.match(guard.lastError, /CHANGED/)
  assert.equal(readFileSync(file, 'utf8'), before)
})

test('verify mode refuses an unknown host key and writes nothing', (t) => {
  const { root, file } = tempFile()
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const guard = createHostKeyGuard({ host: 'synthetic.example', port: 22, hostKeyMode: 'verify' }, file)
  assert.equal(guard.verifier(makeKeyBlob('ssh-ed25519', 1)), false)
  assert.match(guard.lastError, /unknown host key/)
  assert.equal(isHostKeyKnown(file, 'synthetic.example', 22), false)
})

test('a malformed known_hosts file is treated as empty rather than trusted data', (t) => {
  const { root, file } = tempFile()
  t.after(() => rmSync(root, { recursive: true, force: true }))
  writeFileSync(file, '{"synthetic.example:22":')
  const guard = createHostKeyGuard({ host: 'synthetic.example', port: 22, hostKeyMode: 'accept-new' }, file)
  assert.equal(guard.verifier(makeKeyBlob('ssh-ed25519', 3)), true)
  assert.equal(isHostKeyKnown(file, 'synthetic.example', 22), true)
})

test('forgetHost removes only the configured host and port', (t) => {
  const { root, file } = tempFile()
  t.after(() => rmSync(root, { recursive: true, force: true }))
  writeFileSync(file, JSON.stringify({
    'synthetic.example:22': { algo: 'ssh-ed25519', fingerprint: 'keep' },
    'synthetic.example:2222': { algo: 'ssh-ed25519', fingerprint: 'drop' },
  }))
  const guard = createHostKeyGuard({ host: 'synthetic.example', port: 2222, hostKeyMode: 'accept-new' }, file)
  guard.forgetHost()
  const stored = JSON.parse(readFileSync(file, 'utf8'))
  assert.equal(stored['synthetic.example:22'].fingerprint, 'keep')
  assert.equal(stored['synthetic.example:2222'], undefined)
})
