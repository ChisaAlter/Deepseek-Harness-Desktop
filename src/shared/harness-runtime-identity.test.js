'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { RUNTIME_ARCHIVE_IDENTITY, hashRuntimeArchive, readRuntimeArchiveIdentity, writeRuntimeArchiveIdentity } = require('./harness-runtime-identity');

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-runtime-identity-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const archive = path.join(root, 'deepseek-harness.tar');
  fs.writeFileSync(archive, 'archive-v1');
  return { root, archive };
}

test('packaging records the actual archive digest, including equal-length content changes', async (t) => {
  const { archive } = fixture(t);
  const first = await writeRuntimeArchiveIdentity(archive);
  assert.equal(first.archiveSha256, createHash('sha256').update('archive-v1').digest('hex'));
  assert.deepEqual(await readRuntimeArchiveIdentity(archive), first);
  fs.writeFileSync(archive, 'archive-v2');
  const second = await writeRuntimeArchiveIdentity(archive);
  assert.equal(first.archiveBytes, second.archiveBytes);
  assert.notEqual(first.archiveSha256, second.archiveSha256);
});

test('an absent legacy manifest is supported and malformed identities are rejected', async (t) => {
  const { root, archive } = fixture(t);
  assert.equal(await readRuntimeArchiveIdentity(archive), null);
  for (const manifest of [{}, { version: 2, archiveBytes: 10, archiveSha256: 'a'.repeat(64) },
    { version: 1, archiveBytes: -1, archiveSha256: 'a'.repeat(64) },
    { version: 1, archiveBytes: 10, archiveSha256: 'not-a-sha256' }]) {
    fs.writeFileSync(path.join(root, RUNTIME_ARCHIVE_IDENTITY), JSON.stringify(manifest));
    await assert.rejects(readRuntimeArchiveIdentity(archive), /归档摘要无效/);
  }
});

test('archive hashing remains cancellable during asynchronous reads', async (t) => {
  const { archive } = fixture(t);
  const abort = new AbortController();
  t.mock.method(fs, 'createReadStream', function* stream() {
    yield Buffer.from('first chunk');
    abort.abort();
    yield Buffer.from('second chunk');
  });
  await assert.rejects(hashRuntimeArchive(archive, { signal: abort.signal }), { code: 'DSH_CANCELLED' });
});
