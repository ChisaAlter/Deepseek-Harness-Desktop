'use strict';

const fs = require('fs');
const path = require('path');

function lastDesktopStartPath(userDataDir) {
  return path.join(userDataDir, 'last-desktop-start.json');
}

function readLastDesktopStart(userDataDir) {
  try {
    const raw = JSON.parse(fs.readFileSync(lastDesktopStartPath(userDataDir), 'utf8'));
    return {
      ok: raw.ok === true ? true : raw.ok === false ? false : null,
      at: typeof raw.at === 'string' ? raw.at : '',
      error: typeof raw.error === 'string' ? raw.error : '',
    };
  } catch {
    return { ok: null, at: '', error: '' };
  }
}

function writeLastDesktopStart(userDataDir, payload) {
  fs.mkdirSync(userDataDir, { recursive: true });
  const file = lastDesktopStartPath(userDataDir);
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify({
    ok: payload.ok === true,
    at: payload.at || new Date().toISOString(),
    error: payload.error || '',
  }, null, 2)}\n`);
  fs.renameSync(tmp, file);
}

/**
 * Record a full desktop start outcome into last-desktop-start.json.
 * Every start path (launcher, boot retry, menu/tray restart, plugin align)
 * must go through one writer so a stale `{ ok:false }` can never keep holding
 * the next cold start at the launcher after the desktop actually recovered.
 */
async function recordLastDesktopStart(userDataDir, work) {
  try {
    const value = await work();
    writeLastDesktopStart(userDataDir, { ok: true });
    return value;
  } catch (error) {
    writeLastDesktopStart(userDataDir, {
      ok: false,
      error: error && error.message ? error.message : String(error),
    });
    throw error;
  }
}

function shouldPromptUpdate({ askOnUpdate, check }) {
  return askOnUpdate !== false && check && check.status === 'available';
}

/**
 * Single source of truth for "skip user plugins is sticky for this build".
 * A recovery marker written by another app version is stale, not active.
 * Owner shape: { pluginRecovery, appVersion } (HarnessController or snapshot).
 */
function stickySkipActive(owner) {
  const recovery = owner && owner.pluginRecovery;
  if (!recovery || !recovery.skipUserPlugins) {
    return false;
  }
  return recovery.appVersion === owner.appVersion;
}

function shouldAutoStartDesktop({
  autoStartDesktop,
  holdForImport,
  updateFlowHold,
  lastStartFailed,
}) {
  if (autoStartDesktop === false) return false;
  if (holdForImport) return false;
  if (updateFlowHold) return false;
  if (lastStartFailed) return false;
  return true;
}

function shouldCloseLauncher({ desktopReady, quitAfterStart }) {
  return desktopReady === true && quitAfterStart !== false;
}

/** Launcher may close only after a confirmed healthy full start. */
function shouldCloseLauncherAfterDesktopStart({
  desktopReady,
  quitAfterStart,
  stickySkip,
  recoveryLaunch,
  lastStartOk,
}) {
  if (!shouldCloseLauncher({ desktopReady, quitAfterStart })) {
    return false;
  }
  if (stickySkip || recoveryLaunch) {
    return false;
  }
  return lastStartOk === true;
}

/** Hint shown when an accepted update did not end with the app quitting. */
function updateStayHint(check, outcome) {
  if (outcome && outcome.launched === true) {
    const message = '安装器已启动（当前为源码运行，应用不会自动退出）';
    return { ...check, message, hint: `${message}。` };
  }
  if (outcome && outcome.openedPage === true) {
    const message = '该版本没有安装包资产，已打开发布页';
    return { ...check, message, hint: `${message}。仍可启动桌面端。` };
  }
  const message = (outcome && outcome.message) || '更新未完成，可稍后重试或手动启动桌面端';
  return {
    ...check,
    status: 'error',
    message,
    hint: `更新未完成：${message}。仍可启动桌面端。`,
  };
}

/**
 * Cold-start gate orchestration. All effects are injected so the flow is
 * unit-testable; src/main/index.js supplies the Electron-bound deps.
 *
 * Contract (feature card `desktop-launcher`):
 * - The update ask and download progress sit on a visible launcher window,
 *   never on the hidden pre-created one.
 * - An accepted update that fails (download/checksum), only opened the
 *   releases page, or launched the installer from a source run falls back to
 *   the launcher home so「启动桌面端」still works — no hidden window-less
 *   process is ever left behind. Only packaged + installer-launched waits for
 *   the app to quit.
 */
async function runColdStartGate({
  config,
  userDataDir,
  isPackaged,
  checkUpdate,
  confirmUpdate,
  installUpdate,
  openLauncher,
  sendToLauncher,
  recoverInterruptedImport,
  probeImportHold,
  startDesktop,
  log = () => {},
}) {
  let check = { status: 'current' };
  try {
    check = await checkUpdate();
  } catch (error) {
    check = { status: 'error', message: error && error.message ? error.message : String(error) };
  }
  sendToLauncher('shell:launcher-hint', { check });

  let updateFlowHold = false;
  if (shouldPromptUpdate({ askOnUpdate: config.askOnUpdate, check })) {
    await openLauncher();
    if (await confirmUpdate(check)) {
      updateFlowHold = true;
      try {
        const outcome = await installUpdate((payload) => {
          sendToLauncher('shell:update-progress', payload);
        });
        if (outcome && outcome.launched === true && isPackaged) {
          // update.js schedules app.quit() once the installer is up; the
          // launcher stays visible until the process exits.
          return {
            outcome: 'installer', updateFlowHold, holdForImport: false, lastStartFailed: false,
          };
        }
        sendToLauncher('shell:launcher-hint', { check: updateStayHint(check, outcome) });
      } catch (error) {
        const message = error && error.message ? error.message : String(error);
        sendToLauncher('shell:launcher-hint', {
          check: {
            ...check,
            status: 'error',
            message,
            hint: `更新下载失败：${message}。仍可启动桌面端。`,
          },
        });
      }
    }
  }

  let importRecovery = { recovered: false, removedTmp: [] };
  try {
    importRecovery = recoverInterruptedImport() || importRecovery;
  } catch (error) {
    log(`导入日志恢复失败：${error && error.message ? error.message : String(error)}`, 'error');
  }
  // Shallow probe only (feature card `data-import`): the gate needs the
  // destEmpty && sourceHasData verdict, not session titles/cwd metadata —
  // the full scanImport stays on the import page.
  const holdForImport = probeImportHold().hold === true || importRecovery.recovered === true;
  const lastStartFailed = readLastDesktopStart(userDataDir).ok === false;
  const autoStart = shouldAutoStartDesktop({
    autoStartDesktop: config.autoStartDesktop,
    holdForImport,
    updateFlowHold,
    lastStartFailed,
  });
  if (holdForImport) {
    sendToLauncher('shell:show-tab', { tab: 'import' });
  }
  if (importRecovery.recovered === true) {
    sendToLauncher('shell:launcher-hint', {
      importResume: { removedTmp: (importRecovery.removedTmp || []).length },
    });
  }
  if (!holdForImport && (lastStartFailed || updateFlowHold)) {
    sendToLauncher('shell:show-tab', { tab: 'home' });
  }
  if (!autoStart) {
    await openLauncher();
  }
  if (autoStart) {
    await startDesktop();
  }
  return {
    outcome: autoStart ? 'desktop' : 'launcher', updateFlowHold, holdForImport, lastStartFailed,
  };
}

module.exports = {
  lastDesktopStartPath,
  readLastDesktopStart,
  writeLastDesktopStart,
  recordLastDesktopStart,
  shouldPromptUpdate,
  stickySkipActive,
  shouldAutoStartDesktop,
  shouldCloseLauncher,
  shouldCloseLauncherAfterDesktopStart,
  runColdStartGate,
};
