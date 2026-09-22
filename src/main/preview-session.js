'use strict';

const crypto = require('node:crypto');
const path = require('node:path');

const PREVIEW_PARTITION_PREFIX = 'persist:dshd-preview-';

/** Permissions granted to preview web content. Not `clipboard-write` or `local-fonts`. */
const ALLOWED_PREVIEW_PERMISSIONS = new Set([
  'clipboard-read',
  'clipboard-sanitized-write',
  'notifications',
  'geolocation',
]);

/** Electron `clearStorageData` storages swept by `clearCookies`. */
const PREVIEW_COOKIE_STORAGES = Object.freeze([
  'cookies',
  'localstorage',
  'indexdb',
  'websql',
  'serviceworkers',
]);

/**
 * Hashed persist partition for a preview scope (session cwd or `'shared'`).
 * @param {string} [scope='shared']
 * @returns {string}
 */
function previewPartitionForScope(scope = 'shared') {
  const digest = crypto.createHash('sha256').update(String(scope), 'utf8').digest('hex').slice(0, 20);
  return `${PREVIEW_PARTITION_PREFIX}${digest}`;
}

const leftoverUaBrand = ['t', '3', 'code'].join('');

/**
 * Strip Electron and leftover migrated-desktop version tokens from a Chromium user-agent.
 * @param {string} userAgent
 * @returns {string}
 */
function stripPreviewUserAgent(userAgent) {
  return String(userAgent)
    .replace(/Electron\/[\d.]+ /, '')
    .replace(new RegExp(String.raw`\s*${leftoverUaBrand}/[\d.]+`), '');
}

/**
 * Apply UA stripping and the preview permission allow-list to one Electron session.
 * Call once per new session; do not stack handlers.
 * @param {import('electron').Session} ses
 */
function configurePreviewSession(ses) {
  ses.setUserAgent(stripPreviewUserAgent(ses.getUserAgent()));
  ses.setPermissionRequestHandler((_webContents, permission, callback) => {
    callback(ALLOWED_PREVIEW_PERMISSIONS.has(permission));
  });
  ses.setPermissionCheckHandler((_webContents, permission) => (
    ALLOWED_PREVIEW_PERMISSIONS.has(permission)
  ));
}

function defaultFromPartition(partition) {
  const { session } = require('electron');
  return session.fromPartition(partition);
}

/**
 * Cache `session.fromPartition` and configure each new session once.
 * @param {(partition: string) => import('electron').Session} [fromPartition]
 * @returns {{
 *   getSession: (scope?: string) => import('electron').Session,
 *   getByPartition: (partition: string) => import('electron').Session,
 *   listSessions: () => import('electron').Session[],
 *   clearCookies: () => Promise<void>,
 *   clearCache: () => Promise<void>,
 * }}
 */
function createPreviewSessionCache(fromPartition = defaultFromPartition) {
  const sessions = new Map();
  function getByPartition(partition) {
    const existing = sessions.get(partition);
    if (existing) return existing;
    const ses = fromPartition(partition);
    configurePreviewSession(ses);
    sessions.set(partition, ses);
    return ses;
  }
  return {
    getSession(scope = 'shared') {
      return getByPartition(previewPartitionForScope(scope));
    },
    getByPartition,
    listSessions() {
      return [...sessions.values()];
    },
    async clearCookies() {
      await Promise.all([...sessions.values()].map((ses) => {
        if (typeof ses.clearStorageData !== 'function') return undefined;
        return ses.clearStorageData({ storages: [...PREVIEW_COOKIE_STORAGES] });
      }));
    },
    async clearCache() {
      await Promise.all([...sessions.values()].map((ses) => {
        if (typeof ses.clearCache !== 'function') return undefined;
        return ses.clearCache();
      }));
    },
  };
}

const sharedPreviewSessions = createPreviewSessionCache();

/**
 * Absolute path to the guest BrowserView preload (pick IPC lands in Task 20).
 * @returns {string}
 */
function previewGuestPreloadPath() {
  return path.join(__dirname, 'preview-guest-preload.js');
}

/**
 * Guest BrowserView webPreferences. Isolation stays on; pick/annotation IPC
 * stays in the preload and is not published on `globalThis`.
 * @param {{ session: unknown, preload?: string }} options
 * @returns {{ sandbox: true, contextIsolation: true, nodeIntegration: false, session: unknown, preload: string }}
 */
function previewGuestWebPreferences(options) {
  return {
    sandbox: true,
    contextIsolation: true,
    nodeIntegration: false,
    session: options.session,
    preload: options.preload ?? previewGuestPreloadPath(),
  };
}

module.exports = {
  PREVIEW_PARTITION_PREFIX,
  PREVIEW_COOKIE_STORAGES,
  ALLOWED_PREVIEW_PERMISSIONS,
  previewPartitionForScope,
  stripPreviewUserAgent,
  configurePreviewSession,
  createPreviewSessionCache,
  previewGuestPreloadPath,
  previewGuestWebPreferences,
  getPreviewSession: (scope = 'shared') => sharedPreviewSessions.getSession(scope),
  previewSessionForPartition: (partition) => sharedPreviewSessions.getByPartition(partition),
  listPreviewSessions: () => sharedPreviewSessions.listSessions(),
  clearPreviewCookies: () => sharedPreviewSessions.clearCookies(),
  clearPreviewCache: () => sharedPreviewSessions.clearCache(),
};
