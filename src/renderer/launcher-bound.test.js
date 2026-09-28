'use strict';

// Bound-handler regression driven through a real Electron BrowserWindow:
// the actual launcher.html + the actual preload bridge + fixture shell: IPC.
// Asserts DOM and IPC effects — not pure-function behavior.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const ELECTRON = [
  process.env.ELECTRON_PATH,
  path.join(__dirname, '..', '..', 'node_modules', 'electron', 'dist', 'electron.exe'),
  path.join(__dirname, '..', '..', 'node_modules', 'electron', 'dist', 'electron'),
].find((p) => p && fs.existsSync(p));

const CHILD = path.join(__dirname, 'launcher-bound.child.cjs');

function runBound(env = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(ELECTRON, [CHILD], {
      env: { ...process.env, ELECTRON_RUN_AS_NODE: undefined, ...env },
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    let out = '';
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', () => {});
    const timer = setTimeout(() => { try { child.kill(); } catch {} reject(new Error('bound harness timed out')); }, 45000);
    child.on('exit', (code) => {
      clearTimeout(timer);
      const marker = out.indexOf('BOUND_RESULT:');
      const errMarker = out.indexOf('BOUND_ERROR:');
      if (errMarker >= 0) return reject(new Error('bound harness error: ' + out.slice(errMarker + 12)));
      if (marker < 0) return reject(new Error(`no BOUND_RESULT (code ${code}): ${out.slice(-500)}`));
      try { resolve(JSON.parse(out.slice(marker + 13))); } catch (e) { reject(e); }
    });
    child.on('error', reject);
  });
}

const hasElectron = Boolean(ELECTRON);

test('bound handlers: delayed cancel A->B keeps B live and refuses the stale write', { skip: !hasElectron }, async () => {
  const r = await runBound();
  assert.equal(r.scan.hasShell, true, 'real preload bridge exposed window.shell');
  assert.equal(r.scan.importBtn && r.scan.cancelBtn && r.scan.routePicker, true, 'launcher DOM bound');
  assert.equal(r.delayedCancel.staleWriteRefused, true,
    'a delayed cancel for A must not overwrite B in-flight progress');
  assert.match(r.delayedCancel.dom.importResult, /正在导入/, 'B stays in-flight');
  assert.notEqual(r.delayedCancel.opA, r.delayedCancel.opB, 'A and B are distinct operation ids');
  assert.equal(r.delayedCancel.dom.cancelHidden, false, 'cancel stays available for the live run');
});

test('bound handlers: a resolved {ok:false} route-save is refused and the same route retries', { skip: !hasElectron }, async () => {
  const r = await runBound({ QA_ROUTE_FAIL_ONCE: '1' });
  assert.equal(r.routeRetry.firstIssued, true, 'first pick issues a save');
  // The first save resolved {ok:false}; the same route pick must issue again —
  // the resolved refusal was treated as failure and reset the issued marker.
  assert.equal(r.routeRetry.retryIssued, true, 'same route retries after the resolved refusal');
  assert.equal(r.routeRetry.savesAfterRetry, 2, 'two save attempts recorded');
  assert.equal(r.routeRetry.radios.some((x) => x.disabled && x.route === 'nightly'), true, 'unverified route stays disabled');
});
