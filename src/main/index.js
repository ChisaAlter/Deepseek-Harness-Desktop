const { app, dialog, session } = require('electron');
const fs = require('fs');
const { loadConfig, saveConfig, REMOTE_FEATURE_ENABLED, parkRemoteSnapshot, publicConfig, normalizeRendererConfigPatch, normalizeRemotePatch } = require('./config');
const { setDesktopDshHome, desktopDshHomeFromUserData, sanitizePackagedDshHomeEnv } = require('../shared/dsh-home');
const { DshManager, ensureOwnedPort } = require('./dsh');
const { HarnessController } = require('./harness-controller');
const { stripDroppedPlugins, healDanglingBundles, ensureDesktopInstallPlugin, applyDisabledBundles } = require('./plugins');
const { removeDshMarketPreset } = require('./dshmarket-preset');
const { ensureUsagePanelPlugin } = require('./usage-panel-preset');
const { ensureSessionSearchOverlay } = require('./session-search-overlay');
const { ensureDshImPlugin } = require('./dsh-im-desktop');
const { ensureDshbotPlugin, removeDshbotPreset } = require('./dshbot-preset');
const { ensureWorkspace } = require('./workspace-rpc');
const { registerIpc } = require('./ipc');
const { safeStorage } = require('electron');
const { ChisaCodeRemote, resolveDesktopChisaCodeHome } = require('./chisacode-remote');
const { invokeDesktopShell } = require('./remote-shell');
const git = require('./git');
const { listDir } = require('./workspace-fs');
const { buildMenu } = require('./menu');
const { createTray, invokeTrayAction } = require('./tray');
const { checkUpdate, installUpdate, setGithubTokenProvider } = require('./update');
const { probeImportHold, recoverInterruptedImport } = require('./data-import');
const {
  shouldCloseLauncherAfterDesktopStart,
  writeLastDesktopStart,
  recordLastDesktopStart,
  runColdStartGate: runLauncherColdStartGate,
} = require('./launcher-gate');
const {
  startDesktopInstallControl,
  stopDesktopInstallControl,
  desktopInstallReady,
} = require('./desktop-install-control');
const { installPlugin } = require('./marketplace-install');
const { downloadSavePath } = require('./download-path');
const {
  createMainWindow,
  getMainWindow,
  showBoot,
  showHarness,
  onHarnessOriginChange,
  getHarnessOrigin,
  sendToBoot,
  isBootLoaded,
  getHarnessWebContents,
  hideHarnessView,
  showLauncher,
  prepareLauncher,
  getLauncherWindow,
  sendToLauncher,
  closeLauncherWindow,
  showMain,
} = require('./window');
const { watchSystemTheme } = require('./chrome');
const { showClosingOverlay } = require('./closing-overlay');
const { hideOnClose } = require('./close-behavior');
const { qaFlag, qaRemoteMode: readRemoteMode } = require('./qa-gate');
const { devToolsShortcutAllowed, attachDevToolsShortcut } = require('./devtools-shortcut');

/** Packaged-gated QA flag (see qa-gate.js). */
function qaEnv(name) {
  return qaFlag(name, { isPackaged: app.isPackaged });
}

function qaRemoteMode() {
  return readRemoteMode({ isPackaged: app.isPackaged });
}

const dsh = new DshManager();
// Broken-pipe hardening must precede anything that can write to stdio or run
// the in-process ChisaCode daemon (see docs/superpowers/plans/
// 2026-08-28-remote-epipe-hardening.md).
const { installStdioGuard, installUncaughtBrokenPipeGuard } = require('./stdio-guard');
installStdioGuard({ log: (message) => dsh.log(message, 'app') });
installUncaughtBrokenPipeGuard({ log: (message) => dsh.log(message, 'app') });
// Product remote = full ChisaCode daemon + offer v2 (not HTTP RemoteGateway).
const remote = new ChisaCodeRemote({
  getConfig: loadConfig,
  saveConfig,
  // Desktop-facing override is DSHD_CHISACODE_HOME (debug; packaged builds
  // need DSHD_ALLOW_ENV_HOME=1). CHISACODE_HOME itself only ever exists
  // inside the daemon child env bridge.
  getHomeDir: () => resolveDesktopChisaCodeHome({
    defaultDir: require('path').join(app.getPath('userData'), 'chisacode-home'),
    isPackaged: app.isPackaged,
  }),
  safeStorage,
  log: (line) => dsh.log(line, 'app'),
  getHarnessOrigin,
  getSessionCookie: () => dsh.sessionCookie || '',
  git,
  // Kept for any residual shell helpers that still expect a loopback target.
  getTarget: () => {
    if (dsh.state !== 'ready') {
      return null;
    }
    const port = Number(dsh.port);
    return port ? { host: '127.0.0.1', port } : null;
  },
  invokeShell: (name, payload) => invokeDesktopShell({
    name,
    payload,
    git,
    fs: { listDir },
    host: {
      openSettings: (sectionId) => openHarnessSettings(sectionId),
      getConfig: () => publicConfig(loadConfig()),
      saveConfig: (patch) => publicConfig(saveConfig(normalizeRendererConfigPatch(patch || {}))),
    },
  }),
});

onHarnessOriginChange((origin) => {
  if (remote && typeof remote.pushHarnessOrigin === 'function') {
    remote.pushHarnessOrigin(origin);
  }
});

async function probeRemoteSnapshot() {
  if (remote && typeof remote.sync === 'function') {
    await remote.sync();
  }
  const snap = remote && typeof remote.snapshot === 'function'
    ? remote.snapshot()
    : { available: false, enabled: false, listening: false };
  if (!REMOTE_FEATURE_ENABLED) {
    return parkRemoteSnapshot(snap);
  }
  return snap;
}

async function setRemoteFromQa(patch) {
  saveConfig(normalizeRemotePatch(patch || {}));
  if (remote && typeof remote.sync === 'function') {
    return remote.sync();
  }
  return remote && typeof remote.snapshot === 'function' ? remote.snapshot() : null;
}

let quitting = false;
let stoppingForQuit = false;
let desktopResources = null;
let qaQuitIntercepted = false;

async function resolveLaunchTarget() {
  const config = loadConfig();
  const host = config.host || '127.0.0.1';
  const wanted = Number(config.port) || 3080;
  dsh.log(`检测端口 ${host}:${wanted}`);
  const port = await ensureOwnedPort(host, wanted, (line) => dsh.log(line));
  return { port };
}

const mainCloseBound = new WeakSet();
const launcherCloseBound = new WeakSet();

function bindMainClose(win) {
  if (!win || mainCloseBound.has(win)) {
    return win;
  }
  mainCloseBound.add(win);
  win.on('close', (event) => {
    if (quitting) {
      return;
    }
    if (hideOnClose(loadConfig(), quitting)) {
      event.preventDefault();
      win.hide();
      return;
    }
    event.preventDefault();
    quitApp();
  });
  return win;
}

function createMainWindowWithClose() {
  return bindMainClose(createMainWindow());
}

function bindLauncherClose(win) {
  if (!win || launcherCloseBound.has(win)) {
    return win;
  }
  launcherCloseBound.add(win);
  win.on('close', (event) => {
    if (quitting) {
      return;
    }
    if (getMainWindow()) {
      return;
    }
    event.preventDefault();
    quitApp();
  });
  return win;
}

async function openLauncher() {
  const win = await showLauncher();
  bindLauncherClose(win);
  return win;
}

function isDesktopKernelRunning() {
  const state = typeof dsh.state === 'string' ? dsh.state : dsh.snapshot()?.state;
  return state === 'ready' || state === 'starting';
}

function showForeground() {
  const win = getMainWindow();
  if (win && isDesktopKernelRunning()) {
    showMain();
    return;
  }
  void openLauncher();
}

async function startDesktopFromLauncher(options = {}) {
  const recoveryLaunch = options.recoveryLaunch === true || options.skipLaunch === true;
  try {
    if (options.forceRestart) {
      await harness.restart();
    } else {
      await harness.start();
    }
    const stickyAfter = typeof harness.shouldSkipUserPlugins === 'function'
      ? harness.shouldSkipUserPlugins()
      : false;
    writeLastDesktopStart(app.getPath('userData'), { ok: true });
    sendToLauncher('shell:desktop-ready', harness.snapshot());
    if (shouldCloseLauncherAfterDesktopStart({
      desktopReady: true,
      quitAfterStart: loadConfig().quitAfterStart,
      stickySkip: stickyAfter,
      recoveryLaunch,
      lastStartOk: true,
    })) {
      closeLauncherWindow();
    } else if (stickyAfter || recoveryLaunch) {
      sendToLauncher('shell:show-tab', { tab: 'home' });
    }
    return harness.snapshot();
  } catch (error) {
    const message = error && error.message ? error.message : String(error);
    writeLastDesktopStart(app.getPath('userData'), { ok: false, error: message });
    await openLauncher();
    sendToLauncher('shell:show-tab', { tab: 'home' });
    sendToLauncher('shell:desktop-failed', { error: message });
    return { ok: false, error: message };
  }
}

/** Cold-start twin of the ipc.js unverified-install confirmation. */
async function confirmUnverifiedColdStart(info) {
  const result = await dialog.showMessageBox(getLauncherWindow() || undefined, {
    type: 'warning',
    buttons: ['仍要安装', '取消'],
    defaultId: 1,
    cancelId: 1,
    title: '安装包无法校验',
    message: `版本 ${info?.tag || info?.latest || ''} 未提供 SHA512SUMS.txt 校验清单，无法验证安装包完整性。仍要下载并安装吗？`,
    noLink: true,
  });
  return result.response === 0;
}

function runColdStartGate() {
  const userDataDir = app.getPath('userData');
  return runLauncherColdStartGate({
    config: loadConfig(),
    userDataDir,
    isPackaged: app.isPackaged,
    checkUpdate,
    installUpdate: (onProgress) => installUpdate(onProgress, {
      confirmUnverified: confirmUnverifiedColdStart,
    }),
    confirmUpdate: async (check) => {
      const result = await dialog.showMessageBox(getLauncherWindow() || undefined, {
        type: 'question',
        buttons: ['更新', '稍后'],
        defaultId: 0,
        cancelId: 1,
        title: '发现新版本',
        message: `是否更新到 ${check.latest || check.version || ''}？`,
        noLink: true,
      });
      return result.response === 0;
    },
    openLauncher,
    sendToLauncher,
    recoverInterruptedImport: () => recoverInterruptedImport({ userDataDir }),
    probeImportHold,
    startDesktop: () => startDesktopFromLauncher(),
    log: (line, level) => dsh.log(line, level),
  });
}

const harness = new HarnessController({
  dsh,
  remote,
  loadConfig,
  createMainWindow: createMainWindowWithClose,
  getMainWindow,
  showBoot,
  showHarness: (url, extra) => showHarness(url, { cookie: dsh.sessionCookie, ...extra }),
  sendToBoot,
  isBootLoaded,
  getHarnessWebContents,
  resolveLaunchTarget,
  stripDroppedPlugins,
  ensureDesktopInstallPlugin,
  removeDshMarketPreset,
  ensureUsagePanelPlugin,
  ensureSessionSearchOverlay,
  ensureDshImPlugin,
  ensureDshbotPlugin,
  removeDshbotPreset,
  applyDisabledBundles,
  healDanglingBundles,
  saveConfig,
  appVersion: app.getVersion(),
  ensureWorkspace: (url, workspace, fetchImpl, options) => (
    ensureWorkspace(url, workspace, fetchImpl, { cookie: dsh.sessionCookie, ...options })
  ),
});

async function pickWorkspace() {
  const win = getMainWindow();
  const result = await dialog.showOpenDialog(win || undefined, {
    title: '选择工作区',
    defaultPath: loadConfig().workspace,
    properties: ['openDirectory'],
  });
  if (result.canceled || !result.filePaths[0]) {
    return null;
  }
  saveConfig({ workspace: result.filePaths[0] });
  await restartWithCleanup();
  return result.filePaths[0];
}

/** Tear down desktop-bound child processes and views (PTY, BrowserView). */
function cleanupDesktopResources() {
  if (!desktopResources) {
    return;
  }
  try {
    desktopResources.pty.killAll();
  } catch (error) {
    dsh.log(`PTY 清理失败：${error.message}`, 'app');
  }
  void Promise.resolve(desktopResources.preview.closeAll()).catch((error) => {
    dsh.log(`预览清理失败：${error.message}`, 'app');
  });
}

function restartWithCleanup() {
  cleanupDesktopResources();
  // Menu / tray / plugin-align restarts must refresh last-desktop-start too,
  // or a stale { ok:false } keeps holding the next cold start at the launcher
  // even though the desktop already recovered through this path.
  return recordLastDesktopStart(app.getPath('userData'), () => harness.restart());
}

function reloadWithCleanup() {
  cleanupDesktopResources();
  return harness.reload();
}

function quitApp() {
  if (qaEnv('DSH_QA_SHELL') && process.env.DSH_QA_ALLOW_QUIT !== '1') {
    qaQuitIntercepted = true;
    console.log('[DSH_QA_SHELL] quit intercepted');
    return;
  }
  quitting = true;
  app.quit();
}

function ignoreFailure(promise) {
  Promise.resolve(promise).catch((error) => {
    dsh.log(error.message || String(error), 'error');
  });
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  console.error('Deepseek-Harness-Desktop is already running. Quit the installed app before npm start (same appId single-instance lock).');
  app.quit();
} else {
  app.on('second-instance', () => {
    showForeground();
  });

  app.setName('Deepseek-Harness-Desktop');
  app.setAppUserModelId('ai.deepseek.harness.gui');

  // Window-scoped DevTools toggle (Ctrl+Shift+I / Cmd+Alt+I). Never an OS
  // global shortcut: that would hijack the chord in other applications and
  // opened DevTools unconditionally in packaged builds.
  app.on('web-contents-created', (_event, contents) => {
    attachDevToolsShortcut(contents, {
      allowed: () => devToolsShortcutAllowed({
        isPackaged: app.isPackaged,
        openDevTools: loadConfig().openDevTools === true,
      }),
      resolveTarget: () => {
        const win = getMainWindow() || getLauncherWindow();
        return getHarnessWebContents(win) || win?.webContents;
      },
    });
  });

  app.whenReady().then(async () => {
    const homeEnv = sanitizePackagedDshHomeEnv({ isPackaged: app.isPackaged });
    if (homeEnv.dropped) {
      dsh.log(`忽略继承的 DSHD_HOME=${homeEnv.value}（packaged 下需要 DSHD_ALLOW_ENV_HOME=1）`, 'app');
    }
    const desktopHome = setDesktopDshHome(desktopDshHomeFromUserData(app.getPath('userData')));
    fs.mkdirSync(desktopHome, { recursive: true });
    dsh.log(`Harness 家目录 ${desktopHome}`, 'app');
    const config = loadConfig();
    fs.mkdirSync(config.workspace, { recursive: true });
    saveConfig({ workspace: config.workspace });
    app.setLoginItemSettings({ openAtLogin: Boolean(config.openAtLogin) });
    setGithubTokenProvider(() => loadConfig().githubToken);

    startDesktopInstallControl({
      installPlugin: (spec, options) => installPlugin(spec, {
        ...options,
        token: loadConfig().githubToken,
      }),
      startHarness: restartWithCleanup,
    });
    try {
      await desktopInstallReady();
    } catch (error) {
      stopDesktopInstallControl();
      dsh.log(`桌面安装控制通道启动失败：${error.message || String(error)}`, 'error');
    }

    desktopResources = registerIpc({
      dsh,
      harness,
      startHarness: restartWithCleanup,
      startDesktop: startDesktopFromLauncher,
      stopDesktopCleanup: cleanupDesktopResources,
      remote,
      onOpenLauncher: async (options = {}) => {
        await openLauncher();
        // Boot-page bridge: land on the home tab so the Recovery Board is
        // in view (same show-tab path the failed-start flow uses).
        if (options && options.tab) {
          sendToLauncher('shell:show-tab', { tab: options.tab });
        }
      },
    });
    buildMenu({
      onOpenWorkspace: () => ignoreFailure(pickWorkspace()),
      onOpenLauncher: () => ignoreFailure(openLauncher()),
      onRestart: () => ignoreFailure(restartWithCleanup()),
      onReload: () => ignoreFailure(reloadWithCleanup()),
    });
    createTray({
      onShow: showForeground,
      onOpenLauncher: () => ignoreFailure(openLauncher()),
      onRestart: () => ignoreFailure(restartWithCleanup()),
      onQuit: () => quitApp(),
    });

    watchSystemTheme();

    session.defaultSession.on('will-download', (event, item) => {
      const dest = downloadSavePath(app.getPath('downloads'), item.getFilename());
      item.setSavePath(dest);
    });

    const launcherWin = await prepareLauncher();
    bindLauncherClose(launcherWin);
    await runColdStartGate();
    if (qaEnv('DSH_SMOKE')) {
      // QA / smoke orchestration lives in ./smoke and is only required inside
      // this gate: a production start never loads the QA drivers.
      const { createSmokeRunner } = require('./smoke');
      const smoke = createSmokeRunner({
        qaEnv,
        qaRemoteMode,
        dsh,
        harness,
        loadConfig,
        saveConfig,
        getHarnessWebContents,
        showMain,
        invokeTrayAction,
        probeRemoteSnapshot,
        setRemoteFromQa,
        getDesktopResources: () => desktopResources,
        getQuitIntercepted: () => qaQuitIntercepted,
        resetQuitIntercepted: () => { qaQuitIntercepted = false; },
      });
      if (!getMainWindow()) {
        await startDesktopFromLauncher();
      }
      if (qaEnv('DSH_REMOTE_PHONE_HOST')) {
        void smoke.keepRemotePhoneHost();
      } else {
        void smoke.runSmoke(getMainWindow());
      }
    }
  });

  app.on('activate', () => {
    showForeground();
  });

  app.on('before-quit', (event) => {
    quitting = true;
    if (stoppingForQuit) {
      return;
    }
    event.preventDefault();
    stoppingForQuit = true;
    stopDesktopInstallControl();
    cleanupDesktopResources();
    hideHarnessView(getMainWindow());
    showClosingOverlay(getMainWindow(), loadConfig().locale)
      .catch(() => {})
      .then(() => harness.shutdown())
      .finally(() => app.quit());
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin' && !hideOnClose(loadConfig())) {
      quitApp();
    }
  });
}
