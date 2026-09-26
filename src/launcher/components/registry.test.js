'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const registry = require('./registry');

const SAMPLE_FIXTURES = path.resolve(__dirname, '..', '..', '..', 'tests', 'fixtures', 'components');

function tmpRoot(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dshd-comp-reg-'));
  t.after(() => {
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch {
      // tmp cleanup best effort
    }
  });
  return dir;
}

function makeSample(root, id, version, manifestOverrides = {}) {
  const dir = path.join(root, id, version);
  fs.mkdirSync(dir, { recursive: true });
  const manifest = {
    id,
    name: `Sample ${id}`,
    version,
    description: 'test component',
    entry: 'entry.js',
    ...manifestOverrides,
  };
  fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify(manifest));
  if (manifest.entry && !path.isAbsolute(manifest.entry) && !manifest.entry.includes('..')) {
    const entryPath = path.join(dir, manifest.entry);
    fs.mkdirSync(path.dirname(entryPath), { recursive: true });
    fs.writeFileSync(entryPath, "'use strict';\n");
  }
  return dir;
}

test('compareVersions orders numeric semver-ish versions', () => {
  assert.equal(registry.compareVersions('1.0.0', '2.0.0'), -1);
  assert.equal(registry.compareVersions('2.0.0', '1.9.9'), 1);
  assert.equal(registry.compareVersions('1.0.0', '1.0.0'), 0);
  assert.equal(registry.compareVersions('1.0', '1.0.0'), 0);
  assert.equal(registry.compareVersions('1.0.1', '1.0'), 1);
  assert.equal(registry.compareVersions('', '0.0.1'), -1);
});

test('safeEntryPath rejects absolute and traversal entries', () => {
  const dir = path.join('base', 'payload');
  assert.equal(registry.safeEntryPath(dir, 'entry.js'), path.resolve(dir, 'entry.js'));
  assert.equal(registry.safeEntryPath(dir, 'sub/entry.js'), path.resolve(dir, 'sub', 'entry.js'));
  assert.equal(registry.safeEntryPath(dir, '..\\outside.js'), '');
  assert.equal(registry.safeEntryPath(dir, '../outside.js'), '');
  assert.equal(registry.safeEntryPath(dir, 'C:\\abs.js'), '');
  assert.equal(registry.safeEntryPath(dir, '/abs.js'), '');
  assert.equal(registry.safeEntryPath(dir, ''), '');
});

test('scanCatalog picks versions per id, sorted, with latest', (t) => {
  const root = tmpRoot(t);
  makeSample(root, 'alpha', '1.0.0');
  makeSample(root, 'alpha', '2.0.0');
  makeSample(root, 'beta', '0.1.0', { kind: 'tool' });
  const catalog = registry.scanCatalog({ samplesRoot: root });
  assert.equal(catalog.length, 2);
  const alpha = catalog.find((row) => row.id === 'alpha');
  assert.deepEqual(alpha.versions.map((row) => row.version), ['1.0.0', '2.0.0']);
  assert.equal(alpha.latest, '2.0.0');
  assert.equal(alpha.source, 'bundled');
  const beta = catalog.find((row) => row.id === 'beta');
  assert.equal(beta.kind, 'tool');
});

test('scanCatalog skips manifests whose id or version mismatch the dirs', (t) => {
  const root = tmpRoot(t);
  makeSample(root, 'gamma', '1.0.0');
  makeSample(root, 'gamma', '9.9.9', { version: '1.2.3' }); // dir/manifest mismatch
  const dir = path.join(root, 'delta', '1.0.0');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify({
    id: 'delta',
    name: 'delta',
    version: '1.0.0',
    entry: '../escape.js',
  }));
  const catalog = registry.scanCatalog({ samplesRoot: root });
  const gamma = catalog.find((row) => row.id === 'gamma');
  assert.deepEqual(gamma.versions.map((row) => row.version), ['1.0.0']);
  assert.equal(catalog.find((row) => row.id === 'delta'), undefined);
});

test('scanCatalog tolerates a missing root', () => {
  assert.deepEqual(registry.scanCatalog({ samplesRoot: path.join(os.tmpdir(), 'no-such-dir-xyz') }), []);
});

test('the launcher-notes fixture parses with both versions', () => {
  const catalog = registry.scanCatalog({ samplesRoot: SAMPLE_FIXTURES });
  const notes = catalog.find((row) => row.id === 'launcher-notes');
  assert.ok(notes, 'launcher-notes must be in the bundled catalog');
  assert.deepEqual(notes.versions.map((row) => row.version), ['1.0.0', '2.0.0']);
  assert.equal(notes.latest, '2.0.0');
  assert.equal(notes.kind, 'service');
  for (const version of notes.versions) {
    assert.equal(fs.existsSync(version.entryFile), true, `${version.version} entry must exist`);
  }
});

test('resolveCatalogVersion returns latest or the named version only', (t) => {
  const root = tmpRoot(t);
  makeSample(root, 'alpha', '1.0.0');
  makeSample(root, 'alpha', '2.0.0');
  const cat = registry.scanCatalog({ samplesRoot: root })[0];
  assert.equal(registry.resolveCatalogVersion(cat).version, '2.0.0');
  assert.equal(registry.resolveCatalogVersion(cat, '1.0.0').version, '1.0.0');
  assert.equal(registry.resolveCatalogVersion(cat, '3.0.0'), null);
});
