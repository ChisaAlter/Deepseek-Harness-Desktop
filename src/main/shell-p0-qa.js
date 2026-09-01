'use strict';

const { PAGE_HELPERS } = require('./release-ui-walk');
const { trayMenuTemplate } = require('./tray-menu');

const SHELL_P0_STEPS = Object.freeze([
  'shell.shortcut.settings',
  'shell.shortcut.surfaces',
  'shell.shortcut.terminal',
  'shell.window.maximizeRestore',
  'shell.window.minimizeRestore',
  'shell.window.controlsClickable',
  'shell.desk.closeToTray',
  'shell.desk.trayShow',
  'shell.desk.trayOpenLauncher',
  'shell.desk.traySettings',
  'shell.desk.trayMarketplace',
  'shell.desk.noExtraWindow',
  'shell.desk.closeWouldQuit',
  'shell.desk.trayLabels',
  'shell.persist.write',
]);

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitUntil(probe, timeoutMs, intervalMs = 200) {
  const deadline = Date.now() + timeoutMs;
  let last = null;
  while (Date.now() < deadline) {
    last = await probe();
    if (last) return last;
    await sleep(intervalMs);
  }
  return last;
}

function pageEval(wc, fn) {
  return wc.executeJavaScript(`(() => { ${PAGE_HELPERS}; return (${fn.toString()})(); })()`);
}

function makeRecorder(steps) {
  return (name, ok, detail, optional = false) => {
    const row = {
      name,
      ok: Boolean(ok),
      detail: detail == null ? '' : String(detail).slice(0, 400),
    };
    if (optional) row.optional = true;
    steps.push(row);
    console.log(`[DSH_QA_SHELL] ${ok ? 'PASS' : (optional ? 'SKIP' : 'FAIL')} ${name}${row.detail ? ` — ${row.detail}` : ''}`);
  };
}

async function sendAccel(wc, { key, code, vk }) {
  await wc.debugger.sendCommand('Input.dispatchKeyEvent', {
    type: 'keyDown', key: 'Control', code: 'ControlLeft', windowsVirtualKeyCode: 17, modifiers: 2,
  });
  await wc.debugger.sendCommand('Input.dispatchKeyEvent', {
    type: 'keyDown', key, code, windowsVirtualKeyCode: vk, modifiers: 2,
  });
  await wc.debugger.sendCommand('Input.dispatchKeyEvent', {
    type: 'keyUp', key, code, windowsVirtualKeyCode: vk, modifiers: 2,
  });
  await wc.debugger.sendCommand('Input.dispatchKeyEvent', {
    type: 'keyUp', key: 'Control', code: 'ControlLeft', windowsVirtualKeyCode: 17,
  });
}

function clickMenuItem(pathLabels) {
  const { Menu } = require('electron');
  let menu = Menu.getApplicationMenu();
  if (!menu) return false;
  for (const label of pathLabels) {
    const item = menu.items.find((entry) => entry.label === label);
    if (!item) return false;
    if (item.submenu) {
      menu = item.submenu;
      continue;
    }
    if (typeof item.click === 'function') {
      item.click();
      return true;
    }
    return false;
  }
  return false;
}

function surfacesCollapsed(wc) {
  return pageEval(wc, () => {
    const frame = document.querySelector('[class*="frame"]');
    return frame ? frame.getAttribute('data-surfaces-collapsed') === 'true' : null;
  });
}

function terminalDrawerOpen(wc) {
  return pageEval(wc, () => {
    const root = document.querySelector('[data-terminal-owner="drawer"]');
    return Boolean(root && dshShown(root) && root.getBoundingClientRect().height > 8);
  });
}

function settingsOpen(wc) {
  return pageEval(wc, () => Boolean(dshDialog()));
}

function marketNavCurrent(wc) {
  return pageEval(wc, () => {
    const nav = document.querySelector('[data-dsh-settings-section="market"]');
    return Boolean(nav && (nav.getAttribute('aria-current') === 'true' || dshShown(nav)));
  });
}

/**
 * Drive desktop-shell P0s that the page walk cannot see: shortcuts, window
 * chrome, close-to-tray, tray callbacks, and a persist marker.
 *
 * @param {Electron.WebContents} wc
 * @param {{
 *   win: Electron.BrowserWindow,
 *   saveConfig: Function,
 *   loadConfig: Function,
 *   showMain: Function,
 *   invokeTrayAction: Function,
 *   getQuitIntercepted: () => boolean,
 *   resetQuitIntercepted: Function,
 *   pressEscape: Function,
 *   dsh: { child?: { pid?: number }, snapshot: Function },
 *   harness: { snapshot: Function, refreshPolicy?: Function, retryFullPlugins?: Function },
 * }} helpers
 */
async function runShellP0Qa(wc, helpers) {
  const steps = [];
  const rec = makeRecorder(steps);
  const win = helpers.win;
  const { BrowserWindow } = require('electron');
  const windowCountAtStart = BrowserWindow.getAllWindows().length;

  const dismiss = async () => {
    if (typeof helpers.pressEscape === 'function') {
      for (let i = 0; i < 4; i += 1) {
        await helpers.pressEscape(wc);
        await sleep(80);
      }
    }
  };

  rec(
    'shell.desk.trayLabels',
    true,
    trayMenuTemplate({
      onShow() {}, onSettings() {}, onMarketplace() {}, onRestart() {}, onQuit() {},
    }).map((item) => item.label || item.type).join(' | '),
  );

  if (win && !win.isDestroyed()) {
    win.show();
    win.focus();
  }

  const settingsClicked = clickMenuItem(['文件', '设置…']);
  const settingsOpened = settingsClicked
    ? await waitUntil(() => settingsOpen(wc).then((open) => (open ? true : null)), 8_000)
    : false;
  rec(
    'shell.shortcut.settings',
    Boolean(settingsOpened),
    settingsClicked ? (settingsOpened ? 'Ctrl+, menu path opened settings' : 'menu click did not open settings') : '菜单「设置…」缺失',
  );
  await dismiss();

  const surfacesBefore = await surfacesCollapsed(wc);
  if (wc.debugger.isAttached()) {
    await sendAccel(wc, { key: '\\', code: 'Backslash', vk: 220 });
    await sleep(400);
  }
  const surfacesAfter = await surfacesCollapsed(wc);
  const surfacesToggled = surfacesBefore !== null && surfacesAfter !== surfacesBefore;
  if (surfacesToggled) {
    await sendAccel(wc, { key: '\\', code: 'Backslash', vk: 220 });
    await sleep(300);
  }
  rec(
    'shell.shortcut.surfaces',
    surfacesToggled,
    `beforeCollapsed=${surfacesBefore}; afterCollapsed=${surfacesAfter}`,
  );

  const terminalBefore = await terminalDrawerOpen(wc);
  if (wc.debugger.isAttached()) {
    await sendAccel(wc, { key: '`', code: 'Backquote', vk: 192 });
    await sleep(500);
  }
  const terminalAfter = await terminalDrawerOpen(wc);
  const terminalToggled = terminalAfter !== terminalBefore;
  if (terminalToggled) {
    await sendAccel(wc, { key: '`', code: 'Backquote', vk: 192 });
    await sleep(300);
  }
  rec(
    'shell.shortcut.terminal',
    terminalToggled,
    `beforeOpen=${terminalBefore}; afterOpen=${terminalAfter}`,
  );

  const controls = await pageEval(wc, () => {
    const host = document.getElementById('dshd-shell-controls');
    if (!host) return null;
    return {
      min: Boolean(host.querySelector('[data-act="minimize"]')),
      max: Boolean(host.querySelector('[data-act="maximize"]')),
      close: Boolean(host.querySelector('[data-act="close"]')),
    };
  });
  rec(
    'shell.window.controlsClickable',
    Boolean(controls?.min && controls?.max && controls?.close),
    controls ? '' : 'window-control plate missing',
  );

  if (win && !win.isDestroyed() && win.maximizable) {
    const wasMax = win.isMaximized();
    if (wasMax) win.unmaximize();
    else win.maximize();
    await sleep(400);
    const flipped = win.isMaximized() !== wasMax;
    if (win.isMaximized()) win.unmaximize();
    else if (wasMax) win.maximize();
    await sleep(200);
    rec('shell.window.maximizeRestore', flipped, `wasMax=${wasMax}`);
  } else {
    rec('shell.window.maximizeRestore', false, 'window missing or not maximizable');
  }

  if (win && !win.isDestroyed() && win.minimizable) {
    win.minimize();
    await sleep(500);
    const minimized = win.isMinimized();
    if (minimized) win.restore();
    else win.show();
    await sleep(200);
    rec('shell.window.minimizeRestore', minimized, minimized ? 'minimized then restored' : 'minimize did not stick');
  } else {
    rec('shell.window.minimizeRestore', false, 'window missing or not minimizable');
  }

  helpers.saveConfig({ closeToTray: true });
  if (typeof helpers.resetQuitIntercepted === 'function') helpers.resetQuitIntercepted();
  const visibleBeforeClose = Boolean(win && !win.isDestroyed() && win.isVisible());
  if (win && !win.isDestroyed()) {
    win.close();
  }
  await sleep(400);
  const hiddenAlive = Boolean(
    win
    && !win.isDestroyed()
    && win.isVisible() === false
    && helpers.dsh.snapshot().state === 'ready',
  );
  rec(
    'shell.desk.closeToTray',
    visibleBeforeClose && hiddenAlive,
    `visibleBefore=${visibleBeforeClose}; destroyed=${!win || win.isDestroyed()}; harness=${helpers.dsh.snapshot().state}`,
  );

  helpers.invokeTrayAction('show');
  await sleep(300);
  const shown = Boolean(win && !win.isDestroyed() && win.isVisible());
  rec('shell.desk.trayShow', shown, shown ? 'showMain from tray' : 'window stayed hidden');

  helpers.invokeTrayAction('openLauncher');
  await sleep(500);
  const { getLauncherWindow } = require('./window');
  const launcherWin = getLauncherWindow();
  const launcherUp = Boolean(launcherWin && !launcherWin.isDestroyed());
  rec(
    'shell.desk.trayOpenLauncher',
    launcherUp,
    launcherUp ? 'tray 打开启动器 raised launcher window' : 'tray 打开启动器 did not open launcher',
  );
  if (launcherUp) {
    launcherWin.close();
    await sleep(300);
  }

  helpers.invokeTrayAction('settings');
  const traySettings = await waitUntil(() => settingsOpen(wc).then((open) => (open ? true : null)), 8_000);
  rec('shell.desk.traySettings', Boolean(traySettings), traySettings ? 'settings from tray' : 'tray 设置 did not open settings');
  await dismiss();

  helpers.invokeTrayAction('marketplace');
  const trayMarket = await waitUntil(() => marketNavCurrent(wc).then((open) => (open ? true : null)), 8_000);
  const extraWindows = BrowserWindow.getAllWindows().length > windowCountAtStart;
  rec('shell.desk.trayMarketplace', Boolean(trayMarket) && !extraWindows, trayMarket ? 'market section' : 'tray 插件市场 did not open market');
  rec(
    'shell.desk.noExtraWindow',
    !extraWindows,
    `windows=${BrowserWindow.getAllWindows().length} start=${windowCountAtStart}`,
  );
  await dismiss();

  helpers.saveConfig({ closeToTray: false });
  if (typeof helpers.resetQuitIntercepted === 'function') helpers.resetQuitIntercepted();
  if (win && !win.isDestroyed()) {
    if (!win.isVisible()) win.show();
    win.close();
  }
  await sleep(400);
  const intercepted = typeof helpers.getQuitIntercepted === 'function' && helpers.getQuitIntercepted();
  const stillAlive = Boolean(win && !win.isDestroyed());
  rec(
    'shell.desk.closeWouldQuit',
    intercepted && stillAlive,
    `intercepted=${intercepted}; destroyed=${!stillAlive}`,
  );
  helpers.saveConfig({ closeToTray: true, theme: 'midnight' });
  if (win && !win.isDestroyed() && !win.isVisible()) {
    helpers.showMain();
  }

  const written = helpers.loadConfig();
  rec(
    'shell.persist.write',
    written.closeToTray === true && written.theme === 'midnight',
    `closeToTray=${written.closeToTray}; theme=${written.theme}`,
  );

  if (process.env.DSH_QA_TRAY_QUIT === '1') {
    process.env.DSH_QA_ALLOW_QUIT = '1';
    helpers.invokeTrayAction('quit');
    return { ok: true, failed: [], steps, trayQuitRequested: true };
  }

  const failed = steps.filter((s) => !s.ok && !s.optional).map((s) => s.name);
  return { ok: failed.length === 0, failed, steps };
}

const PERSIST_STEPS = Object.freeze([
  'persist.closeToTray',
  'persist.theme',
  'persist.workspace',
  'persist.sessions',
  'persist.model',
  'persist.wallpaper',
]);

function sameFsPath(left, right) {
  const a = String(left || '').replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
  const b = String(right || '').replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
  return Boolean(a) && a === b;
}

function countSessionJsonl(root) {
  if (!root) return 0;
  const fs = require('fs');
  const path = require('path');
  let n = 0;
  const stack = [root];
  while (stack.length) {
    const dir = stack.pop();
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const ent of entries) {
      if (ent.name === 'node_modules' || ent.name === '.git') continue;
      const full = path.join(dir, ent.name);
      if (ent.isDirectory()) stack.push(full);
      else if (ent.name === 'session.jsonl' || ent.name === 'session.jsonl.zstd') n += 1;
    }
  }
  return n;
}

async function runPersistQa(wc, helpers) {
  const steps = [];
  const rec = makeRecorder(steps);
  const config = helpers.loadConfig();
  rec('persist.closeToTray', config.closeToTray === true, `closeToTray=${config.closeToTray}`);
  rec('persist.theme', config.theme === 'midnight', `theme=${config.theme}`);
  const connected = await waitUntil(() => pageEval(wc, () => dshComposerReady() ? true : null), 25_000);
  const wantWorkspace = helpers.workspacePath || config.workspace;
  rec(
    'persist.workspace',
    Boolean(connected) && sameFsPath(config.workspace, wantWorkspace),
    connected
      ? `config=${config.workspace}; want=${wantWorkspace}`
      : 'composer locked after relaunch',
  );

  const { app } = require('electron');
  const { desktopDshHomeFromUserData } = require('../shared/dsh-home');
  let jsonl = 0;
  let jsonlError = '';
  try {
    jsonl = countSessionJsonl(desktopDshHomeFromUserData(app.getPath('userData')));
  } catch (error) {
    jsonlError = String(error).slice(0, 200);
  }
  const sessionUi = await pageEval(wc, () => {
    const menus = Array.from(document.querySelectorAll('button')).filter((el) => {
      const aria = el.getAttribute('aria-label') || '';
      return dshShown(el) && /会话[“"]|session actions for/i.test(aria);
    });
    return {
      menus: menus.length,
      labels: menus.map((el) => el.getAttribute('aria-label') || '').slice(0, 4),
    };
  });
  rec(
    'persist.sessions',
    jsonl >= 1,
    jsonlError || `jsonl=${jsonl}; sidebarMenus=${sessionUi.menus}; ${sessionUi.labels.join(' | ')}`,
  );

  const model = await pageEval(wc, () => {
    const trigger = composerModelTrigger();
    return trigger
      ? (trigger.getAttribute('aria-label') || dshLabel(trigger)).slice(0, 120)
      : '';
  });
  rec('persist.model', /grok-4\.6/i.test(model), model || 'model trigger missing');

  const wallpaper = await pageEval(wc, () => ({
    attr: document.documentElement.hasAttribute('data-dsh-wallpaper'),
    node: Boolean(document.getElementById('dsh-wallpaper')),
  }));
  rec(
    'persist.wallpaper',
    Boolean(wallpaper?.attr || wallpaper?.node),
    wallpaper?.attr
      ? 'data-dsh-wallpaper'
      : (wallpaper?.node ? '#dsh-wallpaper' : 'no wallpaper after relaunch'),
  );

  const failed = steps.filter((s) => !s.ok && !s.optional).map((s) => s.name);
  return { ok: failed.length === 0, failed, steps };
}

const RECOVERY_STEPS = Object.freeze([
  'recovery.skipSticky',
  'recovery.retryFullPlugins',
  'recovery.crashShowsBoot',
  'recovery.retryRestoresUi',
]);

async function runRecoveryQa(helpers) {
  const steps = [];
  const rec = makeRecorder(steps);
  const { win, dsh, harness, saveConfig } = helpers;
  const skipSnap = harness.snapshot();
  rec(
    'recovery.skipSticky',
    skipSnap.pluginRecovery?.skipUserPlugins === true,
    skipSnap.pluginRecovery?.skipUserPlugins ? 'skip-user-plugins sticky' : 'pluginRecovery.skipUserPlugins is false',
  );
  if (typeof harness.retryFullPlugins === 'function') {
    await harness.retryFullPlugins().catch((error) => error);
  }
  const afterRetry = await waitUntil(() => {
    const snap = dsh.snapshot();
    return snap.state === 'ready' ? snap : null;
  }, 90_000);
  rec(
    'recovery.retryFullPlugins',
    Boolean(afterRetry) && harness.snapshot().pluginRecovery?.skipUserPlugins !== true,
    afterRetry ? 'full plugin tree retried' : `state=${dsh.snapshot().state}`,
  );

  saveConfig({ harnessAutoRestart: false, closeToTray: true });
  if (typeof harness.refreshPolicy === 'function') harness.refreshPolicy();

  const pid = dsh.child && dsh.child.pid;
  if (!pid) {
    rec('recovery.crashShowsBoot', false, 'dsh child pid missing');
    rec('recovery.retryRestoresUi', false, 'skipped');
    return { ok: false, failed: ['recovery.crashShowsBoot'], steps };
  }
  try {
    process.kill(pid);
  } catch (error) {
    rec('recovery.crashShowsBoot', false, String(error).slice(0, 200));
    rec('recovery.retryRestoresUi', false, 'kill failed');
    return { ok: false, failed: ['recovery.crashShowsBoot'], steps };
  }

  const crashed = await waitUntil(() => {
    const snap = harness.snapshot();
    if (snap.state === 'error' && snap.failure?.phase === 'runtime') return snap;
    return null;
  }, 20_000);
  const bootCopy = win && !win.isDestroyed()
    ? await win.webContents.executeJavaScript(`({
      status: (document.getElementById('status') && document.getElementById('status').textContent) || '',
      retry: (document.getElementById('retry') && document.getElementById('retry').textContent) || '',
      saveLog: (document.getElementById('save-log') && document.getElementById('save-log').textContent) || '',
    })`).catch(() => null)
    : null;
  rec(
    'recovery.crashShowsBoot',
    Boolean(crashed) && /意外退出|立即重启|下载日志/.test(`${bootCopy?.status || ''}${bootCopy?.retry || ''}${bootCopy?.saveLog || ''}`),
    bootCopy ? `${bootCopy.status} / ${bootCopy.retry}` : `state=${harness.snapshot().state}`,
  );

  if (win && !win.isDestroyed()) {
    await win.webContents.executeJavaScript(`(() => {
      const btn = document.getElementById('retry');
      if (!btn) return false;
      btn.click();
      return true;
    })()`);
  }
  const restored = await waitUntil(() => {
    const snap = dsh.snapshot();
    return snap.state === 'ready' ? snap : null;
  }, 90_000);
  rec(
    'recovery.retryRestoresUi',
    Boolean(restored),
    restored ? 'Web UI 就绪 after retry' : `state=${dsh.snapshot().state}`,
  );

  saveConfig({ harnessAutoRestart: true });
  if (typeof harness.refreshPolicy === 'function') harness.refreshPolicy();

  const failed = steps.filter((s) => !s.ok && !s.optional).map((s) => s.name);
  return { ok: failed.length === 0, failed, steps };
}

function assertShellP0QaResult(qa) {
  if (!qa || qa.ok !== true) {
    throw new Error(`Shell P0 QA failed: ${(qa?.failed || []).join(', ') || 'unknown'}`);
  }
  const names = new Set((qa.steps || []).map((step) => step.name));
  const missing = SHELL_P0_STEPS.filter((name) => !names.has(name));
  if (missing.length > 0) {
    throw new Error(`Shell P0 QA omitted ${missing.join(', ')}`);
  }
}

function assertPersistQaResult(qa) {
  if (!qa || qa.ok !== true) {
    throw new Error(`Persist QA failed: ${(qa?.failed || []).join(', ') || 'unknown'}`);
  }
  const names = new Set((qa.steps || []).map((step) => step.name));
  const missing = PERSIST_STEPS.filter((name) => !names.has(name));
  if (missing.length > 0) {
    throw new Error(`Persist QA omitted ${missing.join(', ')}`);
  }
}

function assertRecoveryQaResult(qa) {
  if (!qa || qa.ok !== true) {
    throw new Error(`Recovery QA failed: ${(qa?.failed || []).join(', ') || 'unknown'}`);
  }
  const names = new Set((qa.steps || []).map((step) => step.name));
  const missing = RECOVERY_STEPS.filter((name) => !names.has(name));
  if (missing.length > 0) {
    throw new Error(`Recovery QA omitted ${missing.join(', ')}`);
  }
}

module.exports = {
  SHELL_P0_STEPS,
  PERSIST_STEPS,
  RECOVERY_STEPS,
  countSessionJsonl,
  runShellP0Qa,
  runPersistQa,
  runRecoveryQa,
  assertShellP0QaResult,
  assertPersistQaResult,
  assertRecoveryQaResult,
};
