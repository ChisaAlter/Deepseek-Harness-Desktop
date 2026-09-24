'use strict';

// Managed-runtime install layer: resolves a release through the selected
// download route, runs the verified download→install pipeline, then waits for
// the desktop registration to settle — without quitting the launcher. The
// slim package is the primary consumer, but the dev full package exercises
// the same path via DSHD_LAUNCHER_PACKAGE=1 (shared userData).
const fs = require('fs');
const { spawn, execFileSync } = require('child_process');
const { app } = require('electron');
const update = require('../main/update');
const { loadConfig } = require('../main/config');
const installDetect = require('./install-detect');
const releaseSource = require('./release-source');
const { isLauncherPackage, runtimeTarget } = require('./product');

const INSTALL_WAIT_MS = 8 * 60_000;
const INSTALL_POLL_MS = 2500;
const INSTALLED_CACHE_MS = 3000;

let installedCache = { at: 0, value: null };

function resolveInstalledInfo(deps = {}) {
  return typeof deps.installedInfo === 'function' ? deps.installedInfo : installedInfo;
}

function installedInfo({ fresh = false, deps = {} } = {}) {
  if (typeof deps.installedInfo === 'function') {
    return deps.installedInfo({ fresh });
  }
  const now = Date.now();
  if (!fresh && installedCache.value && now - installedCache.at < INSTALLED_CACHE_MS) {
    return installedCache.value;
  }
  const value = installDetect.getInstalledAppInfo({ target: runtimeTarget() });
  installedCache = { at: now, value };
  return value;
}

function invalidateInstalledCache() {
  installedCache = { at: 0, value: null };
}

function configuredRoute(deps = {}) {
  try {
    const config = typeof deps.loadConfig === 'function' ? deps.loadConfig() : loadConfig();
    return releaseSource.normalizeRoute(config.downloadRoute) || '';
  } catch {
    return '';
  }
}

function isLauncherPackageNow(deps = {}) {
  return typeof deps.isLauncherPackage === 'function'
    ? deps.isLauncherPackage()
    : isLauncherPackage();
}

function isPackagedNow(deps = {}) {
  if (deps.isPackaged !== undefined) {
    return Boolean(deps.isPackaged);
  }
  try {
    return Boolean(app.isPackaged);
  } catch {
    return false;
  }
}

function runtimeTargetName(deps = {}) {
  const target = deps.target !== undefined ? deps.target : runtimeTarget();
  return (target || installDetect.DESKTOP_TARGET).productName;
}

function runtimeExePath(info, deps = {}) {
  const exists = typeof deps.existsSync === 'function' ? deps.existsSync : fs.existsSync;
  return installDetect
    .desktopExeCandidates(info?.installPath, runtimeTargetName(deps))
    .find((candidate) => exists(candidate)) || '';
}

function runtimeExeStamp(info, deps = {}) {
  const exe = runtimeExePath(info, deps);
  if (!exe) {
    return 0;
  }
  const statSync = typeof deps.statSync === 'function' ? deps.statSync : fs.statSync;
  try {
    return statSync(exe).mtimeMs;
  } catch {
    return 0;
  }
}

/**
 * Wait for the installer to finish and the desktop registration to settle.
 * NSIS re-launches elevated under UAC so the spawned child can exit long
 * before the install completes — completion is detected by the registry
 * record plus a changed/new main exe, not by the child alone.
 */
function waitForInstall(child, baseline, signal, onProgress, deps = {}) {
  const waitMs = deps.waitMs || INSTALL_WAIT_MS;
  const pollMs = deps.pollMs || INSTALL_POLL_MS;
  return new Promise((resolve) => {
    let done = false;
    const finish = (value) => {
      if (done) {
        return;
      }
      done = true;
      clearTimeout(cap);
      clearInterval(timer);
      if (signal) {
        signal.removeEventListener('abort', onAbort);
      }
      resolve(value);
    };
    const onAbort = () => finish('aborted');
    if (signal) {
      signal.addEventListener('abort', onAbort, { once: true });
    }
    const childDone = { fired: false };
    if (child && typeof child.once === 'function') {
      child.once('exit', () => {
        childDone.fired = true;
      });
      child.once('error', () => {
        childDone.fired = true;
      });
    } else {
      childDone.fired = true;
    }
    const cap = setTimeout(() => finish('timeout'), waitMs);
    const started = Date.now();
    const timer = setInterval(() => {
      let info = null;
      try {
        info = installedInfo({ fresh: true, deps });
      } catch {
        // keep polling
      }
      const exe = runtimeExePath(info, deps);
      const stamp = runtimeExeStamp(info, deps);
      const settled = Boolean(info?.registeredInstall && exe)
        && (info.version !== baseline.version || stamp !== baseline.stamp
          || (!baseline.registeredInstall && !baseline.stamp));
      // A same-version repair changes nothing in the record: once the
      // installer process is gone AND the registry is populated, accept it.
      const reinstallSettled = childDone.fired
        && Boolean(info?.registeredInstall && exe)
        && Date.now() - started > (deps.reinstallSettleMs ?? 10_000);
      if (settled || reinstallSettled) {
        finish(info);
        return;
      }
      if (typeof onProgress === 'function') {
        onProgress({ phase: 'install-wait', installerDone: childDone.fired });
      }
    }, pollMs);
  });
}

let runtimeAbort = null;

function cancelRuntimeInstall() {
  if (!runtimeAbort) {
    return { ok: false };
  }
  runtimeAbort.abort();
  return { ok: true };
}

/**
 * Download + install the managed desktop runtime through a route.
 * `deps.confirmUnverified` gates releases without a checksum manifest.
 * Returns plain IPC-safe objects only — the installer child handle is
 * consumed internally and never crosses the wire.
 */
async function installRuntime(options = {}, onProgress, deps = {}) {
  if (runtimeAbort) {
    return { ok: false, status: 'error', error: 'install-in-progress', message: '已有安装任务进行中' };
  }
  const updateMod = deps.update || update;
  const source = deps.releaseSource || releaseSource;
  const route = source.normalizeRoute(options.route)
    || configuredRoute(deps)
    || 'github';
  const tag = typeof options.tag === 'string' ? options.tag.trim() : '';
  const controller = new AbortController();
  runtimeAbort = controller;
  try {
    if (typeof onProgress === 'function') {
      onProgress({ phase: 'resolve', percent: 0 });
    }
    const installed = installedInfo({ fresh: true, deps });
    const info = tag
      ? await source.releaseFor(route, tag, { installedVersion: installed.version })
      : await source.latestFor(route, { installedVersion: installed.version });
    if (!info || info.status === 'error') {
      return {
        ok: false,
        status: 'error',
        route,
        message: info?.message || '获取版本信息失败',
        htmlUrl: source.ROUTES?.[route]?.page || '',
      };
    }
    if (!info.assetUrl) {
      return { ok: false, status: 'error', route, message: 'no-installer', htmlUrl: info.htmlUrl || '' };
    }
    const baseline = {
      registeredInstall: Boolean(installed.registeredInstall),
      version: installed.version || '',
      stamp: runtimeExeStamp(installed, deps),
    };
    let installerChild = null;
    const result = await updateMod.installFromAsset(info, onProgress, {
      signal: controller.signal,
      // The slim launcher must survive the install it is driving; the full
      // package keeps self-update semantics (quit when packaged).
      quitAfterInstall: isPackagedNow(deps) && !isLauncherPackageNow(deps),
      confirmUnverified: deps.confirmUnverified,
      onInstallerLaunch: (child) => {
        installerChild = child;
      },
      userDataDir: deps.userDataDir,
    });
    if (!result || result.launched !== true) {
      return { ok: false, route, ...(result || {}) };
    }
    // A packaged self-update quits this process — nothing left to adopt.
    if (isPackagedNow(deps) && !isLauncherPackageNow(deps)) {
      return { ok: true, route, status: 'quit-pending', installer: result.installer };
    }
    if (typeof onProgress === 'function') {
      onProgress({ phase: 'install-wait', percent: 100 });
    }
    const found = await waitForInstall(installerChild, baseline, controller.signal, onProgress, deps);
    invalidateInstalledCache();
    if (found === 'aborted') {
      return {
        ok: false,
        route,
        cancelled: true,
        status: 'waiting',
        message: '已停止等待安装结果；安装程序仍在运行，完成后会被识别，也可手动刷新。',
      };
    }
    if (found === 'timeout' || found === null) {
      return {
        ok: false,
        route,
        status: 'waiting',
        message: '安装程序已启动；完成后将被自动识别，也可稍后手动刷新状态。',
      };
    }
    return {
      ok: true,
      route,
      status: 'installed',
      installer: result.installer,
      installed: found,
    };
  } catch (error) {
    if (error && error.name === 'AbortError') {
      return { ok: false, route, cancelled: true, status: 'cancelled', message: '已取消下载' };
    }
    return { ok: false, route, status: 'error', message: error?.message || String(error) };
  } finally {
    if (runtimeAbort === controller) {
      runtimeAbort = null;
    }
  }
}

/**
 * Update snapshot for the managed runtime. When nothing is installed the
 * install card — not the cold-start update ask — is the right surface, so an
 * 'available' result is clamped to 'none' (there is nothing to update).
 */
async function checkDesktopUpdate({ route, timeoutMs } = {}, deps = {}) {
  const source = deps.releaseSource || releaseSource;
  const resolved = source.normalizeRoute(route) || configuredRoute(deps) || 'github';
  const installed = installedInfo({ fresh: true, deps });
  const snapshot = await source.latestFor(resolved, {
    installedVersion: installed.version,
    timeoutMs,
  });
  if (!installed.registeredInstall && snapshot.status === 'available') {
    return { ...snapshot, status: 'none' };
  }
  return snapshot;
}

// --- External process control (slim package owns no in-process runtime) ----

function probeDesktopRunning(deps = {}) {
  const target = deps.target !== undefined ? deps.target : runtimeTarget();
  return installDetect.probeDesktopProcess({ ...deps, target });
}

const START_ALIVE_MS = 12_000;
const START_POLL_MS = 400;

async function startExternalDesktop(argv = [], deps = {}) {
  const info = installedInfo({ fresh: true, deps });
  if (!info.registeredInstall || !info.installPath) {
    return { ok: false, error: 'runtime-not-installed' };
  }
  const exe = runtimeExePath(info, deps);
  if (!exe) {
    return { ok: false, error: 'runtime-exe-missing', installPath: info.installPath };
  }
  const doSpawn = deps.spawn || spawn;
  const child = doSpawn(exe, ['--dshd-from-launcher', ...argv], {
    detached: true,
    stdio: 'ignore',
    windowsHide: false,
  });
  // A rejected spawn reports through the error event on the next tick; an
  // unhandled 'error' on a ChildProcess would take the whole launcher down.
  let spawnError = null;
  child.on('error', (error) => {
    spawnError = error;
  });
  child.unref();
  // A successful spawn only proves a child existed for a moment: a runtime
  // that loses its own single-instance race or crashes on boot exits within
  // a second, and reporting ok here would leave the launcher hidden with no
  // working surface. Hold the verdict until the process is still alive at
  // the end of a short grace window.
  const aliveMs = deps.aliveMs ?? START_ALIVE_MS;
  const pollMs = deps.pollMs ?? START_POLL_MS;
  const probe = () => probeDesktopRunning({ ...deps });
  const deadline = Date.now() + aliveMs;
  let seen = false;
  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, Math.min(pollMs, Math.max(0, deadline - Date.now()))));
    if (spawnError) {
      return { ok: false, error: spawnError.message || 'runtime-spawn-failed', exe };
    }
    const alive = probe();
    if (alive) {
      seen = true;
      continue;
    }
    if (seen) {
      // Appeared in the process table then vanished before the grace ended.
      return { ok: false, error: 'runtime-exited', exe };
    }
  }
  return probe()
    ? { ok: true, launched: true, external: true, exe }
    : { ok: false, error: seen ? 'runtime-exited' : 'runtime-never-started', exe };
}

async function stopExternalDesktop(deps = {}) {
  const target = deps.target !== undefined ? deps.target : (runtimeTarget() || installDetect.DESKTOP_TARGET);
  const image = `${target.productName}.exe`;
  const exec = deps.execFileSync || execFileSync;
  const probe = () => probeDesktopRunning({ ...deps, target });
  if (!probe()) {
    return { ok: true, stopped: false };
  }
  try {
    // Graceful first (WM_CLOSE); a tray-parked app may still be alive after.
    exec('taskkill', ['/IM', image], { windowsHide: true });
  } catch {
    // already gone between probe and kill
  }
  const grace = deps.stopGraceMs ?? 5000;
  const deadline = Date.now() + grace;
  while (probe() && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, Math.min(250, deadline - Date.now())));
  }
  if (probe()) {
    try {
      exec('taskkill', ['/IM', image, '/F', '/T'], { windowsHide: true });
    } catch {
      // best effort already attempted
    }
  }
  return { ok: true, stopped: !probe() };
}

module.exports = {
  installedInfo,
  invalidateInstalledCache,
  configuredRoute,
  checkDesktopUpdate,
  installRuntime,
  cancelRuntimeInstall,
  startExternalDesktop,
  stopExternalDesktop,
  probeDesktopRunning,
  waitForInstall,
};
