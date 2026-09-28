'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { overlayWorkspaceRuntimePackages, repairFlattenedVersionIsolation } = require('../../scripts/after-pack');

function writePackage(dir, name, code, dependencies = {}, workspace = false) {
  const main = workspace ? 'lib/index.js' : 'index.js';
  fs.mkdirSync(path.dirname(path.join(dir, main)), { recursive: true });
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name, version: '1.0.0', main, dependencies }));
  fs.writeFileSync(path.join(dir, main), code);
}

function linkDependency(owner, name, target) {
  fs.mkdirSync(path.join(owner, 'node_modules'), { recursive: true });
  fs.symlinkSync(target, path.join(owner, 'node_modules', name), 'junction');
}

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dshd-identity-gate-'));
  t.after(() => {
    assert.ok(path.resolve(root).startsWith(path.resolve(os.tmpdir()) + path.sep));
    fs.rmSync(root, { recursive: true, force: true });
  });
  return { source: path.join(root, 'source'), dest: path.join(root, 'dest') };
}

test('byte-identical transitive source instances cannot merge their mutable state', async (t) => {
  const { source, dest } = fixture(t);
  const sourceEntries = [];
  const targetEntries = [];
  for (const name of ['a', 'b']) {
    const owner = path.join(source, 'packages', 'boot', name);
    const target = path.join(dest, 'node_modules', name);
    const middleName = `q${name}`;
    const middle = path.join(source, 'instances', middleName);
    const state = path.join(source, 'instances', `r-${name}`);
    writePackage(owner, name, `module.exports = require('${middleName}');`, { [middleName]: '*' }, true);
    writePackage(target, name, '', {}, true);
    writePackage(middle, middleName, "module.exports = require('r');", { r: '*' });
    writePackage(state, 'r', 'module.exports = { count: 0 };');
    linkDependency(owner, middleName, middle);
    linkDependency(middle, 'r', state);
    writePackage(path.join(dest, 'node_modules', middleName), middleName, "module.exports = require('r');", { r: '*' });
    sourceEntries.push(path.join(owner, 'lib', 'index.js'));
    targetEntries.push(path.join(target, 'lib', 'index.js'));
  }
  writePackage(path.join(dest, 'node_modules', 'r'), 'r', 'module.exports = { count: 0 };');
  const [sourceA, sourceB] = sourceEntries.map((entry) => require(entry));
  assert.notStrictEqual(sourceA, sourceB);
  sourceA.count = 99;
  assert.equal(sourceB.count, 0);
  const workspace = await overlayWorkspaceRuntimePackages(source, dest);
  const [targetA, targetB] = targetEntries.map((entry) => require(entry));
  assert.strictEqual(targetA, targetB, 'fixture must actually merge two source instances');
  await assert.rejects(
    repairFlattenedVersionIsolation(source, dest, workspace.sources),
    /工作区依赖实例被合并: r/,
  );
});

test('removing a redundant copy counts as progress and preserves shared state', async (t) => {
  const { source, dest } = fixture(t);
  const shared = path.join(source, 'instances', 'r');
  writePackage(shared, 'r', 'module.exports = { count: 0 };');
  writePackage(path.join(dest, 'node_modules', 'r'), 'r', 'module.exports = { count: 0 };');
  const sourceEntries = [];
  const targetEntries = [];
  for (const name of ['a', 'b']) {
    const owner = path.join(source, 'packages', 'boot', name);
    const target = path.join(dest, 'node_modules', name);
    writePackage(owner, name, "module.exports = require('r');", { r: '*' }, true);
    writePackage(target, name, '', {}, true);
    linkDependency(owner, 'r', shared);
    sourceEntries.push(path.join(owner, 'lib', 'index.js'));
    targetEntries.push(path.join(target, 'lib', 'index.js'));
  }
  assert.strictEqual(require(sourceEntries[0]), require(sourceEntries[1]));
  const workspace = await overlayWorkspaceRuntimePackages(source, dest);
  const redundant = path.join(dest, 'node_modules', 'a', 'node_modules', 'r');
  writePackage(redundant, 'r', 'module.exports = { count: 0 };');
  assert.equal(await repairFlattenedVersionIsolation(source, dest, workspace.sources), 0);
  assert.equal(fs.existsSync(redundant), false);
  const [a, b] = targetEntries.map((entry) => require(entry));
  assert.strictEqual(a, b);
  a.count = 99;
  assert.equal(b.count, 99);
  assert.equal(await repairFlattenedVersionIsolation(source, dest, workspace.sources), 0);
});

test('identity checks treat a directory alias as the same physical destination', async (t) => {
  const { source, dest } = fixture(t);
  const shared = path.join(source, 'instances', 'r');
  writePackage(shared, 'r', 'module.exports = { count: 0 };');
  writePackage(path.join(dest, 'node_modules', 'r'), 'r', 'module.exports = { count: 0 };');
  for (const name of ['a', 'b']) {
    const owner = path.join(source, 'packages', 'boot', name);
    writePackage(owner, name, "module.exports = require('r');", { r: '*' }, true);
    writePackage(path.join(dest, 'node_modules', name), name, '', {}, true);
    linkDependency(owner, 'r', shared);
  }
  const alias = path.join(path.dirname(dest), 'alias');
  fs.symlinkSync(dest, alias, 'junction');
  const workspace = await overlayWorkspaceRuntimePackages(source, alias);
  const redundant = path.join(dest, 'node_modules', 'a', 'node_modules', 'r');
  writePackage(redundant, 'r', 'module.exports = { count: 0 };');
  await repairFlattenedVersionIsolation(source, alias, workspace.sources);
  assert.equal(fs.existsSync(redundant), false);
  const [a, b] = ['a', 'b'].map(name => require(path.join(dest, 'node_modules', name, 'lib/index.js')));
  assert.strictEqual(a, b);
});
