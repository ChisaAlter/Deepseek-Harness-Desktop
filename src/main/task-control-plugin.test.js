'use strict';

// Unit coverage for the vendored dsh-task-control Host plugin. The plugin is
// ESM under vendor/, so the suite loads it through dynamic import and keeps
// every surface pure Node — no Electron, no cordis runtime.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { pathToFileURL } = require('url');

const PLUGIN = path.join(__dirname, '..', '..', 'vendor', 'dsh-task-control', 'lib');
const load = (file) => import(pathToFileURL(path.join(PLUGIN, file)).href);

test('admit accepts while unlocked and rejects while locked', async () => {
  const { createControlState, admit, acquireLock } = await load('state.js');
  const state = createControlState();
  const first = admit(state);
  assert.equal(first.accepted, true);
  const acquired = await acquireLock(state, { owner: 'desktop-quit', drainTimeoutMs: 50 });
  assert.equal(acquired.ok, false);
  assert.equal(acquired.code, 'dshd/drain-timeout');
  // Timed-out drain released the lock — admission works again.
  const second = admit(state);
  assert.equal(second.accepted, true);
});

test('acquire drains admitted work, then admits block with the locked code', async () => {
  const { createControlState, admit, acquireLock } = await load('state.js');
  const state = createControlState();
  const pending = admit(state);
  let released = false;
  const acquiring = acquireLock(state, { owner: 'desktop-quit', drainTimeoutMs: 2000 });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(state.lock !== null, true);
  const refused = admit(state);
  assert.equal(refused.accepted, false);
  assert.equal(refused.code, 'dshd/admission-locked');
  pending.done();
  released = true;
  const acquired = await acquiring;
  assert.equal(released, true);
  assert.equal(acquired.ok, true);
  assert.equal(acquired.drainedPending, 1);
});

test('release frees the lock; a superseded acquire is detected', async () => {
  const { createControlState, admit, acquireLock, releaseLock } = await load('state.js');
  const state = createControlState();
  // Hold a pending admission so owner-a's drain stays open while owner-b
  // cannot steal the lock — supersession comes from expiry, not takeover.
  const stuck = admit(state);
  const attempt = acquireLock(state, { owner: 'a', drainTimeoutMs: 1000, ttlMs: 30 });
  await new Promise((resolve) => setImmediate(resolve));
  const b = await acquireLock(state, { owner: 'b', drainTimeoutMs: 10 });
  assert.equal(b.ok, false);
  assert.equal(b.code, 'dshd/lock-held');
  // TTL expiry during the drain prunes the lock — a's acquire reports
  // superseded rather than committing against a stale generation.
  await new Promise((resolve) => setTimeout(resolve, 60));
  stuck.done();
  const result = await attempt;
  assert.equal(result.ok, false);
  assert.equal(result.code, 'dshd/lock-superseded');
  const rel = releaseLock(state, { lockId: 'anything', owner: 'a' });
  assert.equal(rel.ok, true);
  assert.equal(rel.released, false);
});

test('release requires matching lockId and owner', async () => {
  const { createControlState, acquireLock, releaseLock } = await load('state.js');
  const state = createControlState();
  const acquired = await acquireLock(state, { owner: 'desktop-quit' });
  assert.equal(acquired.ok, true);
  const wrong = releaseLock(state, { lockId: acquired.lockId, owner: 'other' });
  assert.equal(wrong.ok, false);
  assert.equal(wrong.code, 'dshd/lock-mismatch');
  const right = releaseLock(state, { lockId: acquired.lockId, owner: 'desktop-quit' });
  assert.equal(right.ok, true);
  assert.equal(right.released, true);
});

test('inspection aggregates agents, jobs, sockets, and pending requests', async () => {
  const { createControlState, admit } = await load('state.js');
  const { collectInspection } = await load('inspection.js');
  const state = createControlState();
  const ctx = {
    get: (name) => ({
      agents: {
        list: () => [
          { id: 'a1', status: 'running', inbox: { nextTurn: [], nextStep: [] } },
          { id: 'a2', status: 'idle', inbox: { nextTurn: ['msg'], nextStep: [] } },
        ],
      },
      jobs: {
        list: (owner) => (owner === 'a1'
          ? [{ id: 'j1', status: 'running' }]
          : owner === undefined
            ? [{ id: 'j0', status: 'queued' }]
            : []),
      },
      webServer: { upgradedSockets: new Set([{}]) },
      schedule: { catalog: async () => [
        { id: 's1', sessionId: 'a1', kind: 'every', title: '站会提醒', status: 'active', scheduledAt: new Date(Date.now() + 3600e3).toISOString() },
        { id: 's2', sessionId: 'a2', kind: 'at', title: '过期', status: 'active', scheduledAt: new Date(Date.now() - 60e3).toISOString() },
        { id: 's3', sessionId: 'a2', kind: 'at', title: '已停', status: 'inactive', scheduledAt: new Date().toISOString() },
      ] },
    })[name],
    waterfall: async () => [],
  };
  const pending = admit(state);
  const inspection = await collectInspection(ctx, state);
  assert.equal(inspection.ok, true);
  const kinds = inspection.activeWork.map((w) => `${w.kind}:${w.id}`);
  assert.ok(kinds.includes('agent:a1'));
  assert.ok(kinds.includes('agent:a2'));
  assert.ok(kinds.includes('job:j1'));
  assert.ok(kinds.includes('socket:upgraded-sockets'));
  assert.ok(kinds.includes('request:pending-requests'));
  // Queued (non-running) jobs do not count — upstream predicate.
  assert.ok(!kinds.includes('job:j0'));
  const scheduled = inspection.scheduledWork.map((w) => w.id);
  assert.deepEqual(scheduled.sort(), ['s1', 's2']);
  assert.equal(inspection.scheduledWork.find((w) => w.id === 's2').due, true);
  assert.equal(inspection.scheduledWork.find((w) => w.id === 's1').recurring, true);
  pending.done();
});

test('inspection reports missing producers as unavailable', async () => {
  const { createControlState } = await load('state.js');
  const { collectInspection } = await load('inspection.js');
  const state = createControlState();
  const inspection = await collectInspection({ get: () => undefined }, state);
  assert.equal(inspection.coverage.agents, 'unavailable');
  assert.equal(inspection.coverage.jobs, 'unavailable');
  // Schedule is a built-in of the web bundle: absent means runtime damage.
  assert.equal(inspection.coverage.schedule, 'unavailable');
});

function fakeRes() {
  const res = {
    status: 0,
    body: '',
    headersSent: false,
    writeHead(code) { res.status = code; res.headersSent = true; },
    end(payload) { res.body = payload || ''; },
    once() {},
    listeners: {},
  };
  return res;
}

test('control route gates on the bearer token and serves ops', async () => {
  const { createControlState } = await load('state.js');
  const { createControlHandler, CONTROL_PREFIX } = await load('http.js');
  const state = createControlState();
  const ctx = { get: () => undefined, emit: () => {} };
  const route = createControlHandler(ctx, state, { token: 'secret' });
  const reqOf = (op, body) => ({
    url: `${CONTROL_PREFIX}/${op}`,
    method: 'POST',
    headers: { authorization: 'Bearer secret' },
    on(event, fn) { if (event === 'end') setImmediate(fn); if (event === 'data') return; },
    // emulate readable: emit 'end' after zero chunks
    [Symbol.asyncIterator]: undefined,
    destroy() {},
    resume() {},
  });
  const unauth = { url: `${CONTROL_PREFIX}/status`, method: 'POST', headers: {} };
  const res1 = fakeRes();
  await route(unauth, res1);
  assert.equal(res1.status, 401);
});

test('gated http handler returns 503 while locked and drains on finish', async () => {
  const { createControlState, admit, acquireLock, releaseLock } = await load('state.js');
  const { wrapWebServer, internals } = await load('wrap.js');
  const state = createControlState();
  const calls = [];
  const webServer = {
    prefixes: new Map(),
    exact: new Map(),
    upgrades: new Map(),
    register(route) {
      (route.kind === 'exact' ? this.exact : this.prefixes).set(route.path, route);
      return () => {};
    },
    registerUpgrade(route) { this.upgrades.set(route.path, route); return () => {}; },
    registerFallback(handler) { this.fallback = handler; return () => {}; },
  };
  assert.equal(wrapWebServer(state, webServer), true);
  // Second wrap is a no-op.
  assert.equal(wrapWebServer(state, webServer), false);
  webServer.register({ kind: 'exact', path: '/api/x', handler: async (_req, res) => res.end('ok') });
  webServer.registerUpgrade({ path: '/ws', handler: () => {} });
  webServer.registerFallback(async (_req, res) => res.end('spa'));

  const acquired = await acquireLock(state, { owner: 'desktop-quit' });
  assert.equal(acquired.ok, true);

  const res = fakeRes();
  await webServer.exact.get('/api/x').handler({}, res);
  assert.equal(res.status, 503);
  assert.ok(res.body.includes('dshd/admission-locked'));

  const socket = { written: '', write(s) { socket.written += s; }, destroy() { socket.destroyed = true; }, once() {} };
  webServer.upgrades.get('/ws').handler({ url: '/ws' }, socket, Buffer.alloc(0));
  assert.ok(socket.written.includes('503'));
  assert.equal(socket.destroyed, true);

  // Read fallback stays open — a locked Host must not white-out the window.
  const getRes = fakeRes();
  await webServer.fallback({ method: 'GET' }, getRes);
  assert.equal(getRes.body, 'spa');
  const postRes = fakeRes();
  await webServer.fallback({ method: 'POST' }, postRes);
  assert.equal(postRes.status, 503);

  releaseLock(state, { lockId: acquired.lockId, owner: 'desktop-quit' });
  const ok = fakeRes();
  await webServer.exact.get('/api/x').handler({}, ok);
  assert.equal(ok.body, 'ok');
  assert.ok(calls.length === 0);
});

test('resolveAgent and jobs.start refuse while locked', async () => {
  const { createControlState, acquireLock } = await load('state.js');
  const { wrapSessionController, wrapJobs, AdmissionLockedError } = await load('wrap.js');
  const state = createControlState();
  const controller = { resolveAgent: async (id) => ({ agent: id }) };
  const jobs = { start: async (spec) => ({ job: spec }) };
  assert.equal(wrapSessionController(state, controller), true);
  assert.equal(wrapJobs(state, jobs), true);
  const acquired = await acquireLock(state, { owner: 'desktop-quit' });
  assert.equal(acquired.ok, true);
  const resolved = await controller.resolveAgent('s1');
  assert.ok(resolved.error instanceof AdmissionLockedError);
  assert.equal(resolved.error.code, 'session/agent-busy');
  await assert.rejects(jobs.start({}), AdmissionLockedError);
});
