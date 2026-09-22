const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'market-state-'));
const electron = require.resolve('electron');
require.cache[electron] = { id: electron, filename: electron, loaded: true, exports: { app: { getPath: () => dir } } };
const { listMarketplaceState, setMarketplaceFavorite, recordMarketplaceOperation, redactMarketLog } = require('./marketplace-state');
test.after(() => fs.rmSync(dir, { recursive: true, force: true }));
test.beforeEach(() => {
  fs.rmSync(path.join(dir, 'marketplace-state.json'), { force: true });
});

test('favorites survive reads, deduplicate, and validate IPC arguments', () => {
  setMarketplaceFavorite('acme/demo', true);
  setMarketplaceFavorite('acme/demo', true);
  assert.deepEqual(listMarketplaceState().favorites, ['acme/demo']);
  assert.throws(() => setMarketplaceFavorite({}, true));
  assert.throws(() => setMarketplaceFavorite('acme/demo', 'true'));
  assert.deepEqual(setMarketplaceFavorite('acme/demo', false).favorites, []);
});

test('operation history is bounded and secrets are removed before persistence', async () => {
  for (let i = 0; i < 32; i++) {
    await recordMarketplaceOperation('install', 'acme/demo', async progress => {
      progress({ line: 'https://user:secret@github.com/repo?token=private' });
      return { ok: false, error: 'Authorization: Bearer invisible', log: 'x'.repeat(20000) + ' _authToken=private' };
    });
  }
  const state = listMarketplaceState();
  assert.equal(state.operations.length, 30);
  assert.ok(state.operations[0].log.length <= 16000);
  assert.equal(state.operations[0].status, 'failed');
  const disk = fs.readFileSync(path.join(dir, 'marketplace-state.json'), 'utf8');
  assert.doesNotMatch(disk, /secret|private|invisible/);
});

test('running state and progress remain visible without the invoking renderer', async () => {
  let finish;
  const work = recordMarketplaceOperation('update', 'acme/demo', async progress => {
    progress({ line: 'working' });
    await new Promise(resolve => { finish = resolve; });
    return { ok: true, harnessStarted: false, error: 'restart failed' };
  });
  assert.equal(listMarketplaceState().operations[0].status, 'running');
  assert.match(listMarketplaceState().operations[0].log, /working/);
  finish();
  await work;
  assert.equal(listMarketplaceState().operations[0].status, 'failed');
});

test('unfinished records from a previous desktop process become interrupted', () => {
  fs.writeFileSync(path.join(dir, 'marketplace-state.json'), JSON.stringify({ operations: [
    { id: 'old', kind: 'update', target: 'acme/demo', startedAt: Date.now(), status: 'running', log: '' },
    { id: 'invalid', kind: 'bogus', startedAt: 'bad' },
  ] }));
  assert.equal(listMarketplaceState().operations.length, 1);
  assert.equal(listMarketplaceState().operations[0].status, 'interrupted');
});

test('redaction handles URL userinfo, query credentials and known token prefixes', () => {
  const value = redactMarketLog('https://user:secret@host/path?access_token=abc Authorization: Bearer hidden github_pat_123456 api_key="private"');
  assert.doesNotMatch(value, /secret|abc|hidden|github_pat_123456|private/);
});
