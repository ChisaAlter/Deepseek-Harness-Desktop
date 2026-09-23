import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const {
  assertInsideRoot,
  establishLiveSession,
  joinRemotePath,
  makeRemoteFixturePaths,
  notRunMessage,
  requireReadySession,
  resolveLiveConfig,
  waitForUrl,
} = require('./lib/remote-workspace-live-guard.cjs');
const { probeHarnessReady } = require('../src/main/harness-browser-auth.js');

/** Fresh throwaway HOME per test; nothing here may touch a fixed shared path. */
function makeTempHome(t) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'dshr-guard-home-'));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  return home;
}

test('deadlineSignal keeps the event loop alive with no other referenced handle', async () => {
  // Regression: `deadlineSignal` used to call `timer.unref()`. The timeout is
  // the only thing that can settle a stalled operation, so on Node 22 the event
  // loop drained first, `node:test` cancelled the pending test, and 17 later
  // cases were cancelled with it. This runs the real helper in a child process
  // that holds no unrelated timer, socket, or interval; the parent watchdog
  // fails the test if the deadline never fires.
  const guardPath = path.join(
    path.dirname(fileURLToPath(import.meta.url)),
    'lib',
    'remote-workspace-live-guard.cjs',
  );
  const script = [
    "const { deadlineSignal } = require(process.argv[1]);",
    'const deadline = deadlineSignal(undefined, 25);',
    'const started = Date.now();',
    // No timer, socket, interval, or pending promise here: the deadline is the
    // only referenced handle, so an unref() regression drains the loop instead.
    'deadline.signal.addEventListener("abort", () => {',
    '  const name = deadline.timeoutError() && deadline.timeoutError().name;',
    '  process.stdout.write(JSON.stringify({ aborted: true, name, elapsed: Date.now() - started }) + "\\n");',
    '  deadline.clear();',
    '  process.exit(0);',
    '}, { once: true });',
  ].join('\n');

  const child = spawn(process.execPath, ['-e', script, guardPath], {
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (chunk) => { stdout += String(chunk); });
  child.stderr.on('data', (chunk) => { stderr += String(chunk); });

  // Parent-side watchdog: if the deadline does not keep its own process alive,
  // the child reports nothing and hangs/exits early; either way this rejects.
  const outcome = await new Promise((resolve) => {
    const watchdog = setTimeout(() => {
      try { child.kill('SIGKILL'); } catch { /* already gone */ }
      resolve({ timedOut: true });
    }, 15_000);
    child.once('error', (error) => {
      clearTimeout(watchdog);
      resolve({ error });
    });
    child.once('exit', (code, signal) => {
      clearTimeout(watchdog);
      resolve({ code, signal });
    });
  });

  assert.equal(outcome.timedOut, undefined, `deadline never fired; stderr=${stderr}`);
  assert.equal(outcome.error, undefined, `child failed to spawn: ${outcome.error && outcome.error.message}`);
  assert.equal(outcome.code, 0, `child exited code=${outcome.code} signal=${outcome.signal} stderr=${stderr}`);
  const lastLine = stdout.trim().split('\n').pop();
  assert.ok(
    lastLine,
    `child produced no completion marker; the deadline never kept the loop alive (code=${outcome.code}, stderr=${stderr})`,
  );
  const report = JSON.parse(lastLine);
  assert.equal(report.aborted, true);
  assert.equal(report.name, 'TimeoutError');
  assert.ok(report.elapsed >= 20, `deadline fired too early: ${report.elapsed}ms`);
});

test('resolveLiveConfig covers the required SSH config matrix', () => {
  const absent = resolveLiveConfig({}, []);
  assert.deepEqual(absent.missing, ['DSHR_TEST_HOST', 'DSHR_TEST_KEY or DSHR_TEST_PASSWORD']);
  assert.equal(absent.requireLive, false);

  const hostOnly = resolveLiveConfig({ DSHR_TEST_HOST: 'example.test' }, []);
  assert.deepEqual(hostOnly.missing, ['DSHR_TEST_KEY or DSHR_TEST_PASSWORD']);

  const authOnly = resolveLiveConfig({ DSHR_TEST_KEY: 'key.pem' }, []);
  assert.deepEqual(authOnly.missing, ['DSHR_TEST_HOST']);

  const keyConfig = resolveLiveConfig({ DSHR_TEST_HOST: 'example.test', DSHR_TEST_KEY: 'key.pem' }, []);
  assert.deepEqual(keyConfig.missing, []);
  assert.equal(keyConfig.user, 'root');
  assert.equal(keyConfig.port, 22);
  assert.equal(keyConfig.lsPath, '/root');
  // Mirroring must stay inside the run-owned fixture root, so an unset
  // DSHR_TEST_MIRROR_PATH must not inherit the read-only ls path.
  assert.equal(keyConfig.mirrorPath, '');

  // ...even when the read-only listing is pointed somewhere else entirely.
  const lsOnly = resolveLiveConfig({
    DSHR_TEST_HOST: 'example.test',
    DSHR_TEST_KEY: 'key.pem',
    DSHR_TEST_LS_PATH: '/var/log',
  }, []);
  assert.equal(lsOnly.lsPath, '/var/log');
  assert.equal(lsOnly.mirrorPath, '');

  const passwordConfig = resolveLiveConfig({
    DSHR_TEST_HOST: 'example.test',
    DSHR_TEST_PASSWORD: 'secret',
    DSHR_TEST_PORT: '2222',
    DSHR_TEST_LS_PATH: '/srv',
    DSHR_TEST_MIRROR_PATH: '/mirror',
  }, ['--require-live']);
  assert.deepEqual(passwordConfig.missing, []);
  assert.equal(passwordConfig.requireLive, true);
  assert.equal(passwordConfig.port, 2222);
  assert.equal(passwordConfig.lsPath, '/srv');
  assert.equal(passwordConfig.mirrorPath, '/mirror');
});

test('requireReadySession rejects ok:false and an empty cookie', () => {
  assert.throws(() => requireReadySession({ ok: false, cookie: 'session=one' }), /ok=true/);
  assert.throws(() => requireReadySession({ ok: true, cookie: '' }), /non-empty cookie/);
  assert.throws(() => requireReadySession(null), /ok=true/);
  assert.deepEqual(
    requireReadySession({ ok: true, cookie: 'session=one' }),
    { ok: true, cookie: 'session=one' },
  );
});

test('one-shot token fixture redeems exactly once and reuses the probe cookie', async () => {
  let tokenRequests = 0;
  let authenticatedRequests = 0;
  const fetchImpl = async (rawUrl, options = {}) => {
    const url = new URL(String(rawUrl));
    if (url.searchParams.has('token')) {
      tokenRequests++;
      if (tokenRequests !== 1) throw new Error('launch token was redeemed more than once');
      return new Response(null, {
        status: 303,
        headers: { 'set-cookie': 'dsh_session=one-shot; Path=/; HttpOnly' },
      });
    }
    if (options.headers?.Cookie === 'dsh_session=one-shot') {
      authenticatedRequests++;
      return new Response('ready', { status: 200 });
    }
    return new Response('unauthorized', { status: 401 });
  };

  const session = await establishLiveSession('http://127.0.0.1:3499/?token=one-shot', {
    probe: (url, options) => probeHarnessReady(url, { ...options, fetchImpl }),
  });

  assert.equal(session.cookie, 'dsh_session=one-shot');
  assert.equal(tokenRequests, 1);
  assert.equal(authenticatedRequests, 1);
});

test('NOT RUN wording is explicit and --require-live changes the outcome', () => {
  const softSkip = resolveLiveConfig({}, []);
  const hardSkip = resolveLiveConfig({}, ['--require-live']);
  assert.match(notRunMessage(softSkip), /NOT RUN \(not PASS\)/);
  assert.match(notRunMessage(softSkip), /set it or pass --require-live/);
  assert.match(notRunMessage(hardSkip), /NOT RUN \(not PASS\)/);
  assert.match(notRunMessage(hardSkip), /--require-live is set/);
});

test('assertInsideRoot rejects traversal, root itself, and non-absolute forms', () => {
  const root = '/home/test/.dshr-live-run-one';
  assert.equal(assertInsideRoot(root, root + '/fixture-dir'), root + '/fixture-dir');
  // Windows remotes resolve to Windows-style roots; both sides must agree.
  const winRoot = 'C:\\Users\\test\\.dshr-live-run-one';
  assert.equal(assertInsideRoot(winRoot, winRoot + '\\mirror', 'win'), winRoot + '\\mirror');

  // The root itself, siblings sharing a name prefix, and traversal are refused.
  assert.throws(() => assertInsideRoot(root, root), /inside the run-owned remote fixture root/);
  assert.throws(() => assertInsideRoot(root, root + '-sibling'), /inside the run-owned remote fixture root/);
  assert.throws(() => assertInsideRoot(root, root + '/../outside'), /"\.\." traversal/);
  assert.throws(() => assertInsideRoot(root, '/home/test/.dshr-live-run-one/..'), /"\.\." traversal/);
  assert.throws(() => assertInsideRoot('/home/test/.dshr-live-run-one', '/etc/passwd'), /inside the run-owned/);
  // A `.` segment cannot be used to escape or to fake a prefix match.
  assert.throws(() => assertInsideRoot(root, root + '/./../outside'), /"\.\." traversal/);
  assert.equal(assertInsideRoot(root, root + '/./mirror', 'dotted'), root + '/./mirror');

  // Illegal / non-absolute / drive-relative forms are refused up front.
  assert.throws(() => assertInsideRoot(root, ''), /must be an absolute path/);
  assert.throws(() => assertInsideRoot(root, 'relative/path'), /must be an absolute path/);
  assert.throws(() => assertInsideRoot(root, 'C:relative'), /drive-relative/);
  assert.throws(() => assertInsideRoot(root, '/'), /must not be a filesystem root|must be inside/);
  assert.throws(() => assertInsideRoot('', '/x'), /must be an absolute path/);
});

test('fixture paths stay unique per run and mirror the directory the run creates', (t) => {
  const home = makeTempHome(t);
  const first = makeRemoteFixturePaths(home, 'run-one');
  const second = makeRemoteFixturePaths(home, 'run-two');
  assert.notEqual(first.root, second.root);
  assert.ok(first.root.startsWith(home + path.sep), 'fixture root must live under the resolved remote home');
  // `/dsh-remote/mirror` requires an existing directory, so the mirrored path
  // must be the one `/fs mkdir` created — not a sibling.
  assert.equal(first.mirrorName, first.dirName);
  assert.ok(assertInsideRoot(first.root, first.dirName));
  assert.ok(assertInsideRoot(first.root, first.fileName));
  assert.equal(joinRemotePath('/a/b', 'c'), '/a/b/c');
  assert.equal(joinRemotePath('C:\\a\\b', 'c'), 'C:\\a\\b\\c');
  assert.equal(joinRemotePath('/a/b/', '/c'), '/a/b/c');
});

test('waitForUrl and establishLiveSession honour a run-level abort signal', async () => {
  const { EventEmitter } = await import('node:events');
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  const controller = new AbortController();
  const pending = waitForUrl(child, { timeoutMs: 5000, signal: controller.signal });
  controller.abort(new Error('live run cancelled'));
  await assert.rejects(pending, /live run cancelled/);

  const preAborted = new AbortController();
  preAborted.abort(new Error('already cancelled'));
  await assert.rejects(
    () => waitForUrl(child, { timeoutMs: 5000, signal: preAborted.signal }),
    /already cancelled/,
  );

  // The run signal must reach the probe, so a cancellation during startup
  // actually interrupts readiness instead of waiting out the probe budget.
  const sessionAbort = new AbortController();
  let forwardedSignal = null;
  await assert.rejects(
    () => establishLiveSession('http://127.0.0.1:1/?token=t', {
      signal: sessionAbort.signal,
      probe: async (_url, options) => {
        forwardedSignal = options.signal;
        throw new Error('probe interrupted: superseded');
      },
    }),
    /superseded/,
  );
  assert.equal(forwardedSignal, sessionAbort.signal);

  // A cancelled run must not start a probe at all.
  const startedAbort = new AbortController();
  startedAbort.abort(new Error('startup cancelled'));
  await assert.rejects(
    () => establishLiveSession('http://127.0.0.1:1/?token=t', {
      signal: startedAbort.signal,
      probe: async () => {
        throw new Error('probe must not run for a cancelled run');
      },
    }),
    /startup cancelled/,
  );
});

test('establishLiveSession propagates cancellation through the real readiness fetch path', async () => {
  const callerReason = new Error('readiness caller cancelled');
  const { getEventListeners } = await import('node:events');

  async function runWithCancellation({
    prepare,
    fetchImpl,
    timeoutMs = 2000,
  }) {
    const controller = new AbortController();
    const startedAt = Date.now();
    const pending = establishLiveSession('http://127.0.0.1:3499/?token=real-cancel', {
      signal: controller.signal,
      timeoutMs,
      probe: (url, options) => probeHarnessReady(url, { ...options, fetchImpl }),
    });
    await prepare(controller);
    await assert.rejects(pending, (error) => error === callerReason);
    assert.ok(
      Date.now() - startedAt < timeoutMs / 2,
      'caller cancellation must settle before the internal timeout',
    );
    assert.equal(
      getEventListeners(controller.signal, 'abort').length,
      0,
      'probe must remove its caller abort listener',
    );
  }

  // Pre-aborted caller: no request may be issued.
  {
    let fetchCalls = 0;
    const controller = new AbortController();
    controller.abort(callerReason);
    await assert.rejects(
      () => establishLiveSession('http://127.0.0.1:3499/?token=real-cancel', {
        signal: controller.signal,
        timeoutMs: 2000,
        probe: (url, options) => probeHarnessReady(url, {
          ...options,
          fetchImpl: async () => {
            fetchCalls++;
            return new Response('unexpected', { status: 200 });
          },
        }),
      }),
      (error) => error === callerReason,
    );
    assert.equal(fetchCalls, 0);
    assert.equal(getEventListeners(controller.signal, 'abort').length, 0);
  }

  // Cancellation while the initial request is in flight.
  {
    let fetchStarted;
    const started = new Promise((resolve) => { fetchStarted = resolve; });
    const requestSignals = [];
    await runWithCancellation({
      prepare: async (controller) => {
        await started;
        controller.abort(callerReason);
      },
      fetchImpl: (_url, options) => new Promise((_resolve, reject) => {
        requestSignals.push(options.signal);
        fetchStarted();
        const fail = () => reject(options.signal.reason);
        if (options.signal.aborted) fail();
        else options.signal.addEventListener('abort', fail, { once: true });
      }),
    });
    assert.equal(requestSignals.length, 1);
  }

  // Cancellation while the nested redemption request is in flight.
  {
    let redemptionStarted;
    const started = new Promise((resolve) => { redemptionStarted = resolve; });
    let calls = 0;
    const requestSignals = [];
    await runWithCancellation({
      prepare: async (controller) => {
        await started;
        controller.abort(callerReason);
      },
      fetchImpl: (_url, options) => {
        calls++;
        requestSignals.push(options.signal);
        if (calls === 1) return new Response('', { status: 401 });
        return new Promise((_resolve, reject) => {
          redemptionStarted();
          const fail = () => reject(options.signal.reason);
          if (options.signal.aborted) fail();
          else options.signal.addEventListener('abort', fail, { once: true });
        });
      },
    });
    assert.equal(calls, 2, 'cancellation stops before the authenticated retry');
    assert.equal(requestSignals[0], requestSignals[1]);
  }

  // Cancellation while the authenticated retry is in flight.
  {
    let retryStarted;
    const started = new Promise((resolve) => { retryStarted = resolve; });
    let calls = 0;
    const requestSignals = [];
    await runWithCancellation({
      prepare: async (controller) => {
        await started;
        controller.abort(callerReason);
      },
      fetchImpl: (_url, options) => {
        calls++;
        requestSignals.push(options.signal);
        if (calls === 1) return new Response('', { status: 401 });
        if (calls === 2) {
          return new Response('', {
            status: 303,
            headers: { 'set-cookie': 'dsh_session=cancelled; Path=/; HttpOnly' },
          });
        }
        return new Promise((_resolve, reject) => {
          retryStarted();
          const fail = () => reject(options.signal.reason);
          if (options.signal.aborted) fail();
          else options.signal.addEventListener('abort', fail, { once: true });
        });
      },
    });
    assert.equal(calls, 3);
    assert.equal(requestSignals[0], requestSignals[1]);
    assert.equal(requestSignals[1], requestSignals[2]);
  }

  // Cancellation that lands after the real probe resolves but before
  // establishLiveSession can accept it must still reject the session.
  {
    const controller = new AbortController();
    let fetchCalls = 0;
    await assert.rejects(
      () => establishLiveSession('http://127.0.0.1:3499/?token=real-cancel', {
        signal: controller.signal,
        timeoutMs: 2000,
        probe: async (url, options) => {
          const result = await probeHarnessReady(url, {
            ...options,
            fetchImpl: async () => {
              fetchCalls++;
              return new Response('ready', { status: 200 });
            },
          });
          controller.abort(callerReason);
          return result;
        },
      }),
      (error) => error === callerReason,
    );
    assert.equal(fetchCalls, 1);
    assert.equal(getEventListeners(controller.signal, 'abort').length, 0);
  }
});
