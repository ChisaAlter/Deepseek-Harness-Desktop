'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const https = require('node:https');
const { EventEmitter } = require('node:events');
const crypto = require('node:crypto');
const {
  summarizeRelease,
  installRelease,
  installUpdate,
  checkUpdate,
  listReleases,
  getInstalledAppInfo,
  launchUninstaller,
  discoverWindowsInstall,
  parseRegBlock,
  uninstallExeCandidates,
  APP_ID,
  PRODUCT_NAME,
  downloadFile,
  parseSha512Sums,
  verifyAssetChecksum,
  CHECKSUM_ASSET_NAME,
} = require('./update');

test('summarizeRelease skips drafts and marks a missing installer', () => {
  assert.equal(summarizeRelease({ draft: true, tag_name: 'v0.2.7' }, '0.2.6'), null);
  const listed = summarizeRelease({
    draft: false,
    prerelease: true,
    tag_name: 'v0.2.6',
    html_url: 'https://example.test/r',
    body: 'notes',
    assets: [{ name: 'Deepseek-Harness-Desktop-Setup-0.2.6.exe', browser_download_url: 'https://example.test/setup.exe' }],
  }, '0.2.6');
  assert.equal(listed.prerelease, true);
  assert.equal(listed.current, true);
  assert.equal(listed.installable, true);
  const sourceOnly = summarizeRelease({
    draft: false,
    tag_name: 'v0.2.5',
    assets: [{ name: 'source.zip', browser_download_url: 'https://example.test/src.zip' }],
  }, '0.2.6');
  assert.equal(sourceOnly.installable, false);
  assert.equal(sourceOnly.newer, false);
  assert.equal(sourceOnly.older, true);
});

test('getInstalledAppInfo reports version and source-run uninstall guidance when unpackaged', () => {
  const info = getInstalledAppInfo({ isPackaged: false, existsSync: () => false, execFileSync: () => { throw new Error('missing'); } });
  assert.equal(typeof info.version, 'string');
  assert.equal(info.packaged, false);
  assert.equal(info.runningFromSource, true);
  assert.equal(info.registeredInstall, false);
  assert.equal(info.uninstallAvailable, false);
  assert.match(info.uninstallNote, /源码运行，无本机安装包可卸载/);
});

test('parseRegBlock accepts InstallLocation without UninstallString', () => {
  const block = [
    'DisplayName    REG_SZ    Deepseek-Harness-Desktop',
    'InstallLocation    REG_SZ    C:\\Apps\\Deepseek-Harness-Desktop',
    'DisplayVersion    REG_SZ    0.2.6',
  ].join('\n');
  const parsed = parseRegBlock(block, 'HKCU\\test');
  assert.ok(parsed);
  assert.equal(parsed.installPath, 'C:\\Apps\\Deepseek-Harness-Desktop');
  assert.equal(parsed.displayVersion, '0.2.6');
  assert.equal(parsed.uninstallCommand, '');
});

test('discoverWindowsInstall resolves uninstall exe under InstallLocation', () => {
  const installDir = 'C:\\Apps\\Deepseek-Harness-Desktop';
  const uninstallExe = uninstallExeCandidates(installDir)[0];
  const registryOutput = [
    'DisplayName    REG_SZ    Deepseek-Harness-Desktop',
    `InstallLocation    REG_SZ    ${installDir}`,
    'DisplayVersion    REG_SZ    0.2.6',
    `UninstallString    REG_SZ    "${uninstallExe}" /currentuser`,
  ].join('\n');
  const discovery = discoverWindowsInstall({
    platform: 'win32',
    isPackaged: false,
    existsSync: (candidate) => candidate === uninstallExe,
    execFileSync: (_cmd, args) => {
      if (args[0] === 'query' && String(args[1]).includes(APP_ID)) {
        return registryOutput;
      }
      throw new Error('missing');
    },
  });
  assert.equal(discovery.registered, true);
  assert.equal(discovery.uninstallMode, 'direct');
  assert.equal(discovery.uninstallCommand, uninstallExe);
  assert.equal(discovery.version, '0.2.6');
});

test('discoverWindowsInstall falls back to settings when uninstall exe is missing', () => {
  const installDir = 'C:\\Apps\\Deepseek-Harness-Desktop';
  const uninstallExe = uninstallExeCandidates(installDir)[0];
  const registryOutput = [
    'DisplayName    REG_SZ    Deepseek-Harness-Desktop',
    `InstallLocation    REG_SZ    ${installDir}`,
    `UninstallString    REG_SZ    "${uninstallExe}" /currentuser`,
  ].join('\n');
  const discovery = discoverWindowsInstall({
    platform: 'win32',
    isPackaged: true,
    existsSync: () => false,
    execFileSync: (_cmd, args) => {
      if (args[0] === 'query' && String(args[1]).includes(APP_ID)) {
        return registryOutput;
      }
      throw new Error('missing');
    },
  });
  assert.equal(discovery.registered, true);
  assert.equal(discovery.uninstallMode, 'settings');
  assert.ok(discovery.searchedPaths.includes(uninstallExe));
});

test('getInstalledAppInfo exposes registered install while running from source', () => {
  const installDir = 'C:\\Apps\\Deepseek-Harness-Desktop';
  const registryOutput = [
    'DisplayName    REG_SZ    Deepseek-Harness-Desktop',
    `InstallLocation    REG_SZ    ${installDir}`,
    'DisplayVersion    REG_SZ    0.2.6',
    `UninstallString    REG_SZ    "${uninstallExePath(installDir)}" /currentuser`,
  ].join('\n');
  const info = getInstalledAppInfo({
    platform: 'win32',
    isPackaged: false,
    existsSync: (candidate) => candidate === uninstallExePath(installDir),
    execFileSync: (_cmd, args) => {
      if (args[0] === 'query' && String(args[1]).includes(APP_ID)) {
        return registryOutput;
      }
      throw new Error('missing');
    },
  });
  assert.equal(info.registeredInstall, true);
  assert.equal(info.version, '0.2.6');
  assert.equal(info.installPath, installDir);
  assert.equal(info.uninstallAvailable, true);
  assert.equal(info.uninstallUsesSettings, false);
});

test('launchUninstaller returns source-run guidance when no registered install', async () => {
  const result = await launchUninstaller({
    isPackaged: false,
    existsSync: () => false,
    execFileSync: () => { throw new Error('missing'); },
  });
  assert.equal(result.ok, false);
  assert.equal(result.error, 'source-run-no-install');
  assert.match(result.message, /源码运行，无本机安装包可卸载/);
});

function uninstallExePath(installDir) {
  return uninstallExeCandidates(installDir)[0];
}

test('checkUpdate passes an abort signal and degrades to status error on timeout', async () => {
  const previousFetch = global.fetch;
  let seenSignal = null;
  global.fetch = async (_url, options) => {
    seenSignal = options?.signal;
    const error = new Error('The operation was aborted due to timeout');
    error.name = 'TimeoutError';
    throw error;
  };
  try {
    const result = await checkUpdate();
    assert.equal(result.status, 'error');
    assert.match(result.message, /超时/);
    assert.ok(seenSignal instanceof AbortSignal, 'fetch must receive an AbortSignal');
  } finally {
    global.fetch = previousFetch;
  }
});

test('checkUpdate and listReleases send Authorization only when a githubToken is configured, and never log it', async () => {
  const { setGithubTokenProvider } = require('./update');
  const previousFetch = global.fetch;
  const seenHeaders = [];
  global.fetch = async (_url, options) => {
    seenHeaders.push(options?.headers || {});
    return {
      ok: true,
      status: 200,
      json: async () => null,
    };
  };
  try {
    await checkUpdate();
    assert.equal(seenHeaders[0].Authorization, undefined, 'no token configured, no header');

    setGithubTokenProvider(() => ' ghp_test_token_value ');
    await checkUpdate();
    assert.equal(seenHeaders[1].Authorization, 'Bearer ghp_test_token_value');
    const listed = await listReleases();
    assert.equal(seenHeaders[2].Authorization, 'Bearer ghp_test_token_value');
    assert.equal(JSON.stringify(listed).includes('ghp_test_token_value'), false, 'token never surfaces in results');

    setGithubTokenProvider(() => { throw new Error('config unreadable'); });
    const degraded = await checkUpdate();
    assert.equal(seenHeaders[3].Authorization, undefined, 'provider failure degrades to anonymous');
    assert.equal(JSON.stringify(degraded).includes('ghp_test_token_value'), false);
  } finally {
    setGithubTokenProvider(null);
    global.fetch = previousFetch;
  }
});

test('download headers carry the token only on the first hop toward GitHub hosts', async () => {
  const { setGithubTokenProvider } = require('./update');
  const previousGet = https.get;
  const seen = [];
  setGithubTokenProvider(() => 'ghp_dl_token');
  https.get = (target, options, onResponse) => {
    seen.push({ target: String(target), headers: options.headers });
    const response = new EventEmitter();
    if (seen.length === 1) {
      response.statusCode = 302;
      response.headers = { location: 'https://objects.githubusercontent.com/signed/asset' };
    } else {
      response.statusCode = 200;
      response.headers = {};
    }
    response.resume = () => {};
    response.pipe = (file) => {
      setImmediate(() => {
        response.emit('end');
        file.end();
      });
      return file;
    };
    setImmediate(() => onResponse(response));
    const request = new EventEmitter();
    request.destroy = () => {};
    return request;
  };
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-dl-auth-'));
  const dest = path.join(dir, 'setup.exe');
  try {
    await downloadFile('https://github.com/ChisaAlter/Deepseek-Harness-Desktop/releases/download/v1/setup.exe', dest, null, { timeoutMs: 2000 });
    assert.equal(seen[0].headers.Authorization, 'Bearer ghp_dl_token', 'first hop to github.com carries the token');
    assert.equal(seen[1].headers.Authorization, undefined, 'signed CDN redirect hop must not carry the token');
  } finally {
    setGithubTokenProvider(null);
    https.get = previousGet;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('listReleases degrades to an empty list with a message on timeout', async () => {
  const previousFetch = global.fetch;
  global.fetch = async () => {
    const error = new Error('aborted');
    error.name = 'AbortError';
    throw error;
  };
  try {
    const result = await listReleases();
    assert.equal(result.status, 'error');
    assert.deepEqual(result.releases, []);
    assert.match(result.message, /超时/);
  } finally {
    global.fetch = previousFetch;
  }
});

test('downloadFile fails, aborts the request, and removes the partial after the overall timeout', async () => {
  const previousGet = https.get;
  let destroyed = false;
  https.get = (_target, _options, _onResponse) => {
    // Connection that never responds: only the overall deadline can settle it.
    const request = new EventEmitter();
    request.destroy = () => {
      destroyed = true;
    };
    return request;
  };
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-update-dl-'));
  const dest = path.join(dir, 'setup.exe');
  try {
    await assert.rejects(
      () => downloadFile('https://example.test/setup.exe', dest, null, { timeoutMs: 50 }),
      /下载超时/,
    );
    assert.equal(destroyed, true);
    assert.equal(fs.existsSync(dest), false);
  } finally {
    https.get = previousGet;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

function fakeDownloadResponse({ contentLength = 100 } = {}) {
  const { PassThrough } = require('node:stream');
  const response = new PassThrough();
  response.statusCode = 200;
  response.headers = { 'content-length': String(contentLength) };
  return response;
}

test('downloadFile fails without crashing and removes the partial when the body errors mid-stream', async () => {
  const previousGet = https.get;
  let destroyed = false;
  https.get = (_target, _options, onResponse) => {
    const request = new EventEmitter();
    request.destroy = () => { destroyed = true; };
    const response = fakeDownloadResponse({ contentLength: 100 });
    process.nextTick(() => {
      onResponse(response);
      response.write(Buffer.alloc(40));
      setImmediate(() => response.emit('error', new Error('socket hang up')));
    });
    return request;
  };
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-update-dl-err-'));
  const dest = path.join(dir, 'setup.exe');
  try {
    await assert.rejects(
      () => downloadFile('https://example.test/setup.exe', dest, null, { timeoutMs: 5_000 }),
      /下载连接中断/,
    );
    assert.equal(destroyed, true);
    assert.equal(fs.existsSync(dest), false, 'partial download must be removed');
  } finally {
    https.get = previousGet;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('downloadFile rejects a truncated body whose size disagrees with content-length', async () => {
  const previousGet = https.get;
  https.get = (_target, _options, onResponse) => {
    const request = new EventEmitter();
    request.destroy = () => {};
    const response = fakeDownloadResponse({ contentLength: 100 });
    process.nextTick(() => {
      onResponse(response);
      response.write(Buffer.alloc(40));
      // Server closes the connection cleanly after 40 of 100 bytes.
      response.end();
    });
    return request;
  };
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-update-dl-trunc-'));
  const dest = path.join(dir, 'setup.exe');
  try {
    await assert.rejects(
      () => downloadFile('https://example.test/setup.exe', dest, null, { timeoutMs: 5_000 }),
      /下载不完整（40\/100 字节）/,
    );
    assert.equal(fs.existsSync(dest), false, 'truncated download must be removed');
  } finally {
    https.get = previousGet;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('downloadFile fails and cleans up when the response is aborted', async () => {
  const previousGet = https.get;
  https.get = (_target, _options, onResponse) => {
    const request = new EventEmitter();
    request.destroy = () => {};
    const response = fakeDownloadResponse({ contentLength: 100 });
    process.nextTick(() => {
      onResponse(response);
      response.write(Buffer.alloc(10));
      setImmediate(() => response.emit('aborted'));
    });
    return request;
  };
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-update-dl-abort-'));
  const dest = path.join(dir, 'setup.exe');
  try {
    await assert.rejects(
      () => downloadFile('https://example.test/setup.exe', dest, null, { timeoutMs: 5_000 }),
      /下载连接中断/,
    );
    assert.equal(fs.existsSync(dest), false);
  } finally {
    https.get = previousGet;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('summarizeRelease exposes the SHA512SUMS.txt checksum manifest when present', () => {
  const listed = summarizeRelease({
    draft: false,
    tag_name: 'v0.2.8',
    assets: [
      { name: 'Deepseek-Harness-Desktop-Setup-0.2.8.exe', browser_download_url: 'https://example.test/setup.exe' },
      { name: CHECKSUM_ASSET_NAME, browser_download_url: 'https://example.test/SHA512SUMS.txt' },
    ],
  }, '0.2.7');
  assert.equal(listed.checksumUrl, 'https://example.test/SHA512SUMS.txt');
  const withoutManifest = summarizeRelease({
    draft: false,
    tag_name: 'v0.2.6',
    assets: [{ name: 'Deepseek-Harness-Desktop-Setup-0.2.6.exe', browser_download_url: 'https://example.test/setup.exe' }],
  }, '0.2.7');
  assert.equal(withoutManifest.checksumUrl, '');
});

test('parseSha512Sums reads sha512sum lines and ignores garbage', () => {
  const hexA = 'a'.repeat(128);
  const hexB = 'B'.repeat(128);
  const sums = parseSha512Sums([
    `${hexA}  Deepseek-Harness-Desktop-Setup-0.2.8.exe`,
    `${hexB} *Deepseek-Harness-Desktop-0.2.8-mac-arm64.dmg`,
    'not a checksum line',
    'deadbeef  short-hash.exe',
    '',
  ].join('\n'));
  assert.equal(sums.get('Deepseek-Harness-Desktop-Setup-0.2.8.exe'), hexA);
  assert.equal(sums.get('Deepseek-Harness-Desktop-0.2.8-mac-arm64.dmg'), 'b'.repeat(128));
  assert.equal(sums.size, 2);
});

test('verifyAssetChecksum passes a good digest and rejects mismatch or missing entry', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-update-sum-'));
  const dest = path.join(dir, 'setup.exe');
  fs.writeFileSync(dest, 'installer-bytes');
  const digest = crypto.createHash('sha512').update('installer-bytes').digest('hex');
  const previousFetch = global.fetch;
  const respond = (text) => async () => ({ ok: true, status: 200, text: async () => text });
  try {
    global.fetch = respond(`${digest}  Setup.exe\n`);
    await verifyAssetChecksum(dest, 'Setup.exe', 'https://example.test/SHA512SUMS.txt');

    global.fetch = respond(`${'0'.repeat(128)}  Setup.exe\n`);
    await assert.rejects(
      () => verifyAssetChecksum(dest, 'Setup.exe', 'https://example.test/SHA512SUMS.txt'),
      /sha512 不匹配/,
    );

    global.fetch = respond(`${digest}  Other.exe\n`);
    await assert.rejects(
      () => verifyAssetChecksum(dest, 'Setup.exe', 'https://example.test/SHA512SUMS.txt'),
      /缺少 Setup\.exe/,
    );

    global.fetch = async () => ({ ok: false, status: 404, text: async () => '' });
    await assert.rejects(
      () => verifyAssetChecksum(dest, 'Setup.exe', 'https://example.test/SHA512SUMS.txt'),
      /校验清单下载失败/,
    );
  } finally {
    global.fetch = previousFetch;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('installRelease refuses a tag with no Setup.exe', async () => {
  const previousFetch = global.fetch;
  global.fetch = async () => ({
    ok: true,
    status: 200,
    json: async () => ({
      draft: false,
      prerelease: false,
      tag_name: 'v0.2.0',
      html_url: 'https://example.test/r',
      body: '',
      assets: [{ name: 'source.zip', browser_download_url: 'https://example.test/src.zip' }],
    }),
  });
  try {
    const result = await installRelease('v0.2.0');
    assert.equal(result.message, 'no-installer');
    assert.equal(result.launched, false);
  } finally {
    global.fetch = previousFetch;
  }
});

function releaseWithoutChecksum() {
  return {
    draft: false,
    prerelease: false,
    tag_name: 'v0.2.6',
    html_url: 'https://example.test/r',
    body: '',
    assets: [{
      name: 'Deepseek-Harness-Desktop-Setup-0.2.6.exe',
      browser_download_url: 'https://example.test/setup.exe',
    }],
  };
}

test('installRelease without SHA512SUMS.txt fails closed when no confirmation is wired', async () => {
  const previousFetch = global.fetch;
  const fetched = [];
  global.fetch = async (url) => {
    fetched.push(String(url));
    return { ok: true, status: 200, json: async () => releaseWithoutChecksum() };
  };
  try {
    const result = await installRelease('v0.2.6');
    assert.equal(result.launched, false);
    assert.equal(result.declined, true);
    assert.equal(result.unverified, true);
    assert.match(result.message, /SHA512SUMS\.txt/);
    assert.equal(fetched.some((url) => url.includes('setup.exe')), false, '拒绝后不得开始下载');
  } finally {
    global.fetch = previousFetch;
  }
});

test('installRelease without SHA512SUMS.txt asks confirmUnverified and stops on decline', async () => {
  const previousFetch = global.fetch;
  global.fetch = async () => ({ ok: true, status: 200, json: async () => releaseWithoutChecksum() });
  const asked = [];
  try {
    const result = await installRelease('v0.2.6', undefined, {
      confirmUnverified: async (info) => {
        asked.push(info.assetName);
        return false;
      },
    });
    assert.deepEqual(asked, ['Deepseek-Harness-Desktop-Setup-0.2.6.exe']);
    assert.equal(result.launched, false);
    assert.equal(result.declined, true);
  } finally {
    global.fetch = previousFetch;
  }
});

test('launchUninstaller spawns the extracted exe without a shell', async () => {
  const installDir = 'C:\\Program Files\\Deepseek-Harness-Desktop';
  const exe = `${installDir}\\Uninstall Deepseek-Harness-Desktop.exe`;
  const spawns = [];
  const result = await launchUninstaller({
    isPackaged: false,
    platform: 'win32',
    existsSync: (candidate) => candidate === exe,
    execFileSync: (cmd, args) => {
      if (args[1] && args[1].endsWith(APP_ID)) {
        return [
          `HKEY_LOCAL_MACHINE\\...\\${APP_ID}`,
          `    DisplayName    REG_SZ    ${PRODUCT_NAME}`,
          `    InstallLocation    REG_SZ    ${installDir}`,
          `    UninstallString    REG_SZ    "${exe}" /currentuser`,
        ].join('\r\n');
      }
      throw new Error('missing');
    },
    spawn: (command, args, options) => {
      spawns.push({ command, args, options });
      return { unref() {} };
    },
  });
  assert.equal(result.ok, true);
  assert.equal(result.mode, 'direct');
  assert.equal(spawns.length, 1);
  assert.equal(spawns[0].command, exe, '必须 spawn 提取后的 exe 路径');
  assert.deepEqual(spawns[0].args, []);
  assert.equal(spawns[0].options.shell, undefined, '绝不能经 shell 执行注册表命令串');
});

test('update.js no longer spawns through a shell', () => {
  const source = fs.readFileSync(path.join(__dirname, 'update.js'), 'utf8');
  assert.doesNotMatch(source, /shell:\s*true/);
});

// ---------------------------------------------------------------------------
// M-3 回归护栏：两条安装入口的确认接线 + 非 Windows 分支
// ---------------------------------------------------------------------------

test('M-3: installUpdate 无 SHA512SUMS.txt 且未接确认时同样 fail-closed', async () => {
  const previousFetch = global.fetch;
  const fetched = [];
  global.fetch = async (url) => {
    fetched.push(String(url));
    return { ok: true, status: 200, json: async () => releaseWithoutChecksum() };
  };
  try {
    const result = await installUpdate();
    assert.equal(result.launched, false);
    assert.equal(result.declined, true);
    assert.equal(result.unverified, true);
    assert.equal(fetched.some((url) => url.includes('setup.exe')), false, '拒绝后不得开始下载');
  } finally {
    global.fetch = previousFetch;
  }
});

test('M-3: ipc.js 两条安装通道都接 confirmUnverified，确认框默认与 Esc 均为取消', () => {
  const source = fs.readFileSync(path.join(__dirname, 'ipc.js'), 'utf8');
  assert.match(source, /handle\('shell:install-update'/);
  assert.match(source, /handle\('shell:install-release'/);
  const wired = source.match(/confirmUnverified:\s*confirmUnverifiedInstall/g) || [];
  assert.ok(wired.length >= 2, `install-update 与 install-release 都必须显式接确认回调（发现 ${wired.length} 处）`);

  const fn = source.match(/async function confirmUnverifiedInstall[\s\S]*?\n {2}\}/);
  assert.ok(fn, 'ipc.js 必须保留 confirmUnverifiedInstall 确认函数');
  assert.match(fn[0], /type:\s*'warning'/);
  assert.match(fn[0], /defaultId:\s*1/, '回车默认必须是「取消」（fail-safe）');
  assert.match(fn[0], /cancelId:\s*1/, 'Esc/关闭必须等同「取消」');
  assert.match(fn[0], /response\s*===\s*0/, '只有明确点「仍要安装」才返回 true');
});

test('M-3: index.js 冷启动闸门的 installUpdate 同样接确认，且对话框 fail-safe', () => {
  const source = fs.readFileSync(path.join(__dirname, 'index.js'), 'utf8');
  assert.match(
    source,
    /installUpdate:\s*\(onProgress\)\s*=>\s*installUpdate\(onProgress,\s*\{\s*\n?\s*confirmUnverified:\s*confirmUnverifiedColdStart/,
    '冷启动闸门必须把 confirmUnverifiedColdStart 传给 installUpdate',
  );
  const fn = source.match(/async function confirmUnverifiedColdStart[\s\S]*?\n\}/);
  assert.ok(fn, 'index.js 必须保留 confirmUnverifiedColdStart 确认函数');
  assert.match(fn[0], /type:\s*'warning'/);
  assert.match(fn[0], /defaultId:\s*1/, '回车默认必须是「取消」（fail-safe）');
  assert.match(fn[0], /cancelId:\s*1/, 'Esc/关闭必须等同「取消」');
  assert.match(fn[0], /response\s*===\s*0/);
});

test('M-3: 非 Windows 下 discoverWindowsInstall 不查注册表、分支正确', () => {
  const regCalls = [];
  const execSpy = (...args) => {
    regCalls.push(args);
    throw new Error('should not be called');
  };

  const unpackaged = discoverWindowsInstall({
    platform: 'linux',
    isPackaged: false,
    existsSync: () => true,
    execFileSync: execSpy,
  });
  assert.equal(unpackaged.registered, false);
  assert.equal(unpackaged.uninstallMode, 'none');
  assert.equal(unpackaged.installPath, '');
  assert.equal(unpackaged.uninstallCommand, '');

  const packaged = discoverWindowsInstall({
    platform: 'darwin',
    isPackaged: true,
    existsSync: () => true,
    execFileSync: execSpy,
  });
  assert.equal(packaged.registered, true);
  assert.equal(packaged.uninstallMode, 'none');
  assert.equal(typeof packaged.installPath, 'string');
  assert.ok(packaged.installPath.length > 0, 'packaged 下应给出运行目录');

  assert.equal(regCalls.length, 0, '非 win32 平台绝不能执行 reg query');
});

test('M-3: 非 Windows 打包运行时 launchUninstaller 返回 uninstaller-not-found 且不 spawn', async () => {
  const spawns = [];
  const result = await launchUninstaller({
    platform: 'linux',
    isPackaged: true,
    existsSync: () => true,
    execFileSync: () => { throw new Error('should not be called'); },
    spawn: (...args) => {
      spawns.push(args);
      return { unref() {} };
    },
  });
  assert.equal(result.ok, false);
  assert.equal(result.error, 'uninstaller-not-found');
  assert.match(result.message, /设置 → 应用/);
  assert.equal(spawns.length, 0, '非 Windows 下不得拉起任何卸载进程');
});

test('M-3: 非 Windows 源码运行时 launchUninstaller 返回 source-run-no-install 且不 spawn', async () => {
  const spawns = [];
  const result = await launchUninstaller({
    platform: 'linux',
    isPackaged: false,
    existsSync: () => true,
    execFileSync: () => { throw new Error('should not be called'); },
    spawn: (...args) => {
      spawns.push(args);
      return { unref() {} };
    },
  });
  assert.equal(result.ok, false);
  assert.equal(result.error, 'source-run-no-install');
  assert.equal(spawns.length, 0);
});

test('M-3: 非 Windows getInstalledAppInfo 不暴露可用卸载入口', () => {
  const info = getInstalledAppInfo({
    platform: 'linux',
    isPackaged: true,
    existsSync: () => true,
    execFileSync: () => { throw new Error('should not be called'); },
  });
  assert.equal(info.packaged, true);
  assert.equal(info.uninstallAvailable, false);
  assert.equal(info.uninstallUsesSettings, false);
});

// ---------------------------------------------------------------------------
// electron-updater channel: latest-only seam, fallback, tag-install guard
// ---------------------------------------------------------------------------

function releaseWithChecksum() {
  return {
    draft: false,
    prerelease: false,
    tag_name: 'v0.2.6',
    html_url: 'https://example.test/r',
    body: '',
    assets: [
      { name: 'Deepseek-Harness-Desktop-Setup-0.2.6.exe', browser_download_url: 'https://example.test/setup.exe' },
      { name: CHECKSUM_ASSET_NAME, browser_download_url: 'https://example.test/SHA512SUMS.txt' },
    ],
  };
}

function fakeUpdaterChannel(overrides = {}) {
  const updater = new EventEmitter();
  updater.calls = { checkForUpdates: 0, downloadUpdate: 0, quitAndInstall: [] };
  updater.checkForUpdates = async () => {
    updater.calls.checkForUpdates += 1;
    if (overrides.failCheck) {
      throw new Error('manifest unreachable');
    }
    return { updateInfo: { version: '9.9.9' } };
  };
  updater.downloadUpdate = async () => {
    updater.calls.downloadUpdate += 1;
    if (overrides.logLine && updater.logger) {
      updater.logger.info(overrides.logLine);
    }
    updater.emit('download-progress', { percent: 42 });
  };
  updater.quitAndInstall = (...args) => {
    updater.calls.quitAndInstall.push(args);
  };
  return updater;
}

test('installUpdate uses the updater channel for the latest release and skips the whole-file download', async () => {
  const previousFetch = global.fetch;
  const previousGet = https.get;
  const fetched = [];
  const seenGet = [];
  global.fetch = async (url) => {
    fetched.push(String(url));
    return { ok: true, status: 200, json: async () => releaseWithChecksum() };
  };
  https.get = (target) => {
    seenGet.push(String(target));
    const request = new EventEmitter();
    request.destroy = () => {};
    return request;
  };
  const fake = fakeUpdaterChannel({ logLine: 'Full: 636.65 MB, To download: 44.59 MB (7%)' });
  try {
    const result = await installUpdate(null, {
      updaterDeps: { isPackaged: true, platform: 'win32', autoUpdater: fake, existsSync: () => true },
    });
    assert.equal(result.updater, true);
    assert.equal(result.launched, true);
    assert.equal(result.differential, true);
    assert.equal(result.downloadPercent, 7);
    assert.equal(fake.calls.downloadUpdate, 1);
    assert.deepEqual(fake.calls.quitAndInstall, [[true, true]]);
    assert.equal(seenGet.length, 0, 'legacy downloadFile must not run when the updater channel succeeds');
    assert.equal(fetched.some((url) => url.includes('setup.exe')), false);
  } finally {
    global.fetch = previousFetch;
    https.get = previousGet;
  }
});

test('installUpdate falls back to the verified whole-file path when the updater channel fails', async () => {
  const previousFetch = global.fetch;
  const previousGet = https.get;
  const seenGet = [];
  global.fetch = async () => ({ ok: true, status: 200, json: async () => releaseWithChecksum() });
  https.get = (target, _options, onResponse) => {
    seenGet.push(String(target));
    const response = new EventEmitter();
    response.statusCode = 500;
    response.headers = {};
    response.resume = () => {};
    response.pipe = () => {};
    setImmediate(() => onResponse(response));
    const request = new EventEmitter();
    request.destroy = () => {};
    return request;
  };
  const fake = fakeUpdaterChannel({ failCheck: true });
  try {
    await assert.rejects(
      () => installUpdate(null, {
        updaterDeps: { isPackaged: true, platform: 'win32', autoUpdater: fake },
        userDataDir: os.tmpdir(),
      }),
      /Download 500/,
      'fallback must surface the legacy download error',
    );
    assert.equal(fake.calls.checkForUpdates, 1, 'updater channel was attempted first');
    assert.equal(fake.calls.downloadUpdate, 0);
    assert.ok(seenGet.some((url) => url.includes('setup.exe')), 'fallback must reach downloadFile');
  } finally {
    global.fetch = previousFetch;
    https.get = previousGet;
  }
});

test('installRelease for a specific tag never touches the updater channel', async () => {
  const previousFetch = global.fetch;
  global.fetch = async () => ({ ok: true, status: 200, json: async () => releaseWithoutChecksum() });
  const fake = fakeUpdaterChannel();
  try {
    const result = await installRelease('v0.2.6', undefined, {
      confirmUnverified: async () => false,
      updaterDeps: { isPackaged: true, platform: 'win32', autoUpdater: fake },
    });
    assert.equal(result.declined, true);
    assert.equal(fake.calls.checkForUpdates, 0, 'tag installs stay on the whole-file path');
  } finally {
    global.fetch = previousFetch;
  }
});
