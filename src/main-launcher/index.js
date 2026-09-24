'use strict';

// Slim launcher package entry. This process never loads the harness/vendor
// runtime: the desktop app is a separately installed product this launcher
// downloads, installs, updates, starts, and probes. Only the launcher window
// and the launcher IPC surface exist here.

const { app, dialog } = require('electron');

const fs = require('fs');
const path = require('path');

// Packaged GUI processes have no console: fatal failures must leave a trace.
let trace = () => {};
try {
  const logDir = path.join(app.getPath('userData'), 'logs');
  fs.mkdirSync(logDir, { recursive: true });
  const logFile = path.join(logDir, 'main.log');
  const write = (line) => {
    try { fs.appendFileSync(logFile, `${new Date().toISOString()} ${line}\n`); } catch {}
  };
  trace = write;
  process.on('uncaughtException', (error) => {
    write(`uncaughtException: ${error && error.stack ? error.stack : error}`);
  });
  process.on('unhandledRejection', (reason) => {
    write(`unhandledRejection: ${reason && reason.stack ? reason.stack : reason}`);
  });
} catch {}
const { getLauncherWindow, prepareLauncher, showLauncher, sendToLauncher } = require('../main/window');
const { watchSystemTheme } = require('../main/chrome');
const { loadConfig } = require('../main/config');
const { desktopStateDir } = require('../launcher/product');
const {
  setDesktopDshHome,
  sanitizePackagedDshHomeEnv,
} = require('../shared/dsh-home');
const { probeImportHold, recoverInterruptedImport } = require('../main/data-import');
const runtimeInstall = require('../launcher/runtime-install');
const {
  runColdStartGate,
  createParkedUpdateDrainer,
  presentUpdateAsk,
} = require('../main/launcher-gate');
const { registerSlimIpc } = require('./ipc');

let quitting = false;

async function confirmUnverified(info) {
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

async function confirmUpdateAsk(check) {
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
}

// The cold-start install path is the runtime install lane: the launcher
// stays alive, the installer runs elevated, and the registration settles by
// polling rather than by this process quitting.
function gateInstallUpdate(onProgress, check) {
  return runtimeInstall.installRuntime(
    check && check.tag ? { tag: check.tag } : {},
    onProgress,
    { confirmUnverified },
  );
}

function launcherVisible() {
  const win = getLauncherWindow();
  return Boolean(win && !win.isDestroyed() && win.isVisible());
}

async function openLauncher() {
  const win = await showLauncher();
  void drainParkedUpdateCheck.drain({ generation: win });
  return win;
}

const drainParkedUpdateCheck = createParkedUpdateDrainer({
  readConfig: () => loadConfig(),
  isVisible: launcherVisible,
  isQuitting: () => quitting,
  isCurrentGeneration: (generation) => (
    generation === undefined || (getLauncherWindow() === generation && launcherVisible())
  ),
  log: (message) => console.error(`[launcher] ${message}`),
  present: (check, { generation }) => presentUpdateAsk({
    config: loadConfig(),
    isPackaged: app.isPackaged,
    check,
    confirmUpdate: confirmUpdateAsk,
    installUpdate: gateInstallUpdate,
    openLauncher,
    sendToLauncher,
    alreadyVisible: true,
    shouldContinue: () => {
      if (quitting) return false;
      const win = getLauncherWindow();
      return Boolean(win && win.isVisible() && (generation === undefined || generation === win));
    },
  }),
});

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    void openLauncher();
  });

  app.on('before-quit', () => {
    quitting = true;
  });

  app.whenReady().then(async () => {
    trace('whenReady');
    const homeEnv = sanitizePackagedDshHomeEnv({ isPackaged: app.isPackaged });
    if (homeEnv.dropped) {
      console.error(`[launcher] 忽略继承的 DSHD_HOME=${homeEnv.value}（packaged 下需要 DSHD_ALLOW_ENV_HOME=1）`);
    }
    // The launcher keeps its own userData (own config + own single-instance
    // lock); dsh-home, the plugin profiles and the import/last-start journal
    // are the runtime's state, so they point at the desktop home explicitly.
    const desktopDir = desktopStateDir(app);
    fs.mkdirSync(setDesktopDshHome(path.join(desktopDir, 'dsh-home')), { recursive: true });
    trace(`dsh-home=${path.join(desktopDir, 'dsh-home')}`);

    // Window chrome IPC binds inside attachIntegratedChrome on window create.
    watchSystemTheme({});
    registerSlimIpc();
    trace('ipc-registered');

    const win = await prepareLauncher();
    trace('launcher-prepared');
    // A visible launcher is the only surface allowed to consume a parked
    // late update check.
    win.on('show', () => {
      void drainParkedUpdateCheck.drain({ generation: win });
    });

    await runColdStartGate({
      config: loadConfig(),
      userDataDir: desktopDir,
      isPackaged: app.isPackaged,
      checkUpdate: () => runtimeInstall.checkDesktopUpdate(),
      confirmUpdate: confirmUpdateAsk,
      installUpdate: gateInstallUpdate,
      openLauncher,
      sendToLauncher,
      recoverInterruptedImport: () => recoverInterruptedImport({ userDataDir: desktopDir }),
      probeImportHold,
      startDesktop: () => runtimeInstall.startExternalDesktop(),
      drainParkedUpdateCheck: () => drainParkedUpdateCheck.drain({ generation: getLauncherWindow() }),
      log: (line, level) => {
        trace(`gate:${line}`);
        (level === 'error' ? console.error : console.log)(`[launcher] ${line}`);
      },
    });
    trace('gate-done');
  }).catch((error) => {
    trace(`whenReady chain failed: ${error && error.stack ? error.stack : error}`);
  });
}
