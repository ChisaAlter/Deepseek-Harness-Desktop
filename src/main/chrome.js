const { BrowserWindow, ipcMain, nativeTheme } = require('electron');
const fs = require('fs');
const path = require('path');
const { loadConfig } = require('./config');
const { resolveTheme, officialShellBackground, windowBackgroundForShell } = require('../shared/themes');
const { IPC_ROLES, assertIpcSender } = require('./ipc-authorization');

const TITLEBAR_HEIGHT = 48;
const injectScript = fs.readFileSync(path.join(__dirname, 'harness-chrome-inject.js'), 'utf8');
let ipcBound = false;
const chromeRoles = new WeakMap();

function chromeBackgroundFor(win, theme = currentTheme()) {
  const role = chromeRoles.get(win);
  let url;
  try {
    url = win.webContents.getURL();
  } catch {
    // window already gone; role from WeakMap is still enough for the launcher
  }
  return windowBackgroundForShell(theme, { role, url });
}

function currentTheme() {
  return resolveTheme(loadConfig(), {
    systemDark: Boolean(nativeTheme && nativeTheme.shouldUseDarkColors),
  });
}

function windowChrome(overrides = {}) {
  const theme = currentTheme();
  return {
    frame: false,
    roundedCorners: true,
    backgroundColor: theme.bg,
    autoHideMenuBar: true,
    ...overrides,
  };
}

function hideNativeMenu(win) {
  if (!win || win.isDestroyed()) {
    return;
  }
  win.setAutoHideMenuBar(true);
  win.setMenuBarVisibility(false);
}

function isHarnessUrl(url) {
  const { isLoopbackHttpUrl } = require('./local-url');
  return isLoopbackHttpUrl(url);
}

function paintBackground(win, color) {
  if (!win || win.isDestroyed() || !color) {
    return;
  }
  win.setBackgroundColor(color);
}

const WINDOW_ROLES = [IPC_ROLES.BOOT, IPC_ROLES.HARNESS, IPC_ROLES.LAUNCHER];

function authorizedRole(event, roles) {
  try {
    return assertIpcSender(event, roles);
  } catch {
    return null;
  }
}

function windowFromEvent(event, role) {
  if (role === IPC_ROLES.HARNESS) {
    const { getMainWindow } = require('./window');
    return getMainWindow();
  }
  return BrowserWindow.fromWebContents(event.sender);
}

function sendWindowState(win) {
  if (!win || win.isDestroyed()) {
    return;
  }
  const payload = {
    maximized: win.isMaximized(),
    minimizable: win.minimizable,
    maximizable: win.maximizable,
  };
  win.webContents.send('shell:window-state', payload);
  try {
    const { getHarnessWebContents } = require('./window');
    const harnessWc = getHarnessWebContents(win);
    if (harnessWc && !harnessWc.isDestroyed()) {
      harnessWc.send('shell:window-state', payload);
    }
  } catch {
    // window module is still loading
  }
}

function bindChromeIpc() {
  if (ipcBound) {
    return;
  }
  ipcBound = true;

  ipcMain.on('shell:window', (event, action) => {
    const role = authorizedRole(event, WINDOW_ROLES);
    if (!role) return;
    const win = windowFromEvent(event, role);
    if (!win || win.isDestroyed()) {
      return;
    }
    if (action === 'minimize' && win.minimizable) {
      // After a caption-classified mousedown, Windows ignores minimize/maximize
      // in the same turn; run on the next tick.
      setImmediate(() => {
        if (!win.isDestroyed() && win.minimizable) {
          win.minimize();
        }
      });
    } else if (action === 'maximize' && win.maximizable) {
      setImmediate(() => {
        if (win.isDestroyed() || !win.maximizable) {
          return;
        }
        if (win.isMaximized()) {
          win.unmaximize();
        } else {
          win.maximize();
        }
      });
    } else if (action === 'close') {
      win.close();
    }
  });

  ipcMain.handle('shell:window-state', (event) => {
    const role = assertIpcSender(event, WINDOW_ROLES);
    const win = windowFromEvent(event, role);
    if (!win || win.isDestroyed()) {
      return { maximized: false, minimizable: true, maximizable: true };
    }
    return {
      maximized: win.isMaximized(),
      minimizable: win.minimizable,
      maximizable: win.maximizable,
    };
  });

  ipcMain.on('shell:chrome-metrics', (event, metrics) => {
    const role = authorizedRole(event, [IPC_ROLES.HARNESS]);
    if (!role) return;
    const win = windowFromEvent(event, role);
    if (win && metrics?.bg) {
      paintBackground(win, metrics.bg);
    }
  });
}

async function syncHarnessChrome(win, webContents = win.webContents) {
  if (win.isDestroyed() || !webContents || webContents.isDestroyed() || !isHarnessUrl(webContents.getURL())) {
    return;
  }
  try {
    const sample = await webContents.executeJavaScript(injectScript);
    if (sample?.bg) {
      paintBackground(win, sample.bg);
    }
  } catch {
    paintBackground(win, '#ffffff');
  }
}

function prepareHarnessChrome(win) {
  paintBackground(win, '#ffffff');
}

function applyAppTheme() {
  const theme = currentTheme();
  const { getHarnessWebContents } = require('./window');
  require('./desktop-pet').getDesktopPet()?.setTheme(theme);
  for (const win of BrowserWindow.getAllWindows()) {
    const harnessWc = getHarnessWebContents(win);
    if (harnessWc && isHarnessUrl(harnessWc.getURL())) {
      syncHarnessChrome(win, harnessWc);
    } else if (isHarnessUrl(win.webContents.getURL())) {
      syncHarnessChrome(win);
    } else {
      paintBackground(win, chromeBackgroundFor(win, theme));
      win.webContents.send('shell:theme', theme);
    }
    sendWindowState(win);
  }
  return theme;
}

/**
 * Repaint every window when the OS light/dark preference flips so themes
 * that follow the system table stay current without a restart.
 * Injectable for tests; returns an unsubscribe.
 */
function watchSystemTheme({ theme = nativeTheme, apply = applyAppTheme } = {}) {
  if (!theme || typeof theme.on !== 'function') {
    return () => {};
  }
  const listener = () => apply();
  theme.on('updated', listener);
  return () => {
    if (typeof theme.off === 'function') {
      theme.off('updated', listener);
    } else if (typeof theme.removeListener === 'function') {
      theme.removeListener('updated', listener);
    }
  };
}

function attachIntegratedChrome(win, options = {}) {
  if (options.role) {
    chromeRoles.set(win, options.role);
  }
  bindChromeIpc();
  hideNativeMenu(win);
  paintBackground(win, chromeBackgroundFor(win));

  const apply = () => {
    if (win.isDestroyed()) {
      return;
    }
    hideNativeMenu(win);
    sendWindowState(win);
    if (isHarnessUrl(win.webContents.getURL())) {
      prepareHarnessChrome(win);
      syncHarnessChrome(win);
      return;
    }
    paintBackground(win, chromeBackgroundFor(win));
  };

  win.on('maximize', () => sendWindowState(win));
  win.on('unmaximize', () => sendWindowState(win));
  win.webContents.on('did-finish-load', apply);
  win.webContents.on('dom-ready', apply);
  win.webContents.on('did-navigate-in-page', apply);
}

module.exports = {
  TITLEBAR_HEIGHT,
  windowChrome,
  hideNativeMenu,
  attachIntegratedChrome,
  applyAppTheme,
  watchSystemTheme,
  prepareHarnessChrome,
  syncHarnessChrome,
  currentTheme,
  isHarnessUrl,
  officialShellBackground,
};
