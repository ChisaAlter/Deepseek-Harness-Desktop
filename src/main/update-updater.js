'use strict';

/**
 * electron-updater channel for the "install latest release" path.
 *
 * Why this exists as a separate module: `update.js` owns the GitHub-API check,
 * the release list, the unverified-manifest gate, and the whole-file download
 * fallback. This file only wraps the updater download+install so that seam can
 * be mocked in unit tests and so `require('electron-updater')` never executes
 * in contexts where app-update.yml does not exist (dev runs, unit tests).
 *
 * Differential mechanics (electron-builder NSIS): the updater downloads the
 * new package's `.blockmap`, derives the OLD version's blockmap URL from the
 * same release-asset naming, and serves unchanged chunks from the previous
 * installer that NSIS copied into `%LOCALAPPDATA%\<app>-updater\installer.exe`
 * at install time. Any failure along that chain (missing old blockmap, absent
 * cached installer, block-version mismatch) falls back inside the updater to
 * a full download; a failure of the updater path itself falls back in
 * update.js to the legacy whole-file download.
 */

const path = require('path');
const fs = require('fs');
const { app } = require('electron');

const PRODUCT_NAME = 'Deepseek-Harness-Desktop';

function readPackagedFlag(deps) {
  if (deps && deps.isPackaged !== undefined) {
    return deps.isPackaged;
  }
  try {
    return app.isPackaged;
  } catch {
    return false;
  }
}

/**
 * The NSIS installer self-copies to this cache on every install, and the
 * updater diff-sources unchanged blocks from it. Its presence means the
 * differential path CAN engage; the actual block-level savings are decided by
 * the two blockmaps at download time.
 */
function cachedInstallerPath() {
  const base = process.env.LOCALAPPDATA;
  if (!base) {
    return '';
  }
  return path.join(base, `${PRODUCT_NAME.toLowerCase()}-updater`, 'installer.exe');
}

/**
 * Parse the differential downloader's own report line
 * ("Full: 636 MB, To download: 44 MB (7%)") for the real download share.
 * The cached-installer check is only a label estimate for the ticks that
 * arrive before that line — when the line never appears the updater took
 * the full-download path and the estimate must not survive.
 */
function makeDifferentialTracker(deps) {
  const tracker = { differential: false, downloadPercent: null };
  tracker.log = (message) => {
    const match = /To download:\s*[\d.,]+\s*\w+\s*\((\d+)%\)/.exec(String(message || ''));
    if (match) {
      tracker.differential = true;
      tracker.downloadPercent = Number.parseInt(match[1], 10);
    }
  };
  // Estimate for early progress ticks before the downloader's own report
  // arrives: a cached installer means the differential path can engage.
  tracker.estimated = () => {
    try {
      return Boolean(deps && deps.existsSync && deps.existsSync(cachedInstallerPath()));
    } catch {
      return false;
    }
  };
  // Ground truth is the downloader's own line — when it never appears the
  // updater took the full-download path, whatever the estimate said.
  tracker.finish = () => tracker;
  return tracker;
}

/**
 * Logger shim: forwards updater internals to the tracker so the real
 * differential percentage is observable without depending on event shapes.
 */
function makeLogger(tracker, sink) {
  return {
    info: (m) => { tracker.log(m); if (sink && sink.info) sink.info(m); },
    warn: (m) => { if (sink && sink.warn) sink.warn(m); },
    error: (m) => { if (sink && sink.error) sink.error(m); },
    debug: () => {},
  };
}

/**
 * Download the latest release through electron-updater and install it.
 *
 * @param {object} args
 * @param {number} args.timeoutMs - wall-clock budget for the whole download.
 * @param {function} [onProgress] - receives `{phase:'download'|'install', percent, differential}`.
 * @param {object} [deps] - test seams: `autoUpdater`, `isPackaged`,
 *   `existsSync`, `CancellationToken`, `logger`, `setTimeout`/`clearTimeout`.
 * @returns {Promise<{ok:true, launched:true, differential:boolean, version:string}|{ok:false, reason:string}>}
 *   `ok:false` tells the caller to use the legacy whole-file path instead.
 */
async function installLatestViaUpdater({ timeoutMs } = {}, onProgress, deps = {}) {
  if (!readPackagedFlag(deps)) {
    return { ok: false, reason: 'not-packaged' };
  }
  const platform = deps.platform || process.platform;
  if (platform !== 'win32') {
    // Only the NSIS blockmap channel is wired up (latest.yml + Setup
    // blockmaps). macOS updates keep the whole-file path — let the caller
    // fall back instead of probing for a latest-mac.yml we never publish.
    return { ok: false, reason: 'not-windows' };
  }
  let autoUpdater = deps.autoUpdater || null;
  let CancellationToken = deps.CancellationToken || null;
  if (!autoUpdater) {
    try {
      const mod = require('electron-updater');
      autoUpdater = mod.autoUpdater;
      CancellationToken = CancellationToken || mod.CancellationToken;
    } catch {
      return { ok: false, reason: 'updater-module-unavailable' };
    }
  }

  const existsSync = deps.existsSync || fs.existsSync.bind(fs);
  const tracker = makeDifferentialTracker({ existsSync });
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = false;
  autoUpdater.logger = makeLogger(tracker, deps.logger || null);

  const onProgressEvent = (progress) => {
    if (typeof onProgress !== 'function') {
      return;
    }
    const percent = Math.max(0, Math.min(99, Math.round(Number(progress && progress.percent) || 0)));
    onProgress({ phase: 'download', percent, differential: tracker.differential || tracker.estimated() });
  };
  const onErrorEvent = () => {};
  autoUpdater.on('download-progress', onProgressEvent);
  // 'error' must have a listener or EventEmitter throws unhandled; the
  // checkForUpdates/downloadUpdate rejections carry the real failure.
  autoUpdater.on('error', onErrorEvent);

  const setTimeoutFn = deps.setTimeout || setTimeout;
  const clearTimeoutFn = deps.clearTimeout || clearTimeout;
  const timeoutSentinel = Symbol('updater-timeout');
  let cancelled = false;
  let timeoutHandle;
  const token = CancellationToken ? new CancellationToken() : null;
  const timeoutPromise = new Promise((resolve) => {
    timeoutHandle = setTimeoutFn(() => {
      cancelled = true;
      try {
        if (token) {
          token.cancel();
        }
      } catch {
        // a stuck token must not block the timeout result
      }
      resolve(timeoutSentinel);
    }, Math.max(1_000, Number(timeoutMs) || 15 * 60_000));
  });
  // checkForUpdates does not honor autoUpdater.cancellationToken — only the
  // race guarantees the wall-clock budget when the manifest fetch stalls.
  const timed = (pending) => Promise.race([pending, timeoutPromise]);
  const timeoutOutcome = () => ({
    ok: false,
    reason: 'timeout',
    message: `下载超时（${Math.round((Number(timeoutMs) || 15 * 60_000) / 60_000)} 分钟）`,
  });

  try {
    if (token) {
      autoUpdater.cancellationToken = token;
    }
    const check = await timed(autoUpdater.checkForUpdates());
    if (check === timeoutSentinel) {
      return timeoutOutcome();
    }
    const info = check && (check.updateInfo
      || (check.updateInfoAndProvider && check.updateInfoAndProvider.info)
      || null);
    if (!info || !info.version) {
      return { ok: false, reason: 'no-update-in-manifest' };
    }
    const downloaded = await timed(autoUpdater.downloadUpdate());
    if (downloaded === timeoutSentinel) {
      return timeoutOutcome();
    }
    const result = tracker.finish();
    if (typeof onProgress === 'function') {
      onProgress({ phase: 'install', percent: 100, differential: result.differential });
    }
    autoUpdater.quitAndInstall(true, true);
    return {
      ok: true,
      launched: true,
      differential: result.differential,
      downloadPercent: result.downloadPercent,
      version: String(info.version),
    };
  } catch (error) {
    if (cancelled) {
      return timeoutOutcome();
    }
    return { ok: false, reason: 'updater-error', message: error && error.message ? error.message : String(error) };
  } finally {
    clearTimeoutFn(timeoutHandle);
    try {
      autoUpdater.cancellationToken = null;
      autoUpdater.removeListener('download-progress', onProgressEvent);
      autoUpdater.removeListener('error', onErrorEvent);
    } catch {
      // listener cleanup must never mask the result
    }
  }
}

module.exports = {
  installLatestViaUpdater,
  cachedInstallerPath,
  makeDifferentialTracker,
};
