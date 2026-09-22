const crypto = require('crypto');
const fs = require('fs');
const https = require('https');
const path = require('path');
const { spawn, execFileSync } = require('child_process');
const { app, shell } = require('electron');
const { installLatestViaUpdater } = require('./update-updater');

const GITHUB_OWNER = 'ChisaAlter';
const GITHUB_REPO = 'Deepseek-Harness-Desktop';
const APP_ID = 'ai.deepseek.harness.gui';
const PRODUCT_NAME = 'Deepseek-Harness-Desktop';
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

function currentVersion() {
  try {
    return app.getVersion();
  } catch {
    return '0.0.0';
  }
}

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

async function checkUpdate() {
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

function downloadFile(url, dest, onProgress, { timeoutMs = DOWNLOAD_TIMEOUT_MS } = {}) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(dest);
    let settled = false;
    let activeRequest = null;
    const fail = (error) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(deadline);
      if (activeRequest) {
        activeRequest.destroy();
      }
      file.close(() => {
        cleanupPartial(dest);
        reject(error);
      });
    };
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

const WINDOWS_UNINSTALL_REL = 'Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall';
const WINDOWS_UNINSTALL_WOW = 'Software\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall';
const SETTINGS_APPS_URL = 'ms-settings:appsfeatures';

function readPackagedFlag() {
  try {
    return app.isPackaged;
  } catch {
    return false;
  }
}

function parseRegValue(output, name) {
  const match = String(output || '').match(new RegExp(`^\\s*${name}\\s+REG_(?:EXPAND_)?SZ\\s+(.+)$`, 'im'));
  return match ? match[1].trim() : '';
}

function parseRegUninstallString(output) {
  return parseRegValue(output, 'UninstallString');
}

function uninstallExeCandidates(installDir) {
  if (!installDir) {
    return [];
  }
  return [
    path.join(installDir, `Uninstall ${PRODUCT_NAME}.exe`),
    path.join(installDir, 'Uninstall.exe'),
  ];
}

function firstExistingPath(candidates, existsSync = fs.existsSync.bind(fs)) {
  for (const candidate of candidates) {
    if (candidate && existsSync(candidate)) {
      return candidate;
    }
  }
  return '';
}

function extractUninstallExe(uninstallCommand) {
  const quoted = String(uninstallCommand || '').match(/^"([^"]+\.exe)"/i);
  if (quoted) {
    return quoted[1];
  }
  const bare = String(uninstallCommand || '').match(/^([^\s]+\.exe)/i);
  return bare ? bare[1] : '';
}

function parseRegBlock(block, keyPath = '') {
  const displayName = parseRegValue(block, 'DisplayName');
  const uninstallCommand = parseRegUninstallString(block);
  const installPath = parseRegValue(block, 'InstallLocation')
    || parseRegValue(block, 'DisplayIcon').replace(/\\[^\\]+$/, '');
  const displayVersion = parseRegValue(block, 'DisplayVersion');
  if (!displayName && !installPath && !uninstallCommand) {
    return null;
  }
  return {
    key: keyPath,
    displayName,
    uninstallCommand,
    installPath: installPath.trim(),
    displayVersion,
  };
}

function uninstallRegistryKeyPaths() {
  const keys = [];
  for (const root of ['HKLM', 'HKCU']) {
    for (const rel of [WINDOWS_UNINSTALL_REL, WINDOWS_UNINSTALL_WOW]) {
      keys.push(`${root}\\${rel}\\${APP_ID}`);
    }
  }
  return keys;
}

function uninstallSearchRoots() {
  const roots = [];
  for (const hive of ['HKLM', 'HKCU']) {
    for (const rel of [WINDOWS_UNINSTALL_REL, WINDOWS_UNINSTALL_WOW]) {
      roots.push(`${hive}\\${rel}`);
    }
  }
  return roots;
}

function queryRegKey(key, deps = {}) {
  const execReg = deps.execFileSync || execFileSync;
  try {
    return execReg('reg', ['query', key], {
      encoding: 'utf8',
      windowsHide: true,
    });
  } catch {
    return '';
  }
}

function resolvePlatform(deps = {}) {
  return typeof deps.platform === 'string' ? deps.platform : process.platform;
}

function findRegisteredWindowsInstall(deps = {}) {
  if (resolvePlatform(deps) !== 'win32') {
    return null;
  }
  for (const key of uninstallRegistryKeyPaths()) {
    const parsed = parseRegBlock(queryRegKey(key, deps), key);
    if (parsed) {
      return parsed;
    }
  }
  const execReg = deps.execFileSync || execFileSync;
  for (const root of uninstallSearchRoots()) {
    try {
      const out = execReg('reg', [
        'query',
        root,
        '/s',
        '/f',
        PRODUCT_NAME,
      ], { encoding: 'utf8', windowsHide: true });
      const blocks = out.split(/\r?\n\r?\n/);
      for (const block of blocks) {
        if (!/DisplayName/i.test(block)) {
          continue;
        }
        const keyMatch = block.match(/^HKEY_[^\r\n]+/m);
        const parsed = parseRegBlock(block, keyMatch ? keyMatch[0] : root);
        if (parsed && (
          parsed.displayName.includes(PRODUCT_NAME)
          || parsed.uninstallCommand.includes(PRODUCT_NAME)
          || parsed.installPath.includes(PRODUCT_NAME)
        )) {
          return parsed;
        }
      }
    } catch {
      // try next root
    }
  }
  return null;
}

function discoverWindowsInstall(deps = {}) {
  const existsSync = deps.existsSync || fs.existsSync.bind(fs);
  const packaged = deps.isPackaged !== undefined ? deps.isPackaged : readPackagedFlag();
  const searchedPaths = [];

  if (resolvePlatform(deps) !== 'win32') {
    return {
      registered: packaged,
      installPath: packaged ? path.dirname(process.execPath) : '',
      version: packaged ? currentVersion() : '',
      uninstallCommand: '',
      uninstallMode: 'none',
      searchedPaths,
    };
  }

  if (packaged) {
    const installDir = path.dirname(process.execPath);
    for (const candidate of uninstallExeCandidates(installDir)) {
      searchedPaths.push(candidate);
    }
    const direct = firstExistingPath(uninstallExeCandidates(installDir), existsSync);
    if (direct) {
      return {
        registered: true,
        installPath: installDir,
        version: currentVersion(),
        uninstallCommand: direct,
        uninstallMode: 'direct',
        searchedPaths,
      };
    }
  }

  const registered = findRegisteredWindowsInstall(deps);
  if (!registered) {
    return {
      registered: false,
      installPath: packaged ? path.dirname(process.execPath) : '',
      version: packaged ? currentVersion() : '',
      uninstallCommand: '',
      uninstallMode: 'none',
      searchedPaths,
    };
  }

  if (registered.installPath) {
    for (const candidate of uninstallExeCandidates(registered.installPath)) {
      searchedPaths.push(candidate);
    }
    const fromInstallDir = firstExistingPath(uninstallExeCandidates(registered.installPath), existsSync);
    if (fromInstallDir) {
      return {
        registered: true,
        installPath: registered.installPath,
        version: registered.displayVersion || '',
        uninstallCommand: fromInstallDir,
        uninstallMode: 'direct',
        searchedPaths,
        registryKey: registered.key,
      };
    }
  }

  if (registered.uninstallCommand) {
    const uninstallExe = extractUninstallExe(registered.uninstallCommand);
    if (uninstallExe) {
      searchedPaths.push(uninstallExe);
      if (existsSync(uninstallExe)) {
        return {
          registered: true,
          installPath: registered.installPath,
          version: registered.displayVersion || '',
          uninstallCommand: registered.uninstallCommand,
          uninstallMode: 'direct',
          searchedPaths,
          registryKey: registered.key,
        };
      }
    }
    return {
      registered: true,
      installPath: registered.installPath,
      version: registered.displayVersion || '',
      uninstallCommand: registered.uninstallCommand,
      uninstallMode: 'settings',
      searchedPaths,
      registryKey: registered.key,
    };
  }

  return {
    registered: true,
    installPath: registered.installPath,
    version: registered.displayVersion || '',
    uninstallCommand: '',
    uninstallMode: 'settings',
    searchedPaths,
    registryKey: registered.key,
  };
}

async function openWindowsAppsSettings(deps = {}) {
  const doSpawn = deps.spawn || spawn;
  try {
    await shell.openExternal(SETTINGS_APPS_URL);
    return true;
  } catch {
    try {
      const child = doSpawn('control.exe', ['appwiz.cpl'], {
        detached: true,
        stdio: 'ignore',
        windowsHide: false,
      });
      child.unref();
      return true;
    } catch {
      return false;
    }
  }
}

function getInstalledAppInfo(deps = {}) {
  const packaged = deps.isPackaged !== undefined ? deps.isPackaged : readPackagedFlag();
  let runningVersion = '0.0.0';
  try {
    runningVersion = currentVersion();
  } catch {
    // outside Electron (unit tests)
  }

  const discovery = discoverWindowsInstall(deps);
  const runningFromSource = !packaged;
  const registeredInstall = discovery.registered;
  const uninstallAvailable = discovery.uninstallMode === 'direct'
    || discovery.uninstallMode === 'settings';

  let version = runningVersion;
  let installPath = '';
  if (registeredInstall) {
    version = discovery.version || runningVersion;
    installPath = discovery.installPath || '';
  } else if (packaged) {
    try {
      installPath = path.dirname(process.execPath);
    } catch {
      installPath = '';
    }
  }

  const uninstallUsesSettings = discovery.uninstallMode === 'settings';
  const searchedLabel = discovery.searchedPaths.length
    ? discovery.searchedPaths.join('、')
    : '安装目录与注册表';

  let uninstallNote = '';
  if (runningFromSource && !registeredInstall) {
    uninstallNote = '当前为源码运行，无本机安装包可卸载。请用「设置 → 应用」卸载已安装的 Deepseek-Harness-Desktop。';
  } else if (runningFromSource && registeredInstall) {
    uninstallNote = discovery.uninstallMode === 'direct'
      ? '当前为源码运行；卸载将移除本机已安装的 Setup 版本。'
      : '已检测到本机安装记录，但未找到卸载程序。可打开「设置 → 应用」手动卸载。';
  } else if (uninstallUsesSettings) {
    uninstallNote = `未找到卸载程序（已查找：${searchedLabel}）。可打开「设置 → 应用」手动卸载。`;
  } else if (packaged && discovery.uninstallMode === 'none') {
    uninstallNote = `未找到卸载程序（已查找：${searchedLabel}）。可打开「设置 → 应用」手动卸载。`;
  }

  return {
    version,
    installPath,
    packaged,
    runningFromSource,
    registeredInstall,
    uninstallAvailable,
    uninstallUsesSettings,
    uninstallNote,
    searchedPaths: discovery.searchedPaths,
  };
}

async function launchUninstaller(deps = {}) {
  const packaged = deps.isPackaged !== undefined ? deps.isPackaged : readPackagedFlag();
  const existsSync = deps.existsSync || fs.existsSync.bind(fs);
  const doSpawn = deps.spawn || spawn;
  const discovery = discoverWindowsInstall(deps);
  const searchedLabel = discovery.searchedPaths.length
    ? discovery.searchedPaths.join('、')
    : '安装目录与注册表';

  if (discovery.uninstallMode === 'direct' && discovery.uninstallCommand) {
    // Never spawn the registry UninstallString through a shell: the value is
    // attacker-influenceable text. Use the plain exe path when the command is
    // one, otherwise extract the quoted/leading exe and verify it exists.
    const uninstallExe = existsSync(discovery.uninstallCommand)
      ? discovery.uninstallCommand
      : extractUninstallExe(discovery.uninstallCommand);
    if (uninstallExe && existsSync(uninstallExe)) {
      const child = doSpawn(uninstallExe, [], {
        detached: true,
        stdio: 'ignore',
        windowsHide: false,
      });
      child.unref();
      return { ok: true, mode: 'direct' };
    }
    const opened = await openWindowsAppsSettings(deps);
    if (opened) {
      return {
        ok: true,
        openedSettings: true,
        mode: 'settings',
        message: '已打开「设置 → 应用」，请在列表中卸载 Deepseek-Harness-Desktop。',
      };
    }
    return {
      ok: false,
      error: 'uninstaller-not-found',
      searchedPaths: discovery.searchedPaths,
      message: `未找到卸载程序（已查找：${searchedLabel}）。请在「设置 → 应用」中卸载 Deepseek-Harness-Desktop。`,
    };
  }

  if (discovery.registered && discovery.uninstallMode === 'settings') {
    const opened = await openWindowsAppsSettings(deps);
    if (opened) {
      return {
        ok: true,
        openedSettings: true,
        mode: 'settings',
        message: '已打开「设置 → 应用」，请在列表中卸载 Deepseek-Harness-Desktop。',
      };
    }
    return {
      ok: false,
      error: 'uninstaller-not-found',
      searchedPaths: discovery.searchedPaths,
      message: `未找到卸载程序（已查找：${searchedLabel}）。请在「设置 → 应用」中卸载 Deepseek-Harness-Desktop。`,
    };
  }

  if (!packaged && !discovery.registered) {
    return {
      ok: false,
      error: 'source-run-no-install',
      message: '当前为源码运行，无本机安装包可卸载。请用「设置 → 应用」卸载已安装的 Deepseek-Harness-Desktop。',
    };
  }

  return {
    ok: false,
    error: 'uninstaller-not-found',
    searchedPaths: discovery.searchedPaths,
    message: `未找到卸载程序（已查找：${searchedLabel}）。请在「设置 → 应用」中卸载 Deepseek-Harness-Desktop。`,
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
        options.updaterDeps || {},
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
  const safeName = path.basename(info.assetName || 'DeepSeek-Harness-Setup.exe').replace(/[^\w.\-]+/g, '_');
  const dest = path.join(dir, safeName);
  await downloadFile(info.assetUrl, dest, onProgress);
  if (info.checksumUrl) {
    try {
      await verifyAssetChecksum(dest, info.assetName, info.checksumUrl);
    } catch (error) {
      cleanupPartial(dest);
      throw error;
    }
  }
  if (typeof onProgress === 'function') {
    onProgress({ phase: 'install', percent: 100 });
  }
  launchInstaller(dest);
  if (app.isPackaged) {
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
  const info = await checkUpdate();
  if (info.status === 'error') {
    return { ...info, launched: false, openedPage: false };
  }
  return installFromAsset({
    ...info,
    assetUrl: info.assetUrl,
    assetName: info.assetName,
    checksumUrl: info.checksumUrl,
    htmlUrl: info.htmlUrl,
  }, onProgress, { ...options, preferUpdater: true });
}

module.exports = {
  setGithubTokenProvider,
  GITHUB_OWNER,
  GITHUB_REPO,
  APP_ID,
  PRODUCT_NAME,
  REPO_URL,
  RELEASES_PAGE,
  CHECK_TIMEOUT_MS,
  DOWNLOAD_TIMEOUT_MS,
  CHECKSUM_ASSET_NAME,
  currentVersion,
  checkUpdate,
  installUpdate,
  summarizeRelease,
  listReleases,
  installRelease,
  getInstalledAppInfo,
  launchUninstaller,
  discoverWindowsInstall,
  findRegisteredWindowsInstall,
  parseRegBlock,
  uninstallExeCandidates,
  downloadFile,
  parseSha512Sums,
  verifyAssetChecksum,
};
