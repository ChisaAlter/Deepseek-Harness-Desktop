'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const store = require('./store');

function tmpRoot(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dshd-comp-store-'));
  t.after(() => {
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch {
      // tmp cleanup best effort
    }
  });
  return dir;
}

test('validComponentId accepts slug ids and rejects traversal/absolute', () => {
  assert.equal(store.validComponentId('launcher-notes'), true);
  assert.equal(store.validComponentId('a1_B.c'), true);
  assert.equal(store.validComponentId(''), false);
  assert.equal(store.validComponentId('../etc'), false);
  assert.equal(store.validComponentId('a/b'), false);
  assert.equal(store.validComponentId('a\\b'), false);
  assert.equal(store.validComponentId('-lead'), false);
  assert.equal(store.validComponentId(null), false);
  assert.equal(store.validComponentId(42), false);
});

test('componentsRoot prefers deps and nests under userData otherwise', () => {
  assert.equal(store.componentsRoot({ componentsRoot: 'D:\\x' }), 'D:\\x');
  assert.equal(
    store.componentsRoot({ userDataDir: path.join('base', 'ud') }),
    path.join('base', 'ud', 'components'),
  );
  assert.equal(typeof store.componentsRoot({}), 'string');
});

test('registry save/load roundtrips and survives a missing file', (t) => {
  const root = tmpRoot(t);
  const missing = store.loadRegistry(root);
  assert.deepEqual(missing.components, {});
  const registry = {
    components: {
      'launcher-notes': {
        id: 'launcher-notes',
        name: '启动器便签',
        version: '1.0.0',
        previous: null,
        state: 'running',
        pid: 4321,
        url: 'http://127.0.0.1:45001/',
        source: 'bundled',
        installedAt: '2026-09-26T00:00:00Z',
        updatedAt: '2026-09-26T00:00:00Z',
        lastError: '',
      },
    },
  };
  store.saveRegistry(root, registry);
  const loaded = store.loadRegistry(root);
  assert.equal(loaded.corrupt, false);
  assert.equal(loaded.components['launcher-notes'].version, '1.0.0');
  assert.equal(loaded.components['launcher-notes'].state, 'running');
  assert.equal(loaded.components['launcher-notes'].pid, 4321);
});

test('a torn registry file is moved aside and loads empty', (t) => {
  const root = tmpRoot(t);
  fs.mkdirSync(root, { recursive: true });
  const file = store.registryFile(root);
  fs.writeFileSync(file, '{ not json');
  const loaded = store.loadRegistry(root);
  assert.equal(loaded.corrupt, true);
  assert.deepEqual(loaded.components, {});
  assert.equal(fs.existsSync(`${file}.broken`), true);
});

test('normalizeRegistry drops invalid ids and malformed records', () => {
  const normalized = store.normalizeRegistry({
    components: {
      ok: { version: '1.0.0', state: 'running', pid: 5 },
      'bad/../id': { version: '1.0.0' },
      noVersion: { state: 'running' },
      weirdState: { version: '1.0.0', state: 'exploded', pid: -3 },
    },
  });
  assert.ok(normalized.components.ok);
  assert.equal(normalized.components['bad/../id'], undefined);
  assert.equal(normalized.components.noVersion, undefined);
  assert.equal(normalized.components.weirdState.state, 'installed');
  assert.equal(normalized.components.weirdState.pid, null);
});

test('payload dirs resolve per id+version inside the components root', () => {
  const root = path.join('ud', 'components');
  assert.equal(store.versionDir(root, 'x', '1.2.3'), path.join(root, 'x', 'versions', '1.2.3'));
  assert.equal(store.dataDir(root, 'x'), path.join(root, 'x', 'data'));
  assert.equal(store.logFile(root, 'x'), path.join(root, 'x', 'data', 'component.log'));
  assert.equal(store.stateFile(root, 'x'), path.join(root, 'x', 'data', 'state.json'));
});
