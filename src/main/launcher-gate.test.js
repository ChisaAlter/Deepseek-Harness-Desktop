'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const {
  shouldPromptUpdate,
  shouldAutoStartDesktop,
  shouldCloseLauncher,
  shouldCloseLauncherAfterDesktopStart,
  readLastDesktopStart,
  writeLastDesktopStart,
  recordLastDesktopStart,
  stickySkipActive,
  runColdStartGate,
} = require('./launcher-gate');

test('shouldPromptUpdate asks only for a newer non-error check when the setting is on', () => {
  assert.equal(shouldPromptUpdate({ askOnUpdate: true, check: { status: 'available' } }), true);
  assert.equal(shouldPromptUpdate({ askOnUpdate: false, check: { status: 'available' } }), false);
  assert.equal(shouldPromptUpdate({ askOnUpdate: true, check: { status: 'current' } }), false);
  assert.equal(shouldPromptUpdate({ askOnUpdate: true, check: { status: 'error' } }), false);
});

test('shouldAutoStartDesktop yields to import hold, update flow hold, and last failure', () => {
  assert.equal(shouldAutoStartDesktop({ autoStartDesktop: true }), true);
  assert.equal(shouldAutoStartDesktop({ autoStartDesktop: false }), false);
  assert.equal(shouldAutoStartDesktop({ autoStartDesktop: true, holdForImport: true }), false);
  assert.equal(shouldAutoStartDesktop({ autoStartDesktop: true, updateFlowHold: true }), false);
  assert.equal(shouldAutoStartDesktop({ autoStartDesktop: true, lastStartFailed: true }), false);
});

test('stickySkipActive is live only for the same app version', () => {
  assert.equal(stickySkipActive(null), false);
  assert.equal(stickySkipActive({}), false);
  assert.equal(stickySkipActive({
    appVersion: '1.2.3',
    pluginRecovery: { skipUserPlugins: false, appVersion: '1.2.3' },
  }), false);
  assert.equal(stickySkipActive({
    appVersion: '1.2.3',
    pluginRecovery: { skipUserPlugins: true, appVersion: '1.2.3' },
  }), true);
  assert.equal(stickySkipActive({
    appVersion: '1.2.4',
    pluginRecovery: { skipUserPlugins: true, appVersion: '1.2.3' },
  }), false);
});

test('shouldCloseLauncher only after a successful desktop start when quit-after-start is on', () => {
  assert.equal(shouldCloseLauncher({ desktopReady: true, quitAfterStart: true }), true);
  assert.equal(shouldCloseLauncher({ desktopReady: true, quitAfterStart: false }), false);
  assert.equal(shouldCloseLauncher({ desktopReady: false, quitAfterStart: true }), false);
});

test('shouldCloseLauncherAfterDesktopStart blocks recovery and sticky skip', () => {
  assert.equal(shouldCloseLauncherAfterDesktopStart({
    desktopReady: true,
    quitAfterStart: true,
    stickySkip: false,
    recoveryLaunch: false,
    lastStartOk: true,
  }), true);
  assert.equal(shouldCloseLauncherAfterDesktopStart({
    desktopReady: true,
    quitAfterStart: true,
    stickySkip: true,
    recoveryLaunch: false,
    lastStartOk: true,
  }), false);
  assert.equal(shouldCloseLauncherAfterDesktopStart({
    desktopReady: true,
    quitAfterStart: true,
    stickySkip: false,
    recoveryLaunch: true,
    lastStartOk: true,
  }), false);
  assert.equal(shouldCloseLauncherAfterDesktopStart({
    desktopReady: true,
    quitAfterStart: true,
    stickySkip: false,
    recoveryLaunch: false,
    lastStartOk: false,
  }), false);
});

test('last desktop start file uses tri-state ok and records failure for the next cold start', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-last-start-'));
  assert.equal(readLastDesktopStart(dir).ok, null);
  writeLastDesktopStart(dir, { ok: false, error: 'plugin tree' });
  const last = readLastDesktopStart(dir);
  assert.equal(last.ok, false);
  assert.equal(last.error, 'plugin tree');
  writeLastDesktopStart(dir, { ok: true });
  assert.equal(readLastDesktopStart(dir).ok, true);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('recordLastDesktopStart writes ok:true on success and ok:false plus rethrow on failure', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-record-start-'));
  try {
    const value = await recordLastDesktopStart(dir, async () => 'started');
    assert.equal(value, 'started');
    assert.equal(readLastDesktopStart(dir).ok, true);
    await assert.rejects(
      () => recordLastDesktopStart(dir, async () => { throw new Error('spawn failed'); }),
      /spawn failed/,
    );
    const last = readLastDesktopStart(dir);
    assert.equal(last.ok, false);
    assert.equal(last.error, 'spawn failed');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

function gateDeps(overrides = {}) {
  const calls = { openLauncher: 0, startDesktop: 0, sent: [] };
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-cold-gate-'));
  const deps = {
    config: { askOnUpdate: true, autoStartDesktop: true },
    userDataDir: dir,
    isPackaged: true,
    checkUpdate: async () => ({ status: 'current' }),
    confirmUpdate: async () => false,
    installUpdate: async () => ({ launched: true }),
    openLauncher: async () => { calls.openLauncher += 1; },
    sendToLauncher: (channel, payload) => { calls.sent.push({ channel, payload }); },
    recoverInterruptedImport: () => ({ recovered: false, removedTmp: [] }),
    probeImportHold: () => ({ destEmpty: true, sourceHasData: false, hold: false }),
    startDesktop: async () => { calls.startDesktop += 1; },
    ...overrides,
  };
  return { deps, calls, dir };
}

test('cold-start gate auto-starts the desktop when there is nothing to hold on', async () => {
  const { deps, calls, dir } = gateDeps();
  try {
    const result = await runColdStartGate(deps);
    assert.equal(result.outcome, 'desktop');
    assert.equal(calls.startDesktop, 1);
    assert.equal(calls.openLauncher, 0);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('cold-start gate opens the launcher before the update prompt', async () => {
  const order = [];
  const { deps, calls, dir } = gateDeps({
    checkUpdate: async () => ({ status: 'available', latest: '9.9.9' }),
    confirmUpdate: async () => {
      order.push('confirm');
      return false;
    },
  });
  deps.openLauncher = async () => {
    calls.openLauncher += 1;
    order.push('openLauncher');
  };
  try {
    const result = await runColdStartGate(deps);
    // Declined update: auto start proceeds, but the prompt sat on a visible window.
    assert.equal(result.outcome, 'desktop');
    assert.deepEqual(order, ['openLauncher', 'confirm']);
    assert.equal(calls.startDesktop, 1);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('cold-start gate falls back to the launcher home when the update download fails', async () => {
  const { deps, calls, dir } = gateDeps({
    checkUpdate: async () => ({ status: 'available', latest: '9.9.9' }),
    confirmUpdate: async () => true,
    installUpdate: async () => { throw new Error('下载超时（15 分钟）'); },
  });
  try {
    const result = await runColdStartGate(deps);
    assert.equal(result.outcome, 'launcher');
    assert.equal(result.updateFlowHold, true);
    assert.equal(calls.startDesktop, 0, 'must not auto-start after a failed update flow');
    assert.ok(calls.openLauncher >= 1, 'launcher must be visible');
    const errorHint = calls.sent.find((row) => row.channel === 'shell:launcher-hint'
      && row.payload?.check?.status === 'error');
    assert.match(errorHint.payload.check.message, /下载超时/);
    const homeTab = calls.sent.find((row) => row.channel === 'shell:show-tab');
    assert.deepEqual(homeTab.payload, { tab: 'home' });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('cold-start gate ends at the installer only when packaged and launched', async () => {
  const { deps, calls, dir } = gateDeps({
    checkUpdate: async () => ({ status: 'available', latest: '9.9.9' }),
    confirmUpdate: async () => true,
    installUpdate: async () => ({ launched: true }),
    isPackaged: true,
  });
  try {
    const result = await runColdStartGate(deps);
    assert.equal(result.outcome, 'installer');
    assert.equal(calls.startDesktop, 0);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('cold-start gate stays on the launcher after a source-run installer launch', async () => {
  const { deps, calls, dir } = gateDeps({
    checkUpdate: async () => ({ status: 'available', latest: '9.9.9' }),
    confirmUpdate: async () => true,
    installUpdate: async () => ({ launched: true }),
    isPackaged: false,
  });
  try {
    const result = await runColdStartGate(deps);
    assert.equal(result.outcome, 'launcher');
    assert.equal(calls.startDesktop, 0);
    const hint = calls.sent.filter((row) => row.channel === 'shell:launcher-hint').at(-1);
    assert.match(hint.payload.check.message, /安装器已启动/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('cold-start gate holds at import and at a failed last start', async () => {
  const importCase = gateDeps({
    probeImportHold: () => ({ destEmpty: true, sourceHasData: true, hold: true }),
  });
  try {
    const result = await runColdStartGate(importCase.deps);
    assert.equal(result.outcome, 'launcher');
    assert.equal(result.holdForImport, true);
    assert.equal(importCase.calls.startDesktop, 0);
    const tab = importCase.calls.sent.find((row) => row.channel === 'shell:show-tab');
    assert.deepEqual(tab.payload, { tab: 'import' });
  } finally {
    fs.rmSync(importCase.dir, { recursive: true, force: true });
  }

  const failedCase = gateDeps();
  writeLastDesktopStart(failedCase.dir, { ok: false, error: 'plugin tree' });
  try {
    const result = await runColdStartGate(failedCase.deps);
    assert.equal(result.outcome, 'launcher');
    assert.equal(result.lastStartFailed, true);
    assert.equal(failedCase.calls.startDesktop, 0);
    assert.equal(failedCase.calls.openLauncher, 1);
    const tab = failedCase.calls.sent.find((row) => row.channel === 'shell:show-tab');
    assert.deepEqual(tab.payload, { tab: 'home' });
  } finally {
    fs.rmSync(failedCase.dir, { recursive: true, force: true });
  }
});
