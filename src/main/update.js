const crypto = require('crypto');
const fs = require('fs');
const https = require('https');
const path = require('path');
const { spawn } = require('child_process');
const { app, shell } = require('electron');
const { installLatestViaUpdater } = require('./update-updater');
const installDetect = require('../launcher/install-detect');
const { currentVersion, getInstalledAppInfo } = installDetect;

const GITHUB_OWNER = 'ChisaAlter';
const GITHUB_REPO = 'Deepseek-Harness-Desktop';
const RELEASES_LATEST = `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/releases/latest`;
const RELEASES_LIST = `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/releases?per_page=30`;
const RELEASES_PAGE = `https://github.com/${GITHUB_OWNER}/${GITHUB_REPO}/releases`;
const REPO_URL = `https://github.com/${GITHUB_OWNER}/${GITHUB_REPO}`;
/** API check budget: a hung GitHub must not stall the cold-start gate. */
const CHECK_TIMEOUT_MS = 10_000;
/** Whole-download budget for one Setup asset (hundreds of MB on slow links). */
const DOWNLOAD_TIMEOUT_MS = 15 * 60_000;
/**
 * Release asset with `sha512sum` lines for every installer. Releases that
 * carry it get mandatory post-download verification; older releases without
 * it install unverified (documented limitation, not an error).
 */
const CHECKSUM_ASSET_NAME = 'SHA512SUMS.txt';

/**
 * Lazy shell `config.githubToken` source, injected by src/main/index.js so
 * this module stays loadable outside Electron (unit tests). The token is only
 * ever placed in an Authorization header toward GitHub hosts; it must never
 * be logged or embedded in error messages.
 */
let githubTokenProvider = null;

function setGithubTokenProvider(provider) {
  githubTokenProvider = typeof provider === 'function' ? provider : null;
}

function githubToken() {
  if (!githubTokenProvider) {
    return '';
  }
  try {
    const token = githubTokenProvider();
    return typeof token === 'string' ? token.trim() : '';
  } catch {
    return '';
  }
}

/** Hosts allowed to receive the Authorization header (never signed CDN redirects). */
function isGithubHost(url) {
  try {
    const host = new URL(String(url || '')).hostname.toLowerCase();
    return host === 'api.github.com' || host === 'github.com' || host === 'www.github.com';
  } catch {
    return false;
  }
}

function githubHeaders(accept = 'application/vnd.github+json') {
  const headers = {
    Accept: accept,
    'User-Agent': `Deepseek-Harness-Desktop/${currentVersion()}`,
    'X-GitHub-Api-Version': '2022-11-28',
  };
  const token = githubToken();
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }
  return headers;
}

function normalizeVersion(value) {
  return String(value || '')
    .trim()
    .replace(/^v/i, '')
    .split(/[+-]/)[0];
}

function compareVersions(left, right) {
  const a = normalizeVersion(left).split('.').map((part) => Number.parseInt(part, 10) || 0);
  const b = normalizeVersion(right).split('.').map((part) => Number.parseInt(part, 10) || 0);
  const len = Math.max(a.length, b.length);
  for (let i = 0; i < len; i += 1) {
    const delta = (a[i] || 0) - (b[i] || 0);
    if (delta !== 0) {
      return delta > 0 ? 1 : -1;
    }
  }
  return 0;
}

function pickInstaller(assets) {
  const list = Array.isArray(assets) ? assets : [];
  const exes = list.filter((asset) => typeof asset?.name === 'string'
    && /\.exe$/i.test(asset.name)
    && !/\.blockmap$/i.test(asset.name)
    && typeof asset.browser_download_url === 'string');
  return exes.find((asset) => /setup|nsis|installer/i.test(asset.name))
    || exes.find((asset) => !/portable/i.test(asset.name))
    || exes[0]
    || null;
}

function pickChecksumAsset(assets) {
  const list = Array.isArray(assets) ? assets : [];
  return list.find((asset) => typeof asset?.name === 'string'
    && asset.name.toLowerCase() === CHECKSUM_ASSET_NAME.toLowerCase()
    && typeof asset.browser_download_url === 'string') || null;
}

/**
 * Parse `sha512sum` output: one `<128-hex>  <filename>` line per asset
 * (`*` binary-mode marker tolerated).
 * @param {string} text
 * @returns {Map<string, string>} filename -> lower-case hex digest
 */
function parseSha512Sums(text) {
  const sums = new Map();
  for (const line of String(text || '').split(/\r?\n/)) {
    const match = line.match(/^([0-9a-fA-F]{128})\s+\*?(.+?)\s*$/);
    if (match) {
      sums.set(match[2], match[1].toLowerCase());
    }
  }
  return sums;
}

function sha512HexOfFile(file) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha512');
    const stream = fs.createReadStream(file);
    stream.on('error', reject);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('end', () => resolve(hash.digest('hex')));
  });
}

/**
 * Mandatory verification once a release carries SHA512SUMS.txt: any failure
 * (manifest fetch, missing entry, digest mismatch) throws so the installer
 * is never launched from a partial or tampered download.
 * @param {string} dest - downloaded installer path.
 * @param {string} assetName - original release asset name (manifest key).
 * @param {string} checksumUrl - browser_download_url of SHA512SUMS.txt.
 */
async function verifyAssetChecksum(dest, assetName, checksumUrl) {
  let response;
  try {
    response = await fetch(checksumUrl, {
      headers: downloadHeaders(true, checksumUrl),
      signal: AbortSignal.timeout(CHECK_TIMEOUT_MS),
    });
  } catch (error) {
    if (isTimeoutError(error)) {
      throw new Error('校验清单下载超时');
    }
    throw new Error(`校验清单下载失败：${error.message || String(error)}`);
  }
  if (!response.ok) {
    throw new Error(`校验清单下载失败（${response.status}）`);
  }
  const sums = parseSha512Sums(await response.text());
  const expected = sums.get(assetName);
  if (!expected) {
    throw new Error(`校验清单缺少 ${assetName} 的条目`);
  }
  const actual = await sha512HexOfFile(dest);
  if (actual !== expected) {
    throw new Error('安装包校验失败（sha512 不匹配），已删除下载文件');
  }
}

function isTimeoutError(error) {
  return error instanceof Error
    && (error.name === 'TimeoutError' || error.name === 'AbortError');
}

async function githubJson(url, timeoutMs = CHECK_TIMEOUT_MS) {
  let response;
  try {
    response = await fetch(url, {
      headers: githubHeaders(),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    if (isTimeoutError(error)) {
      throw new Error(`GitHub 请求超时（${Math.round(timeoutMs / 1000)}s）`);
    }
    throw error;
  }
  if (response.status === 404) {
    return null;
  }
  if (!response.ok) {
    throw new Error(`GitHub ${response.status}`);
  }
  return response.json();
}

function snapshot(extra = {}) {
  return {
    current: currentVersion(),
    repo: `${GITHUB_OWNER}/${GITHUB_REPO}`,
    repoUrl: REPO_URL,
    releasesUrl: RELEASES_PAGE,
    ...extra,
  };
}

/**
 * In-flight single-flight for the cold-start gate: the gate no longer waits for
 * this request, so a user opening the launcher while the first check is still
 * running must not start a second one. Settled results are NOT cached here —
 * an explicit refresh always issues a fresh request.
 */
let checkUpdateInFlight = null;

async function runUpdateCheck() {
  try {
    const release = await githubJson(RELEASES_LATEST);
    if (!release) {
      return snapshot({
        status: 'none',
        latest: '',
        htmlUrl: RELEASES_PAGE,
        assetName: '',
        assetUrl: '',
      });
    }
    const latest = normalizeVersion(release.tag_name || release.name);
    const asset = pickInstaller(release.assets);
    const checksum = pickChecksumAsset(release.assets);
    const newer = latest && compareVersions(latest, currentVersion()) > 0;
    return snapshot({
      status: newer ? 'available' : 'current',
      latest,
      tag: release.tag_name || latest,
      htmlUrl: release.html_url || RELEASES_PAGE,
      notes: typeof release.body === 'string' ? release.body : '',
      assetName: asset?.name || '',
      assetUrl: asset?.browser_download_url || '',
      checksumUrl: checksum?.browser_download_url || '',
    });
  } catch (error) {
    return snapshot({
      status: 'error',
      latest: '',
      htmlUrl: RELEASES_PAGE,
      assetName: '',
      assetUrl: '',
      message: error.message || String(error),
    });
  }
}

async function checkUpdate() {
  if (checkUpdateInFlight) {
    return checkUpdateInFlight;
  }
  const pending = runUpdateCheck();
  checkUpdateInFlight = pending;
  try {
    return await pending;
  } finally {
    if (checkUpdateInFlight === pending) {
      checkUpdateInFlight = null;
    }
  }
}

function downloadHeaders(firstHop, url) {
  const headers = {
    'User-Agent': `Deepseek-Harness-Desktop/${currentVersion()}`,
  };
  if (firstHop) {
    headers.Accept = 'application/octet-stream';
    headers['X-GitHub-Api-Version'] = '2022-11-28';
    // First hop only, GitHub hosts only: redirect targets are signed CDN
    // URLs that reject requests carrying both a signature and an auth header.
    const token = githubToken();
    if (token && isGithubHost(url)) {
      headers.Authorization = `Bearer ${token}`;
    }
  }
  return headers;
}

function cleanupPartial(dest) {
  try {
    fs.unlinkSync(dest);
  } catch {
    // ignore missing partials
  }
}

function cancelledError() {
  const error = new Error('下载已取消');
  error.name = 'AbortError';
  return error;
}

function downloadFile(url, dest, onProgress, { timeoutMs = DOWNLOAD_TIMEOUT_MS, signal } = {}) {
  if (signal?.aborted) {
    return Promise.reject(cancelledError());
  }
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(dest);
    let settled = false;
    let activeRequest = null;
    const onAbort = () => fail(cancelledError());
    const releaseSignal = () => {
      if (signal) {
        signal.removeEventListener('abort', onAbort);
      }
    };
    const fail = (error) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(deadline);
      releaseSignal();
      if (activeRequest) {
        activeRequest.destroy();
      }
      file.close(() => {
        cleanupPartial(dest);
        reject(error);
      });
    };
    if (signal) {
      signal.addEventListener('abort', onAbort, { once: true });
    }
    // One wall-clock budget for the whole download (all redirect hops): a
    // stalled connection must not park the launcher on "下载 0%" forever.
    const deadline = setTimeout(() => {
      fail(new Error(`下载超时（${Math.round(timeoutMs / 60_000)} 分钟）`));
    }, timeoutMs);
    const visit = (target, hops) => {
      if (hops > 8) {
        fail(new Error('Too many redirects'));
        return;
      }
      const request = https.get(target, {
        headers: downloadHeaders(hops === 0, target),
      }, (response) => {
        const location = response.headers.location;
        if (response.statusCode && response.statusCode >= 300 && response.statusCode < 400 && location) {
          response.resume();
          visit(location, hops + 1);
          return;
        }
        if (response.statusCode !== 200) {
          response.resume();
          fail(new Error(`Download ${response.statusCode}`));
          return;
        }
        const total = Number(response.headers['content-length']) || 0;
        let received = 0;
        response.on('data', (chunk) => {
          received += chunk.length;
          if (total > 0 && typeof onProgress === 'function') {
            onProgress({
              phase: 'download',
              percent: Math.min(99, Math.round((received / total) * 100)),
              received,
              total,
            });
          }
        });
        // A reset or aborted body would otherwise just end the pipe and look
        // like a completed download; fail it and drop the partial file.
        response.on('error', (error) => {
          fail(new Error(`下载连接中断：${error && error.message ? error.message : String(error)}`));
        });
        response.on('aborted', () => {
          fail(new Error('下载连接中断（服务器提前断开）'));
        });
        response.pipe(file);
        file.on('finish', () => {
          if (settled) {
            return;
          }
          if (total > 0 && received !== total) {
            fail(new Error(`下载不完整（${received}/${total} 字节），已删除未完成文件`));
            return;
          }
          settled = true;
          clearTimeout(deadline);
          releaseSignal();
          file.close(() => resolve(dest));
        });
      });
      activeRequest = request;
      request.on('error', fail);
    };
    file.on('error', fail);
    visit(url, 0);
  });
}

function launchInstaller(file) {
  const child = spawn(file, [], {
    detached: true,
    stdio: 'ignore',
    windowsHide: false,
  });
  child.unref();
  return child;
}

function summarizeRelease(release, current) {
  if (!release || release.draft) {
    return null;
  }
  const asset = pickInstaller(release.assets);
  const checksum = pickChecksumAsset(release.assets);
  const version = normalizeVersion(release.tag_name || release.name);
  const compared = version ? compareVersions(version, current) : 0;
  return {
    tag: release.tag_name || '',
    version,
    prerelease: Boolean(release.prerelease),
    htmlUrl: release.html_url || RELEASES_PAGE,
    notes: typeof release.body === 'string' ? release.body : '',
    current: Boolean(version) && compared === 0,
    newer: Boolean(version) && compared > 0,
    older: Boolean(version) && compared < 0,
    assetName: asset?.name || '',
    assetUrl: asset?.browser_download_url || '',
    checksumUrl: checksum?.browser_download_url || '',
    installable: Boolean(asset),
  };
}

async function listReleases() {
  try {
    const list = await githubJson(RELEASES_LIST);
    const current = currentVersion();
    const releases = (Array.isArray(list) ? list : [])
      .map((row) => summarizeRelease(row, current))
      .filter(Boolean);
    return snapshot({ status: 'ok', releases, installed: getInstalledAppInfo() });
  } catch (error) {
    return snapshot({
      status: 'error',
      releases: [],
      installed: getInstalledAppInfo(),
      message: error.message || String(error),
    });
  }
}

async function installFromAsset(info, onProgress, options = {}) {
  if (!info?.assetUrl) {
    if (info?.htmlUrl) {
      await shell.openExternal(info.htmlUrl);
    }
    return { ...info, launched: false, openedPage: Boolean(info?.htmlUrl) };
  }
  if (!info.checksumUrl) {
    // No SHA512SUMS.txt on this release: never install unverified silently.
    // The caller must supply a user confirmation; absent or declined, the
    // download does not even start (fail closed).
    const confirm = options.confirmUnverified;
    const confirmed = typeof confirm === 'function' ? await confirm(info) : false;
    if (confirmed !== true) {
      return {
        ...info,
        launched: false,
        openedPage: false,
        unverified: true,
        declined: true,
        message: '该版本未提供 SHA512SUMS.txt 校验清单，已取消未校验安装',
      };
    }
  }
  if (options.preferUpdater) {
    try {
      const outcome = await installLatestViaUpdater(
        { timeoutMs: DOWNLOAD_TIMEOUT_MS },
        onProgress,
        { ...options.updaterDeps, taskProtection: options.taskProtection },
      );
      if (outcome && outcome.ok) {
        return {
          ...info,
          launched: true,
          updater: true,
          differential: Boolean(outcome.differential),
          downloadPercent: outcome.downloadPercent ?? null,
        };
      }
      if (outcome && outcome.reason === 'cancelled') {
        // A cancelled protection prompt is a decision, not an updater
        // shortfall — never fall back into the installer path.
        return { ...info, launched: false, cancelled: true, code: 'cancelled' };
      }
      console.warn(`electron-updater path unavailable (${outcome && outcome.reason}); falling back to full download${outcome && outcome.message ? `: ${outcome.message}` : ''}`);
    } catch (error) {
      // The updater channel is an optimization: any failure falls back to the
      // verified whole-file download below, which is fully independent.
      console.warn('electron-updater path failed, falling back to full download:', error && error.message ? error.message : error);
    }
  }
  if (typeof onProgress === 'function') {
    onProgress({ phase: 'download', percent: 0 });
  }
  const dir = path.join(options.userDataDir || app.getPath('userData'), 'updates');
  fs.mkdirSync(dir, { recursive: true });
  const safeName = path.basename(info.assetName || 'Whale-Isle-Setup.exe').replace(/[^\w.\-]+/g, '_');
  const dest = path.join(dir, safeName);
  await downloadFile(info.assetUrl, dest, onProgress, { signal: options.signal });
  if (info.checksumUrl) {
    if (typeof onProgress === 'function') {
      onProgress({ phase: 'verify' });
    }
    try {
      await verifyAssetChecksum(dest, info.assetName, info.checksumUrl);
    } catch (error) {
      cleanupPartial(dest);
      throw error;
    }
  }
  if (options.signal?.aborted) {
    cleanupPartial(dest);
    throw cancelledError();
  }
  if (typeof onProgress === 'function') {
    onProgress({ phase: 'install', percent: 100 });
  }
  // Caller-side gate (launcher runtime installs stop the managed desktop
  // first) and the task-protection check both run AFTER download + verify —
  // the download itself is not a destructive side effect.
  if (typeof options.beforeInstall === 'function') {
    const gate = await options.beforeInstall({ dest });
    if (gate && gate.ok === false) {
      return {
        ...info,
        launched: false,
        cancelled: gate.cancelled === true,
        code: gate.code || 'install-gated',
        message: gate.message,
      };
    }
  }
  const protection = options.taskProtection;
  if (protection && typeof protection.coordinate === 'function') {
    const willQuit = options.quitAfterInstall !== undefined
      ? Boolean(options.quitAfterInstall)
      : app.isPackaged;
    const result = await protection.coordinate('update', { terminal: willQuit });
    if (!result.proceeded) {
      return { ...info, launched: false, cancelled: true, code: result.code || 'cancelled' };
    }
  }
  const child = launchInstaller(dest);
  // The child handle lets a surviving caller (runtime install) observe the
  // installer's exit; it is consumed in-process and never crosses IPC.
  if (typeof options.onInstallerLaunch === 'function') {
    try {
      options.onInstallerLaunch(child);
    } catch {
      // observability hook only
    }
  }
  // Self-update semantics quit the packaged app so the installer can replace
  // it. A runtime install (slim launcher → desktop) must keep the launcher
  // alive to report progress, so callers opt out explicitly.
  const quitAfterInstall = options.quitAfterInstall !== undefined
    ? Boolean(options.quitAfterInstall)
    : app.isPackaged;
  if (quitAfterInstall) {
    setTimeout(() => app.quit(), 800);
  }
  return { ...info, launched: true, installer: dest };
}

async function installRelease(tag, onProgress, options = {}) {
  const raw = String(tag || '').trim();
  if (!raw) {
    return snapshot({ status: 'error', message: 'missing-tag', launched: false });
  }
  try {
    const release = await githubJson(
      `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/releases/tags/${encodeURIComponent(raw)}`,
    );
    if (!release) {
      return snapshot({ status: 'error', message: 'release-not-found', launched: false });
    }
    const summary = summarizeRelease(release, currentVersion());
    if (!summary) {
      return snapshot({ status: 'error', message: 'release-not-found', launched: false });
    }
    if (!summary.installable) {
      return snapshot({ ...summary, status: 'error', message: 'no-installer', launched: false });
    }
    return installFromAsset(summary, onProgress, options);
  } catch (error) {
    return snapshot({
      status: 'error',
      message: error.message || String(error),
      launched: false,
    });
  }
}

async function installUpdate(onProgress, options = {}) {
  // A confirmation already showed this exact release to the user. Do not
  // query /releases/latest again or let latest.yml move to a newer target.
  const confirmedCheck = options.expectedCheck;
  const info = confirmedCheck || await checkUpdate();
  if (info.status === 'error') {
    return { ...info, launched: false, openedPage: false };
  }
  if (confirmedCheck && info.status !== 'available') {
    return { ...info, launched: false, openedPage: false, status: 'error', message: 'confirmed-release-unavailable' };
  }
  return installFromAsset({
    ...info,
    assetUrl: info.assetUrl,
    assetName: info.assetName,
    checksumUrl: info.checksumUrl,
    htmlUrl: info.htmlUrl,
  }, onProgress, { ...options, preferUpdater: !confirmedCheck });
}

module.exports = {
  setGithubTokenProvider,
  GITHUB_OWNER,
  GITHUB_REPO,
  REPO_URL,
  RELEASES_PAGE,
  CHECK_TIMEOUT_MS,
  DOWNLOAD_TIMEOUT_MS,
  CHECKSUM_ASSET_NAME,
  checkUpdate,
  installUpdate,
  summarizeRelease,
  listReleases,
  installRelease,
  installFromAsset,
  downloadFile,
  launchInstaller,
  cleanupPartial,
  cancelledError,
  parseSha512Sums,
  verifyAssetChecksum,
  // Release-source (GitHub/Gitee mirror routes) builds on these primitives.
  githubJson,
  githubHeaders,
  normalizeVersion,
  compareVersions,
  pickInstaller,
  pickChecksumAsset,
  // Install detection moved to src/launcher/install-detect.js; re-exported so
  // existing consumers (index.js, ipc.js, tests) keep one import surface.
  ...installDetect,
};
