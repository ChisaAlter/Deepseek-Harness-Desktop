#!/usr/bin/env node
// Checkpoint B2: real-Electron verification of the preview permission model.
//
// Must run under Electron, not plain Node: Chromium has to issue the actual
// permission requests. The production preview-session configuration is
// installed through `createPreviewSessionCache`, and the runner wraps the
// session setters first so the *handler's own decision* can be recorded
// separately from what the page and the OS end up observing.
//
// `--positive-control` adds one permission to the in-memory allow-list for
// that process only. It exists to prove the negative run is not vacuous: with
// an allow-list entry the binding seam must let the request through, so a
// "denied" from the default run means the model denied it, not that the probe
// never ran.
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const electronModule = require('electron');
// Plain Node resolves the `electron` package to the binary path string, so the
// guard has to run before anything destructures Electron's API.
const isElectron = Boolean(process.versions.electron)
  && electronModule
  && typeof electronModule === 'object';
const { app, BrowserWindow, session } = isElectron
  ? electronModule
  : { app: null, BrowserWindow: null, session: null };
const {
  ALLOWED_PREVIEW_PERMISSIONS,
  createPreviewSessionCache,
  isPreviewPermissionAllowed,
} = require('../src/main/preview-session.js');

const POSITIVE_CONTROL = process.argv.includes('--positive-control');
const PROBE_TIMEOUT_MS = 2_000;
const RESULT_TIMEOUT_MS = 20_000;
const PROBE_PERMISSION = 'geolocation';
const PROFILE_ROOT_ENV = 'DSHD_PREVIEW_PROFILE_ROOT';
const TEST_SCENARIO_ENV = 'DSHD_PREVIEW_PERMISSIONS_TEST_SCENARIO';
const ALLOW_TEST_SCENARIOS_ENV = 'DSHD_PREVIEW_PERMISSIONS_ALLOW_TEST_SCENARIOS';
const FRAME_IDS = ['main', 'same', 'cross'];
// These probes are the acceptance evidence, so they are required in every
// mode: a missing, `unsupported`, `timeout`, or `threw:` outcome is a failure,
// never an acceptable substitute for the exact expected state.
const REQUIRED_QUERY_PROBES = ['query_geolocation', 'query_notifications', 'query_clipboardRead'];
const DENIED_EVERYWHERE = Object.freeze({
  query_geolocation: 'denied',
  query_notifications: 'denied',
  query_clipboardRead: 'denied',
});
const EXPECTED_QUERY_STATES = Object.freeze(POSITIVE_CONTROL
  ? {
    main: { ...DENIED_EVERYWHERE, query_geolocation: 'granted' },
    same: { ...DENIED_EVERYWHERE, query_geolocation: 'granted' },
    cross: { ...DENIED_EVERYWHERE },
  }
  : {
    main: DENIED_EVERYWHERE,
    same: DENIED_EVERYWHERE,
    cross: DENIED_EVERYWHERE,
  });
const TEST_SCENARIO = process.env[ALLOW_TEST_SCENARIOS_ENV] === '1'
  ? process.env[TEST_SCENARIO_ENV] ?? ''
  : '';

function samePath(left, right) {
  const normalize = (value) => {
    const resolved = path.resolve(value);
    return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
  };
  return normalize(left) === normalize(right);
}

/**
 * Resolve the paths the launcher installed before Electron's ready event.
 * Creating another profile here would be too late for Chromium's sessionData
 * stores, so the runner fails closed instead of silently falling back.
 */
function resolveProfilePaths() {
  const configured = process.env[PROFILE_ROOT_ENV];
  if (!configured) {
    throw new Error(`${PROFILE_ROOT_ENV} is required; start through verify-preview-permissions.cjs`);
  }
  if (!path.isAbsolute(configured)) {
    throw new Error(`${PROFILE_ROOT_ENV} must be an absolute path`);
  }
  const profileRoot = path.resolve(configured);
  const userData = app.getPath('userData');
  const sessionData = app.getPath('sessionData');
  if (!samePath(profileRoot, userData) || !samePath(profileRoot, sessionData)) {
    throw new Error(
      `profile root was not installed before ready: root=${profileRoot} `
      + `userData=${userData} sessionData=${sessionData}`,
    );
  }
  return { profileRoot, userData, sessionData };
}

function delay(ms) {
  return new Promise((resolve) => { setTimeout(resolve, ms); });
}

/**
 * Write the report synchronously. The Electron main process quits as soon as
 * the report is written; a buffered `process.stdout.write` can be torn down
 * with the process before a piped stdout flushes, which makes a completed run
 * look like it produced no report at all.
 * @param {unknown} report
 */
function writeReport(report) {
  const line = `${JSON.stringify(report)}\n`;
  try {
    fs.writeSync(1, line);
  } catch {
    process.stdout.write(line);
  }
}

function safeUrl(webContents) {
  try {
    return typeof webContents?.getURL === 'function' ? webContents.getURL() : null;
  } catch {
    return null;
  }
}

/**
 * Wrap the session permission setters so the production `configurePreviewSession`
 * call is captured instead of replaced. The production handler still makes the
 * decision; the wrapper only records it.
 */
function instrumentPreviewSession(ses) {
  const capture = { request: null, check: null, decisions: [], checks: [] };
  const originalRequest = ses.setPermissionRequestHandler.bind(ses);
  const originalCheck = ses.setPermissionCheckHandler.bind(ses);

  ses.setPermissionRequestHandler = (handler) => {
    capture.request = handler;
    originalRequest((webContents, permission, callback, details) => {
      const record = {
        permission,
        frameUrl: details?.requestingUrl ?? null,
        requestingOrigin: details?.requestingOrigin ?? null,
        isMainFrame: details?.isMainFrame ?? null,
        topUrl: safeUrl(webContents),
        decision: null,
        callbackCount: 0,
        synchronous: false,
        threw: null,
      };
      let handlerReturned = false;
      const answer = (granted) => {
        record.callbackCount += 1;
        record.decision = granted === true;
        if (!handlerReturned) record.synchronous = true;
        callback(granted === true);
      };
      try {
        handler(webContents, permission, answer, details);
      } catch (error) {
        record.threw = error instanceof Error ? error.message : String(error);
      }
      handlerReturned = true;
      capture.decisions.push(record);
    });
  };

  ses.setPermissionCheckHandler = (handler) => {
    capture.check = handler;
    originalCheck((webContents, permission, requestingOrigin, details) => {
      let allowed;
      let threw = null;
      try {
        allowed = handler(webContents, permission, requestingOrigin, details);
      } catch (error) {
        threw = error instanceof Error ? error.message : String(error);
        allowed = undefined;
      }
      capture.checks.push({
        permission,
        requestingOrigin: requestingOrigin ?? null,
        isMainFrame: details?.isMainFrame ?? null,
        topUrl: safeUrl(webContents),
        allowed: allowed === true,
        threw,
      });
      return allowed;
    });
  };

  return capture;
}

/** Probe script shared by the top document and both iframes. */
function probeScript(frameId) {
  return `
const results = {};
function withTimeout(promise, ms) {
  return new Promise((resolve) => {
    let settled = false;
    const timer = setTimeout(() => { if (!settled) { settled = true; resolve('timeout'); } }, ms);
    Promise.resolve(promise).then(
      (value) => { if (!settled) { settled = true; clearTimeout(timer); resolve(value); } },
      (error) => { if (!settled) { settled = true; clearTimeout(timer); resolve('rejected:' + ((error && error.name) || String(error))); } },
    );
  });
}
async function probe(name, run) {
  try {
    results[name] = await withTimeout(run(), ${PROBE_TIMEOUT_MS});
  } catch (error) {
    results[name] = 'threw:' + ((error && error.name) || String(error));
  }
}
async function main() {
  await probe('notifications', async () => {
    if (typeof Notification === 'undefined') return 'unsupported';
    return await Notification.requestPermission();
  });
  await probe('geolocation', async () => {
    if (positiveControl) return 'skipped:positive-control';
    if (!navigator.geolocation) return 'unsupported';
    return await new Promise((resolve) => {
      navigator.geolocation.getCurrentPosition(
        () => resolve('granted'),
        (error) => resolve('denied:' + String(error.code)),
        { timeout: 1500 },
      );
    });
  });
  await probe('clipboardRead', async () => {
    if (!navigator.clipboard || typeof navigator.clipboard.readText !== 'function') return 'unsupported';
    const text = await navigator.clipboard.readText();
    return 'granted:' + String(text).length;
  });
  for (const [name, permission] of [['geolocation', 'geolocation'], ['notifications', 'notifications'], ['clipboardRead', 'clipboard-read']]) {
    await probe('query_' + name, async () => {
      if (!navigator.permissions) return 'unsupported';
      const status = await navigator.permissions.query({ name: permission });
      return String(status.state);
    });
  }
  parent.postMessage({
    source: 'dshd-b2-probe',
    frameId: ${JSON.stringify(frameId)},
    href: location.href,
    results,
  }, '*');
}
main();
`;
}

function frameHtml(frameId) {
  return `<!doctype html><meta charset="utf-8"><title>frame ${frameId}</title><script>
const positiveControl = ${POSITIVE_CONTROL ? 'true' : 'false'};
${probeScript(frameId)}
</script>`;
}

function mainHtml(crossOriginPort) {
  return `<!doctype html><meta charset="utf-8"><title>B2 preview permission probe</title>
<script>
window.__b2 = { results: {} };
window.addEventListener('message', (event) => {
  const data = event.data;
  if (!data || data.source !== 'dshd-b2-probe') return;
  window.__b2.results[data.frameId] = { href: data.href, results: data.results };
});
const positiveControl = ${POSITIVE_CONTROL ? 'true' : 'false'};
${probeScript('main')}
</script>
<iframe src="/frame.html?frameId=same"
        allow="geolocation; clipboard-read; notifications"
        width="300" height="200"></iframe>
<iframe src="http://127.0.0.1:${crossOriginPort}/frame.html?frameId=cross"
        allow="geolocation; clipboard-read; notifications"
        width="300" height="200"></iframe>`;
}

function startServer(handler) {
  const server = http.createServer(handler);
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      resolve({ server, port: server.address().port });
    });
  });
}

function closeServer(server) {
  return new Promise((resolve) => { server.close(() => resolve()); });
}

function sendHtml(res, body) {
  res.writeHead(200, {
    'content-type': 'text/html; charset=utf-8',
    'cache-control': 'no-store',
  });
  res.end(body);
}

async function waitForProbeResults(webContents, expectedFrameIds) {
  const deadline = Date.now() + RESULT_TIMEOUT_MS;
  let last = null;
  while (Date.now() < deadline) {
    last = await webContents.executeJavaScript('window.__b2 ? window.__b2.results : null');
    if (last && expectedFrameIds.every((frameId) => last[frameId])) return last;
    await delay(100);
  }
  throw new Error(`probe results incomplete: ${JSON.stringify(last)}`);
}

function classify(outcome) {
  if (typeof outcome !== 'string') return 'unknown';
  if (outcome.startsWith('granted')) return 'granted';
  if (outcome === 'timeout') return 'pending';
  if (outcome === 'unsupported') return 'unsupported';
  return 'denied';
}

function emptyProfilePaths() {
  return { profileRoot: null, userData: null, sessionData: null };
}

/**
 * Report the cleanup handoff without pretending that a pending out-of-process
 * removal is already complete. Permission-test success and cleanup completion
 * are deliberately separate facts.
 */
function resolveProfileCleanup(profile) {
  const owned = process.env.DSHD_PREVIEW_PROFILE_ROOT_OWNED === '1'
    && profile?.profileRoot != null
    && profile.profileRoot === process.env.DSHD_PREVIEW_PROFILE_ROOT;
  const receiptPath = owned ? process.env.DSHD_PREVIEW_CLEANUP_RECEIPT ?? null : null;

  if (!owned) {
    return {
      state: 'not-owned',
      receiptPath: null,
      profileRoot: profile?.profileRoot ?? process.env.DSHD_PREVIEW_PROFILE_ROOT ?? null,
      ownerPid: process.pid,
    };
  }

  if (process.env.DSHD_PREVIEW_CLEANUP_START_FAILED === '1') {
    return {
      state: 'retained',
      receiptPath,
      profileRoot: profile.profileRoot,
      ownerPid: process.pid,
    };
  }

  return {
    state: 'pending',
    receiptPath,
    profileRoot: profile.profileRoot,
    ownerPid: process.pid,
  };
}

/**
 * Runtime identity for a failure report. An intermittent acceptance failure is
 * only diagnosable if the report names the exact runtime that observed it.
 */
function runtimeIdentity() {
  return {
    electron: process.versions.electron ?? null,
    chrome: process.versions.chrome ?? null,
    node: process.versions.node ?? null,
    v8: process.versions.v8 ?? null,
    platform: process.platform,
    arch: process.arch,
    electronAppVersion: typeof app?.getVersion === 'function' ? app.getVersion() : null,
  };
}

/**
 * Summarize the failure surface of a report so a failing run does not require
 * re-reading the whole payload to learn what actually broke.
 */
function summarizeFailures(report) {
  const failedChecks = (report.checks ?? [])
    .filter((entry) => entry.ok !== true)
    .map((entry) => entry.name);
  const failedCheckDetails = (report.checks ?? [])
    .filter((entry) => entry.ok !== true);
  const nonDeniedDecisions = (report.handlerDecisions ?? []).filter((record) => (
    record.decision !== false || record.callbackCount !== 1 || record.threw !== null
  ));
  const nonDeniedPermissionChecks = (report.permissionChecks ?? []).filter((record) => (
    record.allowed !== false || record.threw !== null
  ));
  return {
    failedChecks,
    failedCheckDetails,
    nonDeniedDecisions,
    nonDeniedPermissionChecks,
    positiveControlObserved: report.positiveControlObserved ?? null,
  };
}

async function run(profile) {
  if (!isElectron) {
    throw new Error('verify-preview-permissions.mjs must run under Electron, not plain Node');
  }

  const timings = {};
  const timed = async (name, fn) => {
    const startedAt = Date.now();
    try {
      return await fn();
    } finally {
      timings[name] = Date.now() - startedAt;
    }
  };

  let crossPort = 0;
  let crossServer = null;
  let mainServer = null;
  let guestWindow = null;

  try {
    const cross = await timed('startCrossServerMs', () => (
      startServer((req, res) => sendHtml(res, frameHtml('cross')))
    ));
    crossServer = cross.server;
    crossPort = cross.port;

    const main = await timed('startMainServerMs', () => startServer((req, res) => {
      if (req.url?.startsWith('/frame.html')) {
        const frameId = new URL(req.url, 'http://127.0.0.1').searchParams.get('frameId') ?? 'same';
        sendHtml(res, frameHtml(frameId));
        return;
      }
      sendHtml(res, mainHtml(crossPort));
    }));
    mainServer = main.server;

    // The preview session cache is the production entry point; the wrapper goes
    // in front of it so `configurePreviewSession` stays the installed owner.
    const cache = createPreviewSessionCache((partition) => {
      const ses = session.fromPartition(partition);
      return ses;
    });
    const previewSession = cache.getSession('b2-verify');
    const capture = instrumentPreviewSession(previewSession);
    // Re-run the production configuration on the captured setters: this session
    // is the one the cache returns, so `webContents.session === ses` still holds.
    require('../src/main/preview-session.js').configurePreviewSession(previewSession);

    const topUrl = `http://127.0.0.1:${main.port}/main.html`;
    guestWindow = new BrowserWindow({
      show: false,
      width: 900,
      height: 700,
      webPreferences: {
        session: previewSession,
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
      },
    });
    const guestContents = guestWindow.webContents;
    await timed('loadMs', () => guestWindow.loadURL(topUrl));
    const frames = await timed('probeResultsMs', () => (
      waitForProbeResults(guestContents, FRAME_IDS)
    ));

    const checks = [];
    const check = (name, ok, detail) => checks.push({ name, ok: ok === true, detail });

    check('production installed request and check handlers', (
      typeof capture.request === 'function' && typeof capture.check === 'function'
    ), {
      request: typeof capture.request,
      check: typeof capture.check,
    });

    // 1. Permission handler decisions, recorded from real Chromium requests.
    const handlerDecisions = capture.decisions.map((record) => ({
      permission: record.permission,
      isMainFrame: record.isMainFrame,
      frameUrl: record.frameUrl,
      topUrl: record.topUrl,
      decision: record.decision,
      callbackCount: record.callbackCount,
      synchronous: record.synchronous,
      threw: record.threw,
    }));
    check('handler was consulted at least once', handlerDecisions.length > 0, {
      decisions: handlerDecisions.length,
    });
    check('handler answered without deferring to a prompt', handlerDecisions.every((record) => (
      record.synchronous === true
    )), { handlerDecisions });

    const permissionChecks = capture.checks.map((record) => ({
      permission: record.permission,
      requestingOrigin: record.requestingOrigin,
      isMainFrame: record.isMainFrame,
      allowed: record.allowed,
      threw: record.threw,
    }));
    check('permission check was consulted at least once', permissionChecks.length > 0, {
      checks: permissionChecks.length,
    });
    if (!POSITIVE_CONTROL) {
      check('production allow-list is empty', ALLOWED_PREVIEW_PERMISSIONS.size === 0, {
        size: ALLOWED_PREVIEW_PERMISSIONS.size,
      });
      check('every handler decision denied', handlerDecisions.every((record) => (
        record.decision === false && record.callbackCount === 1 && record.threw === null
      )), { handlerDecisions });
      check('every permission check denied', permissionChecks.every((record) => (
        record.allowed === false && record.threw === null
      )), { permissionChecks });
    }

    // 2. What the page and the OS actually observed.
    const browserOutcomes = Object.fromEntries(Object.entries(frames).map(([frameId, frame]) => ([
      frameId,
      {
        href: frame.href,
        outcomes: frame.results,
        classification: Object.fromEntries(
          Object.entries(frame.results).map(([probe, outcome]) => [probe, classify(outcome)]),
        ),
      },
    ])));
    const grants = [];
    const pending = [];
    for (const [frameId, frame] of Object.entries(browserOutcomes)) {
      for (const [probe, kind] of Object.entries(frame.classification)) {
        if (kind === 'granted') grants.push(`${frameId}.${probe}=${frame.outcomes[probe]}`);
        if (kind === 'pending') pending.push(`${frameId}.${probe}`);
      }
    }
    check('no permission request stayed pending (no consent surface)', pending.length === 0, { pending });

    const queryStates = [];
    for (const [frameId, frame] of Object.entries(browserOutcomes)) {
      for (const [probe, outcome] of Object.entries(frame.outcomes)) {
        if (probe.startsWith('query_') && outcome !== 'unsupported') {
          queryStates.push({ frameId, probe, state: outcome });
        }
      }
    }
    // Expected grants are mode-specific: default-deny must observe none, while
    // the positive control must observe exactly the allow-listed geolocation
    // query in the two trusted frames. Anything outside that set (including a
    // grant that reached a page-visible probe but not `permissions.query`) is an
    // unexpected permission and fails the run.
    const expectedGrants = POSITIVE_CONTROL
      ? ['main.query_geolocation', 'same.query_geolocation']
      : [];
    const grantedObservations = [];
    for (const [frameId, frame] of Object.entries(browserOutcomes)) {
      for (const [probe, kind] of Object.entries(frame.classification)) {
        if (kind === 'granted') grantedObservations.push(`${frameId}.${probe}`);
      }
    }
    const unexpectedGrants = grantedObservations.filter((entry) => !expectedGrants.includes(entry));
    check('only the mode-declared permission outcomes were granted', unexpectedGrants.length === 0, {
      expectedGrants,
      grantedObservations,
      unexpectedGrants,
      grants,
    });

    // Exact per-frame acceptance, covering both modes. Every required probe must
    // be present in every frame with exactly the expected state; a missing probe,
    // `unsupported`, `timeout`, `threw:` or an unexpected grant all fail. This is
    // what makes the negative run non-vacuous without treating "not denied" as a
    // pass in the positive control.
    const queryStateFailures = [];
    for (const frameId of FRAME_IDS) {
      const frame = browserOutcomes[frameId];
      if (!frame) {
        queryStateFailures.push({ frameId, probe: null, expected: 'frame present', actual: 'missing' });
        continue;
      }
      const expectedForFrame = EXPECTED_QUERY_STATES[frameId];
      for (const probe of REQUIRED_QUERY_PROBES) {
        const expected = expectedForFrame[probe];
        const actual = frame.outcomes[probe];
        if (actual !== expected) {
          queryStateFailures.push({ frameId, probe, expected, actual: actual ?? 'missing' });
        }
      }
    }
    check('required permission probes report their exact expected state', (
      queryStateFailures.length === 0
    ), { queryStateFailures, expected: EXPECTED_QUERY_STATES, queryStates });

    // 3. Binding seam with an explicit allow-list: proves the origin/frame
    //    checks still discriminate after the allow-list change.
    const allowlist = new Set([PROBE_PERMISSION]);
    const seam = (name, args) => ({
      name,
      allowed: isPreviewPermissionAllowed(
        previewSession,
        guestContents,
        PROBE_PERMISSION,
        args.origin,
        args.details,
        allowlist,
      ),
    });
    const seamCases = [
      seam('loopback main frame', { origin: topUrl, details: { isMainFrame: true } }),
      seam('same-origin subframe', { origin: topUrl, details: { isMainFrame: false } }),
      seam('cross-origin loopback subframe', {
        origin: `http://127.0.0.1:${cross.port}/frame.html`,
        details: { isMainFrame: false },
      }),
      seam('public origin main frame', {
        origin: 'https://evil.example/',
        details: { isMainFrame: true },
      }),
      seam('origin changed after load', {
        origin: 'https://evil.example/',
        details: { isMainFrame: false, requestingUrl: 'https://evil.example/frame.html' },
      }),
      seam('opaque origin', { origin: 'data:text/html,x', details: { isMainFrame: true } }),
    ];
    const expectedSeam = {
      'loopback main frame': true,
      'same-origin subframe': true,
      'cross-origin loopback subframe': false,
      'public origin main frame': false,
      'origin changed after load': false,
      'opaque origin': false,
    };
    check('binding seam still discriminates origin and frame', seamCases.every((entry) => (
      entry.allowed === expectedSeam[entry.name]
    )), { seamCases, expectedSeam });

    // The positive control must observe the allow-listed permission as exactly
    // `granted` in both trusted frames while the cross-origin frame stays denied.
    // Anything else (`denied`, `unsupported`, `timeout`, `threw:`) fails: a
    // non-grant outcome is indistinguishable from the negative run, and treating
    // it as "observed" is what made the earlier predicate non-discriminating.
    const positiveControlObserved = POSITIVE_CONTROL
      ? EXPECTED_QUERY_STATES.main.query_geolocation === 'granted'
        && browserOutcomes.main?.outcomes?.query_geolocation === 'granted'
        && browserOutcomes.same?.outcomes?.query_geolocation === 'granted'
        && browserOutcomes.cross?.outcomes?.query_geolocation === 'denied'
      : null;
    if (POSITIVE_CONTROL) {
      check('positive control observed the allow-listed permission', positiveControlObserved === true, {
        queryStates,
        expected: {
          main: 'granted',
          same: 'granted',
          cross: 'denied',
        },
        observed: {
          main: browserOutcomes.main?.outcomes?.query_geolocation ?? 'missing',
          same: browserOutcomes.same?.outcomes?.query_geolocation ?? 'missing',
          cross: browserOutcomes.cross?.outcomes?.query_geolocation ?? 'missing',
        },
        handlerDecisions: handlerDecisions.filter((record) => record.permission === PROBE_PERMISSION),
      });
    }

    // 4. A destroyed sender must stop being a valid permission target.
    guestWindow.destroy();
    guestWindow = null;
    // Electron flips `webContents.isDestroyed()` one tick after `destroy()`
    // returns, so reading it synchronously observes the pre-destruction value.
    // Wait for the destruction to land before asserting on the seam; the
    // production check itself is the standard `isDestroyed()` guard.
    await delay(0);
    const destroyedCase = isPreviewPermissionAllowed(
      previewSession,
      guestContents,
      PROBE_PERMISSION,
      topUrl,
      { isMainFrame: true },
      allowlist,
    );
    check('destroyed webContents is rejected by the binding seam', destroyedCase === false, {
      allowed: destroyedCase,
    });

    if (TEST_SCENARIO === 'assertion-failure') {
      check('test-injected assertion failure', false, { injectedBy: TEST_SCENARIO_ENV });
    }
    if (TEST_SCENARIO === 'runner-error') {
      throw new Error('test-injected runner failure');
    }

    return {
      ok: checks.every((entry) => entry.ok),
      mode: POSITIVE_CONTROL ? 'positive-control' : 'default-deny',
      profileRoot: profile.profileRoot,
      userData: profile.userData,
      sessionData: profile.sessionData,
      allowListSize: ALLOWED_PREVIEW_PERMISSIONS.size,
      positiveControlObserved,
      profileCleanup: resolveProfileCleanup(profile),
      runtime: runtimeIdentity(),
      timings,
      checks,
      handlerDecisions,
      permissionChecks,
      browserOutcomes,
    };
  } finally {
    if (guestWindow && !guestWindow.isDestroyed()) guestWindow.destroy();
    if (mainServer) await closeServer(mainServer);
    if (crossServer) await closeServer(crossServer);
    await delay(50);
  }
}

/**
 * Write the report and take Electron's explicit exit path. `app.exit()` is
 * used instead of `process.exitCode` + `app.quit()` so the caller observes the
 * same status as the report instead of relying on Electron to preserve a
 * pending exit code during shutdown.
 */
function exitElectron(exitCode) {
  app.exit(exitCode);
}

async function main() {
  if (!isElectron) {
    writeReport({
      ok: false,
      mode: 'unsupported-runtime',
      ...emptyProfilePaths(),
      profileCleanup: {
        state: 'not-owned',
        receiptPath: null,
        profileRoot: null,
        ownerPid: process.pid,
      },
      error: 'Error: verify-preview-permissions.mjs must run under Electron, not plain Node',
    });
    process.exitCode = 1;
    return;
  }
  // The runner destroys its last BrowserWindow while the report is still being
  // assembled. Electron's default `window-all-closed` behaviour quits the app
  // at that moment, which tears the process down before the report is written
  // and makes a completed run look like it produced no output. Keep the app
  // alive and exit explicitly once the report is on stdout.
  app.on('window-all-closed', () => {});
  await app.whenReady();
  if (POSITIVE_CONTROL) ALLOWED_PREVIEW_PERMISSIONS.add(PROBE_PERMISSION);
  let profile = emptyProfilePaths();
  let report;
  let exitCode = 0;
  try {
    profile = resolveProfilePaths();
    if (TEST_SCENARIO === 'missing-report') {
      exitElectron(1);
      return;
    }
    if (TEST_SCENARIO === 'malformed-report') {
      fs.writeSync(1, '{"ok":');
      exitElectron(1);
      return;
    }
    report = await run(profile);
    if (report.ok !== true) exitCode = 1;
  } catch (error) {
    report = {
      ok: false,
      mode: POSITIVE_CONTROL ? 'positive-control' : 'default-deny',
      ...profile,
      profileCleanup: resolveProfileCleanup(profile),
      error: error instanceof Error ? `${error.name}: ${error.message}` : String(error),
      stack: error instanceof Error ? error.stack ?? null : null,
      runtime: runtimeIdentity(),
    };
    exitCode = 1;
  }
  // An intermittent failure is only actionable if the report itself names what
  // failed, on which runtime, and at which stage. The runner never retries: a
  // failure is reported as-is so it stays visible instead of being smoothed over.
  if (report && report.ok !== true) {
    report.failureSummary = summarizeFailures(report);
  }
  writeReport(report);
  exitElectron(exitCode);
}

const isDirectExecution = process.argv[1]
  && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isDirectExecution) main();

export { main, resolveProfilePaths, run };
