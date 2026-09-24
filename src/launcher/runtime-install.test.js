'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { EventEmitter } = require('node:events');
const https = require('node:https');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const releaseSource = require('./release-source');
const runtimeInstall = require('./runtime-install');
const installDetect = require('./install-detect');
const update = require('../main/update');

// --- release-source routes --------------------------------------------------

test('normalizeRoute accepts known ids only', () => {
  assert.equal(releaseSource.normalizeRoute('github'), 'github');
  assert.equal(releaseSource.normalizeRoute('Gitee'), 'gitee');
  assert.equal(releaseSource.normalizeRoute(''), '');
  assert.equal(releaseSource.normalizeRoute('gitlab'), '');
  assert.equal(releaseSource.normalizeRoute(undefined), '');
});

test('listRoutes exposes both mirrors; gitee stays unverified until validated', () => {
  const routes = releaseSource.listRoutes();
  const github = routes.find((row) => row.id === 'github');
  const gitee = routes.find((row) => row.id === 'gitee');
  assert.equal(github.verified, true);
  assert.equal(gitee.verified, false);
  assert.match(gitee.page, /gitee\.com/);
});

test('latestFor(github) normalizes a release snapshot against installedVersion', async () => {
  const previousFetch = global.fetch;
  global.fetch = async (url) => {
    assert.match(String(url), /api\.github\.com/);
    return {
      ok: true,
      status: 200,
      json: async () => ({
        tag_name: 'v9.9.9',
        html_url: 'https://github.com/x/releases/v9.9.9',
        body: 'notes',
        assets: [
          { name: 'Deepseek-Harness-Desktop-Setup-9.9.9.exe', browser_download_url: 'https://github.com/dl/setup.exe' },
          { name: 'SHA512SUMS.txt', browser_download_url: 'https://github.com/dl/sums.txt' },
        ],
      }),
    };
  };
  try {
    const check = await releaseSource.latestFor('github', { installedVersion: '1.0.0' });
    assert.equal(check.status, 'available');
    assert.equal(check.latest, '9.9.9');
    assert.equal(check.assetUrl, 'https://github.com/dl/setup.exe');
    assert.equal(check.checksumUrl, 'https://github.com/dl/sums.txt');
    assert.equal(check.route, 'github');
    const current = await releaseSource.latestFor('github', { installedVersion: '9.9.9' });
    assert.equal(current.status, 'current');
  } finally {
    global.fetch = previousFetch;
  }
});

test('latestFor(gitee) only touches gitee hosts and normalizes download_url assets', async () => {
  const previousFetch = global.fetch;
  const seen = [];
  global.fetch = async (url) => {
    const target = String(url);
    seen.push(target);
    assert.match(target, /gitee\.com/, 'gitee route must not query github');
    return {
      ok: true,
      status: 200,
      json: async () => ({
        tag_name: 'v2.0.0',
        name: 'v2.0.0',
        body: '',
        assets: [
          { name: 'Deepseek-Harness-Desktop-Setup-2.0.0.exe', download_url: 'https://gitee.com/ayase/x/releases/download/v2.0.0/setup.exe' },
        ],
      }),
    };
  };
  try {
    const check = await releaseSource.latestFor('gitee', { installedVersion: '1.0.0' });
    assert.equal(check.status, 'available');
    assert.equal(check.route, 'gitee');
    assert.equal(check.assetUrl, 'https://gitee.com/ayase/x/releases/download/v2.0.0/setup.exe');
    assert.ok(seen.every((url) => url.includes('gitee.com')));
  } finally {
    global.fetch = previousFetch;
  }
});

test('releaseFor returns null on 404 and an error shape on failure', async () => {
  const previousFetch = global.fetch;
  global.fetch = async () => ({ ok: false, status: 404, json: async () => ({}) });
  try {
    assert.equal(await releaseSource.releaseFor('github', 'v0.0.0'), null);
  } finally {
    global.fetch = previousFetch;
  }
  global.fetch = async () => { throw new Error('offline'); };
  try {
    const check = await releaseSource.latestFor('github', {});
    assert.equal(check.status, 'error');
    assert.match(check.message, /offline/);
  } finally {
    global.fetch = previousFetch;
  }
});

// --- install-detect target ---------------------------------------------------

test('getInstalledAppInfo with an explicit target never claims the running process', () => {
  const calls = [];
  const info = installDetect.getInstalledAppInfo({
    isPackaged: true,
    platform: 'win32',
    target: { appId: 'com.example.launcher', productName: 'DSHD-Launcher' },
    existsSync: () => false,
    execFileSync: (...args) => {
      calls.push(args);
      throw new Error('missing');
    },
  });
  assert.equal(info.registeredInstall, false);
  // The target's version/path come only from the registry — a missing record
  // means unknown, not the running launcher's own version/dir.
  assert.equal(info.version, '');
  assert.equal(info.installPath, '');
  // Registry probes must key off the target appId, not the desktop identity.
  assert.ok(calls.some((args) => String(args[1]?.join(' ')).includes('com.example.launcher')));
});

test('probeDesktopProcess matches the target image name', () => {
  const seen = [];
  const found = installDetect.probeDesktopProcess({
    platform: 'win32',
    target: { appId: 'x', productName: 'MyApp' },
    execFileSync: (bin, args) => {
      seen.push([bin, ...args].join(' '));
      return '"MyApp.exe","1234","Console","1","100 K"';
    },
  });
  assert.equal(found, true);
  assert.ok(seen[0].includes('MyApp.exe'));
});

// --- runtime-install orchestration -------------------------------------------

function fakeUpdate({ installFromAsset }) {
  return { installFromAsset };
}

function fakeSource({ latest, byTag } = {}) {
  return {
    ROUTES: releaseSource.ROUTES,
    normalizeRoute: releaseSource.normalizeRoute,
    latestFor: async () => latest ?? {
      status: 'available',
      latest: '2.0.0',
      tag: 'v2.0.0',
      assetUrl: 'https://example.test/setup.exe',
      assetName: 'Setup.exe',
      checksumUrl: 'https://example.test/sums.txt',
    },
    releaseFor: async () => byTag ?? null,
    listFor: async () => ({ status: 'ok', releases: [] }),
  };
}

function installerChild() {
  const child = new EventEmitter();
  child.unref = () => {};
  return child;
}

test('installRuntime resolves through the route, installs, and adopts the new registration', async () => {
  const progress = [];
  const seen = {};
  let polls = 0;
  const deps = {
    isLauncherPackage: () => true,
    isPackaged: true,
    loadConfig: () => ({ downloadRoute: 'github' }),
    releaseSource: fakeSource(),
    update: fakeUpdate({
      installFromAsset: async (info, onProgress, options) => {
        seen.info = info;
        seen.options = options;
        options.onInstallerLaunch(installerChild());
        return { ...info, launched: true, installer: 'C:\\tmp\\Setup.exe' };
      },
    }),
    installedInfo: () => {
      polls += 1;
      // First call is the pre-install baseline; polls afterwards see the
      // settled registration.
      if (polls === 1) {
        return { registeredInstall: false, installPath: '', version: '' };
      }
      return { registeredInstall: true, installPath: 'C:\\Apps\\DSHD', version: '2.0.0' };
    },
    existsSync: () => true,
    statSync: () => ({ mtimeMs: 1 }),
    pollMs: 10,
    waitMs: 5000,
  };
  const result = await runtimeInstall.installRuntime({ route: 'github' }, (p) => progress.push(p), deps);
  assert.equal(result.status, 'installed');
  assert.equal(result.installed.version, '2.0.0');
  // Slim package must not quit itself to let an installer replace it.
  assert.equal(seen.options.quitAfterInstall, false);
  assert.equal(typeof seen.options.signal?.aborted, 'boolean');
  assert.ok(progress.some((p) => p.phase === 'resolve'));
});

test('installRuntime maps a mid-download abort to a cancelled result', async () => {
  const deps = {
    isLauncherPackage: () => true,
    isPackaged: true,
    releaseSource: fakeSource(),
    update: fakeUpdate({
      installFromAsset: async (_info, _onProgress, options) => {
        const error = update.cancelledError();
        options.signal.dispatchEvent(new Event('abort'));
        throw error;
      },
    }),
    installedInfo: () => ({ registeredInstall: false }),
  };
  const result = await runtimeInstall.installRuntime({}, null, deps);
  assert.equal(result.cancelled, true);
  assert.equal(result.status, 'cancelled');
});

test('installRuntime passes through a declined unverified install', async () => {
  const deps = {
    isLauncherPackage: () => true,
    isPackaged: true,
    releaseSource: fakeSource(),
    update: fakeUpdate({
      installFromAsset: async (info) => ({ ...info, launched: false, declined: true, unverified: true }),
    }),
    installedInfo: () => ({ registeredInstall: false }),
  };
  const result = await runtimeInstall.installRuntime({}, null, deps);
  assert.equal(result.ok, false);
  assert.equal(result.declined, true);
});

test('installRuntime refuses a second concurrent install', async () => {
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const deps = {
    isLauncherPackage: () => true,
    isPackaged: true,
    releaseSource: fakeSource(),
    update: fakeUpdate({
      installFromAsset: async () => {
        await gate;
        return { launched: true, installer: 'x' };
      },
    }),
    installedInfo: () => ({ registeredInstall: false }),
    pollMs: 10,
    waitMs: 60,
  };
  const first = runtimeInstall.installRuntime({}, null, deps);
  const second = await runtimeInstall.installRuntime({}, null, deps);
  assert.equal(second.error, 'install-in-progress');
  release();
  const firstResult = await first;
  assert.equal(firstResult.status, 'waiting');
});

test('installRuntime reports waiting when the registration never settles', async () => {
  const deps = {
    isLauncherPackage: () => true,
    isPackaged: true,
    releaseSource: fakeSource(),
    update: fakeUpdate({
      installFromAsset: async (info, _onProgress, options) => {
        options.onInstallerLaunch(installerChild());
        return { ...info, launched: true, installer: 'x' };
      },
    }),
    installedInfo: () => ({ registeredInstall: false }),
    existsSync: () => false,
    pollMs: 10,
    waitMs: 60,
  };
  const result = await runtimeInstall.installRuntime({}, null, deps);
  assert.equal(result.status, 'waiting');
});

// --- checkDesktopUpdate --------------------------------------------------------

test('checkDesktopUpdate clamps available→none when no runtime is installed', async () => {
  const deps = {
    loadConfig: () => ({ downloadRoute: 'github' }),
    releaseSource: fakeSource(),
    installedInfo: () => ({ registeredInstall: false, version: '' }),
  };
  const missing = await runtimeInstall.checkDesktopUpdate({}, deps);
  assert.equal(missing.status, 'none');
  assert.equal(missing.latest, '2.0.0');

  const installedDeps = {
    ...deps,
    installedInfo: () => ({ registeredInstall: true, version: '1.0.0', installPath: 'C:\\Apps\\DSHD' }),
  };
  const present = await runtimeInstall.checkDesktopUpdate({}, installedDeps);
  assert.equal(present.status, 'available');
});

// --- downloadFile abort -------------------------------------------------------

test('downloadFile aborts an in-flight request on signal and removes the partial', async () => {
  const previousGet = https.get;
  let destroyed = false;
  https.get = (_target, _options, _onResponse) => {
    const request = new EventEmitter();
    request.destroy = () => { destroyed = true; };
    return request;
  };
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-rt-dl-'));
  const dest = path.join(dir, 'setup.exe');
  const controller = new AbortController();
  try {
    const pending = update.downloadFile('https://example.test/setup.exe', dest, null, { signal: controller.signal });
    controller.abort();
    await assert.rejects(pending, (error) => error.name === 'AbortError');
    assert.equal(destroyed, true);
    assert.equal(fs.existsSync(dest), false);
  } finally {
    https.get = previousGet;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('downloadFile rejects upfront when the signal is already aborted', async () => {
  const controller = new AbortController();
  controller.abort();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-rt-dl0-'));
  const dest = path.join(dir, 'setup.exe');
  try {
    await assert.rejects(
      () => update.downloadFile('https://example.test/setup.exe', dest, null, { signal: controller.signal }),
      (error) => error.name === 'AbortError',
    );
    assert.equal(fs.existsSync(dest), false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// --- startExternalDesktop alive grace ----------------------------------------

const DESKTOP = { appId: 'ai.deepseek.harness', productName: 'DSHD-Runtime' };

function startDeps({ probes, spawnImpl } = {}) {
  const calls = { probes: 0 };
  return {
    deps: {
      isLauncherPackage: () => true,
      target: DESKTOP,
      platform: 'win32',
      installedInfo: () => ({
        registeredInstall: true,
        installPath: 'C:\\Apps\\DSHD',
        version: '2.0.0',
      }),
      existsSync: () => true,
      spawn: spawnImpl || (() => installerChild()),
      execFileSync: () => {
        calls.probes += 1;
        const sequence = probes || [];
        const alive = sequence.length ? sequence[Math.min(calls.probes - 1, sequence.length - 1)] : true;
        return alive ? '"DSHD-Runtime.exe","100","Console","1","50 K"' : 'INFO: No tasks';
      },
      aliveMs: 400,
      pollMs: 10,
    },
    calls,
  };
}

test('startExternalDesktop reports ok only when the runtime is still alive after grace', async () => {
  const { deps } = startDeps({ probes: [true] });
  const result = await runtimeInstall.startExternalDesktop([], deps);
  assert.equal(result.ok, true);
  assert.equal(result.external, true);
});

test('startExternalDesktop fails fast when the runtime exits inside the grace window', async () => {
  const { deps } = startDeps({ probes: [true, false] });
  const result = await runtimeInstall.startExternalDesktop([], deps);
  assert.equal(result.ok, false);
  assert.equal(result.error, 'runtime-exited');
});

test('startExternalDesktop fails when the runtime never enters the process table', async () => {
  const { deps } = startDeps({ probes: [false] });
  const result = await runtimeInstall.startExternalDesktop([], deps);
  assert.equal(result.ok, false);
  assert.equal(result.error, 'runtime-never-started');
});

test('startExternalDesktop fails when nothing is installed, without spawning', async () => {
  let spawned = false;
  const { deps } = startDeps({});
  deps.installedInfo = () => ({ registeredInstall: false, installPath: '' });
  deps.spawn = () => { spawned = true; return installerChild(); };
  const result = await runtimeInstall.startExternalDesktop([], deps);
  assert.equal(result.ok, false);
  assert.equal(result.error, 'runtime-not-installed');
  assert.equal(spawned, false);
});

test('startExternalDesktop reports a rejected spawn instead of throwing', async () => {
  const { deps } = startDeps({
    spawnImpl: () => {
      const child = installerChild();
      setImmediate(() => child.emit('error', new Error('ENOENT')));
      return child;
    },
  });
  const result = await runtimeInstall.startExternalDesktop([], deps);
  assert.equal(result.ok, false);
  assert.equal(result.error, 'ENOENT');
});
