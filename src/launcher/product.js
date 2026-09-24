'use strict';

// Which product this process is: today's single Electron build is the full
// desktop app (launcher rides inside it); the slim launcher package is marked
// by `dshdPackage: 'launcher'` in its packaged package.json (electron-builder
// extraMetadata). `DSHD_LAUNCHER_PACKAGE=1` forces the slim behavior for dev
// verification before the slim packaging target exists.
const { DESKTOP_TARGET } = require('./install-detect');

let cachedFlavor;

function readPackageFlag() {
  try {
    // Resolves to the packaged app's package.json inside asar, where
    // electron-builder has already applied extraMetadata.
    const pkg = require('../../package.json');
    return pkg && pkg.dshdPackage === 'launcher';
  } catch {
    return false;
  }
}

function isLauncherPackage() {
  if (cachedFlavor === undefined) {
    cachedFlavor = process.env.DSHD_LAUNCHER_PACKAGE === '1' || readPackageFlag();
  }
  return Boolean(cachedFlavor);
}

// Which product the launcher manages: the desktop identity for the slim
// package, self for the full package (undefined keeps install-detect defaults).
function runtimeTarget() {
  return isLauncherPackage() ? DESKTOP_TARGET : undefined;
}

// The slim launcher keeps its OWN userData (its own config.json and its own
// single-instance lock — Electron's lock mutex derives from the userData
// path, so sharing the directory would make the launcher and the runtime
// mutually exclusive). What must be shared is pointed at the desktop home
// explicitly instead.
function desktopUserDataDir(app) {
  const path = require('path');
  return path.join(app.getPath('appData'), DESKTOP_TARGET.productName);
}

// Where launcher-visible desktop state lives: last-desktop-start.json and
// the import journal are written/read against the runtime's home so both
// processes see one truth; the full package resolves to its own userData.
function desktopStateDir(app) {
  return isLauncherPackage() ? desktopUserDataDir(app) : app.getPath('userData');
}

module.exports = {
  isLauncherPackage,
  runtimeTarget,
  desktopUserDataDir,
  desktopStateDir,
};
