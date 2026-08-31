const fs = require('node:fs');
const { ipcMain, dialog, app, shell, nativeTheme } = require('electron');
const { formatBootLogDump, saveBootLog } = require('./boot-log-dump');
const {
  REMOTE_FEATURE_ENABLED,
  loadConfig,
  saveConfig,
  publicConfig,
  parkRemoteSnapshot,
  credentialStorageMode,
  normalizeRendererConfigPatch,
  normalizeLauncherConfigPatch,
} = require('./config');
const { normalizeRemotePatch } = require('./remote-patch');
const { getMainWindow, dismissMainWindow, getHarnessWebContents, openHarnessSettings, openMarketplace, openRemote, getLauncherWindow } = require('./window');
const { resolveNodeBin, resolveDshBin, sourceHarnessStatus } = require('./dsh');
const { listThemes, resolveTheme } = require('../shared/themes');
const { applyAppTheme } = require('./chrome');
const { checkUpdate, installUpdate, listReleases, installRelease, launchUninstaller, currentVersion, REPO_URL, RELEASES_PAGE } = require('./update');
const { listMarketplace } = require('./marketplace-catalog');
const { listInstalledPlugins, installPlugin, installImportPlugin, installMarketplacePlugin, uninstallPlugin } = require('./marketplace-install');
const {
  listInstalledPlugins: listProfilePlugins,
  applyDisabledBundles,
  setBundleEnabled,
  OFFICIAL_TEMPLATE_BUNDLES,
} = require('./plugins');
const { scanImport, probeImportHold, runImport } = require('./data-import');
const { inspectPlugins, isPresetPlugin } = require('./plugin-forensics');
const { DSH_IM_ALIASES } = require('./dsh-im-desktop');
const { isPluginTreeFailure } = require('./plugin-tree-failure');
const { readLastDesktopStart, recordLastDesktopStart, stickySkipActive } = require('./launcher-gate');
const { listWallpaperCatalog, downloadWallpaper } = require('./wallpaper-catalog');
const { gitBranchList, gitCommit, gitCreateBranch, gitCreateChangeRequest, gitDiff, gitDiscard, gitFetchForStatus, gitInit, gitPublishRepository, gitPull, gitPush, gitReadPullRequest, gitStage, gitStatus, gitStatusEntries, gitSwitchBranch, gitUnstage, openWorkspacePath } = require('./git');
const { gitIpcNull, guardGitIpc } = require('./git-ipc-guard');
const { watchWorkspaceRegistrations } = require('./git-workspace-watch');
const { registerPreviewIpc } = require('./preview');
const { registerPtyIpc } = require('./pty');
const { listDir, readFile, readFileMedia, writeFile } = require('./workspace-fs');
const { listAvailableEditors, openInEditor, revealInFolder, openWithSystemDefault } = require('./editors');
const { IPC_ROLES, assertIpcSender } = require('./ipc-authorization');
const { tryGetDesktopDshHome } = require('../shared/dsh-home');
const { openDesktopDshHome } = require('./open-dsh-home');

const BOOT_ONLY = [IPC_ROLES.BOOT];
const HARNESS_ONLY = [IPC_ROLES.HARNESS];
const LAUNCHER_ONLY = [IPC_ROLES.LAUNCHER];
const CONFIG_SURFACES = [IPC_ROLES.HARNESS];
const ALL_SURFACES = [IPC_ROLES.BOOT, IPC_ROLES.HARNESS, IPC_ROLES.LAUNCHER];
const UPDATE_SURFACES = [IPC_ROLES.HARNESS, IPC_ROLES.LAUNCHER];
// Boot page and harness may summon the launcher window; the launcher itself
// never needs to (it IS the launcher).
const OPEN_LAUNCHER_SURFACES = [IPC_ROLES.BOOT, IPC_ROLES.HARNESS];

function configLocale(config = loadConfig()) {
  return config.locale === 'en' ? 'en' : 'zh';
}

function configPayload(config) {
  return {
    ...publicConfig(config),
    locale: configLocale(config),
    theme: config.theme || 'midnight',
    themes: listThemes(),
    themeTokens: resolveTheme(config, {
      systemDark: Boolean(nativeTheme && nativeTheme.shouldUseDarkColors),
    }),
    nodeDetected: resolveNodeBin(config),
    dshDetected: (() => {
      const source = sourceHarnessStatus();
      if (source.present) {
        return source.built ? `源码 ${source.root}` : `源码未构建 ${source.root}`;
      }
      return resolveDshBin(config);
    })(),
    appVersion: currentVersion(),
    repoUrl: REPO_URL,
    releasesUrl: RELEASES_PAGE,
    dshHome: tryGetDesktopDshHome(),
    // About/diagnostics: whether credentials.json is protected by the OS
    // keychain (safeStorage) or sits in the documented plaintext fallback.
    credentialStorage: credentialStorageMode(),
  };
}

function sendPluginProgress(event, payload) {
  if (event?.sender && !event.sender.isDestroyed()) {
    event.sender.send('shell:plugin-progress', payload);
  }
}

const HARNESS_DOWN_AFTER_ADD = '插件已写入 web profile，但 Harness 没有起来。请从现有入口重启，不要再安装一次。';
const HARNESS_DOWN_AFTER_REMOVE = '插件已从 web profile 移除，但 Harness 没有起来。请从现有入口重启，不要再卸载一次。';
const HARNESS_DOWN_AFTER_DISABLE = '插件禁用名单已写入，但 Harness 没有重新起来。请从现有入口重启。';
const HARNESS_DOWN_AFTER_ENABLE = '插件启用已写入，但 Harness 没有重新起来。请从现有入口重启。';
const WALLPAPER_CATALOG_KINDS = new Set(['bing', 'wallhaven', 'catalog']);

function dshKernelState(dsh) {
  if (!dsh) {
    return '';
  }
  if (typeof dsh.state === 'string' && dsh.state) {
    return dsh.state;
  }
  if (typeof dsh.snapshot === 'function') {
    return dsh.snapshot().state || '';
  }
  return '';
}

function kernelNeedsAlign(dsh) {
  const state = dshKernelState(dsh);
  return state === 'ready' || state === 'starting' || state === 'error';
}

function kernelIsRunning(dsh) {
  const state = dshKernelState(dsh);
  return state !== 'idle' && state !== '';
}

function finiteNumber(value) {
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : undefined;
}

function wallpaperCatalogQuery(query = {}) {
  return {
    kind: WALLPAPER_CATALOG_KINDS.has(query.kind) ? query.kind : undefined,
    year: finiteNumber(query.year),
    url: typeof query.url === 'string' ? query.url : undefined,
    q: typeof query.q === 'string' ? query.q : undefined,
    categories: typeof query.categories === 'string' ? query.categories : undefined,
    page: finiteNumber(query.page),
  };
}

async function restartAfterProfileWrite(event, result, startHarness, downError, harness, clearPluginSkip = false) {
  if (result.ok !== true || typeof startHarness !== 'function') {
    return result;
  }
  sendPluginProgress(event, { phase: 'restart', line: '正在重启 Harness' });
  try {
    if (clearPluginSkip && harness && typeof harness.retryFullPlugins === 'function') {
      await harness.retryFullPlugins();
    } else {
      await startHarness();
    }
  } catch {
    // startHarness threw after the profile write committed. Return ok so the UI does not retry the write.
    return { ...result, ok: true, harnessStarted: false, error: downError };
  }
  return { ...result, harnessStarted: true };
}

function registerIpc({
  dsh, harness, startHarness, startDesktop, stopDesktopCleanup, remote, onOpenLauncher,
}) {
  const handle = (channel, roles, listener) => {
    ipcMain.handle(channel, (event, ...args) => {
      assertIpcSender(event, roles);
      return listener(event, ...args);
    });
  };
  const authorizeHarness = (event) => assertIpcSender(event, HARNESS_ONLY);
  // Serialize disable/enable write+restart so a second click cannot join a
  // restart that started before its disabledPlugins write landed.
  let profileAlignChain = Promise.resolve();

  function enqueueProfileAlign(work) {
    const run = profileAlignChain.then(work, work);
    profileAlignChain = run.catch(() => {});
    return run;
  }

  async function alignHarnessAfterProfileChange(downError) {
    if (typeof startHarness !== 'function') {
      return { harnessRestarted: false, error: downError };
    }
    try {
      await startHarness();
      return { harnessRestarted: true };
    } catch {
      return { harnessRestarted: false, error: downError };
    }
  }

  handle('shell:get-state', BOOT_ONLY, () => (harness ? harness.snapshot() : dsh.snapshot()));

  handle('shell:get-config', ALL_SURFACES, () => configPayload(loadConfig()));

  handle('shell:save-config', CONFIG_SURFACES, async (_event, patch) => {
    const safePatch = normalizeRendererConfigPatch(patch || {});
    const next = saveConfig(safePatch);
    app.setLoginItemSettings({ openAtLogin: Boolean(next.openAtLogin) });
    if (Object.prototype.hasOwnProperty.call(safePatch, 'theme')) {
      applyAppTheme();
    }
    if (harness && [
      'harnessAutoRestart',
      'harnessRestartMaxAttempts',
      'harnessRestartBaseDelayMs',
    ].some((key) => Object.prototype.hasOwnProperty.call(safePatch, key))) {
      harness.refreshPolicy();
    }
    return configPayload(next);
  });

  handle('shell:open-external', CONFIG_SURFACES, async (_event, url) => {
    if (typeof url !== 'string' || !/^https?:\/\//i.test(url)) {
      throw new Error('Invalid URL');
    }
    await shell.openExternal(url);
    return true;
  });

  // Boot-page restarts are full desktop starts: record their outcome in
  // last-desktop-start.json so the next cold-start gate sees the truth.
  // Launcher-role paths go through startDesktop, which records it itself.
  const recordBootRestart = () => recordLastDesktopStart(
    app.getPath('userData'),
    () => (harness ? harness.retryFullPlugins() : startHarness()),
  );

  handle('shell:restart', BOOT_ONLY, async () => {
    await recordBootRestart();
    return harness ? harness.snapshot() : dsh.snapshot();
  });

  handle('shell:retry-full-plugins', ALL_SURFACES, async (event) => {
    const role = assertIpcSender(event, ALL_SURFACES);
    if (role === IPC_ROLES.LAUNCHER && typeof startDesktop === 'function') {
      if (harness && typeof harness.clearPluginRecovery === 'function') {
        harness.clearPluginRecovery();
      }
      return startDesktop({ recoveryLaunch: true, forceRestart: true });
    }
    await recordBootRestart();
    return harness ? harness.snapshot() : dsh.snapshot();
  });

  handle('shell:cancel-restart', BOOT_ONLY, () => (
    harness ? harness.cancelRecovery() : dsh.snapshot()
  ));

  handle('shell:save-boot-log', BOOT_ONLY, async () => {
    const snapshot = harness ? harness.snapshot() : dsh.snapshot();
    const dump = formatBootLogDump({
      version: currentVersion(),
      savedAt: new Date().toISOString(),
      snapshot,
      logs: Array.isArray(dsh.logs) ? dsh.logs : [],
    });
    return saveBootLog({
      dialog,
      browserWindow: getMainWindow(),
      dump,
      writeFile: fs.promises.writeFile,
      defaultDirectory: app.getPath('downloads'),
    });
  });

  handle('shell:open-settings', HARNESS_ONLY, (_event, sectionId) => openHarnessSettings(sectionId));

  handle('shell:open-launcher', OPEN_LAUNCHER_SURFACES, async (event) => {
    if (typeof onOpenLauncher !== 'function') {
      return { ok: false, reason: 'unavailable' };
    }
    // The boot page bridges startup failures to the launcher home tab, where
    // the Recovery Board owns ALL plugin-level recovery (attribution,
    // per-plugin disable, skip). The boot page itself only keeps transient
    // actions (retry / cancel auto-restart / download log) and never grows
    // its own recovery copy.
    const role = assertIpcSender(event, OPEN_LAUNCHER_SURFACES);
    await onOpenLauncher(role === IPC_ROLES.BOOT ? { tab: 'home' } : {});
    return { ok: true };
  });

  handle('shell:open-dsh-home', HARNESS_ONLY, () => openDesktopDshHome());

  handle('shell:check-update', UPDATE_SURFACES, () => checkUpdate());

  handle('shell:list-marketplace', HARNESS_ONLY, async (_event, options = {}) => {
    return listMarketplace({
      refresh: Boolean(options && options.refresh),
      locale: options?.locale,
    });
  });

  handle('shell:refresh-marketplace', HARNESS_ONLY, async (_event, options = {}) => {
    return listMarketplace({
      refresh: true,
      locale: options?.locale,
    });
  });

  handle('shell:list-wallpaper-catalog', HARNESS_ONLY, async (_event, query = {}) => (
    listWallpaperCatalog(wallpaperCatalogQuery(query))
  ));

  handle('shell:download-wallpaper', HARNESS_ONLY, async (_event, url) => {
    if (typeof url !== 'string') return { error: '壁纸地址无效' };
    return downloadWallpaper(url);
  });

  handle('shell:list-installed-plugins', HARNESS_ONLY, () => listInstalledPlugins());

  handle('shell:install-plugin', HARNESS_ONLY, async (event, spec, options = {}) => {
    const config = loadConfig();
    const result = await installPlugin(spec, {
      token: config.githubToken,
      allowBuilds: Array.isArray(options?.allowBuilds) ? options.allowBuilds : [],
      onProgress: (payload) => sendPluginProgress(event, payload),
    });
    return restartAfterProfileWrite(event, result, startHarness, HARNESS_DOWN_AFTER_ADD);
  });

  handle('shell:install-marketplace-plugin', HARNESS_ONLY, async (event, id, options = {}) => {
    const config = loadConfig();
    const result = await installMarketplacePlugin(id, {
      token: config.githubToken,
      allowBuilds: Array.isArray(options?.allowBuilds) ? options.allowBuilds : [],
      onProgress: (payload) => sendPluginProgress(event, payload),
    });
    return restartAfterProfileWrite(event, result, startHarness, HARNESS_DOWN_AFTER_ADD);
  });

  handle('shell:uninstall-plugin', HARNESS_ONLY, async (event, name) => {
    const result = await uninstallPlugin(name, {
      onProgress: (payload) => sendPluginProgress(event, payload),
    });
    return restartAfterProfileWrite(event, result, startHarness, HARNESS_DOWN_AFTER_REMOVE, harness, true);
  });

  handle('shell:open-marketplace', HARNESS_ONLY, () => openMarketplace());

  // Every shell:git-* listener is guarded: a thrown handler error resolves to
  // the channel's failure payload instead of rejecting the renderer invoke,
  // which would strand the titlebar progress toast in the loading state.
  handle('shell:git-status', HARNESS_ONLY, guardGitIpc((_event, cwd) => gitStatus(cwd), gitIpcNull));
  handle('shell:git-fetch-status', HARNESS_ONLY, guardGitIpc((_event, cwd) => gitFetchForStatus(cwd), gitIpcNull));
  handle('shell:git-pull-request', HARNESS_ONLY, guardGitIpc((_event, cwd) => gitReadPullRequest(cwd)));
  handle('shell:git-init', HARNESS_ONLY, guardGitIpc((_event, cwd) => gitInit(cwd)));
  handle('shell:git-diff', HARNESS_ONLY, guardGitIpc((_event, cwd, options) => gitDiff(cwd, options), gitIpcNull));
  const sendGitProgress = (event, actionId) => (progress) => {
    if (actionId == null || event.sender.isDestroyed()) return;
    event.sender.send('shell:git-progress', { actionId, ...progress });
  };
  handle('shell:git-commit', HARNESS_ONLY, guardGitIpc((event, cwd, message, filePaths, actionId, options) => (
    gitCommit(cwd, message, filePaths, sendGitProgress(event, actionId), options)
  )));
  handle('shell:git-push', HARNESS_ONLY, guardGitIpc((event, cwd, actionId) => gitPush(cwd, sendGitProgress(event, actionId))));
  handle('shell:git-pull', HARNESS_ONLY, guardGitIpc((event, cwd, actionId) => gitPull(cwd, sendGitProgress(event, actionId))));
  handle('shell:git-create-change-request', HARNESS_ONLY, guardGitIpc((event, cwd, input, actionId) => (
    gitCreateChangeRequest(cwd, input, sendGitProgress(event, actionId))
  )));
  handle('shell:git-publish', HARNESS_ONLY, guardGitIpc((event, cwd, input, actionId) => (
    gitPublishRepository(cwd, input, sendGitProgress(event, actionId))
  )));
  // Not a git channel, but ui-git consumes it as the same `{ ok, message }`
  // failure payload from the commit dialog's file rows.
  handle('shell:open-workspace-path', HARNESS_ONLY, guardGitIpc((_event, cwd, relativePath) => openWorkspacePath(cwd, relativePath)));
  handle('shell:list-dir', HARNESS_ONLY, (_event, cwd, relativePath) => listDir(cwd, relativePath));
  handle('shell:read-file', HARNESS_ONLY, (_event, cwd, relativePath) => readFile(cwd, relativePath));
  handle('shell:read-file-media', HARNESS_ONLY, (_event, cwd, relativePath) => readFileMedia(cwd, relativePath));
  handle('shell:write-file', HARNESS_ONLY, (_event, cwd, relativePath, text) => writeFile(cwd, relativePath, text));
  handle('shell:list-editors', HARNESS_ONLY, () => listAvailableEditors());
  handle('shell:open-in-editor', HARNESS_ONLY, (_event, input) => openInEditor(input));
  handle('shell:show-item-in-folder', HARNESS_ONLY, (_event, cwd, relativePath) => revealInFolder(cwd, relativePath));
  handle('shell:open-with-default', HARNESS_ONLY, (_event, cwd, relativePath) => (
    openWithSystemDefault({ cwd, relativePath })
  ));
  handle('shell:git-stage', HARNESS_ONLY, guardGitIpc((_event, cwd, relativePath) => gitStage(cwd, relativePath)));
  handle('shell:git-unstage', HARNESS_ONLY, guardGitIpc((_event, cwd, relativePath) => gitUnstage(cwd, relativePath)));
  handle('shell:git-discard', HARNESS_ONLY, guardGitIpc((_event, cwd, relativePath) => gitDiscard(cwd, relativePath)));
  handle('shell:git-status-entries', HARNESS_ONLY, guardGitIpc((_event, cwd) => gitStatusEntries(cwd)));
  handle('shell:git-branch-list', HARNESS_ONLY, guardGitIpc((_event, cwd) => gitBranchList(cwd)));
  handle('shell:git-switch-branch', HARNESS_ONLY, guardGitIpc((_event, cwd, ref) => gitSwitchBranch(cwd, ref)));
  handle('shell:git-create-branch', HARNESS_ONLY, guardGitIpc((_event, cwd, name) => gitCreateBranch(cwd, name)));
  // The harness registers a newly opened workspace asynchronously, so the
  // titlebar's first git status read can race that write and come back
  // unauthorized. Push a signal when the registry changes so ui-git refreshes
  // as soon as the trust roots are live instead of waiting for window focus.
  const stopWorkspaceWatch = watchWorkspaceRegistrations(() => {
    const contents = getHarnessWebContents();
    if (contents && !contents.isDestroyed()) {
      contents.send('shell:git-workspaces-changed');
    }
  });
  const pty = registerPtyIpc(ipcMain, undefined, { authorize: authorizeHarness });
  const preview = registerPreviewIpc(ipcMain, undefined, { authorize: authorizeHarness });

  handle('shell:open-remote', HARNESS_ONLY, () => {
    if (!REMOTE_FEATURE_ENABLED) {
      throw new Error('Remote is disabled in this build');
    }
    return openRemote();
  });

  handle('shell:get-remote', HARNESS_ONLY, async () => {
    if (!REMOTE_FEATURE_ENABLED) {
      const parked = remote && typeof remote.snapshot === 'function'
        ? remote.snapshot()
        : { available: false, enabled: false, listening: false };
      return parkRemoteSnapshot(parked);
    }
    if (remote && typeof remote.ensurePairing === 'function') {
      await remote.ensurePairing();
    }
    const snapshot = remote && typeof remote.snapshot === 'function'
      ? remote.snapshot()
      : { available: false, enabled: false, listening: false };
    if (snapshot.available === false) {
      return { ...snapshot, available: false, enabled: false };
    }
    return {
      ...snapshot,
      available: true,
      enabled: Boolean(snapshot.enabled),
    };
  });

  handle('shell:save-remote', HARNESS_ONLY, async (_event, patch) => {
    if (!REMOTE_FEATURE_ENABLED) {
      saveConfig({ remoteEnabled: false, remoteMode: 'lan', remoteRelayUrl: '' });
      if (remote && typeof remote.sync === 'function') {
        await remote.sync();
      }
      return parkRemoteSnapshot(remote && typeof remote.snapshot === 'function' ? remote.snapshot() : {});
    }
    saveConfig(normalizeRemotePatch(patch || {}));
    if (remote && typeof remote.sync === 'function') {
      return remote.sync();
    }
    return remote ? remote.snapshot() : null;
  });

  handle('shell:rotate-remote-token', HARNESS_ONLY, async () => {
    if (!REMOTE_FEATURE_ENABLED) {
      return parkRemoteSnapshot(remote && typeof remote.snapshot === 'function' ? remote.snapshot() : {});
    }
    if (remote && typeof remote.rotateToken === 'function') {
      return remote.rotateToken();
    }
    return null;
  });

  handle('shell:unbind-remote-device', HARNESS_ONLY, async (_event, id) => {
    if (!REMOTE_FEATURE_ENABLED) {
      return parkRemoteSnapshot(remote && typeof remote.snapshot === 'function' ? remote.snapshot() : {});
    }
    if (remote && typeof remote.unbindDevice === 'function') {
      return remote.unbindDevice(id);
    }
    return remote ? remote.snapshot() : null;
  });

  // Releases without SHA512SUMS.txt must never install silently: the user
  // explicitly accepts the unverified download or nothing is fetched.
  async function confirmUnverifiedInstall(info) {
    const win = getLauncherWindow() || getMainWindow() || undefined;
    const en = configLocale() === 'en';
    const result = await dialog.showMessageBox(win, {
      type: 'warning',
      buttons: en ? ['Install anyway', 'Cancel'] : ['仍要安装', '取消'],
      defaultId: 1,
      cancelId: 1,
      title: en ? 'Unverified installer' : '安装包无法校验',
      message: en
        ? `Release ${info?.tag || info?.latest || ''} has no SHA512SUMS.txt manifest, so the installer cannot be verified. Install anyway?`
        : `版本 ${info?.tag || info?.latest || ''} 未提供 SHA512SUMS.txt 校验清单，无法验证安装包完整性。仍要下载并安装吗？`,
      noLink: true,
    });
    return result.response === 0;
  }

  handle('shell:install-update', UPDATE_SURFACES, async (event) => {
    try {
      return await installUpdate((payload) => {
        if (!event.sender.isDestroyed()) {
          event.sender.send('shell:update-progress', payload);
        }
      }, { confirmUnverified: confirmUnverifiedInstall });
    } catch (error) {
      return {
        status: 'error',
        current: currentVersion(),
        repoUrl: REPO_URL,
        releasesUrl: RELEASES_PAGE,
        htmlUrl: RELEASES_PAGE,
        latest: '',
        assetName: '',
        assetUrl: '',
        launched: false,
        message: error.message || String(error),
      };
    }
  });

  function collectForensics() {
    const listed = listProfilePlugins();
    const config = loadConfig();
    const lastStart = readLastDesktopStart(app.getPath('userData'));
    const logs = Array.isArray(dsh?.logs)
      ? dsh.logs.map((row) => (typeof row === 'string' ? row : row.message || row.line || String(row)))
      : [];
    const corpus = [logs.join('\n'), lastStart.error].filter(Boolean).join('\n');
    const recovery = harness?.pluginRecovery && typeof harness.pluginRecovery === 'object'
      ? harness.pluginRecovery
      : (config.pluginRecovery || {});
    return inspectPlugins({
      logs,
      lastStartError: lastStart.error,
      pluginTreeFailure: isPluginTreeFailure(corpus),
      recovery,
      plugins: listed.plugins || [],
      bundles: listed.bundles || [],
      disabledPlugins: config.disabledPlugins,
    });
  }

  async function stopKernelIfRunning() {
    if (!dsh || typeof dsh.stop !== 'function') {
      return false;
    }
    if (!kernelIsRunning(dsh)) {
      return false;
    }
    await dsh.stop();
    return true;
  }

  handle('shell:launcher-status', LAUNCHER_ONLY, () => {
    const lastStart = readLastDesktopStart(app.getPath('userData'));
    const forensics = collectForensics();
    return {
      config: configPayload(loadConfig()),
      desktop: harness ? harness.snapshot() : dsh.snapshot(),
      lastStart,
      recovery: forensics.recovery,
      forensicsSummary: forensics.summary,
      forensics,
      version: currentVersion(),
    };
  });

  handle('shell:save-launcher-config', LAUNCHER_ONLY, (_event, patch) => {
    const next = saveConfig(normalizeLauncherConfigPatch(patch || {}));
    return configPayload(next);
  });

  handle('shell:scan-import', LAUNCHER_ONLY, (_event, payload) => {
    if (typeof payload === 'string') {
      return scanImport({ sourceHome: payload });
    }
    const options = payload && typeof payload === 'object' ? payload : {};
    return scanImport({
      sourceHome: typeof options.sourceHome === 'string' ? options.sourceHome : undefined,
      extraSkillDirs: Array.isArray(options.extraSkillDirs) ? options.extraSkillDirs : [],
    });
  });

  handle('shell:pick-import-source', LAUNCHER_ONLY, async () => {
    const win = getLauncherWindow();
    const result = await dialog.showOpenDialog(win || undefined, {
      title: configLocale() === 'en' ? 'Choose official home' : '选择官方数据目录',
      defaultPath: require('node:os').homedir(),
      properties: ['openDirectory'],
    });
    if (result.canceled || !result.filePaths[0]) {
      return null;
    }
    return result.filePaths[0];
  });

  handle('shell:pick-skill-dir', LAUNCHER_ONLY, async () => {
    const win = getLauncherWindow();
    const result = await dialog.showOpenDialog(win || undefined, {
      title: configLocale() === 'en' ? 'Choose a skill folder' : '选择技能目录',
      defaultPath: require('node:os').homedir(),
      properties: ['openDirectory'],
    });
    if (result.canceled || !result.filePaths[0]) {
      return null;
    }
    return result.filePaths[0];
  });

  handle('shell:run-import', LAUNCHER_ONLY, async (_event, options = {}) => {
    const kernelStopped = await stopKernelIfRunning();
    const sourceHome = typeof options.sourceHome === 'string' ? options.sourceHome : undefined;
    const extraSkillDirs = Array.isArray(options.extraSkillDirs)
      ? options.extraSkillDirs.filter((row) => typeof row === 'string')
      : [];
    const overwrite = options.overwrite === true;
    const userDataDir = app.getPath('userData');
    const result = await runImport({
      sourceHome,
      extraSkillDirs,
      overwrite,
      userDataDir,
      selectedRels: Array.isArray(options.selectedRels) ? options.selectedRels : [],
      selectedSkillIds: Array.isArray(options.selectedSkillIds) ? options.selectedSkillIds : [],
      selectedPluginNames: Array.isArray(options.selectedPluginNames) ? options.selectedPluginNames : [],
      selectedMcpIds: Array.isArray(options.selectedMcpIds) ? options.selectedMcpIds : [],
      selectedSettingIds: Array.isArray(options.selectedSettingIds) ? options.selectedSettingIds : [],
      selectedPresetIds: Array.isArray(options.selectedPresetIds) ? options.selectedPresetIds : [],
      importAttachments: options.importAttachments === true,
      installPlugin: (spec) => installImportPlugin(spec, { token: loadConfig().githubToken }),
    });
    return {
      ...result,
      kernelStopped,
      hold: probeImportHold({ sourceHome, extraSkillDirs }).hold,
    };
  });

  handle('shell:list-releases', LAUNCHER_ONLY, () => listReleases());

  handle('shell:install-release', LAUNCHER_ONLY, async (event, tag) => {
    try {
      return await installRelease(tag, (payload) => {
        if (!event.sender.isDestroyed()) {
          event.sender.send('shell:update-progress', payload);
        }
      }, { confirmUnverified: confirmUnverifiedInstall });
    } catch (error) {
      return { status: 'error', launched: false, message: error.message || String(error) };
    }
  });

  handle('shell:uninstall-app', LAUNCHER_ONLY, () => launchUninstaller());

  handle('shell:stop-desktop', LAUNCHER_ONLY, async () => {
    const wasRunning = kernelIsRunning(dsh);
    if (typeof stopDesktopCleanup === 'function') {
      stopDesktopCleanup();
    }
    if (harness && typeof harness.stopDesktop === 'function') {
      await harness.stopDesktop();
    } else {
      await stopKernelIfRunning();
    }
    dismissMainWindow();
    return {
      ok: true,
      stopped: wasRunning ? !kernelIsRunning(dsh) : false,
    };
  });

  handle('shell:plugin-forensics', LAUNCHER_ONLY, () => collectForensics());

  handle('shell:disable-plugins', LAUNCHER_ONLY, async (_event, names) => {
    const list = (Array.isArray(names) ? names : [])
      .map((item) => String(item || '').trim())
      .filter(Boolean);
    if (!list.length) {
      return { ok: false, error: 'missing-names' };
    }
    for (const raw of list) {
      if (OFFICIAL_TEMPLATE_BUNDLES.has(raw)) {
        return { ok: false, error: 'official-template', name: raw };
      }
      if (DSH_IM_ALIASES.includes(raw)) {
        return { ok: false, error: 'desktop-builtin', name: raw };
      }
    }
    const config = loadConfig();
    const disabled = [...new Set([...(config.disabledPlugins || []), ...list])];
    applyDisabledBundles(disabled);
    saveConfig({ disabledPlugins: disabled });
    if (!kernelNeedsAlign(dsh)) {
      return { ok: true, harnessRestarted: false, forensics: collectForensics() };
    }
    return enqueueProfileAlign(async () => {
      const align = await alignHarnessAfterProfileChange(HARNESS_DOWN_AFTER_DISABLE);
      return { ok: true, ...align, forensics: collectForensics() };
    });
  });

  handle('shell:disable-plugin', LAUNCHER_ONLY, async (_event, name) => {
    const raw = String(name || '').trim();
    if (!raw) {
      return { ok: false, error: 'missing-name' };
    }
    if (OFFICIAL_TEMPLATE_BUNDLES.has(raw)) {
      return { ok: false, error: 'official-template' };
    }
    if (DSH_IM_ALIASES.includes(raw)) {
      return { ok: false, error: 'desktop-builtin' };
    }
    const config = loadConfig();
    const disabled = [...new Set([...(config.disabledPlugins || []), raw])];
    applyDisabledBundles(disabled);
    saveConfig({ disabledPlugins: disabled });
    if (!kernelNeedsAlign(dsh)) {
      return { ok: true, harnessRestarted: false, forensics: collectForensics() };
    }
    return enqueueProfileAlign(async () => {
      const align = await alignHarnessAfterProfileChange(HARNESS_DOWN_AFTER_DISABLE);
      return { ok: true, ...align, forensics: collectForensics() };
    });
  });

  handle('shell:enable-plugin', LAUNCHER_ONLY, async (_event, name) => {
    const raw = String(name || '').trim();
    if (!raw) {
      return { ok: false, error: 'missing-name' };
    }
    const disabled = (loadConfig().disabledPlugins || []).filter((item) => item !== raw);
    const enabled = setBundleEnabled(raw, true);
    applyDisabledBundles(disabled);
    saveConfig({ disabledPlugins: disabled });
    if (enabled.ok === false) {
      return { ok: false, ...enabled, harnessRestarted: false, forensics: collectForensics() };
    }
    if (!kernelNeedsAlign(dsh)) {
      return { ok: true, ...enabled, harnessRestarted: false, forensics: collectForensics() };
    }
    return enqueueProfileAlign(async () => {
      const align = await alignHarnessAfterProfileChange(HARNESS_DOWN_AFTER_ENABLE);
      return { ok: true, ...enabled, ...align, forensics: collectForensics() };
    });
  });

  handle('shell:remove-plugin', LAUNCHER_ONLY, async (event, name) => {
    const raw = String(name || '').trim();
    if (!raw) {
      return { ok: false, error: 'missing-name' };
    }
    if (isPresetPlugin(raw) || OFFICIAL_TEMPLATE_BUNDLES.has(raw)) {
      return { ok: false, error: 'preset' };
    }
    const kernelStopped = await stopKernelIfRunning();
    const result = await uninstallPlugin(raw, {
      onProgress: (payload) => {
        if (!event.sender.isDestroyed()) {
          event.sender.send('shell:plugin-progress', payload);
        }
      },
    });
    const disabled = (loadConfig().disabledPlugins || []).filter((item) => item !== raw);
    saveConfig({ disabledPlugins: disabled });
    return { ...result, kernelStopped, forensics: collectForensics() };
  });

  handle('shell:start-desktop', LAUNCHER_ONLY, async () => {
    const wasSticky = stickySkipActive(harness);
    if (harness && typeof harness.clearPluginRecovery === 'function') {
      harness.clearPluginRecovery();
    }
    const start = typeof startDesktop === 'function' ? startDesktop : startHarness;
    // Clearing sticky while already ready would otherwise early-return with skip mode still live.
    if (wasSticky) {
      return start({ forceRestart: true });
    }
    return start();
  });

  handle('shell:start-desktop-skipped', LAUNCHER_ONLY, async () => {
    if (harness && typeof harness.writePluginSkip === 'function') {
      harness.writePluginSkip(new Error('launcher-skip-user-plugins'));
    }
    const start = typeof startDesktop === 'function' ? startDesktop : startHarness;
    // Must force restart: plain start() no-ops when already ready / joins an
    // in-flight boot that captured skipUserPlugins=false before this click.
    return start({ forceRestart: true });
  });

  return { pty, preview, stopWorkspaceWatch };
}

module.exports = { registerIpc };
