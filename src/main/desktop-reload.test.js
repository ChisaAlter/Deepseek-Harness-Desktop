'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createTaskProtection, CONTROL_PREFIX } = require('./task-protection');
const { createReloadWithCleanup } = require('./desktop-reload');
const importGuard = require('./import-guard');

const CLEAN_INSPECTION = {
  ok: true,
  hostGeneration: 'gen-1',
  activeWork: [],
  scheduledWork: [],
  coverage: { agents: 'ok', jobs: 'ok', schedule: 'ok' },
};

function jsonResponse(body, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

function fetchScript(handlers) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    const op = url.slice(url.indexOf(CONTROL_PREFIX) + CONTROL_PREFIX.length + 1);
    const body = JSON.parse(init.body || '{}');
    calls.push({ op, body });
    const handler = handlers[op] || (async () => ({ ok: false, code: 'unhandled' }));
    return jsonResponse(await handler(body));
  };
  return { fetchImpl, calls };
}

/**
 * A deferred-cleanup fixture: cleanup is suspended behind a manually
 * released promise so the test can change kernel state and slot ownership
 * mid-flight — the exact interleaving the dispatch-time recheck exists for.
 * The coordinator is the REAL createTaskProtection (it awaits commit() but
 * discards its return value, matching production).
 */
function makeReloadFixture({ readyKernel = true, journal = null } = {}) {
  const { fetchImpl } = fetchScript({
    inspect: async () => CLEAN_INSPECTION,
    acquire: async () => ({ ok: true, lockId: 'l', owner: 'desktop-quit', generation: 1 }),
    release: async () => ({ ok: true, released: true }),
  });
  const taskProtection = createTaskProtection({
    getBaseUrl: () => 'http://127.0.0.1:9',
    hostRunning: () => true,
    confirm: async () => true,
    fetchImpl,
  });
  const dsh = { state: readyKernel ? 'ready' : 'idle', baseUrl: readyKernel ? 'http://x' : '' };
  const events = { starts: 0, reloads: 0 };
  const harness = {
    // Mirrors harness-controller.reload(): pure view refresh when ready,
    // a kernel start (this.start()) when not. Counts every start.
    reload: async () => {
      if (dsh.state === 'ready' && dsh.baseUrl) {
        events.reloads += 1;
        return { reloaded: true };
      }
      events.starts += 1;
      return { started: true };
    },
  };
  let releaseCleanup;
  const cleanupGate = new Promise((r) => { releaseCleanup = r; });
  const reloadWithCleanup = createReloadWithCleanup({
    getMainWindow: () => ({ id: 1 }),
    dsh,
    harness,
    taskProtection,
    importGuard,
    readImportJournal: () => journal,
    journalIsBlocked: (j) => Boolean(j && (j.phase === 'blocked' || j.unreadable === true)),
    cleanupDesktopResources: () => cleanupGate,
    getUserDataDir: () => '/tmp/userData',
  });
  return { reloadWithCleanup, dsh, events, releaseCleanup };
}

test('dispatch-time refusal: ready->idle + foreign owner — zero starts, refusal returned, foreign owner kept', async () => {
  const f = makeReloadFixture({ readyKernel: true });
  const pending = f.reloadWithCleanup();
  await new Promise((r) => setImmediate(r));
  // Mid-flight: kernel becomes idle AND a foreign owner takes the slot.
  f.dsh.state = 'idle';
  f.dsh.baseUrl = '';
  const foreign = importGuard.acquireMaintenance('import');
  // Release the foreign token in cleanup, not after the assertions — a
  // failed assertion must never leave ownership behind for later tests.
  try {
    f.releaseCleanup();
    const result = await pending;
    assert.equal(f.events.starts, 0, 'no kernel start may run');
    assert.equal(f.events.reloads, 0, 'no view reload either — the op refused');
    assert.equal(result.proceeded, false);
    assert.equal(result.code, 'maintenance-in-progress');
    assert.equal(importGuard.holdsMaintenance(foreign), true, 'foreign owner is never released');
  } finally {
    importGuard.releaseMaintenance(foreign);
  }
});

test('dispatch-time refusal: ready->idle + blocked journal — zero starts, recovery refusal returned', async () => {
  const f = makeReloadFixture({ readyKernel: true, journal: { phase: 'blocked', destHome: '/x' } });
  const pending = f.reloadWithCleanup();
  await new Promise((r) => setImmediate(r));
  f.dsh.state = 'idle';
  f.dsh.baseUrl = '';
  f.releaseCleanup();
  const result = await pending;
  assert.equal(f.events.starts, 0);
  assert.equal(f.events.reloads, 0);
  assert.equal(result.proceeded, false);
  assert.equal(result.code, 'import-recovery-blocked');
});

test('ready throughout — one view reload, no kernel start, lock-free', async () => {
  const f = makeReloadFixture({ readyKernel: true });
  const pending = f.reloadWithCleanup();
  await new Promise((r) => setImmediate(r));
  f.releaseCleanup();
  const result = await pending;
  assert.equal(f.events.reloads, 1, 'ready reload is a view refresh');
  assert.equal(f.events.starts, 0);
  assert.equal(result, undefined, 'a completed reload resolves like the existing wrapper');
  assert.equal(importGuard.isMaintenanceHeld(), false, 'no ownership leaks');
});

test('initially idle + authorized — start runs under owned maintenance, released at settle', async () => {
  const f = makeReloadFixture({ readyKernel: false });
  const pending = f.reloadWithCleanup();
  await new Promise((r) => setImmediate(r));
  assert.equal(importGuard.isMaintenanceHeld(), true, 'idle-start acquires the slot up front');
  f.releaseCleanup();
  const result = await pending;
  assert.equal(f.events.starts, 1, 'authorized idle-start runs once');
  assert.equal(importGuard.isMaintenanceHeld(), false, 'ownership released at settlement');
  // Result is the coordinator's completed outcome (proceeded -> undefined).
  assert.equal(result, undefined);
});

test('coordinator decline — refusal propagates, no start, no leaked ownership', async () => {
  const { fetchImpl } = fetchScript({
    inspect: async () => ({ ...CLEAN_INSPECTION, activeWork: [{ kind: 'agent', id: 'a1' }] }),
    acquire: async () => ({ ok: true, lockId: 'l', owner: 'x', generation: 1 }),
    release: async () => ({ ok: true, released: true }),
  });
  const declining = createTaskProtection({
    getBaseUrl: () => 'http://127.0.0.1:9',
    hostRunning: () => true,
    confirm: async () => false, // user declines
    fetchImpl,
  });
  const dsh = { state: 'idle', baseUrl: '' };
  let starts = 0;
  const reloadWithCleanup = createReloadWithCleanup({
    getMainWindow: () => ({ id: 1 }),
    dsh,
    harness: { reload: async () => { starts += 1; return {}; } },
    taskProtection: declining,
    importGuard,
    readImportJournal: () => null,
    journalIsBlocked: () => false,
    cleanupDesktopResources: async () => {},
    getUserDataDir: () => '/tmp',
  });
  const result = await reloadWithCleanup();
  assert.equal(starts, 0);
  assert.equal(result && result.proceeded, false);
  assert.equal(importGuard.isMaintenanceHeld(), false, 'no ownership leaked on decline');
});

test('cleanup rejection — exception propagates truthfully, ownership released', async () => {
  const f = makeReloadFixture({ readyKernel: false });
  const broken = createReloadWithCleanup({
    getMainWindow: () => ({ id: 1 }),
    dsh: f.dsh,
    harness: f.harness,
    taskProtection: createTaskProtection({
      getBaseUrl: () => 'http://127.0.0.1:9',
      hostRunning: () => true,
      confirm: async () => true,
      fetchImpl: fetchScript({
        inspect: async () => CLEAN_INSPECTION,
        acquire: async () => ({ ok: true, lockId: 'l', owner: 'x', generation: 1 }),
        release: async () => ({ ok: true, released: true }),
      }).fetchImpl,
    }),
    importGuard,
    readImportJournal: () => null,
    journalIsBlocked: () => false,
    cleanupDesktopResources: async () => { throw new Error('cleanup exploded'); },
    getUserDataDir: () => '/tmp',
  });
  await assert.rejects(() => broken(), /cleanup exploded|commit|error/);
  assert.equal(importGuard.isMaintenanceHeld(), false, 'a cleanup exception must not leak the slot');
});

test('controller rejection — exception propagates truthfully, ownership released', async () => {
  const dsh = { state: 'idle', baseUrl: '' };
  const reloadWithCleanup = createReloadWithCleanup({
    getMainWindow: () => ({ id: 1 }),
    dsh,
    harness: { reload: async () => { throw new Error('controller exploded'); } },
    taskProtection: createTaskProtection({
      getBaseUrl: () => 'http://127.0.0.1:9',
      hostRunning: () => true,
      confirm: async () => true,
      fetchImpl: fetchScript({
        inspect: async () => CLEAN_INSPECTION,
        acquire: async () => ({ ok: true, lockId: 'l', owner: 'x', generation: 1 }),
        release: async () => ({ ok: true, released: true }),
      }).fetchImpl,
    }),
    importGuard,
    readImportJournal: () => null,
    journalIsBlocked: () => false,
    cleanupDesktopResources: async () => {},
    getUserDataDir: () => '/tmp',
  });
  await assert.rejects(() => reloadWithCleanup(), /controller exploded|commit|error/);
  assert.equal(importGuard.isMaintenanceHeld(), false);
});

test('authorized idle start — ownership held until the deferred controller result settles', async () => {
  const dsh = { state: 'idle', baseUrl: '' };
  let resolveReload;
  const deferred = new Promise((r) => { resolveReload = r; });
  const reloadWithCleanup = createReloadWithCleanup({
    getMainWindow: () => ({ id: 1 }),
    dsh,
    harness: { reload: () => deferred },
    taskProtection: createTaskProtection({
      getBaseUrl: () => 'http://127.0.0.1:9',
      hostRunning: () => true,
      confirm: async () => true,
      fetchImpl: fetchScript({
        inspect: async () => CLEAN_INSPECTION,
        acquire: async () => ({ ok: true, lockId: 'l', owner: 'x', generation: 1 }),
        release: async () => ({ ok: true, released: true }),
      }).fetchImpl,
    }),
    importGuard,
    readImportJournal: () => null,
    journalIsBlocked: () => false,
    cleanupDesktopResources: async () => {},
    getUserDataDir: () => '/tmp',
  });
  const pending = reloadWithCleanup();
  await new Promise((r) => setImmediate(r));
  // The acquired token must stay held while the controller reload is still
  // pending — ownership survives until the deferred result settles.
  assert.equal(importGuard.isMaintenanceHeld(), true, 'ownership held while controller pending');
  resolveReload({ started: true });
  await pending;
  assert.equal(importGuard.isMaintenanceHeld(), false, 'ownership released after settlement');
});
