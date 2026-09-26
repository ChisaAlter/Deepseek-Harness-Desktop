'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { installDelta, pickDeltaAsset } = require('./install');
const { buildDelta } = require('./build');
const { applyDeltaFile, DeltaApplyError } = require('./apply');
const manifest = require('./manifest');
const ipcDelta = require('../../main/ipc-delta');

function tmpdir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'dshd-delta-ipc-'));
}

const RELEASE = {
  tag_name: 'v2.0.0',
  name: 'v2.0.0',
  assets: [
    { name: 'Whale-Isle-Setup-2.0.0.exe', browser_download_url: 'https://x.test/setup.exe' },
    { name: 'Whale-Isle-delta-1.0.0-2.0.0.zip', browser_download_url: 'https://x.test/delta.zip' },
    { name: 'SHA512SUMS.txt', browser_download_url: 'https://x.test/sums.txt' },
  ],
};

function baseDeps(overrides = {}) {
  return {
    isLauncherPackage: () => true,
    installedInfo: async () => ({ registeredInstall: true, installPath: 'C:\\Apps\\DSHD', version: '1.0.0' }),
    probeDesktopRunning: () => false,
    stopDesktop: async () => ({ ok: true }),
    route: 'github',
    fetchRelease: async () => RELEASE,
    update: {
      downloadFile: async (_url, dest, onProgress) => {
        if (typeof onProgress === 'function') {
          onProgress({ phase: 'download', percent: 42 });
        }
        fs.writeFileSync(dest, 'zip-bytes');
        return dest;
      },
      verifyAssetChecksum: async () => {},
    },
    applyFile: async () => ({ ok: true, applied: { added: 1, patched: 2, deleted: 1, skipped: 0 } }),
    fullInstall: async () => ({ ok: true, launched: true }),
    deltaDir: path.join(os.tmpdir(), 'dshd-delta-cache-test'),
    ...overrides,
  };
}

// --- installDelta orchestration -----------------------------------------------

test('installDelta applies a matching verified delta and reports mode:delta', async () => {
  const progress = [];
  let fullCalls = 0;
  const deps = baseDeps({ fullInstall: async () => { fullCalls += 1; return { ok: true }; } });
  const result = await installDelta('v2.0.0', (p) => progress.push(p), deps);
  assert.equal(result.ok, true);
  assert.equal(result.mode, 'delta');
  assert.equal(result.from, '1.0.0');
  assert.equal(result.to, '2.0.0');
  assert.equal(fullCalls, 0);
  assert.ok(progress.some((p) => p.phase === 'download' && p.differential === true));
});

test('installDelta falls back to the full installer when no delta asset exists', async () => {
  let fullTag = null;
  const release = { ...RELEASE, assets: RELEASE.assets.filter((a) => !a.name.includes('-delta-')) };
  const deps = baseDeps({
    fetchRelease: async () => release,
    fullInstall: async (tag) => { fullTag = tag; return { launched: true }; },
  });
  const result = await installDelta('v2.0.0', null, deps);
  assert.equal(result.mode, 'full');
  assert.equal(result.ok, true);
  assert.equal(result.deltaFallback, 'delta-asset-missing');
  assert.equal(fullTag, 'v2.0.0');
});

test('installDelta falls back when the base hash check fails inside apply', async () => {
  const calls = [];
  const deps = baseDeps({
    applyFile: async () => { throw new DeltaApplyError('base-mismatch', 'drifted', 'x.dll'); },
    fullInstall: async (tag, onProgress) => { calls.push('full'); return { ok: true, status: 'installed' }; },
  });
  const result = await installDelta('v2.0.0', null, deps);
  assert.equal(result.mode, 'full');
  assert.equal(result.ok, true);
  assert.equal(result.deltaFallback, 'base-mismatch');
  assert.deepEqual(calls, ['full']);
});

test('installDelta falls back when the release carries no checksum manifest', async () => {
  const release = { ...RELEASE, assets: RELEASE.assets.filter((a) => a.name !== 'SHA512SUMS.txt') };
  const deps = baseDeps({ fetchRelease: async () => release });
  const result = await installDelta('v2.0.0', null, deps);
  assert.equal(result.mode, 'full');
  assert.equal(result.deltaFallback, 'delta-unverified');
});

test('installDelta refuses the full package (cannot patch a running self)', async () => {
  let fetched = false;
  const deps = baseDeps({
    isLauncherPackage: () => false,
    fetchRelease: async () => { fetched = true; return RELEASE; },
  });
  const result = await installDelta('v2.0.0', null, deps);
  assert.equal(result.mode, 'full');
  assert.equal(result.deltaFallback, 'unsupported-package');
  assert.equal(fetched, false);
});

test('installDelta falls back when nothing is installed or the runtime stays busy', async () => {
  const missing = await installDelta('v2.0.0', null, baseDeps({
    installedInfo: async () => ({ registeredInstall: false, installPath: '' }),
  }));
  assert.equal(missing.deltaFallback, 'no-installed-base');
  // A desktop that refuses to exit must not fall back into the full-install
  // lane — its handshake would re-prompt for the same decision.
  const busy = await installDelta('v2.0.0', null, baseDeps({
    probeDesktopRunning: () => true,
    stopDesktop: async () => ({ ok: false, error: 'desktop-still-running' }),
  }));
  assert.equal(busy.mode, 'delta');
  assert.equal(busy.ok, false);
  assert.equal(busy.error, 'desktop-still-running');
  const cancelled = await installDelta('v2.0.0', null, baseDeps({
    probeDesktopRunning: () => true,
    stopDesktop: async () => ({ ok: false, cancelled: true, error: 'peer-cancelled' }),
  }));
  assert.equal(cancelled.mode, 'delta');
  assert.equal(cancelled.cancelled, true);
});

test('installDelta propagates a failed full install as mode:full not-ok', async () => {
  const deps = baseDeps({
    fetchRelease: async () => null,
    fullInstall: async () => ({ ok: false, status: 'error', message: 'release-not-found' }),
  });
  const result = await installDelta('v9.9.9', null, deps);
  assert.equal(result.mode, 'full');
  assert.equal(result.ok, false);
  assert.equal(result.error, 'release-not-found');
});

test('pickDeltaAsset matches only the installed→target version pair', () => {
  assert.equal(pickDeltaAsset(RELEASE.assets, '1.0.0', '2.0.0').name, 'Whale-Isle-delta-1.0.0-2.0.0.zip');
  assert.equal(pickDeltaAsset(RELEASE.assets, '1.0.1', '2.0.0'), null);
  assert.equal(pickDeltaAsset(RELEASE.assets, 'v1.0.0', 'v2.0.0').name, 'Whale-Isle-delta-1.0.0-2.0.0.zip');
  assert.equal(pickDeltaAsset([], '1.0.0', '2.0.0'), null);
});

// --- real end-to-end through installDelta (build + download + apply) ----------

test('installDelta end-to-end: real zip through fake wire onto a copied base tree', async () => {
  const dir = tmpdir();
  const fromDir = path.join(dir, 'from');
  const toDir = path.join(dir, 'to');
  const installDir = path.join(dir, 'installed');
  fs.mkdirSync(fromDir, { recursive: true });
  fs.mkdirSync(toDir, { recursive: true });
  fs.writeFileSync(path.join(fromDir, 'a.txt'), 'old-a');
  fs.writeFileSync(path.join(fromDir, 'b.txt'), 'old-b');
  fs.writeFileSync(path.join(toDir, 'a.txt'), 'new-a');
  fs.writeFileSync(path.join(toDir, 'c.txt'), 'new-c');
  fs.cpSync(fromDir, installDir, { recursive: true });
  const zipPath = path.join(dir, 'wire.zip');
  await buildDelta({ fromDir, toDir, outFile: zipPath, fromVersion: '1.0.0', toVersion: '2.0.0' });
  const wireBytes = fs.readFileSync(zipPath);

  const deps = baseDeps({
    installedInfo: async () => ({ registeredInstall: true, installPath: installDir, version: '1.0.0' }),
    update: {
      downloadFile: async (_url, dest) => { fs.writeFileSync(dest, wireBytes); return dest; },
      verifyAssetChecksum: async () => {},
    },
    applyFile: applyDeltaFile,
    deltaDir: path.join(dir, 'cache'),
    fullInstall: async () => ({ ok: false, error: 'should-not-run' }),
  });
  const result = await installDelta('v2.0.0', null, deps);
  assert.equal(result.ok, true);
  assert.equal(result.mode, 'delta');
  assert.equal(fs.readFileSync(path.join(installDir, 'a.txt'), 'utf8'), 'new-a');
  assert.equal(fs.readFileSync(path.join(installDir, 'c.txt'), 'utf8'), 'new-c');
  assert.equal(fs.existsSync(path.join(installDir, 'b.txt')), false);
  fs.rmSync(dir, { recursive: true, force: true });
});

// --- ipc-delta contract -------------------------------------------------------

function fakeCtx() {
  const calls = { handled: null, sent: [] };
  const ctx = {
    LAUNCHER_ONLY: ['launcher'],
    handle: (channel, roles, listener) => { calls.handled = { channel, roles, listener }; },
    send: (event, channel, payload) => { calls.sent.push({ channel, payload }); },
    launcher: { installRelease: async () => ({ ok: true, launched: true }) },
  };
  return { ctx, calls };
}

test('register mounts shell:install-delta on LAUNCHER_ONLY and forwards progress', async () => {
  const { ctx, calls } = fakeCtx();
  const seen = [];
  ipcDelta.setDeltaDeps({
    deltaDir: tmpdir(),
    installDelta: async (tag, onProgress, deps) => {
      seen.push(tag);
      onProgress({ phase: 'download', percent: 5 });
      assert.equal(typeof deps.fullInstall, 'function');
      return { ok: true, mode: 'delta' };
    },
  });
  try {
    ipcDelta.register(ctx);
    assert.equal(calls.handled.channel, 'shell:install-delta');
    assert.equal(calls.handled.roles, ctx.LAUNCHER_ONLY);
    const result = await calls.handled.listener({}, 'v2.0.0');
    assert.deepEqual(result, { ok: true, mode: 'delta' });
    assert.deepEqual(seen, ['v2.0.0']);
    assert.equal(calls.sent[0].channel, 'shell:update-progress');
    assert.equal(calls.sent[0].payload.delta, true);
    assert.equal(calls.sent[0].payload.percent, 5);
  } finally {
    ipcDelta.setDeltaDeps(null);
  }
});

test('register full-fallback path delegates to ctx.launcher.installRelease', async () => {
  const { ctx, calls } = fakeCtx();
  const realInstall = require('./install').installDelta;
  const installDir = tmpdir();
  ipcDelta.setDeltaDeps({
    deltaDir: tmpdir(),
    installDelta: (tag, onProgress, deps) => realInstall(tag, onProgress, {
      ...deps,
      isLauncherPackage: () => true,
      installedInfo: async () => ({ registeredInstall: true, installPath: installDir, version: '1.0.0' }),
      probeDesktopRunning: () => false,
      route: 'github',
      fetchRelease: async () => null, // release gone → fallback
    }),
  });
  try {
    ipcDelta.register(ctx);
    const result = await calls.handled.listener({}, 'v9.9.9');
    assert.equal(result.mode, 'full');
    assert.equal(result.ok, true);
    assert.equal(result.deltaFallback, 'release-not-found');
  } finally {
    ipcDelta.setDeltaDeps(null);
  }
});

test('register maps a thrown orchestrator error to {ok:false, mode:full}', async () => {
  const { ctx, calls } = fakeCtx();
  ipcDelta.setDeltaDeps({
    deltaDir: tmpdir(),
    installDelta: async () => { throw new Error('kaboom'); },
  });
  try {
    ipcDelta.register(ctx);
    const result = await calls.handled.listener({}, 'v1');
    assert.deepEqual(result, { ok: false, mode: 'full', error: 'kaboom' });
  } finally {
    ipcDelta.setDeltaDeps(null);
  }
});

test('contributeStatus lists cached delta artifacts and lastError', async () => {
  const dir = tmpdir();
  const artifact = path.join(dir, 'Whale-Isle-delta-0.3.2-0.3.3.zip');
  fs.writeFileSync(artifact, 'zipbytes');
  fs.writeFileSync(`${artifact}.json`, JSON.stringify({ tag: 'v0.3.3' }));
  fs.writeFileSync(path.join(dir, 'unrelated.txt'), 'x');
  ipcDelta.setDeltaDeps({ deltaDir: dir, installDelta: async () => ({ ok: true, mode: 'delta' }) });
  try {
    const status = ipcDelta.contributeStatus();
    assert.deepEqual(status, {
      deltas: { available: [{ tag: 'v0.3.3', from: '0.3.2', size: Buffer.byteLength('zipbytes') }] },
    });
  } finally {
    ipcDelta.setDeltaDeps(null);
  }
  fs.rmSync(dir, { recursive: true, force: true });
});

test('contributeStatus returns null when nothing is cached and no error', () => {
  const dir = tmpdir();
  ipcDelta.setDeltaDeps({ deltaDir: dir });
  try {
    assert.equal(ipcDelta.contributeStatus(), null);
  } finally {
    ipcDelta.setDeltaDeps(null);
  }
  fs.rmSync(dir, { recursive: true, force: true });
});

test('contributeStatus surfaces lastError after a failed install', async () => {
  const { ctx, calls } = fakeCtx();
  const dir = tmpdir();
  ipcDelta.setDeltaDeps({
    deltaDir: dir,
    installDelta: async () => ({ ok: false, mode: 'full', error: 'boom' }),
  });
  try {
    ipcDelta.register(ctx);
    await calls.handled.listener({}, 'v1');
    const status = ipcDelta.contributeStatus();
    assert.equal(status.deltas.lastError, 'boom');
    assert.deepEqual(status.deltas.available, []);
  } finally {
    ipcDelta.setDeltaDeps(null);
  }
  fs.rmSync(dir, { recursive: true, force: true });
});
