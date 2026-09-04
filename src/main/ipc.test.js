const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { IPC_ROLES } = require('./ipc-authorization');
const launcherGate = require('./launcher-gate');

const ipcPath = require.resolve('./ipc');

function harnessEvent(progress = []) {
  return {
    role: IPC_ROLES.HARNESS,
    sender: {
      isDestroyed: () => false,
      send(channel, payload) {
        progress.push({ channel, payload });
      },
    },
  };
}

function leftoverMarketplaceEvent() {
  return {
    role: 'marketplace',
    sender: {
      isDestroyed: () => true,
      send() {},
    },
  };
}

function bootEvent() {
  return {
    role: IPC_ROLES.BOOT,
    sender: {
      isDestroyed: () => false,
      send() {},
    },
  };
}

function launcherEvent() {
  return {
    role: IPC_ROLES.LAUNCHER,
    sender: {
      isDestroyed: () => false,
      send() {},
    },
  };
}

function stubModule(id, exports) {
  const filename = require.resolve(id);
  const previous = require.cache[filename];
  require.cache[filename] = {
    id: filename,
    filename,
    loaded: true,
    exports,
  };
  return { filename, previous };
}

function gitStubs() {
  return {
    gitBranchList() {},
    gitCommit() {},
    gitCreateBranch() {},
    gitCreateChangeRequest() {},
    gitDiff() {},
    gitDiscard() {},
    gitFetchForStatus() {},
    gitInit() {},
    gitPublishRepository() {},
    gitPull() {},
    gitPush() {},
    gitReadPullRequest() {},
    gitStage() {},
    gitStatus() {},
    gitStatusEntries() {},
    gitSwitchBranch() {},
    gitUnstage() {},
    openWorkspacePath() {},
  };
}

function loadIpc(options = {}) {
  const restoreEntries = [];
  const handlers = new Map();
  const openedPaths = [];
  const listMarketplaceCalls = [];
  const listWallpaperCatalogCalls = [];
  const installMarketplaceCalls = [];
  const installPluginCalls = [];
  const uninstallCalls = [];
  const saveConfigCalls = [];
  let startHarnessCalls = 0;
  const installResult = options.installResult || { ok: true };
  const startHarnessImpl = options.startHarness || (async () => {});

  function stub(id, exports) {
    restoreEntries.push(stubModule(id, exports));
  }

  stub('electron', {
    ipcMain: {
      handle(channel, listener) {
        handlers.set(channel, listener);
      },
    },
    dialog: {
      showSaveDialog: options.showSaveDialog || (async () => ({ canceled: true })),
      showOpenDialog: options.showOpenDialog || (async () => ({ canceled: true, filePaths: [] })),
    },
    app: {
      setLoginItemSettings() {},
      getPath: options.getPath || ((name) => (name === 'downloads' ? '/tmp/downloads' : '/tmp')),
    },
    shell: {
      openExternal: async () => true,
      openPath: options.openPath || (async (target) => {
        openedPaths.push(target);
        return '';
      }),
    },
    nativeTheme: { shouldUseDarkColors: false },
  });
  stub('./config', {
    REMOTE_FEATURE_ENABLED: options.remoteFeatureEnabled ?? false,
    loadConfig: () => ({
      githubToken: 'secret-token',
      locale: 'zh',
      theme: 'midnight',
      workspace: '',
    }),
    saveConfig: (patch) => {
      saveConfigCalls.push(patch);
      return patch;
    },
    publicConfig: (config) => ({ theme: config.theme }),
    parkRemoteSnapshot: (snap) => ({
      ...(snap && typeof snap === 'object' ? snap : {}),
      available: false,
      enabled: false,
      listening: false,
      urls: [],
      token: '',
    }),
    normalizeRendererConfigPatch: (patch) => patch || {},
    normalizeLauncherConfigPatch: (patch) => patch || {},
    credentialStorageMode: options.credentialStorageMode || (() => 'encrypted'),
  });
  stub('./window', {
    getMainWindow: options.getMainWindow || (() => null),
    getHarnessWebContents: options.getHarnessWebContents || (() => null),
    getLauncherWindow: () => null,
    hideHarnessView: options.hideHarnessView || (() => {}),
    dismissMainWindow: options.dismissMainWindow || (() => false),
    openHarnessSettings() {},
    openMarketplace() {},
    openRemote() {},
  });
  stub('./dsh', {
    resolveNodeBin: () => 'node',
    resolveDshBin: () => 'dsh',
    sourceHarnessStatus: () => ({ present: false, built: false, root: '' }),
  });
  stub('../shared/themes', {
    listThemes: () => [],
    resolveTheme: () => ({}),
  });
  stub('./chrome', { applyAppTheme() {} });
  stub('./update', {
    checkUpdate() { return {}; },
    installUpdate: async () => ({}),
    listReleases: async () => ({ status: 'ok', releases: [], installed: { version: '0.0.0' } }),
    installRelease: async () => ({ status: 'error', message: 'no-installer', launched: false }),
    launchUninstaller: options.launchUninstaller || (() => ({ ok: true })),
    currentVersion: () => '0.0.0',
    REPO_URL: '',
    RELEASES_PAGE: '',
  });
  const scanImportCalls = [];
  const runImportCalls = [];
  stub('./data-import', {
    scanImport: (opts) => {
      scanImportCalls.push(opts);
      return {
        ok: true, destEmpty: true, sourceHasData: false, sessions: [], plugins: [], skills: [], mcp: [], settings: [], presets: [],
      };
    },
    probeImportHold: () => ({ destEmpty: true, sourceHasData: false, hold: false }),
    runImport: async (opts) => {
      runImportCalls.push(opts);
      return {
        ok: true, empty: true, sessions: [], skills: [], plugins: [], mcp: [], settings: [], credentials: [], presets: [],
      };
    },
  });
  stub('./plugin-forensics', {
    inspectPlugins: () => ({ genericCause: null, suspects: [], plugins: [] }),
    isPresetPlugin: () => false,
  });
  stub('./plugins', {
    listInstalledPlugins: () => ({ plugins: [], bundles: [] }),
    applyDisabledBundles: () => ({ ok: true, changed: false, bundles: [] }),
    setBundleEnabled: () => ({ ok: true, changed: false }),
    OFFICIAL_TEMPLATE_BUNDLES: new Set(['@deepseek-ai/dsh-base']),
  });
  const lastStartWrites = [];
  stub('./launcher-gate', {
    ...launcherGate,
    readLastDesktopStart: () => ({ ok: true, at: '', error: '' }),
    recordLastDesktopStart: async (_dir, work) => {
      try {
        const value = await work();
        lastStartWrites.push({ ok: true });
        return value;
      } catch (error) {
        lastStartWrites.push({ ok: false, error: error && error.message ? error.message : String(error) });
        throw error;
      }
    },
  });
  stub('./marketplace-catalog', {
    listMarketplace: async (opts) => {
      listMarketplaceCalls.push(opts);
      return { ok: true, items: [] };
    },
  });
  stub('./wallpaper-catalog', {
    listWallpaperCatalog: async (query) => {
      listWallpaperCatalogCalls.push(query);
      return { items: [] };
    },
    downloadWallpaper: async () => ({}),
  });
  stub('./marketplace-install', {
    listInstalledPlugins: () => ({ plugins: [] }),
    installPlugin: async (spec, opts) => {
      installPluginCalls.push({ spec, options: opts });
      return { ok: true };
    },
    uninstallPlugin: async (name, opts) => {
      uninstallCalls.push({ name, options: opts });
      return { ok: true };
    },
    installMarketplacePlugin: async (id, opts) => {
      installMarketplaceCalls.push({ id, options: opts });
      return installResult;
    },
  });
  stub('./git', { ...gitStubs(), ...(options.git || {}) });
  const workspaceWatch = { onChange: null, stopped: 0 };
  stub('./git-workspace-watch', {
    watchWorkspaceRegistrations: (onChange) => {
      workspaceWatch.onChange = onChange;
      return () => {
        workspaceWatch.stopped += 1;
      };
    },
  });
  stub('./preview', { registerPreviewIpc: () => ({}) });
  stub('./pty', { registerPtyIpc: () => ({}) });
  stub('./workspace-fs', {
    listDir() { return []; },
    readFile() { return ''; },
    readFileMedia() { return null; },
    writeFile() {},
  });
  stub('./ipc-authorization', {
    IPC_ROLES,
    assertIpcSender(event, roles) {
      const allowed = new Set(roles);
      if (!event?.role || !allowed.has(event.role)) {
        const error = new Error('Unauthorized IPC sender');
        error.code = 'ERR_DSH_IPC_SENDER';
        throw error;
      }
      return event.role;
    },
  });

  const previousIpc = require.cache[ipcPath];
  delete require.cache[ipcPath];
  let startDesktopCalls = 0;
  const startDesktopArgs = [];
  const { registerIpc } = require('./ipc');
  registerIpc({
    dsh: options.dsh || { snapshot: () => ({}), logs: [] },
    harness: options.harness || null,
    startHarness: async () => {
      startHarnessCalls += 1;
      return startHarnessImpl();
    },
    startDesktop: async (opts) => {
      startDesktopCalls += 1;
      startDesktopArgs.push(opts || {});
      return { ok: true };
    },
    stopDesktopCleanup: options.stopDesktopCleanup,
    remote: options.remote === undefined ? null : options.remote,
    onOpenLauncher: options.onOpenLauncher,
  });

  async function invoke(channel, event, ...args) {
    const listener = handlers.get(channel);
    assert.equal(typeof listener, 'function', `missing ${channel}`);
    return listener(event, ...args);
  }

  function restore() {
    delete require.cache[ipcPath];
    if (previousIpc) require.cache[ipcPath] = previousIpc;
    for (const { filename, previous } of restoreEntries) {
      if (previous) require.cache[filename] = previous;
      else delete require.cache[filename];
    }
  }

  return {
    handlers,
    invoke,
    restore,
    listMarketplaceCalls,
    listWallpaperCatalogCalls,
    installMarketplaceCalls,
    installPluginCalls,
    uninstallCalls,
    saveConfigCalls,
    openedPaths,
    startHarness() {
      return startHarnessCalls;
    },
    startDesktop() {
      return startDesktopCalls;
    },
    startDesktopArgs,
    scanImportCalls,
    runImportCalls,
    lastStartWrites,
    workspaceWatch,
  };
}

test('shell:git-branch-list resolves the guard failure payload when the handler throws', async () => {
  const ipc = loadIpc({
    git: {
      gitBranchList: async () => {
        throw new Error('registry walk exploded');
      },
    },
  });
  try {
    const result = await ipc.invoke('shell:git-branch-list', harnessEvent(), '/work');
    assert.deepEqual(result, { ok: false, message: 'registry walk exploded' });
  } finally {
    ipc.restore();
  }
});

test('shell:git-status resolves null instead of rejecting when the handler throws', async () => {
  const ipc = loadIpc({
    git: {
      gitStatus: async () => {
        throw new Error('porcelain exploded');
      },
    },
  });
  try {
    assert.equal(await ipc.invoke('shell:git-status', harnessEvent(), '/work'), null);
  } finally {
    ipc.restore();
  }
});

test('a workspace registry change pushes shell:git-workspaces-changed to the harness', async () => {
  const sent = [];
  const ipc = loadIpc({
    getHarnessWebContents: () => ({
      isDestroyed: () => false,
      send(channel, payload) {
        sent.push({ channel, payload });
      },
    }),
  });
  try {
    assert.equal(typeof ipc.workspaceWatch.onChange, 'function');
    ipc.workspaceWatch.onChange();
    assert.deepEqual(sent, [{ channel: 'shell:git-workspaces-changed', payload: undefined }]);
  } finally {
    ipc.restore();
  }
});

test('a workspace registry change without a live harness webContents is a no-op', async () => {
  const destroyedSent = [];
  for (const getHarnessWebContents of [
    () => null,
    () => ({
      isDestroyed: () => true,
      send(channel) {
        destroyedSent.push(channel);
      },
    }),
  ]) {
    const ipc = loadIpc({ getHarnessWebContents });
    try {
      ipc.workspaceWatch.onChange();
    } finally {
      ipc.restore();
    }
  }
  assert.deepEqual(destroyedSent, []);
});

test('shell:list-marketplace forwards locale and refresh without a GitHub token', async () => {
  const ipc = loadIpc();
  try {
    await ipc.invoke('shell:list-marketplace', harnessEvent(), {
      locale: 'en',
      refresh: true,
      token: 'renderer-token',
    });
    assert.equal(ipc.listMarketplaceCalls.length, 1);
    assert.deepEqual(ipc.listMarketplaceCalls[0], { locale: 'en', refresh: true });
  } finally {
    ipc.restore();
  }
});

test('shell:refresh-marketplace forwards locale without defaulting to zh', async () => {
  const ipc = loadIpc();
  try {
    await ipc.invoke('shell:refresh-marketplace', harnessEvent());
    await ipc.invoke('shell:refresh-marketplace', harnessEvent(), { locale: 'en', token: 'renderer-token' });
    assert.deepEqual(ipc.listMarketplaceCalls, [
      { locale: undefined, refresh: true },
      { locale: 'en', refresh: true },
    ]);
  } finally {
    ipc.restore();
  }
});

test('marketplace catalog and plugin channels reject marketplace senders', async () => {
  const ipc = loadIpc();
  try {
    const sender = leftoverMarketplaceEvent();
    const unauthorized = (error) => error.code === 'ERR_DSH_IPC_SENDER';
    await assert.rejects(() => ipc.invoke('shell:list-marketplace', sender, {}), unauthorized);
    await assert.rejects(() => ipc.invoke('shell:refresh-marketplace', sender), unauthorized);
    await assert.rejects(() => ipc.invoke('shell:list-installed-plugins', sender), unauthorized);
    await assert.rejects(() => ipc.invoke('shell:uninstall-plugin', sender, 'pkg'), unauthorized);
    await assert.rejects(() => ipc.invoke('shell:install-marketplace-plugin', sender, 'owner/name'), unauthorized);
  } finally {
    ipc.restore();
  }
});

test('config surfaces reject leftover marketplace senders', async () => {
  const ipc = loadIpc();
  try {
    const sender = leftoverMarketplaceEvent();
    const unauthorized = (error) => error.code === 'ERR_DSH_IPC_SENDER';
    await assert.rejects(() => ipc.invoke('shell:get-config', sender), unauthorized);
    await assert.rejects(() => ipc.invoke('shell:save-config', sender, { theme: 'midnight' }), unauthorized);
    await assert.rejects(() => ipc.invoke('shell:open-external', sender, 'https://example.com'), unauthorized);
  } finally {
    ipc.restore();
  }
});

test('shell:seed-install-draft is not registered', () => {
  const ipc = loadIpc();
  try {
    assert.equal(ipc.handlers.has('shell:seed-install-draft'), false);
  } finally {
    ipc.restore();
  }
});

test('shell:install-marketplace-plugin passes allowBuilds token and onProgress only', async () => {
  const ipc = loadIpc();
  try {
    const progress = [];
    const runPlugin = () => {};
    await ipc.invoke(
      'shell:install-marketplace-plugin',
      harnessEvent(progress),
      'owner/name',
      { allowBuilds: ['pkg'], runPlugin, token: 'renderer-token' },
    );
    assert.equal(ipc.installMarketplaceCalls.length, 1);
    assert.equal(ipc.installMarketplaceCalls[0].id, 'owner/name');
    const opts = ipc.installMarketplaceCalls[0].options;
    assert.deepEqual(Object.keys(opts).sort(), ['allowBuilds', 'onProgress', 'token']);
    assert.deepEqual(opts.allowBuilds, ['pkg']);
    assert.equal(opts.token, 'secret-token');
    assert.equal(typeof opts.onProgress, 'function');
    assert.equal(ipc.startHarness(), 1);
    opts.onProgress({ phase: 'start', line: 'installing' });
    assert.deepEqual(progress.at(-1), {
      channel: 'shell:plugin-progress',
      payload: { phase: 'start', line: 'installing' },
    });
  } finally {
    ipc.restore();
  }
});

test('shell:install-marketplace-plugin does not restart harness when install fails', async () => {
  const ipc = loadIpc({ installResult: { ok: false, error: '未收录该插件' } });
  try {
    const result = await ipc.invoke(
      'shell:install-marketplace-plugin',
      harnessEvent(),
      'missing/plugin',
      { allowBuilds: [], runPlugin: () => {} },
    );
    assert.equal(result.ok, false);
    assert.equal(ipc.startHarness(), 0);
  } finally {
    ipc.restore();
  }
});

test('shell:install-marketplace-plugin does not restart harness for needsAllowBuilds', async () => {
  const ipc = loadIpc({ installResult: { ok: false, needsAllowBuilds: true, allowBuilds: ['pkg'] } });
  try {
    const result = await ipc.invoke(
      'shell:install-marketplace-plugin',
      harnessEvent(),
      'owner/name',
    );
    assert.equal(result.ok, false);
    assert.equal(result.needsAllowBuilds, true);
    assert.equal(ipc.startHarness(), 0);
  } finally {
    ipc.restore();
  }
});

test('shell:install-marketplace-plugin keeps ok when startHarness throws', async () => {
  const ipc = loadIpc({
    installResult: { ok: true, spec: 'dsh-loop' },
    startHarness: async () => {
      throw new Error('spawn failed');
    },
  });
  try {
    const result = await ipc.invoke(
      'shell:install-marketplace-plugin',
      harnessEvent(),
      'owner/name',
    );
    assert.equal(result.ok, true);
    assert.equal(result.harnessStarted, false);
    assert.match(String(result.error), /web profile/);
    assert.equal(ipc.startHarness(), 1);
  } finally {
    ipc.restore();
  }
});

test('shell:uninstall-plugin keeps ok when startHarness throws', async () => {
  const ipc = loadIpc({
    startHarness: async () => {
      throw new Error('spawn failed');
    },
  });
  try {
    const result = await ipc.invoke('shell:uninstall-plugin', harnessEvent(), 'pkg');
    assert.equal(result.ok, true);
    assert.equal(result.harnessStarted, false);
    assert.match(String(result.error), /移除/);
    assert.equal(ipc.startHarness(), 1);
  } finally {
    ipc.restore();
  }
});

test('shell:install-plugin keeps ok when startHarness throws', async () => {
  const ipc = loadIpc({
    startHarness: async () => {
      throw new Error('spawn failed');
    },
  });
  try {
    const result = await ipc.invoke('shell:install-plugin', harnessEvent(), 'github:owner/repo');
    assert.equal(result.ok, true);
    assert.equal(result.harnessStarted, false);
    assert.equal(ipc.startHarness(), 1);
  } finally {
    ipc.restore();
  }
});

test('shell:install-plugin does not spread renderer options onto the installer', async () => {
  const ipc = loadIpc();
  try {
    await ipc.invoke(
      'shell:install-plugin',
      harnessEvent(),
      'github:acme/demo',
      { allowBuilds: ['demo'], runPlugin: () => {}, token: 'renderer-token' },
    );
    const opts = ipc.installPluginCalls[0].options;
    assert.deepEqual(Object.keys(opts).sort(), ['allowBuilds', 'onProgress', 'token']);
    assert.equal(opts.token, 'secret-token');
    assert.equal(opts.runPlugin, undefined);
  } finally {
    ipc.restore();
  }
});

test('shell:list-wallpaper-catalog forwards a kind query and coerces numbers', async () => {
  const ipc = loadIpc();
  try {
    await ipc.invoke('shell:list-wallpaper-catalog', harnessEvent(), {
      kind: 'wallhaven',
      year: '2024',
      url: 'https://example.com/pack.json',
      q: 'lake',
      categories: '010',
      page: '2',
    });
    await ipc.invoke('shell:list-wallpaper-catalog', harnessEvent(), {
      kind: 'nsfw',
      includeBing: true,
      catalogs: ['https://example.com/a.json'],
    });
    assert.equal(ipc.listWallpaperCatalogCalls.length, 2);
    const [wallhaven, rejected] = ipc.listWallpaperCatalogCalls;
    assert.equal(wallhaven.kind, 'wallhaven');
    assert.equal(wallhaven.year, 2024);
    assert.equal(typeof wallhaven.year, 'number');
    assert.equal(wallhaven.page, 2);
    assert.equal(typeof wallhaven.page, 'number');
    assert.equal(wallhaven.url, 'https://example.com/pack.json');
    assert.equal(wallhaven.q, 'lake');
    assert.equal(wallhaven.categories, '010');
    assert.equal(rejected.kind, undefined);
    assert.equal(rejected.includeBing, undefined);
    assert.equal(rejected.catalogs, undefined);
  } finally {
    ipc.restore();
  }
});

test('shell:save-boot-log is boot-only and writes dsh.logs not a renderer path', async () => {
  const dest = path.join(os.tmpdir(), `dshd-boot-ipc-${Date.now()}.log`);
  const logs = Array.from({ length: 81 }, (_, index) => `[app] line ${index + 1}`);
  const ipc = loadIpc({
    dsh: {
      logs,
      snapshot: () => ({
        state: 'error',
        error: 'Harness 启动失败',
        failure: { phase: 'startup', message: 'tar failed', code: null, signal: null, occurredAt: '2026-08-20T00:00:00.000Z' },
      }),
    },
    showSaveDialog: async () => ({ canceled: false, filePath: dest }),
  });
  try {
    const unauthorized = (error) => error.code === 'ERR_DSH_IPC_SENDER';
    await assert.rejects(() => ipc.invoke('shell:save-boot-log', harnessEvent()), unauthorized);
    await assert.rejects(() => ipc.invoke('shell:save-boot-log', leftoverMarketplaceEvent()), unauthorized);

    const result = await ipc.invoke('shell:save-boot-log', bootEvent(), 'C:\\evil\\from-renderer.log');
    assert.equal(result.ok, true);
    assert.equal(result.canceled, false);
    assert.equal(result.path, dest);
    const body = fs.readFileSync(dest, 'utf8');
    assert.match(body, /\[app\] line 1\n/);
    assert.match(body, /\[app\] line 81\n/);
    assert.doesNotMatch(body, /from-renderer|evil/);
  } finally {
    ipc.restore();
    fs.rmSync(dest, { force: true });
  }
});

test('shell:get-remote reports unavailable for the disabled remote stub even when the feature flag is on', async () => {
  const { createDisabledRemote } = require('./remote');
  let syncCalls = 0;
  const remote = createDisabledRemote();
  const wrapped = {
    ...remote,
    sync() {
      syncCalls += 1;
      return remote.sync();
    },
  };
  const ipc = loadIpc({ remote: wrapped, remoteFeatureEnabled: true });
  try {
    const snap = await ipc.invoke('shell:get-remote', harnessEvent());
    assert.deepEqual(snap, {
      available: false,
      enabled: false,
      listening: false,
    });
    const saved = await ipc.invoke('shell:save-remote', harnessEvent(), { remoteEnabled: true });
    assert.equal(saved.available, false);
    assert.equal(saved.enabled, false);
    assert.equal(saved.listening, false);
    assert.equal(syncCalls, 1);
  } finally {
    ipc.restore();
  }
});

test('shell:get-remote reports available for a live gateway snapshot', async () => {
  const remote = {
    snapshot() {
      return { enabled: false, listening: false };
    },
    async sync() {
      return this.snapshot();
    },
  };
  const ipc = loadIpc({ remote, remoteFeatureEnabled: true });
  try {
    const snap = await ipc.invoke('shell:get-remote', harnessEvent());
    assert.equal(snap.available, true);
    assert.equal(snap.enabled, false);
    assert.equal(snap.listening, false);
  } finally {
    ipc.restore();
  }
});

test('shell:save-remote refuses credential and workspace fields', async () => {
  const remote = {
    snapshot() {
      return { enabled: true, listening: false };
    },
    async sync() {
      return this.snapshot();
    },
  };
  const ipc = loadIpc({ remote, remoteFeatureEnabled: true });
  try {
    await assert.rejects(
      () => ipc.invoke('shell:save-remote', harnessEvent(), {
        remoteEnabled: true,
        apiKey: 'sk-stolen',
        workspace: 'C:\\',
        githubToken: 'ghp_stolen',
      }),
      /not renderer-writable|must be/,
    );
    assert.equal(ipc.saveConfigCalls.length, 0);
    const saved = await ipc.invoke('shell:save-remote', harnessEvent(), {
      remoteEnabled: true,
      remoteMode: 'lan',
    });
    assert.equal(saved.enabled, true);
    assert.deepEqual(ipc.saveConfigCalls.at(-1), {
      remoteEnabled: true,
      remoteMode: 'lan',
    });
  } finally {
    ipc.restore();
  }
});

test('shell:get-remote stays unavailable when remote is null', async () => {
  const ipc = loadIpc({ remote: null, remoteFeatureEnabled: true });
  try {
    const snap = await ipc.invoke('shell:get-remote', harnessEvent());
    assert.deepEqual(snap, {
      available: false,
      enabled: false,
      listening: false,
    });
  } finally {
    ipc.restore();
  }
});

test('shell:get-config includes the bound desktop DSH home', async () => {
  const { setDesktopDshHome, clearDesktopDshHome } = require('../shared/dsh-home');
  const home = path.join(os.tmpdir(), 'dsh-home-config-view');
  setDesktopDshHome(home);
  const ipc = loadIpc();
  try {
    const config = await ipc.invoke('shell:get-config', harnessEvent());
    assert.equal(config.dshHome, path.resolve(home));
  } finally {
    ipc.restore();
    clearDesktopDshHome();
  }
});

test('shell:get-config exposes the credential storage mode for About diagnostics', async () => {
  const { setDesktopDshHome, clearDesktopDshHome } = require('../shared/dsh-home');
  setDesktopDshHome(path.join(os.tmpdir(), 'dsh-home-cred-view'));
  const encrypted = loadIpc();
  try {
    const config = await encrypted.invoke('shell:get-config', harnessEvent());
    assert.equal(config.credentialStorage, 'encrypted');
  } finally {
    encrypted.restore();
  }
  const plaintext = loadIpc({ credentialStorageMode: () => 'plaintext' });
  try {
    const config = await plaintext.invoke('shell:get-config', harnessEvent());
    assert.equal(config.credentialStorage, 'plaintext');
  } finally {
    plaintext.restore();
    clearDesktopDshHome();
  }
});

test('shell:open-dsh-home opens the bound home and ignores a renderer path', async () => {
  const { setDesktopDshHome, clearDesktopDshHome } = require('../shared/dsh-home');
  const home = path.join(os.tmpdir(), 'dsh-home-open-bound');
  setDesktopDshHome(home);
  const ipc = loadIpc();
  try {
    const unauthorized = (error) => error.code === 'ERR_DSH_IPC_SENDER';
    await assert.rejects(() => ipc.invoke('shell:open-dsh-home', bootEvent()), unauthorized);
    const result = await ipc.invoke('shell:open-dsh-home', harnessEvent(), 'C:\\evil\\from-renderer');
    assert.deepEqual(result, { ok: true, path: path.resolve(home) });
    assert.deepEqual(ipc.openedPaths, [path.resolve(home)]);
  } finally {
    ipc.restore();
    clearDesktopDshHome();
  }
});

test('shell:get-remote reports unavailable when the feature is parked', async () => {
  const remote = {
    snapshot() {
      return { available: true, enabled: true, listening: true, port: 3180, token: 'secret', urls: [{ pairingUrl: 'http://10.0.0.4:3180/#offer=x' }] };
    },
  };
  const ipc = loadIpc({ remote });
  try {
    const snap = await ipc.invoke('shell:get-remote', harnessEvent());
    assert.equal(snap.available, false);
    assert.equal(snap.enabled, false);
    assert.equal(snap.listening, false);
    assert.deepEqual(snap.urls, []);
    assert.equal(snap.token, '');
    const saved = await ipc.invoke('shell:save-remote', harnessEvent(), { remoteEnabled: true });
    assert.equal(saved.available, false);
    assert.equal(saved.enabled, false);
  } finally {
    ipc.restore();
  }
});

test('launcher-only import and release channels reject boot and harness senders', async () => {
  const ipc = loadIpc();
  try {
    const unauthorized = (error) => error.code === 'ERR_DSH_IPC_SENDER';
    await assert.rejects(() => ipc.invoke('shell:scan-import', bootEvent()), unauthorized);
    await assert.rejects(() => ipc.invoke('shell:scan-import', harnessEvent()), unauthorized);
    await assert.rejects(() => ipc.invoke('shell:run-import', bootEvent(), {}), unauthorized);
    await assert.rejects(() => ipc.invoke('shell:install-release', harnessEvent(), 'v0.2.6'), unauthorized);
    await assert.rejects(() => ipc.invoke('shell:list-releases', leftoverMarketplaceEvent()), unauthorized);
  } finally {
    ipc.restore();
  }
});

test('launcher sender can scan-import and list-releases', async () => {
  const ipc = loadIpc();
  try {
    const scan = await ipc.invoke('shell:scan-import', launcherEvent());
    assert.equal(scan.ok, true);
    const releases = await ipc.invoke('shell:list-releases', launcherEvent());
    assert.equal(releases.status, 'ok');
    const start = await ipc.invoke('shell:start-desktop', launcherEvent());
    assert.equal(start.ok, true);
    assert.equal(ipc.startDesktop(), 1);
  } finally {
    ipc.restore();
  }
});

test('launcher skip-user-plugins writes recovery and force-restarts desktop', async () => {
  const writes = [];
  const ipc = loadIpc({
    harness: {
      writePluginSkip(error) {
        writes.push(error && error.message ? error.message : String(error));
      },
    },
  });
  try {
    const result = await ipc.invoke('shell:start-desktop-skipped', launcherEvent());
    assert.equal(result.ok, true);
    assert.deepEqual(writes, ['launcher-skip-user-plugins']);
    assert.equal(ipc.startDesktop(), 1);
    assert.deepEqual(ipc.startDesktopArgs[0], { forceRestart: true });
  } finally {
    ipc.restore();
  }
});

test('launcher start-desktop force-restarts when clearing sticky skip', async () => {
  let cleared = 0;
  const ipc = loadIpc({
    harness: {
      appVersion: '1.2.3',
      pluginRecovery: {
        skipUserPlugins: true,
        reason: 'launcher-skip-user-plugins',
        at: '2026-01-01T00:00:00.000Z',
        appVersion: '1.2.3',
      },
      clearPluginRecovery() {
        cleared += 1;
        this.pluginRecovery = {
          skipUserPlugins: false,
          reason: '',
          at: '',
          appVersion: '',
        };
      },
    },
  });
  try {
    const result = await ipc.invoke('shell:start-desktop', launcherEvent());
    assert.equal(result.ok, true);
    assert.equal(cleared, 1);
    assert.equal(ipc.startDesktop(), 1);
    assert.deepEqual(ipc.startDesktopArgs[0], { forceRestart: true });
  } finally {
    ipc.restore();
  }
});

test('launcher start-desktop does not force-restart without sticky skip', async () => {
  const ipc = loadIpc({
    harness: {
      appVersion: '1.2.3',
      pluginRecovery: {
        skipUserPlugins: false,
        reason: '',
        at: '',
        appVersion: '',
      },
      clearPluginRecovery() {},
    },
  });
  try {
    await ipc.invoke('shell:start-desktop', launcherEvent());
    assert.equal(ipc.startDesktop(), 1);
    assert.deepEqual(ipc.startDesktopArgs[0], {});
  } finally {
    ipc.restore();
  }
});

test('launcher retry-full-plugins clears sticky and uses startDesktop recovery launch', async () => {
  let cleared = 0;
  const ipc = loadIpc({
    harness: {
      clearPluginRecovery() {
        cleared += 1;
      },
    },
  });
  try {
    const result = await ipc.invoke('shell:retry-full-plugins', launcherEvent());
    assert.equal(result.ok, true);
    assert.equal(cleared, 1);
    assert.equal(ipc.startDesktop(), 1);
    assert.deepEqual(ipc.startDesktopArgs[0], { recoveryLaunch: true, forceRestart: true });
    assert.equal(ipc.startHarness(), 0);
  } finally {
    ipc.restore();
  }
});

test('boot retry-full-plugins still uses harness retryFullPlugins and records the start outcome', async () => {
  let retried = 0;
  const ipc = loadIpc({
    harness: {
      retryFullPlugins: async () => {
        retried += 1;
        return { state: 'ready' };
      },
      snapshot: () => ({ state: 'ready' }),
    },
  });
  try {
    await ipc.invoke('shell:retry-full-plugins', bootEvent());
    assert.equal(retried, 1);
    assert.equal(ipc.startDesktop(), 0);
    assert.deepEqual(ipc.lastStartWrites, [{ ok: true }]);
  } finally {
    ipc.restore();
  }
});

test('launcher retry-full-plugins leaves last-start recording to startDesktop', async () => {
  const ipc = loadIpc({ harness: { clearPluginRecovery() {} } });
  try {
    await ipc.invoke('shell:retry-full-plugins', launcherEvent());
    assert.equal(ipc.startDesktop(), 1);
    assert.deepEqual(ipc.lastStartWrites, [], 'startDesktop writes the marker itself');
  } finally {
    ipc.restore();
  }
});

test('boot shell:restart writes last-desktop-start ok:true on success', async () => {
  const ipc = loadIpc({
    harness: {
      retryFullPlugins: async () => ({ state: 'ready' }),
      snapshot: () => ({ state: 'ready' }),
    },
  });
  try {
    const snapshot = await ipc.invoke('shell:restart', bootEvent());
    assert.equal(snapshot.state, 'ready');
    assert.deepEqual(ipc.lastStartWrites, [{ ok: true }]);
  } finally {
    ipc.restore();
  }
});

test('boot shell:restart writes last-desktop-start ok:false and rethrows on failure', async () => {
  const ipc = loadIpc({
    harness: {
      retryFullPlugins: async () => {
        throw new Error('plugin tree exploded');
      },
      snapshot: () => ({ state: 'error' }),
    },
  });
  try {
    await assert.rejects(() => ipc.invoke('shell:restart', bootEvent()), /plugin tree exploded/);
    assert.deepEqual(ipc.lastStartWrites, [{ ok: false, error: 'plugin tree exploded' }]);
  } finally {
    ipc.restore();
  }
});

test('disable-plugins batch writes once and restarts harness once', async () => {
  const ipc = loadIpc({
    dsh: {
      state: 'ready',
      logs: [],
      snapshot: () => ({ state: 'ready' }),
    },
  });
  try {
    const result = await ipc.invoke('shell:disable-plugins', launcherEvent(), ['a-pack', 'b-pack']);
    assert.equal(result.ok, true);
    assert.equal(result.harnessRestarted, true);
    assert.equal(ipc.startHarness(), 1);
    assert.deepEqual(ipc.saveConfigCalls[0].disabledPlugins.sort(), ['a-pack', 'b-pack']);
  } finally {
    ipc.restore();
  }
});

test('disable-plugin restarts harness when kernel is ready without startDesktop', async () => {
  const ipc = loadIpc({
    dsh: {
      state: 'ready',
      logs: [],
      snapshot: () => ({ state: 'ready' }),
      stop: async () => {},
    },
  });
  try {
    const result = await ipc.invoke('shell:disable-plugin', launcherEvent(), 'user-pack');
    assert.equal(result.ok, true);
    assert.equal(result.harnessRestarted, true);
    assert.equal(ipc.startHarness(), 1);
    assert.equal(ipc.startDesktop(), 0);
    assert.ok(result.forensics);
  } finally {
    ipc.restore();
  }
});

test('disable-plugin rejects desktop built-in dsh-im aliases without writing config', async () => {
  const ipc = loadIpc({
    dsh: {
      state: 'ready',
      logs: [],
      snapshot: () => ({ state: 'ready' }),
    },
  });
  try {
    for (const alias of ['@xmanrui/dsh-im', 'dsh-im', 'xmanrui-dsh-im']) {
      const result = await ipc.invoke('shell:disable-plugin', launcherEvent(), alias);
      assert.equal(result.ok, false);
      assert.equal(result.error, 'desktop-builtin');
    }
    const batch = await ipc.invoke('shell:disable-plugins', launcherEvent(), ['user-pack', 'dsh-im']);
    assert.equal(batch.ok, false);
    assert.equal(batch.error, 'desktop-builtin');
    assert.equal(batch.name, 'dsh-im');
    assert.equal(ipc.saveConfigCalls.length, 0);
    assert.equal(ipc.startHarness(), 0);
  } finally {
    ipc.restore();
  }
});

test('disable-plugin rejects the desktop built-in usage-panel without writing config', async () => {
  const ipc = loadIpc({
    dsh: {
      state: 'ready',
      logs: [],
      snapshot: () => ({ state: 'ready' }),
    },
  });
  try {
    const single = await ipc.invoke('shell:disable-plugin', launcherEvent(), 'dsh-usage-panel');
    assert.equal(single.ok, false);
    assert.equal(single.error, 'desktop-builtin');
    const batch = await ipc.invoke('shell:disable-plugins', launcherEvent(), ['user-pack', 'dsh-usage-panel']);
    assert.equal(batch.ok, false);
    assert.equal(batch.error, 'desktop-builtin');
    assert.equal(batch.name, 'dsh-usage-panel');
    assert.equal(ipc.saveConfigCalls.length, 0);
    assert.equal(ipc.startHarness(), 0);
  } finally {
    ipc.restore();
  }
});

test('disable-plugin skips harness restart when kernel is idle', async () => {
  const ipc = loadIpc({
    dsh: {
      state: 'idle',
      logs: [],
      snapshot: () => ({ state: 'idle' }),
    },
  });
  try {
    const result = await ipc.invoke('shell:disable-plugin', launcherEvent(), 'user-pack');
    assert.equal(result.ok, true);
    assert.equal(result.harnessRestarted, false);
    assert.equal(ipc.startHarness(), 0);
    assert.equal(ipc.startDesktop(), 0);
  } finally {
    ipc.restore();
  }
});

test('disable-plugin keeps ok when harness restart fails after disk write', async () => {
  const ipc = loadIpc({
    dsh: {
      state: 'ready',
      logs: [],
      snapshot: () => ({ state: 'ready' }),
    },
    startHarness: async () => {
      throw new Error('restart failed');
    },
  });
  try {
    const result = await ipc.invoke('shell:disable-plugin', launcherEvent(), 'user-pack');
    assert.equal(result.ok, true);
    assert.equal(result.harnessRestarted, false);
    assert.match(result.error, /没有重新起来/);
    assert.equal(ipc.startHarness(), 1);
  } finally {
    ipc.restore();
  }
});

test('enable-plugin restarts harness when kernel is starting', async () => {
  const ipc = loadIpc({
    dsh: {
      state: 'starting',
      logs: [],
      snapshot: () => ({ state: 'starting' }),
    },
  });
  try {
    const result = await ipc.invoke('shell:enable-plugin', launcherEvent(), 'user-pack');
    assert.equal(result.ok, true);
    assert.equal(result.harnessRestarted, true);
    assert.equal(ipc.startHarness(), 1);
    assert.equal(ipc.startDesktop(), 0);
  } finally {
    ipc.restore();
  }
});

test('run-import reports kernelStopped only when a running kernel was stopped', async () => {
  let stopCalls = 0;
  const ipc = loadIpc({
    dsh: {
      state: 'ready',
      logs: [],
      snapshot: () => ({ state: 'ready' }),
      stop: async () => {
        stopCalls += 1;
      },
    },
  });
  try {
    const running = await ipc.invoke('shell:run-import', launcherEvent(), {});
    assert.equal(running.kernelStopped, true);
    assert.equal(stopCalls, 1);
  } finally {
    ipc.restore();
  }

  const idle = loadIpc({
    dsh: {
      state: 'idle',
      logs: [],
      snapshot: () => ({ state: 'idle' }),
      stop: async () => {
        stopCalls += 1;
      },
    },
  });
  try {
    const result = await idle.invoke('shell:run-import', launcherEvent(), {});
    assert.equal(result.kernelStopped, false);
    assert.equal(stopCalls, 1);
  } finally {
    idle.restore();
  }
});

test('launcher scan-import and run-import forward extra skill dirs and selections', async () => {
  const ipc = loadIpc();
  try {
    await ipc.invoke('shell:scan-import', launcherEvent(), {
      sourceHome: 'C:\\official-home',
      extraSkillDirs: ['C:\\skills-extra'],
    });
    assert.equal(ipc.scanImportCalls.length, 1);
    assert.equal(ipc.scanImportCalls[0].sourceHome, 'C:\\official-home');
    assert.deepEqual(ipc.scanImportCalls[0].extraSkillDirs, ['C:\\skills-extra']);

    const payload = {
      sourceHome: 'C:\\official-home',
      extraSkillDirs: ['C:\\skills-extra'],
      overwrite: true,
      importAttachments: true,
      selectedRels: ['proj/sess-a'],
      selectedSkillIds: ['home:alpha'],
      selectedPluginNames: ['good-plugin'],
      selectedMcpIds: ['wiki'],
      selectedSettingIds: ['llm-deepseek', 'agents-md'],
      selectedPresetIds: ['research'],
    };
    const result = await ipc.invoke('shell:run-import', launcherEvent(), payload);
    assert.equal(result.empty, true);
    assert.equal(ipc.runImportCalls.length, 1);
    const opts = ipc.runImportCalls[0];
    assert.equal(opts.sourceHome, payload.sourceHome);
    assert.deepEqual(opts.extraSkillDirs, payload.extraSkillDirs);
    assert.equal(opts.overwrite, true);
    assert.equal(opts.importAttachments, true);
    assert.deepEqual(opts.selectedRels, payload.selectedRels);
    assert.deepEqual(opts.selectedSkillIds, payload.selectedSkillIds);
    assert.deepEqual(opts.selectedPluginNames, payload.selectedPluginNames);
    assert.deepEqual(opts.selectedMcpIds, payload.selectedMcpIds);
    assert.deepEqual(opts.selectedSettingIds, payload.selectedSettingIds);
    assert.deepEqual(opts.selectedPresetIds, payload.selectedPresetIds);
    assert.equal(typeof opts.installPlugin, 'function');
  } finally {
    ipc.restore();
  }
});

test('launcher stop-desktop stops kernel, cancels recovery, and dismisses main window', async () => {
  let stopped = 0;
  let stopDesktopCalls = 0;
  let cleaned = 0;
  let dismissed = 0;
  const dsh = {
    state: 'ready',
    stop: async () => {
      stopped += 1;
      dsh.state = 'idle';
    },
    snapshot: () => ({ state: dsh.state }),
    logs: [],
  };
  const ipc = loadIpc({
    dsh,
    harness: {
      async stopDesktop() {
        stopDesktopCalls += 1;
        await dsh.stop();
        return dsh.snapshot();
      },
    },
    stopDesktopCleanup: () => {
      cleaned += 1;
    },
    dismissMainWindow: () => {
      dismissed += 1;
      return true;
    },
  });
  try {
    const result = await ipc.invoke('shell:stop-desktop', launcherEvent());
    assert.equal(result.ok, true);
    assert.equal(result.stopped, true);
    assert.equal(stopped, 1);
    assert.equal(stopDesktopCalls, 1);
    assert.equal(cleaned, 1);
    assert.equal(dismissed, 1);
  } finally {
    ipc.restore();
  }
});

test('launcher stop-desktop is a no-op when kernel is not running', async () => {
  let stopped = 0;
  let stopDesktopCalls = 0;
  const ipc = loadIpc({
    dsh: {
      state: 'idle',
      stop: async () => {
        stopped += 1;
      },
      snapshot: () => ({ state: 'idle' }),
      logs: [],
    },
    harness: {
      async stopDesktop() {
        stopDesktopCalls += 1;
      },
    },
  });
  try {
    const result = await ipc.invoke('shell:stop-desktop', launcherEvent());
    assert.equal(result.ok, true);
    assert.equal(result.stopped, false);
    assert.equal(stopped, 0);
    assert.equal(stopDesktopCalls, 1);
  } finally {
    ipc.restore();
  }
});

test('launcher uninstall-app returns launchUninstaller result', async () => {
  const ipc = loadIpc({
    launchUninstaller: () => ({ ok: false, error: 'uninstaller-not-found' }),
  });
  try {
    const result = await ipc.invoke('shell:uninstall-app', launcherEvent());
    assert.equal(result.ok, false);
    assert.equal(result.error, 'uninstaller-not-found');
  } finally {
    ipc.restore();
  }
});

test('launcher-only stop-desktop rejects boot and harness senders', async () => {
  const ipc = loadIpc();
  try {
    const unauthorized = (error) => error.code === 'ERR_DSH_IPC_SENDER';
    await assert.rejects(() => ipc.invoke('shell:stop-desktop', bootEvent()), unauthorized);
    await assert.rejects(() => ipc.invoke('shell:stop-desktop', harnessEvent()), unauthorized);
  } finally {
    ipc.restore();
  }
});

test('open-launcher serves harness and boot (boot lands on home tab), rejects launcher sender', async () => {
  const calls = [];
  const ipc = loadIpc({
    onOpenLauncher: async (options) => {
      calls.push(options);
    },
  });
  try {
    const result = await ipc.invoke('shell:open-launcher', harnessEvent());
    assert.equal(result.ok, true);
    assert.deepEqual(calls, [{}]);
    // Boot-page bridge: startup failures route to the launcher home tab so
    // the Recovery Board (the ONLY plugin-level recovery surface) is in view.
    const bridged = await ipc.invoke('shell:open-launcher', bootEvent());
    assert.equal(bridged.ok, true);
    assert.deepEqual(calls, [{}, { tab: 'home' }]);
    await assert.rejects(
      () => ipc.invoke('shell:open-launcher', launcherEvent()),
      (error) => error.code === 'ERR_DSH_IPC_SENDER',
    );
    assert.equal(calls.length, 2);
  } finally {
    ipc.restore();
  }
});
