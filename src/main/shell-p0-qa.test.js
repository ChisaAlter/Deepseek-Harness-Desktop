'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  SHELL_P0_STEPS,
  PERSIST_STEPS,
  RECOVERY_STEPS,
  assertShellP0QaResult,
  assertPersistQaResult,
  assertRecoveryQaResult,
} = require('./shell-p0-qa');

test('shell P0 steps cover shortcuts, tray, close, and persist write', () => {
  assert.ok(SHELL_P0_STEPS.includes('shell.shortcut.settings'));
  assert.ok(SHELL_P0_STEPS.includes('shell.shortcut.surfaces'));
  assert.ok(SHELL_P0_STEPS.includes('shell.window.maximizeRestore'));
  assert.ok(SHELL_P0_STEPS.includes('shell.window.minimizeRestore'));
  assert.ok(SHELL_P0_STEPS.includes('shell.desk.closeToTray'));
  assert.ok(SHELL_P0_STEPS.includes('shell.desk.trayMarketplace'));
  assert.ok(SHELL_P0_STEPS.includes('shell.desk.closeWouldQuit'));
  assert.ok(PERSIST_STEPS.includes('persist.theme'));
  assert.ok(PERSIST_STEPS.includes('persist.sessions'));
  assert.ok(PERSIST_STEPS.includes('persist.model'));
  assert.ok(PERSIST_STEPS.includes('persist.wallpaper'));
  assert.ok(RECOVERY_STEPS.includes('recovery.crashShowsBoot'));
});

test('assertShellP0QaResult rejects omitted steps', () => {
  assert.throws(
    () => assertShellP0QaResult({ ok: true, failed: [], steps: [] }),
    /omitted/,
  );
  assert.doesNotThrow(() => assertShellP0QaResult({
    ok: true,
    failed: [],
    steps: SHELL_P0_STEPS.map((name) => ({ name, ok: true, detail: '' })),
  }));
});

test('assertPersistQaResult and assertRecoveryQaResult require their rows', () => {
  assert.throws(() => assertPersistQaResult({ ok: false, failed: ['persist.theme'], steps: [] }), /persist\.theme/);
  assert.throws(() => assertRecoveryQaResult({ ok: false, failed: ['recovery.retryRestoresUi'], steps: [] }), /recovery\.retryRestoresUi/);
  assert.doesNotThrow(() => assertPersistQaResult({
    ok: true,
    failed: [],
    steps: PERSIST_STEPS.map((name) => ({ name, ok: true, detail: '' })),
  }));
  assert.doesNotThrow(() => assertRecoveryQaResult({
    ok: true,
    failed: [],
    steps: RECOVERY_STEPS.map((name) => ({ name, ok: true, detail: '' })),
  }));
});

test('shell P0 QA is wired into the main-process smoke path', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const smoke = fs.readFileSync(path.join(__dirname, 'smoke', 'index.js'), 'utf8');
  assert.match(smoke, /runShellP0Qa/);
  assert.match(smoke, /DSH_QA_SHELL/);
  assert.match(smoke, /DSH_QA_PERSIST/);
  assert.match(smoke, /DSH_QA_RECOVERY/);
  const installedFull = fs.readFileSync(
    path.join(__dirname, '../../docs/qa/results/2026-08-31/ci-installer/run-installed-full.mjs'),
    'utf8',
  );
  assert.match(installedFull, /DSH_QA_PERSIST/);
  assert.match(installedFull, /assertPersistQaResult/);
  const shell = fs.readFileSync(path.join(__dirname, 'shell-p0-qa.js'), 'utf8');
  assert.match(shell, /persist\.sessions/);
  assert.match(shell, /persist\.model/);
  assert.match(shell, /persist\.wallpaper/);
  assert.match(shell, /session\.jsonl/);
  assert.match(shell, /data-dsh-wallpaper/);
  // The quit interception itself stays in the production entry (quitApp).
  const index = fs.readFileSync(path.join(__dirname, 'index.js'), 'utf8');
  assert.match(index, /DSH_QA_SHELL/);
  assert.match(index, /quit intercepted/);
});
