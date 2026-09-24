'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { assertNoDevOnlyPackages, overlayWorkspaceRuntimePackages, repairFlattenedVersionIsolation } = require('../../scripts/after-pack.js');

test('workspace runtime wins over an older flattened package', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dshd-overlay-'));
  try {
    const source = path.join(root, 'source', 'packages', 'boot', 'app-boot');
    const target = path.join(root, 'dest', 'node_modules', '@deepseek-ai', 'dsh-app-boot');
    fs.mkdirSync(path.join(source, 'lib'), { recursive: true });
    fs.mkdirSync(path.join(target, 'lib'), { recursive: true });
    fs.writeFileSync(path.join(source, 'package.json'), JSON.stringify({ name: '@deepseek-ai/dsh-app-boot', version: '0.1.7' }));
    fs.writeFileSync(path.join(source, 'lib', 'index.js'), 'export const createRuntimeResolution = true;\n');
    fs.mkdirSync(path.join(source, 'assets'));
    fs.writeFileSync(path.join(source, 'assets', 'current.json'), '{}');
    fs.writeFileSync(path.join(target, 'package.json'), JSON.stringify({ name: '@deepseek-ai/dsh-app-boot', version: '0.1.6' }));
    fs.writeFileSync(path.join(target, 'lib', 'index.js'), 'export const old = true;\n');
    fs.writeFileSync(path.join(target, 'lib', 'removed.js'), 'stale');
    fs.writeFileSync(path.join(target, 'stale.json'), '{}');
    const consumer = path.join(root, 'source', 'node_modules', '.pnpm', 'consumer@1', 'node_modules');
    const oldDependency = path.join(consumer, '@deepseek-ai', 'dsh-app-boot');
    fs.mkdirSync(oldDependency, { recursive: true });
    fs.mkdirSync(path.join(consumer, 'consumer'), { recursive: true });
    fs.writeFileSync(path.join(consumer, 'consumer', 'package.json'), JSON.stringify({ name: 'consumer', version: '1.0.0' }));
    fs.writeFileSync(path.join(oldDependency, 'package.json'), JSON.stringify({ name: '@deepseek-ai/dsh-app-boot', version: '0.1.6' }));
    fs.writeFileSync(path.join(oldDependency, 'old.js'), 'old dependency');
    const consumerTarget = path.join(root, 'dest', 'node_modules', 'consumer');
    fs.mkdirSync(consumerTarget, { recursive: true });
    fs.writeFileSync(path.join(consumerTarget, 'package.json'), JSON.stringify({ name: 'consumer', version: '1.0.0' }));
    const result = await overlayWorkspaceRuntimePackages(path.join(root, 'source'), path.join(root, 'dest'));
    await repairFlattenedVersionIsolation(path.join(root, 'source'), path.join(root, 'dest'));
    assert.equal(result.packages, 1);
    assert.equal(JSON.parse(fs.readFileSync(path.join(target, 'package.json'))).version, '0.1.7');
    assert.match(fs.readFileSync(path.join(target, 'lib', 'index.js'), 'utf8'), /createRuntimeResolution/);
    assert.equal(fs.existsSync(path.join(target, 'lib', 'removed.js')), false);
    assert.equal(fs.existsSync(path.join(target, 'stale.json')), false);
    assert.equal(fs.existsSync(path.join(target, 'assets', 'current.json')), true);
    assert.equal(JSON.parse(fs.readFileSync(path.join(consumerTarget, 'node_modules', '@deepseek-ai', 'dsh-app-boot', 'package.json'))).version, '0.1.6');
  } finally {
    assert.ok(path.resolve(root).startsWith(path.resolve(os.tmpdir()) + path.sep));
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('workspace runtime replacement fails when the local build is missing', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dshd-overlay-missing-'));
  try {
    const source = path.join(root, 'source', 'packages', 'boot', 'app-boot');
    const target = path.join(root, 'dest', 'node_modules', '@deepseek-ai', 'dsh-app-boot');
    fs.mkdirSync(source, { recursive: true });
    fs.mkdirSync(target, { recursive: true });
    const manifest = JSON.stringify({ name: '@deepseek-ai/dsh-app-boot', version: '0.1.7' });
    fs.writeFileSync(path.join(source, 'package.json'), manifest);
    fs.writeFileSync(path.join(target, 'package.json'), manifest);
    await assert.rejects(overlayWorkspaceRuntimePackages(path.join(root, 'source'), path.join(root, 'dest')),
      /缺少编译产物/);
  } finally {
    assert.ok(path.resolve(root).startsWith(path.resolve(os.tmpdir()) + path.sep));
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('test-only workspace runtime is excluded and a runtime consumer blocks the exclusion', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dshd-overlay-test-only-'));
  try {
    const sourceRoot = path.join(root, 'source');
    const destRoot = path.join(root, 'dest');
    const sourceTest = path.join(sourceRoot, 'packages', 'test-support', 'client-runtime');
    const targetTest = path.join(destRoot, 'node_modules', '@deepseek-ai', 'dsh-client-test-runtime');
    const targetSnapshot = path.join(destRoot, 'node_modules', '@deepseek-ai', 'dsh-session-snapshot');
    const mirror = path.join(destRoot, 'packages', 'test-support', 'client-runtime');
    const sourceSnapshot = path.join(sourceRoot, 'packages', 'test-support', 'snapshot');
    for (const dir of [sourceTest, targetTest, sourceSnapshot, targetSnapshot, mirror]) { fs.mkdirSync(dir, { recursive: true }); }
    fs.writeFileSync(path.join(sourceTest, 'package.json'), JSON.stringify({ name: '@deepseek-ai/dsh-client-test-runtime', version: '1.0.0' }));
    fs.writeFileSync(path.join(targetTest, 'package.json'), JSON.stringify({ name: '@deepseek-ai/dsh-client-test-runtime', version: '0.9.0' }));
    fs.writeFileSync(path.join(sourceSnapshot, 'package.json'), JSON.stringify({ name: '@deepseek-ai/dsh-session-snapshot', version: '1.0.0' }));
    fs.writeFileSync(path.join(targetSnapshot, 'package.json'), JSON.stringify({ name: '@deepseek-ai/dsh-session-snapshot', version: '0.9.0' }));
    fs.writeFileSync(path.join(mirror, 'package.json'), '{}');
    const result = await overlayWorkspaceRuntimePackages(sourceRoot, destRoot);
    assert.equal(result.packages, 0);
    assert.equal(fs.existsSync(targetTest), false);
    assert.equal(fs.existsSync(targetSnapshot), false);
    assert.equal(fs.existsSync(mirror), false);

    const consumer = path.join(sourceRoot, 'packages', 'boot', 'consumer');
    fs.mkdirSync(consumer, { recursive: true });
    fs.writeFileSync(path.join(consumer, 'package.json'), JSON.stringify({ name: 'consumer', version: '1.0.0', dependencies: { '@deepseek-ai/dsh-client-test-runtime': '1.0.0' } }));
    await assert.rejects(overlayWorkspaceRuntimePackages(sourceRoot, destRoot), /测试专用包被运行时依赖引用/);
  } finally {
    assert.ok(path.resolve(root).startsWith(path.resolve(os.tmpdir()) + path.sep));
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('final release tree rejects a nested test-only package', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dshd-overlay-final-tree-'));
  try {
    const nested = path.join(root, 'node_modules', 'consumer', 'node_modules', '@deepseek-ai', 'dsh-session-snapshot');
    fs.mkdirSync(nested, { recursive: true });
    fs.writeFileSync(path.join(nested, 'package.json'), JSON.stringify({ name: '@deepseek-ai/dsh-session-snapshot' }));
    assert.throws(() => assertNoDevOnlyPackages(root), /测试专用包仍在发布树中/);
    fs.rmSync(path.join(nested, 'package.json'));
    assert.doesNotThrow(() => assertNoDevOnlyPackages(root));
  } finally {
    assert.ok(path.resolve(root).startsWith(path.resolve(os.tmpdir()) + path.sep));
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('new workspace package never inherits dependencies from an old pnpm host', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dshd-overlay-host-'));
  try {
    const harnessSrc = path.join(root, 'source');
    const harnessDest = path.join(root, 'dest');
    const source = path.join(harnessSrc, 'packages', 'boot', 'p');
    const target = path.join(harnessDest, 'node_modules', 'p');
    const topQ = path.join(harnessDest, 'node_modules', 'q');
    const localQ = path.join(source, 'node_modules', 'q');
    const oldEntry = path.join(harnessSrc, 'node_modules', '.pnpm', 'p@1', 'node_modules');
    for (const dir of [path.join(source, 'lib'), path.join(target, 'lib'), topQ, localQ,
      path.join(oldEntry, 'p'), path.join(oldEntry, 'q')]) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(path.join(source, 'package.json'), JSON.stringify({ name: 'p', version: '2.0.0', dependencies: { q: '2.0.0' } }));
    fs.writeFileSync(path.join(source, 'lib', 'index.js'), 'module.exports = require("q");');
    fs.writeFileSync(path.join(target, 'package.json'), JSON.stringify({ name: 'p', version: '1.0.0' }));
    fs.writeFileSync(path.join(topQ, 'package.json'), JSON.stringify({ name: 'q', version: '2.0.0' }));
    fs.writeFileSync(path.join(localQ, 'package.json'), JSON.stringify({ name: 'q', version: '2.0.0' }));
    fs.writeFileSync(path.join(oldEntry, 'p', 'package.json'), JSON.stringify({ name: 'p', version: '1.0.0' }));
    fs.writeFileSync(path.join(oldEntry, 'q', 'package.json'), JSON.stringify({ name: 'q', version: '1.0.0' }));
    const workspace = await overlayWorkspaceRuntimePackages(harnessSrc, harnessDest);
    await repairFlattenedVersionIsolation(harnessSrc, harnessDest, workspace.sources);
    const resolved = require.resolve('q/package.json', { paths: [target] });
    assert.equal(JSON.parse(fs.readFileSync(resolved, 'utf8')).version, '2.0.0');
    assert.equal(fs.existsSync(path.join(target, 'node_modules', 'q')), false);
  } finally {
    assert.ok(path.resolve(root).startsWith(path.resolve(os.tmpdir()) + path.sep));
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('workspace package fails when a declared required dependency has no source instance', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dshd-overlay-required-'));
  try {
    const harnessSrc = path.join(root, 'source');
    const harnessDest = path.join(root, 'dest');
    const source = path.join(harnessSrc, 'packages', 'boot', 'p');
    const target = path.join(harnessDest, 'node_modules', 'p');
    fs.mkdirSync(path.join(source, 'lib'), { recursive: true });
    fs.mkdirSync(target, { recursive: true });
    fs.writeFileSync(path.join(source, 'package.json'), JSON.stringify({ name: 'p', version: '2.0.0', dependencies: { q: '1.0.0' } }));
    fs.writeFileSync(path.join(target, 'package.json'), JSON.stringify({ name: 'p', version: '1.0.0' }));
    const workspace = await overlayWorkspaceRuntimePackages(harnessSrc, harnessDest);
    await assert.rejects(repairFlattenedVersionIsolation(harnessSrc, harnessDest, workspace.sources), /工作区必需依赖缺失: p → q/);
  } finally {
    assert.ok(path.resolve(root).startsWith(path.resolve(os.tmpdir()) + path.sep));
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('workspace package keeps its own direct dependency when top-level differs', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dshd-overlay-direct-'));
  try {
    const harnessSrc = path.join(root, 'source');
    const harnessDest = path.join(root, 'dest');
    const source = path.join(harnessSrc, 'packages', 'boot', 'p');
    const target = path.join(harnessDest, 'node_modules', 'p');
    const localQ = path.join(source, 'node_modules', 'q');
    const topQ = path.join(harnessDest, 'node_modules', 'q');
    for (const dir of [path.join(source, 'lib'), target, localQ, topQ]) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(path.join(source, 'package.json'), JSON.stringify({ name: 'p', version: '2.0.0', dependencies: { q: '1.0.0' } }));
    fs.writeFileSync(path.join(source, 'lib', 'index.js'), 'module.exports = require("q");');
    fs.writeFileSync(path.join(target, 'package.json'), JSON.stringify({ name: 'p', version: '1.0.0' }));
    fs.writeFileSync(path.join(localQ, 'package.json'), JSON.stringify({ name: 'q', version: '1.0.0' }));
    fs.writeFileSync(path.join(topQ, 'package.json'), JSON.stringify({ name: 'q', version: '2.0.0' }));
    const workspace = await overlayWorkspaceRuntimePackages(harnessSrc, harnessDest);
    await repairFlattenedVersionIsolation(harnessSrc, harnessDest, workspace.sources);
    const resolved = require.resolve('q/package.json', { paths: [target] });
    assert.equal(JSON.parse(fs.readFileSync(resolved, 'utf8')).version, '1.0.0');
  } finally {
    assert.ok(path.resolve(root).startsWith(path.resolve(os.tmpdir()) + path.sep));
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('workspace owners reuse one identical leaf instance without a root link', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dshd-overlay-leaf-'));
  try {
    const harnessSrc = path.join(root, 'source');
    const harnessDest = path.join(root, 'dest');
    const sharedQ = path.join(root, 'shared-q');
    const topQ = path.join(harnessDest, 'node_modules', 'q');
    fs.mkdirSync(sharedQ, { recursive: true });
    fs.mkdirSync(topQ, { recursive: true });
    const qManifest = JSON.stringify({ name: 'q', version: '1.0.0', main: 'index.js' });
    for (const dir of [sharedQ, topQ]) {
      fs.writeFileSync(path.join(dir, 'package.json'), qManifest);
      fs.writeFileSync(path.join(dir, 'index.js'), 'module.exports = { shared: true };\n');
    }
    for (const name of ['p', 'r']) {
      const source = path.join(harnessSrc, 'packages', 'boot', name);
      const target = path.join(harnessDest, 'node_modules', name);
      fs.mkdirSync(path.join(source, 'lib'), { recursive: true });
      fs.mkdirSync(path.join(source, 'node_modules'), { recursive: true });
      fs.mkdirSync(target, { recursive: true });
      fs.symlinkSync(sharedQ, path.join(source, 'node_modules', 'q'), 'junction');
      fs.writeFileSync(path.join(source, 'package.json'), JSON.stringify({ name, version: '2.0.0', dependencies: { q: '1.0.0' } }));
      fs.writeFileSync(path.join(source, 'lib', 'index.js'), 'module.exports = require("q");\n');
      fs.writeFileSync(path.join(target, 'package.json'), JSON.stringify({ name, version: '1.0.0' }));
    }
    const workspace = await overlayWorkspaceRuntimePackages(harnessSrc, harnessDest);
    await repairFlattenedVersionIsolation(harnessSrc, harnessDest, workspace.sources);
    const p = path.join(harnessDest, 'node_modules', 'p');
    const r = path.join(harnessDest, 'node_modules', 'r');
    assert.equal(fs.existsSync(path.join(p, 'node_modules', 'q')), false);
    assert.equal(fs.existsSync(path.join(r, 'node_modules', 'q')), false);
    assert.equal(require.resolve('q', { paths: [p] }), require.resolve('q', { paths: [r] }));
  } finally {
    assert.ok(path.resolve(root).startsWith(path.resolve(os.tmpdir()) + path.sep));
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('same-version peer instances are isolated by source identity', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dshd-overlay-peer-'));
  try {
    const harnessSrc = path.join(root, 'source');
    const harnessDest = path.join(root, 'dest');
    const source = path.join(harnessSrc, 'packages', 'boot', 'p');
    const target = path.join(harnessDest, 'node_modules', 'p');
    const localQ = path.join(source, 'node_modules', 'q');
    const rootQ = path.join(harnessSrc, 'node_modules', 'q');
    const topQ = path.join(harnessDest, 'node_modules', 'q');
    for (const dir of [path.join(source, 'lib'), target, localQ, rootQ, topQ]) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(path.join(source, 'package.json'), JSON.stringify({ name: 'p', version: '2.0.0', dependencies: { q: '1.0.0' } }));
    fs.writeFileSync(path.join(source, 'lib', 'index.js'), 'module.exports = require("q");');
    fs.writeFileSync(path.join(target, 'package.json'), JSON.stringify({ name: 'p', version: '1.0.0' }));
    fs.writeFileSync(path.join(localQ, 'package.json'), JSON.stringify({ name: 'q', version: '1.0.0', variant: 'peer-b' }));
    fs.writeFileSync(path.join(rootQ, 'package.json'), JSON.stringify({ name: 'q', version: '1.0.0', variant: 'peer-a' }));
    fs.writeFileSync(path.join(topQ, 'package.json'), JSON.stringify({ name: 'q', version: '1.0.0', variant: 'peer-a' }));
    const workspace = await overlayWorkspaceRuntimePackages(harnessSrc, harnessDest);
    await repairFlattenedVersionIsolation(harnessSrc, harnessDest, workspace.sources);
    const resolved = require.resolve('q/package.json', { paths: [target] });
    assert.equal(JSON.parse(fs.readFileSync(resolved, 'utf8')).variant, 'peer-b');
  } finally {
    assert.ok(path.resolve(root).startsWith(path.resolve(os.tmpdir()) + path.sep));
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('nested dependency keeps its transitive version after workspace overlay', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dshd-overlay-transitive-'));
  try {
    const sourceRoot = path.join(root, 'source');
    const destRoot = path.join(root, 'dest');
    const sourceP = path.join(sourceRoot, 'packages', 'boot', 'p');
    const targetP = path.join(destRoot, 'node_modules', 'p');
    const sourceQ = path.join(sourceP, 'node_modules', 'q');
    const sourceR = path.join(sourceQ, 'node_modules', 'r');
    const topQ = path.join(destRoot, 'node_modules', 'q');
    const topR = path.join(destRoot, 'node_modules', 'r');
    for (const dir of [path.join(sourceP, 'lib'), targetP, sourceQ, sourceR, topQ, topR]) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(path.join(sourceP, 'package.json'), JSON.stringify({ name: 'p', version: '2.0.0', dependencies: { q: '1.0.0' } }));
    fs.writeFileSync(path.join(sourceP, 'lib', 'index.js'), 'module.exports = require("q");\n');
    fs.writeFileSync(path.join(targetP, 'package.json'), JSON.stringify({ name: 'p', version: '1.0.0' }));
    for (const dir of [sourceQ, topQ]) {
      fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: 'q', version: '1.0.0', main: 'index.js', dependencies: { r: '1.0.0' } }));
      fs.writeFileSync(path.join(dir, 'index.js'), 'module.exports = require("r").version;\n');
    }
    for (const [dir, version] of [[sourceR, '1.0.0'], [topR, '2.0.0']]) {
      fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: 'r', version, main: 'index.js' }));
      fs.writeFileSync(path.join(dir, 'index.js'), `module.exports = { version: '${version}' };\n`);
    }
    const workspace = await overlayWorkspaceRuntimePackages(sourceRoot, destRoot);
    await repairFlattenedVersionIsolation(sourceRoot, destRoot, workspace.sources);
    assert.equal(require(path.join(targetP, 'lib', 'index.js')), '1.0.0');
    assert.equal(JSON.parse(fs.readFileSync(path.join(targetP, 'node_modules', 'q', 'node_modules', 'r', 'package.json'))).version, '1.0.0');
  } finally {
    assert.ok(path.resolve(root).startsWith(path.resolve(os.tmpdir()) + path.sep));
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('same-version peer variant shares its peer with the workspace owner', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dshd-overlay-peer-graph-'));
  try {
    const sourceRoot = path.join(root, 'source');
    const destRoot = path.join(root, 'dest');
    const sourceP = path.join(sourceRoot, 'packages', 'boot', 'p');
    const targetP = path.join(destRoot, 'node_modules', 'p');
    const sourceQ = path.join(sourceP, 'node_modules', 'q');
    const sourceR = path.join(sourceP, 'node_modules', 'r');
    const topQ = path.join(destRoot, 'node_modules', 'q');
    const topR = path.join(destRoot, 'node_modules', 'r');
    for (const dir of [path.join(sourceP, 'lib'), targetP, sourceQ, sourceR, topQ, topR]) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(path.join(sourceP, 'package.json'), JSON.stringify({ name: 'p', version: '2.0.0', dependencies: { q: '1.0.0', r: '2.0.0' } }));
    fs.writeFileSync(path.join(sourceP, 'lib', 'index.js'), 'const q = require("q"); const r = require("r"); module.exports = { same: q.peer === r, version: q.peer.version };\n');
    fs.writeFileSync(path.join(targetP, 'package.json'), JSON.stringify({ name: 'p', version: '1.0.0' }));
    for (const dir of [sourceQ, topQ]) {
      fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: 'q', version: '1.0.0', main: 'index.js', peerDependencies: { r: '*' } }));
      fs.writeFileSync(path.join(dir, 'index.js'), 'module.exports = { peer: require("r") };\n');
    }
    for (const [dir, version] of [[sourceR, '2.0.0'], [topR, '1.0.0']]) {
      fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: 'r', version, main: 'index.js' }));
      fs.writeFileSync(path.join(dir, 'index.js'), `module.exports = { version: '${version}' };\n`);
    }
    const workspace = await overlayWorkspaceRuntimePackages(sourceRoot, destRoot);
    await repairFlattenedVersionIsolation(sourceRoot, destRoot, workspace.sources);
    assert.deepEqual(require(path.join(targetP, 'lib', 'index.js')), { same: true, version: '2.0.0' });
    assert.equal(fs.existsSync(path.join(targetP, 'node_modules', 'q', 'node_modules', 'r')), false);
  } finally {
    assert.ok(path.resolve(root).startsWith(path.resolve(os.tmpdir()) + path.sep));
    fs.rmSync(root, { recursive: true, force: true });
  }
});

for (const topVersion of ['1.0.0', '2.0.0']) {
test(`shared module identity with a conflicting third consumer and root ${topVersion}`, async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dshd-overlay-shared-variant-'));
  try {
    const sourceRoot = path.join(root, 'source');
    const destRoot = path.join(root, 'dest');
    const sharedR = path.join(root, 'shared-r1');
    const otherR = path.join(root, 'other-r2');
    for (const [dir, version] of [[sharedR, '1.0.0'], [otherR, '2.0.0'],
      [path.join(destRoot, 'node_modules', 'r'), topVersion]]) {
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: 'r', version, main: 'index.js' }));
      fs.writeFileSync(path.join(dir, 'index.js'), `module.exports = { version: '${version}' };\n`);
    }
    for (const [name, sourceR] of [['a', sharedR], ['b', sharedR], ['c', otherR]]) {
      const source = path.join(sourceRoot, 'packages', 'boot', name);
      const target = path.join(destRoot, 'node_modules', name);
      fs.mkdirSync(path.join(source, 'lib'), { recursive: true });
      fs.mkdirSync(path.join(source, 'node_modules'), { recursive: true });
      fs.mkdirSync(target, { recursive: true });
      fs.symlinkSync(sourceR, path.join(source, 'node_modules', 'r'), 'junction');
      fs.writeFileSync(path.join(source, 'package.json'), JSON.stringify({ name, version: '1.0.0', main: 'lib/index.js', dependencies: { r: '*' } }));
      fs.writeFileSync(path.join(source, 'lib', 'index.js'), 'module.exports = require("r");\n');
      fs.writeFileSync(path.join(target, 'package.json'), JSON.stringify({ name, version: '0.9.0' }));
    }
    const workspace = await overlayWorkspaceRuntimePackages(sourceRoot, destRoot);
    if (topVersion === '2.0.0') {
      // A and B share one source object. A different root version must not
      // silently authorize separate module instances for these consumers.
      await assert.rejects(repairFlattenedVersionIsolation(sourceRoot, destRoot, workspace.sources),
        /工作区依赖实例被拆分: r/);
      return;
    }
    await repairFlattenedVersionIsolation(sourceRoot, destRoot, workspace.sources);
    const [a, b, c] = ['a', 'b', 'c'].map((name) => require(path.join(destRoot, 'node_modules', name, 'lib', 'index.js')));
    assert.strictEqual(a, b);
    assert.notStrictEqual(a, c);
    assert.equal(c.version, '2.0.0');
    assert.equal(fs.existsSync(path.join(destRoot, 'node_modules', 'a', 'node_modules', 'r')), false);
    assert.equal(fs.existsSync(path.join(destRoot, 'node_modules', 'b', 'node_modules', 'r')), false);
  } finally {
    assert.ok(path.resolve(root).startsWith(path.resolve(os.tmpdir()) + path.sep));
    fs.rmSync(root, { recursive: true, force: true });
  }
});
}

for (const order of [['q', 'r'], ['r', 'q']]) {
  test(`peer and direct dependency keep transitive child in ${order.join(',')} order`, async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dshd-overlay-peer-order-'));
    try {
      const sourceRoot = path.join(root, 'source');
      const destRoot = path.join(root, 'dest');
      const p = path.join(sourceRoot, 'packages', 'boot', 'p');
      const u = path.join(sourceRoot, 'packages', 'boot', 'u');
      const sourceQ = path.join(p, 'node_modules', 'q');
      const sourceR2 = path.join(p, 'node_modules', 'r');
      const sourceS1 = path.join(sourceR2, 'node_modules', 's');
      const sourceR3 = path.join(u, 'node_modules', 'r');
      const top = path.join(destRoot, 'node_modules');
      for (const dir of [path.join(p, 'lib'), path.join(u, 'lib'), sourceQ, sourceR2, sourceS1,
        sourceR3, path.join(top, 'p'), path.join(top, 'u'), path.join(top, 'q'), path.join(top, 'r'), path.join(top, 's')]) {
        fs.mkdirSync(dir, { recursive: true });
      }
      const pManifest = { name: 'p', version: '2.0.0', main: 'lib/index.js', dependencies: Object.fromEntries(order.map((name) => [name, '*'])) };
      fs.writeFileSync(path.join(p, 'package.json'), JSON.stringify(pManifest));
      fs.writeFileSync(path.join(p, 'lib', 'index.js'), 'const q = require("q"); const r = require("r"); module.exports = { same: q.peer === r, child: r.child.version };\n');
      fs.writeFileSync(path.join(u, 'package.json'), JSON.stringify({ name: 'u', version: '2.0.0', main: 'lib/index.js', dependencies: { r: '3.0.0' } }));
      fs.writeFileSync(path.join(u, 'lib', 'index.js'), 'module.exports = require("r");\n');
      for (const name of ['p', 'u']) { fs.writeFileSync(path.join(top, name, 'package.json'), JSON.stringify({ name, version: '1.0.0' })); }
      for (const dir of [sourceQ, path.join(top, 'q')]) {
        fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: 'q', version: '1.0.0', main: 'index.js', peerDependencies: { r: '*' } }));
        fs.writeFileSync(path.join(dir, 'index.js'), 'module.exports = { peer: require("r") };\n');
      }
      for (const [dir, version] of [[sourceR2, '2.0.0'], [sourceR3, '3.0.0'], [path.join(top, 'r'), '1.0.0']]) {
        const dependencies = version === '2.0.0' ? { s: '1.0.0' } : {};
        fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: 'r', version, main: 'index.js', dependencies }));
        fs.writeFileSync(path.join(dir, 'index.js'), version === '2.0.0'
          ? `module.exports = { version: '${version}', child: require("s") };\n`
          : `module.exports = { version: '${version}' };\n`);
      }
      for (const [dir, version] of [[sourceS1, '1.0.0'], [path.join(top, 's'), '2.0.0']]) {
        fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: 's', version, main: 'index.js' }));
        fs.writeFileSync(path.join(dir, 'index.js'), `module.exports = { version: '${version}' };\n`);
      }
      const workspace = await overlayWorkspaceRuntimePackages(sourceRoot, destRoot);
      await repairFlattenedVersionIsolation(sourceRoot, destRoot, workspace.sources);
      assert.deepEqual(require(path.join(top, 'p', 'lib', 'index.js')), { same: true, child: '1.0.0' });
      assert.equal(require(path.join(top, 'u', 'lib', 'index.js')).version, '3.0.0');
    } finally {
      assert.ok(path.resolve(root).startsWith(path.resolve(os.tmpdir()) + path.sep));
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
}
