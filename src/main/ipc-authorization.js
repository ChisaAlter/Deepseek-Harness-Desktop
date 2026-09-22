const {
  isLocalAppNavigationUrl,
  isLauncherNavigationUrl,
  isSameOriginLoopbackUrl,
} = require('./local-url');

const IPC_ROLES = Object.freeze({
  BOOT: 'boot',
  HARNESS: 'harness',
  LAUNCHER: 'launcher',
});

function defaultSurfaces() {
  const {
    getMainWindow,
    getHarnessWebContents,
    getHarnessOrigin,
    getLauncherWindow,
  } = require('./window');
  const mainWindow = getMainWindow();
  const launcherWindow = getLauncherWindow();
  return {
    boot: mainWindow && !mainWindow.isDestroyed() ? mainWindow.webContents : null,
    harness: getHarnessWebContents(mainWindow),
    harnessOrigin: getHarnessOrigin(),
    launcher: launcherWindow && !launcherWindow.isDestroyed() ? launcherWindow.webContents : null,
  };
}

function ipcSenderRole(event, options = {}) {
  const sender = event?.sender;
  const frame = event?.senderFrame;
  if (!sender || !frame || frame !== sender.mainFrame || typeof frame.url !== 'string') {
    return null;
  }

  const surfaces = options.surfaces || defaultSurfaces();
  const bootUrl = options.isBootUrl || isLocalAppNavigationUrl;
  const harnessUrl = options.isHarnessUrl || isSameOriginLoopbackUrl;
  const launcherUrl = options.isLauncherUrl || isLauncherNavigationUrl;

  if (sender === surfaces.boot && bootUrl(frame.url)) {
    return IPC_ROLES.BOOT;
  }
  if (sender === surfaces.harness && harnessUrl(frame.url, surfaces.harnessOrigin)) {
    return IPC_ROLES.HARNESS;
  }
  if (sender === surfaces.launcher && launcherUrl(frame.url)) {
    return IPC_ROLES.LAUNCHER;
  }
  return null;
}

function assertIpcSender(event, allowedRoles, options) {
  const allowed = allowedRoles instanceof Set ? allowedRoles : new Set(allowedRoles || []);
  const role = ipcSenderRole(event, options);
  if (!role || !allowed.has(role)) {
    const error = new Error('Unauthorized IPC sender');
    error.code = 'ERR_DSH_IPC_SENDER';
    throw error;
  }
  return role;
}

module.exports = { IPC_ROLES, ipcSenderRole, assertIpcSender };
