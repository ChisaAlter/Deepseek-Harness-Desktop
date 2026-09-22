'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { EventEmitter } = require('node:events');
const { installLatestViaUpdater, makeDifferentialTracker, cachedInstallerPath } = require('./update-updater');

class FakeCancellationToken {
  constructor() {
    this.cancelled = false;
    this._waiters = [];
  }
  cancel() {
    this.cancelled = true;
    const waiters = this._waiters.splice(0);
    for (const reject of waiters) {
      reject(new Error('cancelled'));
    }
  }
  whenCancelled() {
    return new Promise((_resolve, reject) => this._waiters.push(reject));
  }
}

function fakeAutoUpdater(overrides = {}) {
  const updater = new EventEmitter();
  updater.calls = { checkForUpdates: 0, downloadUpdate: 0, quitAndInstall: [] };
  updater.autoDownload = true;
  updater.autoInstallOnAppQuit = true;
  updater.logger = null;
  updater.cancellationToken = null;
  updater.checkForUpdates = async () => {
    updater.calls.checkForUpdates += 1;
    if (overrides.failCheck) {
      throw new Error('check failed');
    }
    if (overrides.noUpdate) {
      return { updateInfo: null };
    }
    return { updateInfo: { version: overrides.version || '9.9.9' } };
  };
  updater.downloadUpdate = async () => {
    updater.calls.downloadUpdate += 1;
    updater.calls.token = updater.cancellationToken;
    if (overrides.logLine && updater.logger) {
      updater.logger.info(overrides.logLine);
    }
    if (overrides.failDownload) {
      throw new Error('download failed');
    }
    if (overrides.hang) {
      await Promise.race([
        new Promise(() => {}),
        updater.cancellationToken ? updater.cancellationToken.whenCancelled() : new Promise(() => {}),
      ]);
      return;
    }
    for (const percent of overrides.progress || [42]) {
      updater.emit('download-progress', { percent, transferred: percent, total: 100 });
    }
  };
  updater.quitAndInstall = (...args) => {
    updater.calls.quitAndInstall.push(args);
  };
  return updater;
}

function collectProgress() {
  const events = [];
  return { events, onProgress: (payload) => events.push(payload) };
}

test('updater path refuses non-packaged runs before touching autoUpdater', async () => {
  const fake = fakeAutoUpdater();
  const result = await installLatestViaUpdater({}, null, { isPackaged: false, autoUpdater: fake });
  assert.deepEqual(result, { ok: false, reason: 'not-packaged' });
  assert.equal(fake.calls.checkForUpdates, 0);
});

test('updater path refuses non-Windows packaged runs before probing manifests', async () => {
  const fake = fakeAutoUpdater();
  const result = await installLatestViaUpdater({}, null, {
    isPackaged: true,
    platform: 'darwin',
    autoUpdater: fake,
  });
  assert.deepEqual(result, { ok: false, reason: 'not-windows' });
  assert.equal(fake.calls.checkForUpdates, 0, 'macOS must not fetch latest-mac.yml we never publish');
});

test('updater path reports no-update when latest.yml resolves nothing', async () => {
  const fake = fakeAutoUpdater({ noUpdate: true });
  const result = await installLatestViaUpdater({}, null, { isPackaged: true, platform: 'win32', autoUpdater: fake });
  assert.deepEqual(result, { ok: false, reason: 'no-update-in-manifest' });
  assert.equal(fake.calls.downloadUpdate, 0);
  assert.equal(fake.listenerCount('download-progress'), 0, 'listeners must be cleaned up');
});

test('updater path installs silently and reports the real differential share', async () => {
  const fake = fakeAutoUpdater({
    version: '0.3.3',
    logLine: 'Full: 636.65 MB, To download: 44.59 MB (7%)',
    progress: [12, 48],
  });
  const { events, onProgress } = collectProgress();
  const result = await installLatestViaUpdater({ timeoutMs: 60_000 }, onProgress, {
    isPackaged: true, platform: 'win32',
    autoUpdater: fake,
    existsSync: () => true,
  });
  assert.equal(result.ok, true);
  assert.equal(result.launched, true);
  assert.equal(result.version, '0.3.3');
  assert.equal(result.differential, true);
  assert.equal(result.downloadPercent, 7);
  assert.deepEqual(fake.calls.quitAndInstall, [[true, true]], 'silent install + force-run');
  assert.equal(fake.autoDownload, false, 'manual download only');
  assert.deepEqual(events.map((e) => [e.phase, e.percent]), [['download', 12], ['download', 48], ['install', 100]]);
  assert.equal(events[0].differential, true, 'downloader report marks differential before first tick');
  assert.equal(fake.listenerCount('download-progress'), 0);
  assert.equal(fake.listenerCount('error'), 0);
});

test('updater path without cached installer and without diff report stays full-download labelled', async () => {
  const fake = fakeAutoUpdater();
  const { events, onProgress } = collectProgress();
  const result = await installLatestViaUpdater({}, onProgress, {
    isPackaged: true, platform: 'win32',
    autoUpdater: fake,
    existsSync: () => false,
  });
  assert.equal(result.ok, true);
  assert.equal(result.differential, false);
  assert.equal(events[0].differential, false, 'no cache, no diff report → full download');
});

test('a cached installer labels early ticks as differential but the ground-truth report wins', async () => {
  const fake = fakeAutoUpdater({ logLine: undefined });
  const { events, onProgress } = collectProgress();
  const result = await installLatestViaUpdater({}, onProgress, {
    isPackaged: true, platform: 'win32',
    autoUpdater: fake,
    existsSync: () => true,
  });
  assert.equal(events[0].differential, true, 'cache estimate labels the early tick');
  assert.equal(result.differential, false, 'no downloader report → updater took the full path');
});

test('updater path propagates download failures as updater-error for fallback', async () => {
  const fake = fakeAutoUpdater({ failDownload: true });
  const result = await installLatestViaUpdater({}, null, { isPackaged: true, platform: 'win32', autoUpdater: fake });
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'updater-error');
  assert.match(result.message, /download failed/);
  assert.equal(fake.calls.quitAndInstall.length, 0, 'no install after a failed download');
  assert.equal(fake.listenerCount('download-progress'), 0);
});

test('updater path check failure is updater-error and never reaches download', async () => {
  const fake = fakeAutoUpdater({ failCheck: true });
  const result = await installLatestViaUpdater({}, null, { isPackaged: true, platform: 'win32', autoUpdater: fake });
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'updater-error');
  assert.equal(fake.calls.downloadUpdate, 0);
});

test('updater path enforces the wall-clock timeout via cancellation token', async () => {
  const fake = fakeAutoUpdater({ hang: true });
  const timer = { fn: null };
  const result = await installLatestViaUpdater({ timeoutMs: 1234 }, null, {
    isPackaged: true, platform: 'win32',
    autoUpdater: fake,
    CancellationToken: FakeCancellationToken,
    setTimeout: (fn) => { timer.fn = fn; setImmediate(fn); return 1; },
    clearTimeout: () => {},
  });
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'timeout');
  assert.match(result.message, /下载超时/);
  assert.equal(fake.calls.token.cancelled, true, 'timeout must cancel the download token');
  assert.equal(fake.cancellationToken, null, 'the spent token must be cleared so a later update is not poisoned');
});

test('differential tracker only trusts the downloader report line', () => {
  const tracker = makeDifferentialTracker({ existsSync: () => true });
  tracker.log('Download block maps (old: "a", new: "b")');
  assert.equal(tracker.differential, false);
  tracker.log('Full: 636.65 MB, To download: 44.59 MB (7%)');
  assert.equal(tracker.differential, true);
  assert.equal(tracker.downloadPercent, 7);
  assert.equal(tracker.finish().differential, true);
});

test('cachedInstallerPath resolves the NSIS self-copied installer under LOCALAPPDATA', () => {
  const resolved = cachedInstallerPath();
  if (process.env.LOCALAPPDATA) {
    assert.match(resolved, /deepseek-harness-desktop-updater[\\/]installer\.exe$/i);
  } else {
    assert.equal(resolved, '');
  }
});
