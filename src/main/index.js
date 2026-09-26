const { app, dialog, ipcMain, session } = require('electron');
const { PRODUCT_NAME, LEGACY_DESKTOP_USER_DATA, preserveUserDataPath } = require('../shared/product-identity');
preserveUserDataPath(app, LEGACY_DESKTOP_USER_DATA);
const fs = require('fs');
const { loadConfig, saveConfig, REMOTE_FEATURE_ENABLED, parkRemoteSnapshot, publicConfig, normalizeRendererConfigPatch, normalizeRemotePatch, readConfigSnapshot, configRevision } = require('./config');
const { setDesktopDshHome, desktopDshHomeFromUserData, sanitizePackagedDshHomeEnv } = require('../shared/dsh-home');
const { DshManager, ensureOwnedPort } = require('./dsh');
const { HarnessController } = require('./harness-controller');
const { stripDroppedPlugins, healDanglingBundles, ensureDesktopInstallPlugin, applyDisabledBundles, listInstalledPlugins } = require('./plugins');
const { removeDshMarketPreset } = require('./dshmarket-preset');
const { ensureUsagePanelPlugin } = require('./usage-panel-preset');
const { ensureSessionSearchOverlay } = require('./session-search-overlay');
const { ensureDshImPlugin } = require('./dsh-im-desktop');
const { ensureDshbotPlugin } = require('./dshbot-desktop');
const { ensureDesktopTaskControl } = require('./task-control-overlay');
const { createTaskProtection, installTaskProtection, getTaskProtection } = require('./task-protection');
const { createTaskControlPeer } = require('./task-control-peer');
const { ensureDesktopDshWhale } = require('./dsh-whale-desktop');
const { ensureDesktopDshRemote } = require('./dsh-remote-desktop');
const { ensureDesktopMarket } = require('./dsh-market-desktop');
const { ensureDesktopOfficeRuntime } = require('./office-runtime');
const { removeLegacyDshbotPreset } = require('./legacy-dshbot-preset');
const { ensureWorkspace } = require('./workspace-rpc');
const { registerIpc } = require('./ipc');
const { safeStorage } = require('electron');
const { DshdRemote, resolveDesktopChisaCodeHome } = require('./dshd-remote');
const { invokeDesktopShell } = require('./remote-shell');
const git = require('./git');
const { listDir } = require('./workspace-fs');
const { buildMenu } = require('./menu');
const { createTray, invokeTrayAction, refreshTrayMenu } = require('./tray');
const { DESKTOP_PET_FEATURE, configureDesktopPet, getDesktopPet } = require('./desktop-pet');
const { LIVE2D_PET_FEATURE, configureLive2dPet, getLive2dPet } = require('./desktop-live2d');
const { checkUpdate, installUpdate, setGithubTokenProvider, currentVersion } = require('./update');
const { probeImportHold, recoverInterruptedImport } = require('./data-import');
const { isLauncherPackage } = require('../launcher/product');
const runtimeInstall = require('../launcher/runtime-install');
const installDetect = require('../launcher/install-detect');
const {
  shouldCloseLauncherAfterDesktopStart,
  writeLastDesktopStart,
  recordLastDesktopStart,
  kernelLogTail,
  runColdStartGate: runLauncherColdStartGate,
  createParkedUpdateDrainer,
  presentUpdateAsk,
} = require('./launcher-gate');
const {
  startDesktopInstallControl,
  stopDesktopInstallControl,
  desktopInstallReady,
} = require('./desktop-install-control');
const { installPlugin, installMarketplacePlugin, uninstallPlugin } = require('./marketplace-install');
const { listMarketplace } = require('./marketplace-catalog');
const { recordMarketplaceOperation } = require('./marketplace-state');
const {
  applyRendererConfigPatch,
  disablePlugins,
  dshKernelState,
  enablePlugin,
  pluginRemoveGuardError,
} = require('./profile-ops');
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
  getHarnessView,
  isHarnessLoaded,
  hideHarnessView,
  dismissMainWindow,
  showLauncher,
  prepareLauncher,
  getLauncherWindow,
  sendToLauncher,
  closeLauncherWindow,
  showMain,
  openHarnessSettings,
} = require('./window');
const { watchSystemTheme, currentTheme, applyAppTheme } = require('./chrome');
const { showClosingOverlay } = require('./closing-overlay');
const { installShortcutService, getShortcutService } = require('./shortcuts');
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
const remote = new DshdRemote({
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
// Shell-owned input block for the shortcut bridge: while the closing overlay
// owns the window, bound chords and menu dispatch must not run commands.
let closingOverlayActive = false;
let desktopResources = null;
let qaQuitIntercepted = false;
/**
 * The launcher window a parked update ask belongs to. A stale ask (window
 * closed/recreated, app quitting, install already started) must never keep
 * going on a window the user can no longer see.
 */
let launcherWindowToken = null;

/**
 * Resolve the port from the start's config snapshot. The revision is handed
 * back so `performStartOnce` can prove the port still belongs to the config
 * the rest of the start read.
 */
async function resolveLaunchTarget(snapshot) {
  const config = snapshot ? snapshot.config : loadConfig();
  const host = config.host || '127.0.0.1';
  const wanted = Number(config.port) || 3080;
  dsh.log(`检测端口 ${host}:${wanted}`);
  const port = await ensureOwnedPort(host, wanted, (line) => dsh.log(line));
  return { port, configRevision: snapshot ? snapshot.revision : undefined };
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
      // A protection prompt may be in flight — swallow the close instead of
      // destroying a window the user just cancelled quitting over.
      if (!stoppingForQuit) event.preventDefault();
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
  // A late check can also settle while the launcher is already on screen.
  win.on('show', () => {
    launcherWindowToken = win;
    void drainParkedUpdateCheck.drain({ generation: win });
  });
  win.on('closed', () => {
    if (launcherWindowToken === win) launcherWindowToken = null;
  });
  win.on('close', (event) => {
    if (quitting) {
      if (!stoppingForQuit) event.preventDefault();
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
  launcherWindowToken = win;
  // Visible launcher: this is the moment a parked late update check may be
  // presented, pinned to the window the user is actually looking at.
  void drainParkedUpdateCheck.drain({ generation: win });
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
      // forceRestart replaces a running desktop: ride the same protected
      // commit as menu/tray restarts so active work prompts first.
      const guarded = await restartWithCleanup();
      if (guarded && guarded.proceeded === false) {
        return { ok: false, cancelled: guarded.code === 'cancelled', code: guarded.code || 'blocked' };
      }
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
    writeLastDesktopStart(app.getPath('userData'), { ok: false, error: message, logTail: kernelLogTail(dsh) });
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

// Release notes travel on the check payload (`notes`); the update ask used to
// drop them, so the user confirmed blind. Surface a bounded excerpt as detail.
function updateAskDetail(check) {
  const notes = typeof check?.notes === 'string' ? check.notes.trim() : '';
  if (!notes) {
    return undefined;
  }
  return notes.length > 600 ? `${notes.slice(0, 600)}…` : notes;
}

// Slim-package cold start talks to the managed runtime: route-aware checks,
// installs that keep the launcher alive, and external process start.
function gateInstallUpdate(onProgress, check) {
  if (isLauncherPackage()) {
    return runtimeInstall.installRuntime(
      check && check.tag ? { tag: check.tag } : {},
      onProgress,
      { confirmUnverified: confirmUnverifiedColdStart },
    );
  }
  return installUpdate(onProgress, {
    confirmUnverified: confirmUnverifiedColdStart,
    expectedCheck: check,
    taskProtection: getTaskProtection(),
  });
}

function runColdStartGate() {
  const userDataDir = app.getPath('userData');
  const launcherPackage = isLauncherPackage();
  return runLauncherColdStartGate({
    config: loadConfig(),
    userDataDir,
    isPackaged: app.isPackaged,
    checkUpdate: launcherPackage
      ? () => runtimeInstall.checkDesktopUpdate()
      : checkUpdate,
    installUpdate: gateInstallUpdate,
    confirmUpdate: async (check) => {
      const result = await dialog.showMessageBox(getLauncherWindow() || undefined, {
        type: 'question',
        buttons: ['更新', '稍后'],
        defaultId: 0,
        cancelId: 1,
        title: '发现新版本',
        message: `是否更新到 ${check.latest || check.version || ''}？`,
        detail: updateAskDetail(check),
        noLink: true,
      });
      return result.response === 0;
    },
    openLauncher,
    sendToLauncher,
    recoverInterruptedImport: () => recoverInterruptedImport({ userDataDir }),
    probeImportHold,
    startDesktop: launcherPackage
      ? () => runtimeInstall.startExternalDesktop()
      : () => startDesktopFromLauncher(),
    drainParkedUpdateCheck: () => drainParkedUpdateCheck.drain({ generation: getLauncherWindow() }),
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
  readConfigSnapshot,
  currentConfigRevision: configRevision,
  stripDroppedPlugins,
  ensureDesktopInstallPlugin,
  removeDshMarketPreset,
  ensureUsagePanelPlugin,
  ensureSessionSearchOverlay,
  ensureDshImPlugin,
  ensureDshbotPlugin,
  ensureTaskControlPlugin: ensureDesktopTaskControl,
  ensureDshWhalePlugin: ensureDesktopDshWhale,
  ensureDshRemotePlugin: ensureDesktopDshRemote,
  ensureDesktopMarket,
  ensureDesktopOfficeRuntime: async () => ensureDesktopOfficeRuntime(),
  removeLegacyDshbotPreset,
  applyDisabledBundles,
  healDanglingBundles,
  saveConfig,
  appVersion: app.getVersion(),
  ensureWorkspace: (url, workspace, fetchImpl, options) => (
    ensureWorkspace(url, workspace, fetchImpl, { cookie: dsh.sessionCookie, ...options })
  ),
});

// --- Task protection (quit/stop/restart/update) -----------------------------
// The coordinator inspects Host-side work through the dsh-task-control
// plugin's loopback route and prompts before any destructive side effect.
// See docs/features/task-protection.md.

const TASK_VERBS = {
  quit: '退出',
  restart: '重启',
  reload: '重新加载',
  stop: '停止桌面端',
  update: '安装更新',
  install: '安装运行时',
  delta: '增量更新',
};

function describeWorkItem(item) {
  switch (item && item.kind) {
    case 'agent':
      return `代理会话运行中（${item.id}）`;
    case 'job':
      return `后台任务运行中（${item.id}）`;
    case 'request':
      return `${item.count || 1} 个在途请求`;
    case 'socket':
      return `${item.count || 1} 条已建立的远程连接`;
    case 'schedule-task':
      return `定时提醒${item.due ? '已到期' : '待触发'}：${item.title || item.id}`;
    case 'bot-routine':
      return `机器人例程${item.detail === 'running' ? '运行中' : '待执行'}（${item.id}）`;
    case 'bot-inbox':
      return `机器人收件箱有 ${item.count || ''} 条待处理消息`;
    case 'pty':
      return `${item.count || 1} 个打开的终端会话`;
    default:
      return item && item.detail ? String(item.detail) : '有后台工作项';
  }
}

async function confirmTaskStop(operation, inspection) {
  const verb = TASK_VERBS[operation] || '继续';
  const parts = [];
  for (const item of inspection.activeWork || []) {
    parts.push(describeWorkItem(item));
  }
  for (const item of inspection.scheduledWork || []) {
    parts.push(describeWorkItem(item));
  }
  const unknownCoverage = Object.values(inspection.coverage || {})
    .some((value) => value !== 'ok' && value !== 'intentional-disabled');
  const detail = [
    parts.length > 0 ? `仍在运行：${[...new Set(parts)].join('；')}` : '后台任务状态无法完全确认',
    unknownCoverage ? '注意：部分后台服务状态未知' : '',
  ].filter(Boolean).join('\n');
  const win = getMainWindow() || getLauncherWindow();
  const anchor = win && win.isVisible() ? win : null;
  const options = {
    type: 'warning',
    buttons: ['取消', `仍然${verb}`],
    defaultId: 0,
    cancelId: 0,
    title: `${verb}前确认`,
    message: `${verb}将中断仍在运行的工作`,
    detail,
    noLink: true,
  };
  const result = anchor
    ? await dialog.showMessageBox(anchor, options)
    : await dialog.showMessageBox(options);
  return result.response === 1;
}

const taskProtection = createTaskProtection({
  getBaseUrl: () => (typeof dsh.baseUrl === 'string' ? dsh.baseUrl : ''),
  hostRunning: () => isDesktopKernelRunning() && dsh.webReady === true && Boolean(dsh.baseUrl),
  confirm: confirmTaskStop,
  shellWork: () => {
    const count = Number(desktopResources && desktopResources.pty && typeof desktopResources.pty.count === 'function'
      ? desktopResources.pty.count() : 0);
    return count > 0 ? [{ kind: 'pty', id: 'desktop-pty', count }] : [];
  },
  log: (message) => dsh.log(message, 'app'),
});
installTaskProtection(taskProtection);

// Slim-launcher handshake: the peer endpoint lets a separate launcher process
// ask this desktop to stop (task-protected) or to prepare for an install.
const taskControlPeer = createTaskControlPeer({
  stateDir: () => app.getPath('userData'),
  status: () => ({ kernel: typeof dsh.state === 'string' ? dsh.state : 'unknown', webReady: dsh.webReady === true }),
  onPeerStop: async () => {
    // "Stop the desktop" for an external launcher means this process exits —
    // the legacy path was taskkill, so the protected equivalent is a
    // terminal coordinate followed by the normal quit funnel.
    const result = await taskProtection.coordinate('stop', { terminal: true });
    if (!result.proceeded) {
      return { ok: false, code: result.code || 'cancelled' };
    }
    setTimeout(() => quitApp(), 250);
    return { ok: true, quit: true };
  },
  onPeerInstall: async () => {
    const result = await taskProtection.coordinate('install', { terminal: true });
    if (!result.proceeded) {
      return { ok: false, code: result.code || 'cancelled' };
    }
    // Flush the response before the process starts its protected quit.
    setTimeout(() => quitApp(), 250);
    return { ok: true, quit: true };
  },
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

/**
 * Restart goes through the task-protection funnel: active Host work prompts
 * before PTY/preview teardown. `recordLastDesktopStart` keeps running inside
 * the commit so a cancelled prompt does not leave a stale failure marker.
 */
function restartWithCleanup() {
  return taskProtection.coordinate('restart', {
    commit: async () => {
      cleanupDesktopResources();
      return recordLastDesktopStart(app.getPath('userData'), () => harness.restart(), () => kernelLogTail(dsh));
    },
  }).then((result) => (result.proceeded ? undefined : result));
}

function reloadWithCleanup() {
  // Reload keeps the Host alive: no admission lock, only the prompt and the
  // shell-side teardown (PTY/preview) inside commit.
  return taskProtection.coordinate('reload', {
    hostLock: false,
    commit: async () => {
      cleanupDesktopResources();
      return harness.reload();
    },
  }).then((result) => (result.proceeded ? undefined : result));
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

/**
 * Turn a parked late update check into an ask, but only while the launcher is
 * genuinely on screen. `shell:launcher-status` runs from a pre-created hidden
 * window, so consuming the parked check there lost it before the user ever saw
 * it. The window-identity guard abandons an in-flight ask if that window goes
 * away (or the app is quitting / already installing).
 */
const drainParkedUpdateCheck = createParkedUpdateDrainer({
  readConfig: () => loadConfig(),
  isVisible: () => {
    const win = getLauncherWindow();
    return Boolean(win && !win.isDestroyed() && win.isVisible());
  },
  isQuitting: () => quitting || stoppingForQuit,
  isCurrentGeneration: (generation) => {
    if (generation === undefined) return true;
    const win = getLauncherWindow();
    return Boolean(win && win === generation && win.isVisible());
  },
  log: (message) => dsh.log(message, 'error'),
  present: (check, { generation }) => presentUpdateAsk({
    config: loadConfig(),
    isPackaged: app.isPackaged,
    check,
    confirmUpdate: async (pending) => {
      const result = await dialog.showMessageBox(getLauncherWindow() || undefined, {
        type: 'question',
        buttons: ['更新', '稍后'],
        defaultId: 0,
        cancelId: 1,
        title: '发现新版本',
        message: `是否更新到 ${pending.latest || pending.version || ''}？`,
        detail: updateAskDetail(pending),
        noLink: true,
      });
      return result.response === 0;
    },
    installUpdate: gateInstallUpdate,
    openLauncher,
    sendToLauncher,
    alreadyVisible: true,
    // `presentUpdateAsk` re-checks this after its awaits.
    shouldContinue: () => {
      if (quitting || stoppingForQuit) return false;
      const win = getLauncherWindow();
      return Boolean(win && win.isVisible() && (generation === undefined || generation === win));
    },
  }),
});

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  console.error(`${PRODUCT_NAME} is already running. Quit the installed app before npm start (same appId single-instance lock).`);
  app.quit();
} else {
  app.on('second-instance', () => {
    showForeground();
  });

  app.setName(PRODUCT_NAME);
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
    configureDesktopPet({ loadConfig, saveConfig, currentTheme });
    if (LIVE2D_PET_FEATURE) {
      configureLive2dPet({
        loadConfig,
        saveConfig,
        sessionsDir: require('path').join(desktopHome, 'sessions'),
        getMainWindow,
        getHarnessOrigin,
        getSessionCookie: () => dsh.sessionCookie || '',
        // The pet card's jump button: raise the main window and open her
        // persistent conversation through the client-side hook.
        openWhaleAssistant: async () => {
          const win = showMain();
          const wc = getHarnessWebContents(win);
          if (!wc || !isHarnessLoaded(win)) {
            return { ok: false, reason: 'harness-not-ready' };
          }
          // null = hook absent (plugin not mounted/not ready); false = hook
          // ran but failed; true = session opened.
          const opened = await wc.executeJavaScript(
            'typeof window.__dshWhaleOpen === "function"'
              + ' ? window.__dshWhaleOpen().then(() => true, () => false)'
              + ' : Promise.resolve(null)',
          ).catch(() => null);
          if (opened === null) {
            return { ok: false, reason: 'hook-missing' };
          }
          if (opened !== true) {
            return { ok: false, reason: 'open-failed' };
          }
          win.focus();
          return { ok: true };
        },
        // The pet panel's ⚙ 设置 cell opens her section inside the main
        // window's Settings shell (section `pet`) — the pet overlay itself
        // carries no settings UI. openHarnessSettings resolves false when
        // the harness page is not up.
        openPetSettings: async () => ({ ok: (await openHarnessSettings('pet')) === true }),
        // Hide paths that bypass the tray (pet panel 隐藏, settings page)
        // still funnel through setEnabled — refresh rebuilds the checkbox
        // snapshot so the tray never shows a stale check.
        onEnabledChange: () => refreshTrayMenu(),
      });
      getLive2dPet()?.show();
    }
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
      // The /desktop/* half of the control channel: dsh-whale's management
      // tools reach the same profile-ops implementation as the IPC surface,
      // so config writes and plugin toggles share one serialized align
      // chain no matter which surface asked.
      desktop: {
        state: () => {
          const configNow = loadConfig();
          const listed = listInstalledPlugins();
          return {
            ok: true,
            version: currentVersion(),
            kernel: dshKernelState(dsh),
            plugins: (listed.plugins || []).map((row) => row.name),
            disabledPlugins: Array.isArray(configNow.disabledPlugins) ? configNow.disabledPlugins : [],
            config: publicConfig(configNow),
          };
        },
        listMarketplace: async (options = {}) => {
          const payload = await listMarketplace({
            refresh: options.refresh === true,
            locale: loadConfig().locale === 'en' ? 'en' : 'zh',
          });
          const q = String(options.q ?? '').trim().toLowerCase();
          if (!q || !Array.isArray(payload?.items)) return payload;
          return {
            ...payload,
            items: payload.items.filter((item) =>
              `${item.id} ${item.description} ${item.packageName} ${item.category}`
                .toLowerCase()
                .includes(q)),
          };
        },
        applyConfig: (patch) => {
          try {
            const next = applyRendererConfigPatch(patch, {
              app,
              applyAppTheme,
              harness,
              startHarness: restartWithCleanup,
              log: (line) => dsh.log(line, 'app'),
            });
            return { ok: true, config: publicConfig(next) };
          } catch (error) {
            return { ok: false, error: String(error?.message ?? error) };
          }
        },
        petSettings: () => {
          const pet = getLive2dPet();
          if (!pet) return { ok: false, error: 'whale settings are unavailable' };
          return { ok: true, settings: pet.getSettings(), enabled: Boolean(loadConfig().live2dPet?.enabled) };
        },
        applyPetSettings: (patch) => {
          const pet = getLive2dPet();
          if (!pet) return { ok: false, error: 'whale settings are unavailable' };
          const allowed = new Set([
            'scale', 'opacity', 'personality', 'activity', 'selfTalk', 'wander',
            'lockPosition', 'shiftToDrag', 'powerSave', 'clickSound', 'chatEnabled',
            'lookProvider', 'lookModel',
          ]);
          if (!patch || typeof patch !== 'object' || Array.isArray(patch)
            || Object.keys(patch).some((key) => !allowed.has(key))) {
            return { ok: false, error: 'unknown or invalid whale setting' };
          }
          return { ok: true, settings: pet.applySettings({ patch }) };
        },
        installCatalog: (id, options = {}) => recordMarketplaceOperation('install', id, (record) => (
          installMarketplacePlugin(id, {
            allowBuilds: Array.isArray(options.allowBuilds) ? options.allowBuilds : [],
            token: loadConfig().githubToken,
            onProgress: record,
          })
        )),
        removePlugin: async (name) => {
          const guardError = pluginRemoveGuardError(name);
          if (guardError) {
            return { ok: false, error: guardError };
          }
          return recordMarketplaceOperation('uninstall', name, (record) => (
            uninstallPlugin(name, { onProgress: record })
          ));
        },
        disablePlugins: (names) => disablePlugins(names, { dsh, startHarness: restartWithCleanup }),
        enablePlugin: (name) => enablePlugin(name, { dsh, startHarness: restartWithCleanup }),
      },
    });
    try {
      await desktopInstallReady();
    } catch (error) {
      stopDesktopInstallControl();
      dsh.log(`桌面安装控制通道启动失败：${error.message || String(error)}`, 'error');
    }
    // Slim-launcher handshake endpoint: publishing the peer file lets a
    // launcher-driven install/stop run through task protection instead of
    // touching the process directly.
    taskControlPeer.start()
      .then((result) => {
        if (result.ok === false) {
          dsh.log(`任务保护握手端点启动失败：${result.error || 'unknown'}`, 'error');
        }
      })
      .catch((error) => {
        dsh.log(`任务保护握手端点启动失败：${error.message || String(error)}`, 'error');
      });

    desktopResources = registerIpc({
      dsh,
      harness,
      startHarness: restartWithCleanup,
      startDesktop: startDesktopFromLauncher,
      stopDesktopCleanup: cleanupDesktopResources,
      remote,
      getLive2dPet,
      onOpenLauncher: async (options = {}) => {
        await openLauncher();
        // Boot-page bridge: land on the home tab so the Recovery Board is
        // in view (same show-tab path the failed-start flow uses).
        if (options && options.tab) {
          sendToLauncher('shell:show-tab', { tab: options.tab });
        }
      },
    });
    installShortcutService({
      ipcMain,
      userData: app.getPath('userData'),
      platform: process.platform === 'darwin' ? 'macos' : process.platform === 'win32' ? 'windows' : 'linux',
      getView: () => getHarnessView() ?? undefined,
      getWindow: () => getMainWindow(),
      getOrigin: () => getHarnessOrigin(),
      overlayInput: (win) => ({ revision: 0, blocked: Boolean(win) && closingOverlayActive }),
      onMenuChanged: () => rebuildMenu(),
    });
    const existingView = getHarnessView();
    if (existingView) getShortcutService().attach(existingView);
    const rebuildMenu = () => buildMenu({
      onOpenWorkspace: () => ignoreFailure(pickWorkspace()),
      onOpenLauncher: () => ignoreFailure(openLauncher()),
      onRestart: () => ignoreFailure(restartWithCleanup()),
      onReload: () => ignoreFailure(reloadWithCleanup()),
      shortcuts: getShortcutService(),
    });
    rebuildMenu();
    createTray({
      onShow: showForeground,
      onOpenLauncher: () => ignoreFailure(openLauncher()),
      onRestart: () => ignoreFailure(restartWithCleanup()),
      onQuit: () => quitApp(),
      ...(DESKTOP_PET_FEATURE ? {
        petEnabled: () => getDesktopPet()?.isEnabled() === true,
        onPetToggle: (enabled) => {
          const pet = getDesktopPet();
          const win = getMainWindow();
          pet?.setEnabled(enabled, isHarnessLoaded(win) ? win : null);
        },
      } : LIVE2D_PET_FEATURE ? {
        petEnabled: () => getLive2dPet()?.isEnabled() === true,
        onPetToggle: (enabled) => {
          getLive2dPet()?.setEnabled(enabled);
        },
      } : {}),
    });

    watchSystemTheme();

    session.defaultSession.on('will-download', (event, item) => {
      const dest = downloadSavePath(app.getPath('downloads'), item.getFilename());
      item.setSavePath(dest);
    });

    const launcherWin = await prepareLauncher();
    bindLauncherClose(launcherWin);
    if (process.argv.includes('--dshd-from-launcher')) {
      // Spawned by the slim launcher package: its gate already decided — go
      // straight to the desktop start instead of opening a second gate.
      if (process.argv.includes('--skip-user-plugins')
        && harness && typeof harness.writePluginSkip === 'function') {
        harness.writePluginSkip(new Error('launcher-skip-user-plugins'));
      }
      await startDesktopFromLauncher();
    } else {
      await runColdStartGate();
    }
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
    void finalizeQuit();
  });

  // All quit paths funnel here: the protection decision (inspect → acquire →
  // drain → inspect → confirm) completes before the first shutdown side
  // effect runs. A cancelled prompt restores the pre-quit flags.
  async function finalizeQuit() {
    const result = await taskProtection.coordinate('quit', {
      terminal: true,
      commit: async () => {
        stoppingForQuit = true;
        stopDesktopInstallControl();
        void taskControlPeer.stop();
        cleanupDesktopResources();
        hideHarnessView(getMainWindow());
        closingOverlayActive = true;
        await showClosingOverlay(getMainWindow(), loadConfig().locale).catch(() => {});
        await harness.shutdown();
      },
    });
    if (result.proceeded) {
      app.quit();
      return;
    }
    quitting = false;
    stoppingForQuit = false;
    closingOverlayActive = false;
    // The user already accepted the risk prompt; a failed drain or an
    // unreachable runtime must not silently cancel the quit — offer a
    // last-resort force exit so the app can always be closed.
    if (result.code && result.code !== 'cancelled' && result.code !== 'busy') {
      const choice = await dialog.showMessageBox({
        type: 'warning',
        title: '退出未完成',
        message: '桌面运行时未响应退出请求',
        detail: '后台任务状态无法完全确认。可重试退出，或强制退出（运行中的工作将直接中断）。',
        buttons: ['重试', '强制退出'],
        defaultId: 0,
        cancelId: 0,
        noLink: true,
      }).catch(() => ({ response: 0 }));
      if (choice.response === 1) {
        quitting = true;
        stoppingForQuit = true;
        try {
          stopDesktopInstallControl();
          void taskControlPeer.stop();
          cleanupDesktopResources();
          hideHarnessView(getMainWindow());
          await harness.shutdown();
        } catch {
          // A wedged runtime must not stall the force exit.
        }
        app.exit(0);
      }
    }
  }

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin' && !hideOnClose(loadConfig())) {
      quitApp();
    }
  });
}
