'use strict';

/**
 * Microphone access belongs to the primary harness frame and the OS.
 * Ported from upstream apps/desktop/microphone-permissions.ts; the trusted
 * frame check targets our loopback origin instead of dsh-app://.
 */

function isHarnessOrigin(url) {
  try {
    const parsed = new URL(url);
    return (parsed.protocol === 'http:' || parsed.protocol === 'https:')
      && (parsed.hostname === '127.0.0.1' || parsed.hostname === 'localhost');
  } catch {
    return false;
  }
}

/**
 * Narrow `media` permission to the primary harness view's main frame, audio
 * only; every other permission keeps Electron's defaults.
 * @param {any} ses - the session hosting the harness view (defaultSession).
 * @param {() => any} primary - current primary harness webContents, or undefined.
 * @param {any} [systemPreferences]
 */
function installMediaPermissions(ses, primary, systemPreferences) {
  const darwinAccess = () => process.platform !== 'darwin'
    || (systemPreferences && systemPreferences.getMediaAccessStatus('microphone') === 'granted');
  ses.setPermissionCheckHandler((contents, permission, origin, details) => {
    if (permission !== 'media') return true;
    return contents != null && contents === primary() && details.isMainFrame
      && isHarnessOrigin(origin) && details.mediaType === 'audio'
      && darwinAccess();
  });
  ses.setPermissionRequestHandler((contents, permission, callback, details) => {
    if (permission !== 'media') {
      callback(true);
      return;
    }
    const allowed = contents === primary() && details.isMainFrame
      && isHarnessOrigin(details.requestingUrl)
      && 'mediaTypes' in details && details.mediaTypes.length === 1
      && details.mediaTypes[0] === 'audio';
    if (!allowed) {
      callback(false);
      return;
    }
    if (process.platform !== 'darwin' || !systemPreferences) {
      callback(true);
      return;
    }
    void systemPreferences.askForMediaAccess('microphone').then(callback, () => callback(false));
  });
}

module.exports = { installMediaPermissions, isHarnessOrigin };
