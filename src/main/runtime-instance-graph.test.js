'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { assembleCanonicalRuntime } = require('../../scripts/after-pack');
const { RUNTIME_LINKS, materializeRuntimeLinks, removeRuntimeLinks } = require('../shared/runtime-links');

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dshd-instance-graph-'));
  t.after(() => {
    assert.ok(root.startsWith(path.resolve(os.tmpdir()) + path.sep));
    fs.rmSync(root, { recursive: true, force: true });
  });
  const source = path.join(root, 'source');
  const dest = path.join(root, 'dest');
  fs.mkdirSync(source); fs.mkdirSync(dest);
  return { root, source, dest };
}

function writePackage(dir, name, dependencies, code) {
  fs.mkdirSync(path.join(dir, 'lib'), { recursive: true });
  const manifest = { name, version: '1.0.0', main: 'lib/index.js', dependencies };
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify(manifest));
  fs.writeFileSync(path.join(dir, 'lib/index.js'), code);
  return manifest;
}

function link(owner, name, target) {
  const file = path.join(owner, 'node_modules', name);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.symlinkSync(target, file, 'junction');
}

test('canonical graph preserves shared and isolated transitive state through tar relocation', async (t) => {
  const { root, source, dest } = fixture(t);
  const shared = path.join(source, 'instances', 'shared-r');
  const separate = path.join(source, 'instances', 'separate-r');
  for (const dir of [shared, separate]) writePackage(dir, 'r', {}, 'module.exports = { count: 0 };');
  const seeds = [];
  for (const [name, state] of [['a', shared], ['b', shared], ['c', separate]]) {
    const owner = path.join(source, 'packages', 'boot', name);
    const middle = path.join(source, 'instances', `q-${name}`);
    writePackage(middle, 'q', { r: '*' }, "module.exports = require('r');");
    link(middle, 'r', state);
    const manifest = writePackage(owner, name, { q: '*' }, "module.exports = require('q');");
    link(owner, 'q', middle);
    seeds.push({ name, source: owner, target: path.join(dest, 'node_modules', name), manifest });
  }
  await assembleCanonicalRuntime(source, dest, seeds);
  function verify(directory) {
    const [a, b, c] = ['a', 'b', 'c'].map(name => require(require.resolve(name, { paths: [directory] })));
    assert.strictEqual(a, b);
    assert.notStrictEqual(a, c);
    a.count = 91;
    assert.equal(b.count, 91);
    assert.equal(c.count, 0);
  }
  verify(dest);
  assert.equal(fs.readFileSync(path.join(dest, RUNTIME_LINKS), 'utf8').includes(root), false);
  removeRuntimeLinks(dest);
  const archive = path.join(root, 'runtime.tar');
  execFileSync('tar', ['-cf', archive, '-C', dest, '.']);
  const relocated = path.join(root, 'relocated');
  fs.mkdirSync(relocated);
  execFileSync('tar', ['-xf', archive, '-C', relocated]);
  assert.ok(materializeRuntimeLinks(relocated) > 0);
  materializeRuntimeLinks(relocated);
  verify(relocated);
});

test('canonical graph retains a cycle and resolves workspace entries from their original layout', async (t) => {
  const { source, dest } = fixture(t);
  const a = path.join(source, 'apps', 'cli');
  const b = path.join(source, 'instances', 'b');
  const manifest = writePackage(a, 'a', { b: '*' }, "exports.name='a'; exports.b=require('b');");
  writePackage(b, 'b', { a: '*' }, "exports.name='b'; exports.a=require('a');");
  link(a, 'b', b); link(b, 'a', a);
  await assembleCanonicalRuntime(source, dest, [{ name: 'a', source: a, manifest }]);
  const loaded = require(path.join(dest, 'apps', 'cli', 'lib', 'index.js'));
  assert.strictEqual(loaded.b.a, loaded);
  assert.strictEqual(require(require.resolve('a', { paths: [dest] })), loaded);
});

test('runtime link manifest rejects traversal and refuses to replace real user files', (t) => {
  const { dest } = fixture(t);
  const manifest = path.join(dest, RUNTIME_LINKS);
  fs.writeFileSync(manifest, JSON.stringify({ version: 1, links: [{ path: '../escape', target: 'target' }] }));
  assert.throws(() => materializeRuntimeLinks(dest), /Invalid runtime link/);
  fs.mkdirSync(path.join(dest, 'target'));
  fs.mkdirSync(path.join(dest, 'existing'));
  fs.writeFileSync(path.join(dest, 'existing', 'keep'), 'keep');
  fs.writeFileSync(manifest, JSON.stringify({ version: 1, links: [{ path: 'existing', target: 'target' }] }));
  assert.throws(() => materializeRuntimeLinks(dest), /would replace a directory/);
  assert.equal(fs.readFileSync(path.join(dest, 'existing', 'keep'), 'utf8'), 'keep');
});
