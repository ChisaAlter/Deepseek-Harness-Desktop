const { BrowserView, BrowserWindow, shell, nativeImage } = require('electron');
const { rendererFile, assetFile, preloadFile } = require('./paths');
const { REMOTE_FEATURE_ENABLED } = require('./config');
const { windowChrome, attachIntegratedChrome, hideNativeMenu, prepareHarnessChrome, syncHarnessChrome, currentTheme, officialShellBackground } = require('./chrome');
const { normalizeSettingsSection, buildSettingsSectionScript } = require('./settings-jump');
const {
  isLoopbackHttpUrl,
  isSameOriginLoopbackUrl,
  isLocalAppNavigationUrl,
  isLauncherNavigationUrl,
  isHttpOrHttpsUrl,
  rewriteLoopbackLoadUrl,
  shouldAllowPrivilegedNavigate,
  shouldAllowPrivilegedRedirect,
} = require('./local-url');

const { applyHarnessCookieToSession, launchTokenFromUrl, loadUrlAfterRedeem } = require('./harness-browser-auth');

const PLUGIN_BOOT_TIMEOUT_MS = 90_000;
const PLUGIN_BOOT_PROBE = `(() => {
  const boot = document.querySelector('[data-dshd-boot-status]');
  const status = boot ? boot.getAttribute('data-dshd-boot-status') : null;
  const hasApp = Boolean(document.querySelector('[data-dsh-settings-trigger], [class*="frame"]'));
  return {
    ready: boot ? Number(boot.getAttribute('data-dshd-boot-ready')) || 0 : 0,
    total: boot ? Number(boot.getAttribute('data-dshd-boot-total')) || 0 : 0,
    pending: !hasApp,
    failed: status === 'failed',
    hasApp,
    error: boot ? String(boot.getAttribute('data-dshd-boot-error') || '') : '',
  };
})()`;

let mainWindow = null;
let harnessView = null;
let harnessRevealed = false;
let harnessOrigin = '';
let harnessOriginListener = null;
let pluginBootWatch = null;
let pendingMarketplaceJump = false;
let launcherWindow = null;

function pluginBootCancelled(message = 'Web UI 插件加载已取消') {
  const error = new Error(message);
  error.code = 'HARNESS_OPERATION_CANCELLED';
  return error;
}

function cancelPluginBootWatch() {
  pluginBootWatch?.cancel();
}

function iconImage() {
  const png = nativeImage.createFromPath(assetFile('icon.png'));
  if (!png.isEmpty()) {
    return png;
  }
  const svg = nativeImage.createFromPath(assetFile('icon.svg'));
  return svg.isEmpty() ? undefined : svg;
}

function createMainWindow() {
  if (mainWindow && !mainWindow.isDestroyed()) {
    return mainWindow;
  }

  mainWindow = new BrowserWindow({
    ...windowChrome({
      width: 1440,
      height: 920,
      minWidth: 960,
      minHeight: 640,
      show: false,
      icon: iconImage(),
    }),
    webPreferences: {
      preload: preloadFile(),
      additionalArguments: ['--dshd-shell-role=boot'],
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
    },
  });

  attachIntegratedChrome(mainWindow);
  mainWindow.once('ready-to-show', () => {
    hideNativeMenu(mainWindow);
    mainWindow.show();
  });
  mainWindow.on('closed', () => {
    hideHarnessView(mainWindow);
    mainWindow = null;
  });

  attachPrivilegedNavigationGuards(mainWindow.webContents, {
    allowUrl: isLocalAppNavigationUrl,
    openDeniedExternal: true,
  });

  return mainWindow;
}

/**
 * Pin a privileged BrowserWindow/BrowserView to an allowlist; denied
 * navigations optionally open http(s) in the system browser, and harness
 * contents may send denied loopback (not same-origin) to the preview surface.
 * @param {Electron.WebContents} contents
 * @param {{ allowUrl: (url: unknown) => boolean, openDeniedExternal?: boolean, openDeniedLoopback?: boolean }} options
 */
function attachPrivilegedNavigationGuards(contents, options) {
  const { allowUrl, openDeniedExternal = false, openDeniedLoopback = false } = options;

  function handleDeniedHttp(url) {
    if (openDeniedLoopback && isLoopbackHttpUrl(url)) {
      if (!allowUrl(url)) {
        const next = rewriteLoopbackLoadUrl(url);
        if (next && typeof contents.send === 'function') {
          contents.send('shell:open-preview-url', { url: next });
        }
      }
      return;
    }
    if (openDeniedExternal && isHttpOrHttpsUrl(url)) {
      shell.openExternal(url);
    }
  }

  contents.setWindowOpenHandler(({ url }) => {
    handleDeniedHttp(url);
    return { action: 'deny' };
  });
  contents.on('will-navigate', (event, url) => {
    const current = contents.getURL();
    if (!shouldAllowPrivilegedNavigate({ nextUrl: url, currentUrl: current, allowUrl })) {
      event.preventDefault();
      handleDeniedHttp(url);
    }
  });
  contents.on('will-redirect', (event, url) => {
    if (!shouldAllowPrivilegedRedirect({ nextUrl: url, allowUrl })) {
      event.preventDefault();
    }
  });
}

function getMainWindow() {
  return mainWindow && !mainWindow.isDestroyed() ? mainWindow : null;
}

function getHarnessWebContents(win) {
  if (!harnessView || harnessView.webContents.isDestroyed()) {
    return null;
  }
  const owner = getMainWindow();
  if (win && owner && win !== owner) {
    return null;
  }
  return harnessView.webContents;
}

function getHarnessOrigin() {
  return getHarnessWebContents() ? harnessOrigin : '';
}

function onHarnessOriginChange(listener) {
  harnessOriginListener = typeof listener === 'function' ? listener : null;
}

function notifyHarnessOrigin() {
  if (typeof harnessOriginListener === 'function') {
    try {
      harnessOriginListener(getHarnessOrigin());
    } catch {
      // Origin fans-out must not break BrowserView load.
    }
  }
}

function isHarnessNavigationUrl(url) {
  return Boolean(harnessOrigin && isSameOriginLoopbackUrl(url, harnessOrigin));
}

function harnessPageContents(win) {
  return getHarnessWebContents(win) || win?.webContents;
}

function sendPluginBoot(payload) {
  sendToBoot('shell:plugin-boot', payload);
}

function setBootHarnessCovered(win, covered) {
  if (!win || win.isDestroyed() || !win.webContents || win.webContents.isDestroyed()) {
    return;
  }
  const url = typeof win.webContents.getURL === 'function' ? win.webContents.getURL() : '';
  if (!isLocalAppNavigationUrl(url)) {
    return;
  }
  const flag = covered ? 'true' : 'false';
  void win.webContents.executeJavaScript(
    `document.body && document.body.toggleAttribute('data-harness-covered', ${flag})`,
  ).catch(() => {
    // boot document may already be gone
  });
}

function hideHarnessView(win) {
  harnessRevealed = false;
  harnessOrigin = '';
  notifyHarnessOrigin();
  setBootHarnessCovered(win, false);
  cancelPluginBootWatch();
  if (!harnessView) {
    return;
  }
  const view = harnessView;
  harnessView = null;
  try {
    win?.removeBrowserView(view);
  } catch {
    // already detached
  }
  if (!view.webContents.isDestroyed()) {
    view.webContents.close();
  }
}

function layoutHarnessView(win) {
  if (!harnessView || !win || win.isDestroyed() || !harnessRevealed) {
    return;
  }
  const bounds = win.getContentBounds();
  harnessView.setBounds({ x: 0, y: 0, width: bounds.width, height: bounds.height });
  harnessView.setAutoResize({ width: true, height: true });
}

function revealHarnessView(win) {
  if (!harnessView || !win || win.isDestroyed()) {
    return;
  }
  harnessRevealed = true;
  if (!win.getBrowserViews().includes(harnessView)) {
    win.addBrowserView(harnessView);
  }
  layoutHarnessView(win);
  if (typeof win.setTopBrowserView === 'function') {
    win.setTopBrowserView(harnessView);
  }
  setBootHarnessCovered(win, true);
  prepareHarnessChrome(win);
  syncHarnessChrome(win, harnessView.webContents);
  consumePendingMarketplaceJump(win);
}

function watchPluginBoot(view, win) {
  const deadline = Date.now() + PLUGIN_BOOT_TIMEOUT_MS;
  return new Promise((resolve, reject) => {
    const watch = {
      timer: null,
      settled: false,
      cancel: null,
    };
    const finish = (callback, value) => {
      if (watch.settled) {
        return;
      }
      watch.settled = true;
      if (watch.timer) {
        clearTimeout(watch.timer);
        watch.timer = null;
      }
      if (pluginBootWatch === watch) {
        pluginBootWatch = null;
      }
      callback(value);
    };
    const isCurrent = () => pluginBootWatch === watch && !watch.settled;
    watch.cancel = () => finish(reject, pluginBootCancelled());
    cancelPluginBootWatch();
    pluginBootWatch = watch;

    const tick = async () => {
      watch.timer = null;
      if (!isCurrent()) {
        return;
      }
      if (!view || view.webContents.isDestroyed()) {
        finish(reject, pluginBootCancelled('Web UI 在插件加载期间已关闭'));
        return;
      }
      let status;
      try {
        status = await view.webContents.executeJavaScript(PLUGIN_BOOT_PROBE);
      } catch {
        status = { pending: true, ready: 0, total: 0, failed: false, hasApp: false, error: '' };
      }
      if (!isCurrent()) {
        return;
      }
      const settled = Boolean(status.hasApp);
      sendPluginBoot({
        ready: status.ready,
        total: status.total,
        pending: Boolean(status.pending) && !settled,
        failed: Boolean(status.failed),
        settled,
        error: status.error || '',
      });
      if (status.failed) {
        finish(reject, new Error(status.error || '插件加载失败'));
        return;
      }
      if (settled || Date.now() > deadline) {
        revealHarnessView(win);
        finish(resolve, status);
        return;
      }
      watch.timer = setTimeout(tick, 150);
    };
    watch.timer = setTimeout(tick, 80);
  });
}

function ensureHarnessView(win) {
  if (harnessView && !harnessView.webContents.isDestroyed()) {
    return harnessView;
  }
  hideHarnessView(win);
  harnessView = new BrowserView({
    webPreferences: {
      preload: preloadFile(),
      // The remote flag travels to the sandboxed preload via argv; the
      // preload must not (and cannot) require src/main/config.js itself.
      additionalArguments: [
        '--dshd-shell-role=harness',
        `--dshd-remote-feature=${REMOTE_FEATURE_ENABLED ? '1' : '0'}`,
      ],
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
    },
  });
  win.addBrowserView(harnessView);
  harnessView.setBounds({ x: 0, y: 0, width: 0, height: 0 });
  attachPrivilegedNavigationGuards(harnessView.webContents, {
    allowUrl: isHarnessNavigationUrl,
    openDeniedExternal: true,
    openDeniedLoopback: true,
  });
  const applyChrome = () => {
    if (!harnessRevealed || !harnessView || harnessView.webContents.isDestroyed()) {
      return;
    }
    prepareHarnessChrome(win);
    syncHarnessChrome(win, harnessView.webContents);
  };
  harnessView.webContents.on('did-finish-load', applyChrome);
  harnessView.webContents.on('dom-ready', applyChrome);
  harnessView.webContents.on('did-navigate-in-page', applyChrome);
  if (!win._dshHarnessResizeBound) {
    win._dshHarnessResizeBound = true;
    const relayout = () => layoutHarnessView(win);
    win.on('resize', relayout);
    win.on('maximize', relayout);
    win.on('unmaximize', relayout);
  }
  return harnessView;
}

function showBoot() {
  const win = createMainWindow();
  hideHarnessView(win);
  win.setBackgroundColor(currentTheme().bg);
  if (isBootLoaded(win)) {
    return Promise.resolve();
  }
  return win.loadFile(rendererFile('boot.html'));
}

function showHarness(baseUrl, options = {}) {
  const loadUrl = rewriteLoopbackLoadUrl(baseUrl);
  if (!loadUrl) {
    return Promise.reject(new Error('Harness URL must be a loopback http(s) address'));
  }
  const cookie = typeof options.cookie === 'string' ? options.cookie : '';
  const viewUrl = cookie && launchTokenFromUrl(loadUrl) ? loadUrlAfterRedeem(loadUrl) : loadUrl;
  const win = createMainWindow();
  hideHarnessView(win);
  const bootReady = isBootLoaded(win)
    ? Promise.resolve()
    : win.loadFile(rendererFile('boot.html'));
  return bootReady.then(async () => {
    const view = ensureHarnessView(win);
    harnessOrigin = new URL(viewUrl).origin;
    notifyHarnessOrigin();
    if (cookie) {
      await applyHarnessCookieToSession(view.webContents.session, harnessOrigin, cookie);
    }
    sendPluginBoot({
      ready: 0,
      total: 0,
      pending: true,
      failed: false,
      settled: false,
      error: '',
    });
    return view.webContents.loadURL(viewUrl).then(() => watchPluginBoot(view, win));
  });
}

function showMain() {
  const win = getMainWindow();
  if (!win) {
    return null;
  }
  if (win.isMinimized()) {
    win.restore();
  }
  win.show();
  win.focus();
  return win;
}

/** Tear down the desktop shell window after the kernel stops (launcher stays open). */
function dismissMainWindow() {
  const win = getMainWindow();
  if (!win || win.isDestroyed()) {
    return false;
  }
  hideHarnessView(win);
  win.destroy();
  return true;
}

function isHarnessLoaded(win) {
  if (!harnessRevealed) {
    return false;
  }
  const wc = getHarnessWebContents(win);
  return Boolean(wc && isHarnessNavigationUrl(wc.getURL() || ''));
}

function isBootLoaded(win) {
  const url = win?.webContents.getURL() || '';
  return isLocalAppNavigationUrl(url);
}

function openHarnessSettings(sectionId) {
  const requested = normalizeSettingsSection(sectionId);
  if (!requested.ok) {
    return Promise.resolve(false);
  }
  const win = showMain();
  if (!win || !isHarnessLoaded(win)) {
    return Promise.resolve(false);
  }
  return harnessPageContents(win)
    .executeJavaScript(buildSettingsSectionScript(requested.section))
    .catch(() => {
      // executeJavaScript rejected (destroyed view or thrown page script).
      return false;
    });
}

function jumpToMarketplaceTab() {
  return openHarnessSettings('market');
}

function consumePendingMarketplaceJump(win) {
  if (!pendingMarketplaceJump) {
    return;
  }
  if (!win || !isHarnessLoaded(win)) {
    return;
  }
  void jumpToMarketplaceTab().then((ok) => {
    if (ok) {
      pendingMarketplaceJump = false;
    }
  });
}

function openMarketplace() {
  const win = showMain();
  if (!win || !isHarnessLoaded(win)) {
    pendingMarketplaceJump = true;
    return win || null;
  }
  return jumpToMarketplaceTab();
}

function openRemote() {
  return showMain();
}

function sendToBoot(channel, payload) {
  const win = getMainWindow();
  if (!win) {
    return;
  }
  const url = win.webContents.getURL();
  if (isLocalAppNavigationUrl(url)) {
    win.webContents.send(channel, payload);
  }
}

function getLauncherWindow() {
  return launcherWindow && !launcherWindow.isDestroyed() ? launcherWindow : null;
}

function isLauncherLoaded(win) {
  const url = win?.webContents.getURL() || '';
  return isLauncherNavigationUrl(url);
}

function createLauncherWindow() {
  if (launcherWindow && !launcherWindow.isDestroyed()) {
    return launcherWindow;
  }
  launcherWindow = new BrowserWindow({
    ...windowChrome({
      width: 900,
      height: 680,
      minWidth: 760,
      minHeight: 520,
      show: false,
      icon: iconImage(),
      backgroundColor: officialShellBackground(currentTheme()),
    }),
    webPreferences: {
      preload: preloadFile(),
      additionalArguments: ['--dshd-shell-role=launcher'],
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
    },
  });
  attachIntegratedChrome(launcherWindow, { role: 'launcher' });
  launcherWindow.once('ready-to-show', () => {
    hideNativeMenu(launcherWindow);
  });
  launcherWindow.on('closed', () => {
    launcherWindow = null;
  });
  attachPrivilegedNavigationGuards(launcherWindow.webContents, {
    allowUrl: isLauncherNavigationUrl,
    openDeniedExternal: true,
  });
  return launcherWindow;
}

function showLauncher() {
  const win = createLauncherWindow();
  const ready = isLauncherLoaded(win)
    ? Promise.resolve()
    : win.loadFile(rendererFile('launcher.html'));
  return ready.then(() => {
    if (win.isMinimized()) {
      win.restore();
    }
    win.show();
    win.focus();
    return win;
  });
}

/** Create or reuse the launcher window without showing it (cold start / IPC). */
function prepareLauncher() {
  const win = createLauncherWindow();
  if (isLauncherLoaded(win)) {
    return Promise.resolve(win);
  }
  return win.loadFile(rendererFile('launcher.html')).then(() => win);
}

function sendToLauncher(channel, payload) {
  const win = getLauncherWindow();
  if (!win) {
    return;
  }
  const url = win.webContents.getURL();
  if (isLauncherNavigationUrl(url)) {
    win.webContents.send(channel, payload);
  }
}

function closeLauncherWindow() {
  const win = getLauncherWindow();
  if (!win) {
    return;
  }
  win.close();
}

module.exports = {
  createMainWindow,
  getMainWindow,
  getHarnessWebContents,
  getHarnessOrigin,
  onHarnessOriginChange,
  isHarnessNavigationUrl,
  hideHarnessView,
  dismissMainWindow,
  showBoot,
  showHarness,
  showMain,
  openHarnessSettings,
  openMarketplace,
  openRemote,
  sendToBoot,
  createLauncherWindow,
  getLauncherWindow,
  showLauncher,
  prepareLauncher,
  sendToLauncher,
  closeLauncherWindow,
  setBootHarnessCovered,
  isBootLoaded,
  isHarnessLoaded,
  iconImage,
  attachPrivilegedNavigationGuards,
};
