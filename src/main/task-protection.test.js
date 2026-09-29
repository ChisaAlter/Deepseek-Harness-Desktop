'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createTaskProtection, inspectionClean, CONTROL_PREFIX } = require('./task-protection');

const CLEAN_INSPECTION = {
  ok: true,
  hostGeneration: 'gen-1',
  activeWork: [],
  scheduledWork: [],
  coverage: { agents: 'ok', jobs: 'ok', schedule: 'ok' },
};

const DIRTY_INSPECTION = {
  ...CLEAN_INSPECTION,
  activeWork: [{ kind: 'agent', id: 'a1', detail: 'running' }],
};

function jsonResponse(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  };
}

/** Fake fetch that routes control ops to scripted handlers. */
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

function makeProtection(overrides = {}, handlers = {}) {
  const { fetchImpl, calls } = fetchScript({
    inspect: async () => overrides.inspection || CLEAN_INSPECTION,
    acquire: async () => ({ ok: true, lockId: 'lock-1', owner: 'desktop-quit', generation: 1 }),
    release: async () => ({ ok: true, released: true }),
    ...handlers,
  });
  const protection = createTaskProtection({
    getBaseUrl: () => 'http://127.0.0.1:9',
    hostRunning: () => overrides.hostDown !== true,
    confirm: overrides.confirm,
    fetchImpl,
    ...overrides.options,
  });
  return { protection, calls };
}

test('a token-carrying ready URL still posts to the control prefix', async () => {
  // The `dsh web:` line advertises <origin>/?token=…; appending the control
  // route after that query used to post `/` and fail with http-405.
  const urls = [];
  const { fetchImpl, calls } = fetchScript({
    inspect: async () => CLEAN_INSPECTION,
    acquire: async () => ({ ok: true, lockId: 'l', owner: 'desktop-stop', generation: 1 }),
    release: async () => ({ ok: true, released: true }),
  });
  const recordingFetch = async (url, init) => {
    urls.push(String(url));
    return fetchImpl(url, init);
  };
  const protection = createTaskProtection({
    getBaseUrl: () => 'http://127.0.0.1:3080/?token=launch-secret',
    hostRunning: () => true,
    fetchImpl: recordingFetch,
  });
  const result = await protection.coordinate('stop', { commit: async () => {} });
  assert.equal(result.proceeded, true);
  assert.deepEqual(calls.map((c) => c.op), ['inspect', 'acquire', 'inspect', 'release']);
  for (const url of urls) {
    assert.match(url, /^http:\/\/127\.0\.0\.1:3080\/dshd-task-control\//);
    assert.ok(!url.includes('token='), `control URL leaked the launch token: ${url}`);
  }
});

test('clean inspection proceeds to commit without prompting or locking early', async () => {
  let committed = false;
  let prompted = false;
  const { protection, calls } = makeProtection({ confirm: async () => { prompted = true; return true; } });
  const result = await protection.coordinate('quit', { commit: async () => { committed = true; } });
  assert.equal(result.proceeded, true);
  assert.equal(committed, true);
  assert.equal(prompted, false);
  assert.deepEqual(calls.map((c) => c.op), ['inspect', 'acquire', 'inspect', 'release']);
});

test('active work prompts; declined cancels before any side effect', async () => {
  let committed = false;
  const { protection, calls } = makeProtection({
    inspection: DIRTY_INSPECTION,
    confirm: async () => false,
  });
  const result = await protection.coordinate('quit', { commit: async () => { committed = true; } });
  assert.equal(result.proceeded, false);
  assert.equal(result.code, 'cancelled');
  assert.equal(committed, false);
  // No lock acquire on cancel — admission was never frozen.
  assert.deepEqual(calls.map((c) => c.op), ['inspect']);
});

test('preConfirmed skips the user-confirm gates but keeps the lock sequencing', async () => {
  let prompted = false;
  let committed = false;
  const { protection, calls } = makeProtection({
    inspection: DIRTY_INSPECTION,
    confirm: async () => { prompted = true; return false; },
  });
  const result = await protection.coordinate('stop', {
    preConfirmed: true,
    commit: async () => { committed = true; },
  });
  assert.equal(result.proceeded, true);
  assert.equal(committed, true);
  assert.equal(prompted, false, 'a launcher-confirmed stop must never prompt');
  assert.deepEqual(calls.map((c) => c.op), ['inspect', 'acquire', 'inspect', 'release']);
});

test('preConfirmed also skips the second-inspection re-confirm', async () => {
  let n = 0;
  let committed = false;
  const { protection } = makeProtection({
    confirm: async () => false,
  }, {
    inspect: async () => (n++ === 0 ? CLEAN_INSPECTION : DIRTY_INSPECTION),
    acquire: async () => ({ ok: true, lockId: 'l', owner: 'desktop-stop', generation: 3 }),
    release: async () => ({ ok: true, released: true }),
  });
  const result = await protection.coordinate('stop', {
    preConfirmed: true,
    commit: async () => { committed = true; },
  });
  assert.equal(result.proceeded, true);
  assert.equal(committed, true);
});

test('dirty first inspect prompts once; clean second inspect proceeds', async () => {
  let inspections = 0;
  const confirmations = [];
  const { protection } = makeProtection({
    confirm: async (_op, inspection) => {
      confirmations.push(inspection.activeWork.length);
      return true;
    },
  }, {
    inspect: async () => (inspections++ === 0 ? DIRTY_INSPECTION : CLEAN_INSPECTION),
    acquire: async () => ({ ok: true, lockId: 'l', owner: 'desktop-restart', generation: 2 }),
    release: async () => ({ ok: true, released: true }),
  });
  const result = await protection.coordinate('restart', {});
  assert.equal(result.proceeded, true);
  assert.deepEqual(confirmations, [1]);
});

test('fresh work after acquire re-confirms against the second picture', async () => {
  const seen = [];
  let committed = false;
  let n = 0;
  const { protection, calls } = makeProtection({
    confirm: async (_op, inspection) => {
      seen.push(inspection.activeWork.length);
      return false;
    },
  }, {
    inspect: async () => (n++ === 0 ? CLEAN_INSPECTION : DIRTY_INSPECTION),
    acquire: async () => ({ ok: true, lockId: 'l', owner: 'desktop-quit', generation: 3 }),
    release: async () => ({ ok: true, released: true }),
  });
  const result = await protection.coordinate('quit', { commit: async () => { committed = true; } });
  assert.equal(result.proceeded, false);
  assert.equal(result.code, 'cancelled');
  assert.equal(committed, false);
  assert.deepEqual(seen, [1]);
  // The lock is released so Host admissions are not frozen on cancel.
  assert.deepEqual(calls.map((c) => c.op), ['inspect', 'acquire', 'inspect', 'release']);
});

test('drain timeout blocks unattended commit (fail closed)', async () => {
  let committed = false;
  const { protection } = makeProtection({}, {
    acquire: async () => ({ ok: false, code: 'dshd/drain-timeout', pendingCount: 2 }),
  });
  const result = await protection.coordinate('update', { commit: async () => { committed = true; } });
  assert.equal(result.proceeded, false);
  assert.equal(result.code, 'dshd/drain-timeout');
  assert.equal(committed, false);
});

test('a throwing commit releases the Host lock', async () => {
  const { protection, calls } = makeProtection();
  await assert.rejects(protection.coordinate('stop', {
    commit: async () => { throw new Error('commit-boom'); },
  }), /commit-boom/);
  assert.deepEqual(calls.map((c) => c.op), ['inspect', 'acquire', 'inspect', 'release']);
});

test('concurrent operations get busy; a host-down run skips the lock', async () => {
  const { protection } = makeProtection({ hostDown: true });
  let committed = false;
  const result = await protection.coordinate('restart', { commit: async () => { committed = true; } });
  assert.equal(result.proceeded, true);
  assert.equal(committed, true);
});

test('terminal commits latch; follow-up coordinates run commit without re-inspecting', async () => {
  let commits = 0;
  const { protection, calls } = makeProtection();
  const first = await protection.coordinate('quit', { terminal: true, commit: async () => { commits++; } });
  assert.equal(first.proceeded, true);
  const before = calls.length;
  const second = await protection.coordinate('quit', { commit: async () => { commits++; } });
  assert.equal(second.proceeded, true);
  assert.equal(commits, 2);
  assert.equal(calls.length, before);
});

test('non-terminal commits release the lock after success', async () => {
  const { protection, calls } = makeProtection();
  const result = await protection.coordinate('stop', { commit: async () => {} });
  assert.equal(result.proceeded, true);
  assert.equal(calls.at(-1).op, 'release');
});

test('commit cleanups run on terminal ops only, never on stop/restart', async () => {
  let cleanups = 0;
  const { protection } = makeProtection();
  protection.onCommitCleanup(() => { cleanups++; });
  await protection.coordinate('stop', { commit: async () => {} });
  assert.equal(cleanups, 0);
  await protection.coordinate('quit', { terminal: true, commit: async () => {} });
  assert.equal(cleanups, 1);
});

test('inspectionClean treats unknown coverage as blocking', () => {
  assert.equal(inspectionClean(CLEAN_INSPECTION), true);
  assert.equal(inspectionClean({ ...CLEAN_INSPECTION, coverage: { jobs: 'unavailable' } }), false);
  assert.equal(inspectionClean({ ...CLEAN_INSPECTION, coverage: { bots: 'intentional-disabled' } }), true);
  assert.equal(inspectionClean(DIRTY_INSPECTION), false);
});

test('production quit skips confirmation while retaining inspect, lock, cleanup and shutdown', async () => {
  const fs = require('node:fs');
  const vm = require('node:vm');
  const source = fs.readFileSync(require('node:path').join(__dirname, 'index.js'), 'utf8');
  const start = source.indexOf('  async function finalizeQuit()');
  const end = source.indexOf("  app.on('window-all-closed'", start);
  assert.ok(start >= 0 && end > start);
  for (const failDrain of [false, true]) {
    const events = [];
    const { protection, calls } = makeProtection({
      inspection: DIRTY_INSPECTION,
      confirm: async () => { assert.fail('explicit quit must not ask again'); },
    }, failDrain ? { acquire: async () => ({ ok: false, code: 'dshd/drain-timeout' }) } : {});
    const quit = vm.runInNewContext(`${source.slice(start, end)}; finalizeQuit`, {
      taskProtection: protection, quitting: true, stoppingForQuit: false, closingOverlayActive: false,
      stopDesktopInstallControl: () => events.push('control-stop'),
      taskControlPeer: { stop: async () => events.push('peer-stop') },
      cleanupDesktopResources: async () => events.push('cleanup'),
      hideHarnessView: () => {}, getMainWindow: () => ({}), loadConfig: () => ({}),
      showClosingOverlay: async () => {}, harness: { shutdown: async () => events.push('shutdown') },
      app: { quit: () => events.push('quit'), exit: () => assert.fail('must not force exit') },
      firstVisibleWindow: () => null,
      confirmDialog: async () => { events.push('failure-notice'); return { response: 0 }; },
    });
    await quit();
    if (failDrain) {
      assert.deepEqual(events, ['failure-notice']);
      assert.deepEqual(calls.map(call => call.op), ['inspect', 'acquire']);
    } else {
      assert.deepEqual(events, ['control-stop', 'peer-stop', 'cleanup', 'shutdown', 'quit']);
      assert.deepEqual(calls.map(call => call.op), ['inspect', 'acquire', 'inspect']);
    }
  }
});
