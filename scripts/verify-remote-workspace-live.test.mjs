import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const here = path.dirname(fileURLToPath(import.meta.url));
const script = path.join(here, 'verify-remote-workspace-live.cjs');
const {
  makeRemoteFixturePaths,
  requestJson,
  reservePort,
  waitForUrl,
} = require('./lib/remote-workspace-live-guard.cjs');
const { main, runLive } = require('./verify-remote-workspace-live.cjs');

/**
 * Every test gets its own HOME under the OS temp dir, removed as soon as the
 * test ends. A fixed shared path (e.g. `C:\fake-home`) would let a stubbed run
 * really write profile files onto the developer machine.
 */
function tempHome(t) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'dshr-live-home-'));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  return home;
}

function childStub() {
  const child = new EventEmitter();
  child.exitCode = null;
  child.signalCode = null;
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.kill = (signal) => {
    child.killedWith = signal;
    child.signalCode = signal;
    child.exitCode = 0;
    child.emit('exit', 0, signal);
    return true;
  };
  return child;
}

/**
 * Method-aware stand-in for the vendored plugin. It mirrors the real contract
 * instead of being permissive:
 *   - mutating routes reject a GET with 405 (vendor/dsh-remote/lib/index.js
 *     :2081 machines, :1969 mirror, :2201 test-connect, :2259 current,
 *     :2388 home; vendor/dsh-remote/lib/routes-fs.js:120 write, :148 fs),
 *   - `/mirror` requires the remote directory to already exist (index.js:1975),
 *   - `/current { id: '' }` clears the active host, after which remote work is
 *     refused (index.js:384-401 / :406, binding.js:664-699).
 */
const PRODUCT_ROUTE_METHODS = Object.freeze({
  '/dsh-remote/audit': 'GET',
  '/dsh-remote/current': 'POST',
  '/dsh-remote/fs': 'POST',
  '/dsh-remote/home': 'POST',
  '/dsh-remote/ls': 'GET',
  '/dsh-remote/machines': 'POST|GET',
  '/dsh-remote/mirror': 'POST',
  '/dsh-remote/read': 'GET|POST',
  '/dsh-remote/resolve-mirror': 'GET',
  '/dsh-remote/status': 'GET',
  '/dsh-remote/test-connect': 'POST',
  '/dsh-remote/write': 'POST',
});

function createPlugin({
  home = '/home/test',
  failMirror = false,
  failCleanup = false,
  localMirrorRoot = null,
  cleanupResponses = {},
} = {}) {
  const state = {
    dirs: new Set(),
    current: '',
    machines: new Set(),
    mirrorPath: '',
    removed: [],
    responses: [],
  };
  const bound = () => !!state.current;
  const noHost = () => ({ status: 400, json: { ok: false, error: 'no remote host configured/connected' }, text: '' });

  const respond = ({ method, route, body }) => {
    const pathname = route.split('?')[0];
    const expectedMethods = PRODUCT_ROUTE_METHODS[pathname];
    if (!expectedMethods) {
      return { status: 404, json: { ok: false, error: `unexpected route: ${pathname}` }, text: '' };
    }
    if (!expectedMethods.split('|').includes(method)) {
      return { status: 405, json: { ok: false, error: 'method not allowed' }, text: `${method} not allowed` };
    }

    if (pathname === '/dsh-remote/machines') {
      if (method === 'GET') return { status: 200, json: { machines: [], currentId: state.current || null }, text: '' };
      if (body.action === 'add') {
        state.machines.add('machine-1');
        return { status: 200, json: { ok: true, id: 'machine-1', machine: { id: 'machine-1' } }, text: '' };
      }
      if (body.action === 'delete') {
        if (cleanupResponses.machineDelete) return cleanupResponses.machineDelete;
        if (!state.machines.has(body.id)) return { status: 404, json: { ok: false, error: 'machine not found' }, text: '' };
        state.machines.delete(body.id);
        if (state.current === body.id) state.current = '';
        return { status: 200, json: { ok: true, machines: [], currentId: null }, text: '' };
      }
      return { status: 400, json: { ok: false, error: 'unknown action' }, text: '' };
    }
    if (pathname === '/dsh-remote/test-connect') {
      return { status: 200, json: { ok: true, latencyMs: 1, platform: 'posix' }, text: '' };
    }
    if (pathname === '/dsh-remote/current') {
      const nextCurrent = body && body.id ? String(body.id) : '';
      if (!nextCurrent && cleanupResponses.machineDeselect) return cleanupResponses.machineDeselect;
      state.current = nextCurrent;
      if (!state.current) state.mirrorPath = '';
      return { status: 200, json: { ok: true, currentId: state.current || null }, text: '' };
    }
    if (pathname === '/dsh-remote/status') {
      // `clearActiveMachine()` blanks config.host and unbinds the pool.
      return { status: 200, json: { host: state.current ? 'example.test' : '', connected: bound() }, text: '' };
    }
    if (pathname === '/dsh-remote/home') {
      if (!bound()) return noHost();
      return { status: 200, json: { ok: true, home }, text: '' };
    }
    if (pathname === '/dsh-remote/ls') {
      if (!bound()) return noHost();
      return { status: 200, json: { ok: true, items: [] }, text: '' };
    }
    if (pathname === '/dsh-remote/fs') {
      if (!bound()) return noHost();
      if (body.op === 'mkdir') {
        state.dirs.add(body.path);
        return { status: 200, json: { ok: true }, text: '' };
      }
      if (body.op === 'remove') {
        if (cleanupResponses.fixtureRemove) return cleanupResponses.fixtureRemove;
        if (failCleanup) return { status: 500, json: { ok: false, error: 'cleanup failure' }, text: 'cleanup failure' };
        state.removed.push(body.path);
        state.dirs.forEach((dir) => {
          if (dir === body.path || dir.startsWith(body.path + '/')) state.dirs.delete(dir);
        });
        return { status: 200, json: { ok: true }, text: '' };
      }
      return { status: 400, json: { ok: false, error: 'unknown op' }, text: '' };
    }
    if (pathname === '/dsh-remote/write') {
      if (!bound()) return noHost();
      // Optimistic-lock conflict: a stale mtime is a 409, never a silent write.
      if (body.content === 'x' || (body.expectedMtime != null && body.expectedMtime < 0)) {
        return { status: 409, json: { ok: false, error: 'stale mtime' }, text: '' };
      }
      return { status: 200, json: { ok: true, mtime: 1 }, text: '' };
    }
    if (pathname === '/dsh-remote/read') {
      if (!bound()) return noHost();
      // GET reads `path` from the QUERY; POST reads it from the BODY
      // (routes-fs.js:77-89). The source is decided by the method alone, so a
      // run that guesses wrong really fails instead of passing by accident.
      let readPath = '';
      if (method === 'GET') {
        const query = route.split('?')[1] || '';
        readPath = decodeURIComponent((query.match(/path=([^&]*)/) || [])[1] || '');
      } else {
        readPath = String((body && body.path) || '');
      }
      if (!readPath) {
        return { status: 400, json: { ok: false, error: 'path is required' }, text: '' };
      }
      return { status: 200, json: { ok: true, content: 'acceptance' }, text: '' };
    }
    if (pathname === '/dsh-remote/mirror') {
      if (!bound()) return noHost();
      // `isRemoteDir()` — a missing target is refused with 400.
      if (!state.dirs.has(body.path)) {
        return { status: 400, json: { ok: false, error: `not a directory (or unreachable): ${body.path}` }, text: '' };
      }
      if (failMirror) return { status: 500, json: { ok: false, error: 'mid-run boom' }, text: 'mid-run boom' };
      state.mirrorPath = body.path;
      // `ensureMirror()` writes the local mirror dir plus its meta file. Each
      // call gets its own subdirectory, exactly like a per-remote-path mirror.
      let localMirrorDir = '';
      if (localMirrorRoot) {
        localMirrorDir = path.join(localMirrorRoot, `mirror-${state.responses.length}`);
        fs.mkdirSync(localMirrorDir, { recursive: true });
        fs.writeFileSync(
          path.join(localMirrorDir, '.dsh-remote-meta.json'),
          JSON.stringify({ host: 'example.test', username: 'root', port: 22, remotePath: body.path }),
        );
      }
      return { status: 200, json: { ok: true, path: body.path, localMirror: localMirrorDir }, text: '' };
    }
    if (pathname === '/dsh-remote/resolve-mirror') {
      // Realized from the mirror's own `.dsh-remote-meta.json`, so concurrent
      // runs cannot read each other's binding (binding.js:45-87).
      const query = route.split('?')[1] || '';
      const local = decodeURIComponent((query.match(/local=([^&]*)/) || [])[1] || '');
      let remotePath = '';
      let machine = null;
      try {
        const meta = JSON.parse(fs.readFileSync(path.join(local, '.dsh-remote-meta.json'), 'utf8'));
        remotePath = String(meta.remotePath || '');
        machine = { host: meta.host, username: meta.username, port: meta.port };
      } catch { /* no usable meta → no binding */ }
      return { status: 200, json: { remotePath, machine }, text: '' };
    }
    if (pathname === '/dsh-remote/audit') {
      return { status: 200, json: { ok: true, lines: ['audit'] }, text: '' };
    }
    return { status: 404, json: { ok: false, error: `unimplemented fixture route: ${pathname}` }, text: '' };
  };

  const request = (base, cookie, method, route, body) => {
    const response = respond({ method, route, body });
    state.responses.push({ method, route: route.split('?')[0], body, status: response.status });
    return response;
  };

  return { state, request, respond };
}

function config(overrides = {}) {
  return {
    host: 'example.test',
    user: 'root',
    port: 22,
    key: 'key.pem',
    password: '',
    lsPath: '/srv',
    mirrorPath: '',
    missing: [],
    requireLive: false,
    timeouts: {
      requestMs: 60,
      bodyMs: 60,
      runMs: 400,
      cleanupMs: 80,
      childExitMs: 30,
    },
    ...overrides,
  };
}

/**
 * Run `runLive` against a stubbed runtime. `overrides` must only close over
 * bindings that already exist: a callback referencing a binding from the
 * not-yet-resolved result would throw inside production cleanup, where the
 * error is deliberately swallowed.
 */
async function runWithApi(t, plugin, overrides = {}) {
  const requests = [];
  const runtime = {
    resolveConfig: () => {
      throw new Error('resolveConfig should not be called by runLive');
    },
    makeHome: () => tempHome(t),
    removeHome: (home) => fs.rmSync(home, { recursive: true, force: true }),
    reservePort: async () => 43123,
    spawnChild: () => childStub(),
    waitForUrl: async () => 'http://127.0.0.1:43123/?token=one',
    establishSession: async () => ({ ok: true, cookie: 'session=cookie' }),
    request: async (base, cookie, method, route, body, options) => {
      requests.push({ base, cookie, method, route, body, options });
      return plugin.request(base, cookie, method, route, body, options);
    },
    stopChild: async () => {},
    ensureRemote: () => ({ ok: true, overlayFile: 'overlay.yml', added: [] }),
    probeReady: async () => ({ ok: true, cookie: 'session=cookie' }),
    error: () => {},
    log: () => {},
    exitCode: () => {},
    ...overrides,
  };
  const result = await runLive({ runtime: { ...runtime, config: config() } });
  return { result, requests };
}

const routeOf = (request) => request.route.split('?')[0];
const callsTo = (requests, route) => requests.filter((request) => routeOf(request) === route);

test('CLI soft-skips with exit 0 and --require-live exits 2 without SSH env', () => {
  assert.equal(typeof main, 'function', 'the script must stay import-safe');
  const cleanEnv = { ...process.env };
  for (const key of ['DSHR_TEST_HOST', 'DSHR_TEST_KEY', 'DSHR_TEST_PASSWORD']) delete cleanEnv[key];

  const optional = spawnSync(process.execPath, [script], { env: cleanEnv, encoding: 'utf8' });
  assert.equal(optional.status, 0, optional.stderr);
  assert.match(optional.stdout, /NOT RUN \(not PASS\)/);

  const required = spawnSync(process.execPath, [script, '--require-live'], { env: cleanEnv, encoding: 'utf8' });
  assert.equal(required.status, 2, required.stderr);
  assert.match(required.stderr, /--require-live is set/);
});

test('reservePort returns an unoccupied port and rejects an occupied one cleanly', async () => {
  const held = net.createServer();
  await new Promise((resolve) => held.listen(0, '127.0.0.1', resolve));
  const heldPort = held.address().port;
  const allocated = await reservePort('127.0.0.1');
  assert.ok(allocated > 0);
  assert.notEqual(allocated, heldPort, 'allocator must not reuse the occupied port');

  const first = net.createServer();
  await new Promise((resolve) => first.listen(allocated, '127.0.0.1', resolve));
  const second = net.createServer();
  await assert.rejects(
    new Promise((resolve, reject) => {
      second.once('error', reject);
      second.listen(allocated, '127.0.0.1', resolve);
    }),
    /EADDRINUSE|address already in use/i,
  );
  await new Promise((resolve) => first.close(resolve));
  await new Promise((resolve) => held.close(resolve));
});

test('requestJson aborts a stalled request and a stalled body', async () => {
  let requestAborted = false;
  await assert.rejects(
    () => requestJson('http://127.0.0.1:1', 'session=cookie', 'GET', '/stall', undefined, {
      requestMs: 20,
      bodyMs: 20,
      fetchImpl: (_url, options) => new Promise((_resolve, reject) => {
        options.signal.addEventListener('abort', () => {
          requestAborted = true;
          reject(options.signal.reason);
        }, { once: true });
      }),
    }),
    /timed out/,
  );
  assert.equal(requestAborted, true);

  let bodyCancelled = false;
  const body = new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode('{"partial":'));
    },
    cancel() {
      bodyCancelled = true;
    },
  });
  await assert.rejects(
    () => requestJson('http://127.0.0.1:1', 'session=cookie', 'GET', '/stall-body', undefined, {
      requestMs: 100,
      bodyMs: 20,
      fetchImpl: async () => new Response(body, { status: 200 }),
    }),
    /timed out/,
  );
  assert.equal(bodyCancelled, true);
});

test('waitForUrl rejects spawn errors, early exits, and a cancelled run', async () => {
  const spawnError = childStub();
  const spawnResult = waitForUrl(spawnError, { timeoutMs: 100 });
  spawnError.emit('error', new Error('spawn failed'));
  await assert.rejects(spawnResult, /spawn error: spawn failed/);

  const earlyExit = childStub();
  const exitResult = waitForUrl(earlyExit, { timeoutMs: 100 });
  earlyExit.emit('exit', 7, null);
  await assert.rejects(exitResult, /exited before printing a URL.*code=7/);

  const controller = new AbortController();
  const cancelled = waitForUrl(childStub(), { timeoutMs: 5000, signal: controller.signal });
  controller.abort(new Error('live run exceeded its budget'));
  await assert.rejects(cancelled, /exceeded its budget/);
});

test('remote fixtures are unique per run and mirror the directory the run creates', () => {
  const first = makeRemoteFixturePaths('/home/test', 'run-one');
  const second = makeRemoteFixturePaths('/home/test', 'run-two');
  assert.match(first.root, /^\/home\/test\/\.dshr-live-run-one$/);
  assert.notEqual(first.root, second.root);
  assert.match(first.fileName, /^\/home\/test\/\.dshr-live-run-one\/fixture\.txt$/);
  // `/mirror` refuses a missing directory, so the mirrored path must be the one
  // the run created — never a sibling name.
  assert.equal(first.mirrorName, first.dirName);
  assert.match(first.dirName, /^\/home\/test\/\.dshr-live-run-one\/mirror$/);
});

test('full success path uses the documented HTTP methods and tears down in order', async (t) => {
  const plugin = createPlugin({ localMirrorRoot: path.join(tempHome(t), 'mirrors') });
  const teardown = [];
  const { result, requests } = await runWithApi(t, plugin, {
    stopChild: async () => teardown.push('stopChild'),
    removeHome: (home) => {
      teardown.push('removeHome');
      fs.rmSync(home, { recursive: true, force: true });
    },
  });

  assert.equal(result.ok, true, result.error ? result.error.message : 'expected ok');
  assert.equal(result.cleanupError, null);

  // Every request must use the method the vendored route documents, and none
  // may be answered with 405.
  for (let index = 0; index < requests.length; index++) {
    const request = requests[index];
    const expected = PRODUCT_ROUTE_METHODS[routeOf(request)];
    assert.ok(expected, `${routeOf(request)} must be a known product route`);
    assert.ok(
      expected.split('|').includes(request.method),
      `${routeOf(request)} must accept ${expected}, got ${request.method}`,
    );
    assert.notEqual(plugin.state.responses[index].status, 405, `${routeOf(request)} hit a 405`);
  }
  assert.equal(PRODUCT_ROUTE_METHODS['/dsh-remote/home'], 'POST');
  assert.equal(PRODUCT_ROUTE_METHODS['/dsh-remote/current'], 'POST');
  assert.equal(PRODUCT_ROUTE_METHODS['/dsh-remote/machines'], 'POST|GET');
  assert.equal(PRODUCT_ROUTE_METHODS['/dsh-remote/mirror'], 'POST');
  assert.equal(callsTo(requests, '/dsh-remote/home').length, 1);

  // The mirrored target is the directory the run created, inside its own root.
  const fixtureRoot = result.fixture.root;
  const fixtureDir = result.fixture.mirrorTarget;
  assert.ok(fixtureDir.startsWith(fixtureRoot + '/'), 'mirror target must live inside the fixture root');
  assert.deepEqual(callsTo(requests, '/dsh-remote/mirror').map((r) => r.body.path), [
    fixtureRoot + '/does-not-exist',
    fixtureDir,
  ]);
  assert.deepEqual(plugin.state.removed, [fixtureRoot]);
  assert.equal(plugin.state.dirs.size, 0, 'no fixture directory may survive the run');
  assert.deepEqual(
    plugin.state.responses.filter((r) => r.route === '/dsh-remote/mirror').map((r) => r.status),
    [400, 200],
    'a missing mirror target is refused, a created one succeeds',
  );

  // Cleanup precedes deselect, and deselect precedes the machine delete.
  const removeIndex = requests.findIndex((r) => routeOf(r) === '/dsh-remote/fs' && r.body.op === 'remove');
  const deselectIndex = requests.findIndex((r) => routeOf(r) === '/dsh-remote/current' && r.body.id === '');
  const deleteIndex = requests.findIndex((r) => routeOf(r) === '/dsh-remote/machines' && r.body.action === 'delete');
  assert.ok(removeIndex >= 0 && removeIndex < deselectIndex, 'remote cleanup must precede deselect');
  assert.ok(deselectIndex < deleteIndex, 'deselect must precede machine delete');

  // After deselect nothing but the registry delete may be accepted: /status
  // reports no host, and the probe operation used to prove it is refused.
  for (let index = deselectIndex + 1; index < requests.length; index++) {
    const request = requests[index];
    if (routeOf(request) === '/dsh-remote/machines') continue;
    if (routeOf(request) === '/dsh-remote/status') {
      assert.equal(plugin.state.responses[index].status, 200);
      continue;
    }
    assert.notEqual(plugin.state.responses[index].status, 200, `${routeOf(request)} succeeded after deselect`);
  }

  assert.deepEqual(result.teardownOrder, [
    'remote-fixture-cleanup',
    'machine-deselect',
    'post-deselect-remote-op',
    'machine-delete',
    'stopChild',
    'removeHome',
  ]);
  assert.deepEqual(teardown, ['stopChild', 'removeHome']);
  assert.equal(result.homePreserved, false);
  assert.equal(fs.existsSync(result.home), false, 'the temp HOME must be removed on success');
});

test('fixture rejects GET /dsh-remote/home and unknown routes without a generic success', () => {
  const plugin = createPlugin();

  const getHome = plugin.respond({ method: 'GET', route: '/dsh-remote/home' });
  assert.equal(getHome.status, 405);
  assert.equal(getHome.json.ok, false);

  const unknown = plugin.respond({ method: 'POST', route: '/dsh-remote/not-a-product-route', body: {} });
  assert.equal(unknown.status, 404);
  assert.equal(unknown.json.ok, false);
});

test('mid-run failure cleans the fixture before stopping the child and removing HOME', async (t) => {
  const plugin = createPlugin({ failMirror: true });
  const order = [];
  const { result, requests } = await runWithApi(t, plugin, {
    stopChild: async () => order.push('stopChild'),
    removeHome: () => order.push('removeHome'),
  });

  assert.equal(result.ok, false);
  assert.ok(result.error);
  // The real failure is the mirror POST itself (500), reached only because the
  // missing-directory probe was correctly refused with 400 first.
  assert.match(result.error.message, /check failed: mirror owned fixture dir/);
  assert.deepEqual(
    plugin.state.responses.filter((r) => r.route === '/dsh-remote/mirror').map((r) => r.status),
    [400, 500],
  );
  assert.deepEqual(result.teardownOrder, [
    'remote-fixture-cleanup',
    'machine-deselect',
    'post-deselect-remote-op',
    'machine-delete',
    'stopChild',
    'removeHome',
  ]);
  assert.deepEqual(order, ['stopChild', 'removeHome']);
  assert.equal(plugin.state.dirs.size, 0, 'the fixture must not be left behind');
  assert.equal(plugin.state.machines.size, 0, 'the temporary machine must be deleted');
  assert.equal(requests.some((r) => r.body && r.body.op === 'remove'), true);

  // The conflict probe must exercise the 409 path rather than a plain success.
  assert.ok(
    plugin.state.responses.some((r) => r.route === '/dsh-remote/write' && r.status === 409),
    'the stale-mtime write must be answered with 409',
  );
});

test('cleanup failure is reported separately and preserves the original failure', async (t) => {
  const plugin = createPlugin({ failMirror: true, failCleanup: true });
  const { result } = await runWithApi(t, plugin);

  assert.equal(result.ok, false);
  assert.match(result.error.message, /check failed: mirror owned fixture dir/);
  assert.match(result.cleanupError.message, /remote fixture cleanup failed/);
  assert.equal(result.homePreserved, false);
});

const CLEANUP_FAILURE_TARGETS = [
  {
    kind: 'fixtureRemove',
    error: /remote fixture cleanup failed/,
    ledger: 'remote-fixture-cleanup',
  },
  {
    kind: 'machineDeselect',
    error: /machine deselect failed/,
    ledger: 'machine-deselect',
  },
  {
    kind: 'machineDelete',
    error: /machine delete failed/,
    ledger: 'machine-delete',
  },
];

async function assertCleanupRejected(t, target, response) {
  const logs = [];
  const plugin = createPlugin({
    cleanupResponses: { [target.kind]: response },
  });
  const { result } = await runWithApi(t, plugin, {
    log: (message) => logs.push(message),
  });

  assert.equal(result.ok, false);
  assert.ok(result.cleanupError, 'cleanup failure must be reported');
  assert.match(result.cleanupError.message, target.error);
  assert.match(result.cleanupError.message, /HTTP 200/);
  assert.equal(result.teardownOrder.includes(target.ledger), false, `${target.ledger} must not be recorded`);
  if (target.kind === 'fixtureRemove') {
    assert.deepEqual(plugin.state.removed, [], 'the invalid removal must not be declared successful');
    assert.equal(logs.some((line) => /remote cleanup: removed/.test(line)), false);
  }
}

for (const target of CLEANUP_FAILURE_TARGETS) {
  test(`HTTP 200 with ok:false is a cleanup failure for ${target.kind}`, async (t) => {
    await assertCleanupRejected(t, target, {
      status: 200,
      json: { ok: false, error: 'cleanup refused' },
      text: '',
    });
  });
}

const INVALID_SUCCESS_PAYLOADS = [
  {
    name: 'missing JSON',
    response: { status: 200, json: null, text: '' },
  },
  {
    name: 'malformed JSON',
    response: { status: 200, json: null, text: '{"ok":' },
  },
];

for (const target of CLEANUP_FAILURE_TARGETS) {
  for (const payload of INVALID_SUCCESS_PAYLOADS) {
    test(`HTTP 200 with ${payload.name} is a cleanup failure for ${target.kind}`, async (t) => {
      await assertCleanupRejected(t, target, payload.response);
    });
  }
}

test('a stopChild failure preserves the temp HOME and reports its location', async (t) => {
  const plugin = createPlugin();
  const { result } = await runWithApi(t, plugin, {
    stopChild: async () => {
      throw new Error('harness child did not exit');
    },
  });

  assert.equal(result.ok, false);
  assert.match(result.cleanupError.message, /did not exit/);
  assert.equal(result.homePreserved, true);
  assert.ok(result.home, 'the preserved HOME path must be reported');
  assert.equal(result.teardownOrder.includes('removeHome'), false, 'HOME must not be removed while the child may live');
  assert.equal(plugin.state.dirs.size, 0, 'the remote fixture is still cleaned up first');
});

test('concurrent runs use distinct fixture roots and never remove a shared path', async (t) => {
  const roots = [];
  const removed = [];
  // Each run drives its own harness process, so each gets its own registry;
  // only the local temp dirs and the recorded fixture paths are shared.
  const makeTracked = (index) => {
    const plugin = createPlugin({ localMirrorRoot: path.join(tempHome(t), `mirrors-${index}`) });
    return {
      request: (base, cookie, method, route, body, options) => {
        const pathname = route.split('?')[0];
        if (pathname === '/dsh-remote/fs' && body && body.op === 'mkdir') roots.push(body.path);
        if (pathname === '/dsh-remote/fs' && body && body.op === 'remove') removed.push(body.path);
        return plugin.request(base, cookie, method, route, body, options);
      },
    };
  };
  const [first, second] = await Promise.all([
    runWithApi(t, makeTracked(0)),
    runWithApi(t, makeTracked(1)),
  ]);

  assert.equal(first.result.ok, true, first.result.error ? first.result.error.message : 'first run');
  assert.equal(second.result.ok, true, second.result.error ? second.result.error.message : 'second run');
  // Each run creates its own root plus its mirror directory.
  assert.equal(roots.length, 4);
  assert.equal(new Set(roots).size, 4);
  assert.equal(roots.some((root) => root === '/tmp/dshr-live-dir'), false);
  assert.equal(removed.length, 2, 'each run removes its own fixture root');
  assert.equal(new Set(removed).size, 2);
  assert.equal(
    removed.every((root) => roots.some((candidate) => candidate.startsWith(root + '/'))),
    true,
    'a run may only remove the root it created',
  );
});
