'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { RUNTIME_LINKS, materializeRuntimeLinksAsync, removeRuntimeLinksAsync } = require('./runtime-links');

function fixture(t) {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-links-'));
  const root = path.join(temp, 'runtime');
  fs.mkdirSync(path.join(root, 'physical'), { recursive: true });
  t.after(() => {
    assert.ok(temp.startsWith(path.resolve(os.tmpdir()) + path.sep));
    fs.rmSync(temp, { recursive: true, force: true });
  });
  return { temp, root, manifest: links => fs.writeFileSync(path.join(root, RUNTIME_LINKS), JSON.stringify({ version: 1, links })) };
}

test('async links repair stale targets, reuse valid links and remove only links', async (t) => {
  const { root, manifest } = fixture(t);
  const from = path.join(root, 'node_modules', 'proof');
  fs.mkdirSync(path.dirname(from));
  fs.symlinkSync(path.join(root, 'missing'), from, 'junction');
  manifest([{ path: 'node_modules/proof', target: 'physical' }]);
  const progress = [];
  assert.equal(await materializeRuntimeLinksAsync(root, { onProgress: (...args) => progress.push(args) }), 1);
  assert.deepEqual(progress, [[0, 1], [1, 1]]);
  assert.equal(await materializeRuntimeLinksAsync(root), 1);
  assert.equal(fs.realpathSync(from), fs.realpathSync(path.join(root, 'physical')));
  await removeRuntimeLinksAsync(root);
  await removeRuntimeLinksAsync(root);
  assert.equal(fs.existsSync(from), false);
  assert.equal(fs.existsSync(path.join(root, 'physical')), true);
});

test('async links reject traversal and duplicates before mutating the tree', async (t) => {
  const { root, manifest } = fixture(t);
  for (const links of [
    [{ path: '../escape', target: 'physical' }],
    [{ path: 'safe', target: '../outside' }],
    [{ path: 'same', target: 'physical' }, { path: 'same', target: 'physical' }],
  ]) {
    manifest(links);
    await assert.rejects(materializeRuntimeLinksAsync(root), /Invalid runtime link|Conflicting runtime link/);
    await assert.rejects(removeRuntimeLinksAsync(root), /Invalid runtime link|Conflicting runtime link/);
    assert.equal(fs.existsSync(path.join(root, 'same')), false);
  }
});

test('async links refuse real directories and preserve their files', async (t) => {
  const { root, manifest } = fixture(t);
  fs.mkdirSync(path.join(root, 'existing'));
  fs.writeFileSync(path.join(root, 'existing', 'keep'), 'keep');
  manifest([{ path: 'existing', target: 'physical' }]);
  await assert.rejects(materializeRuntimeLinksAsync(root), /would replace a directory/);
  await assert.rejects(removeRuntimeLinksAsync(root), /not a link/);
  assert.equal(fs.readFileSync(path.join(root, 'existing', 'keep'), 'utf8'), 'keep');
});

test('async links reject targets and parent junctions escaping the runtime', async (t) => {
  const { temp, root, manifest } = fixture(t);
  const outside = path.join(temp, 'outside');
  fs.mkdirSync(outside);
  fs.symlinkSync(outside, path.join(root, 'escape'), 'junction');
  manifest([{ path: 'proof', target: 'escape' }]);
  await assert.rejects(materializeRuntimeLinksAsync(root), /Invalid runtime link target/);
  fs.symlinkSync(path.join(root, 'physical'), path.join(outside, 'proof'), 'junction');
  manifest([{ path: 'escape/proof', target: 'physical' }]);
  await assert.rejects(materializeRuntimeLinksAsync(root), /parent escapes root/);
  await assert.rejects(removeRuntimeLinksAsync(root), /parent escapes root/);
  assert.equal(fs.lstatSync(path.join(outside, 'proof')).isSymbolicLink(), true);
});

test('async link cancellation stops between entries and allows repair on the next attempt', async (t) => {
  const { root, manifest } = fixture(t);
  manifest(['a', 'b'].map(name => ({ path: name, target: 'physical' })));
  const controller = new AbortController();
  await assert.rejects(materializeRuntimeLinksAsync(root, {
    signal: controller.signal, onProgress: done => { if (done === 1) controller.abort(); },
  }), { code: 'DSH_CANCELLED' });
  assert.equal(fs.existsSync(path.join(root, 'a')), true);
  assert.equal(fs.existsSync(path.join(root, 'b')), false);
  await materializeRuntimeLinksAsync(root);
  const removing = new AbortController();
  await assert.rejects(removeRuntimeLinksAsync(root, {
    signal: removing.signal, onProgress: done => { if (done === 1) removing.abort(); },
  }), { code: 'DSH_CANCELLED' });
  assert.equal(fs.existsSync(path.join(root, 'a')), true);
  assert.equal(fs.existsSync(path.join(root, 'b')), false);
  await materializeRuntimeLinksAsync(root);
  assert.equal(fs.existsSync(path.join(root, 'b')), true);
});
