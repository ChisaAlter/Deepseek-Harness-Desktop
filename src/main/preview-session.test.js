'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const {
  ALLOWED_PREVIEW_PERMISSIONS,
  PREVIEW_PARTITION_PREFIX,
  configurePreviewSession,
  createPreviewSessionCache,
  previewGuestPreloadPath,
  previewGuestWebPreferences,
  previewPartitionForScope,
  stripPreviewUserAgent,
} = require('./preview-session.js');

const leftoverUaBrand = ['t', '3', 'code'].join('');
const BRIEF_UA = `Mozilla/5.0 Electron/43.0.0 ${leftoverUaBrand}/1.0 Safari`;

function fakeSession(ua = BRIEF_UA) {
  let userAgent = ua;
  return {
    requestHandler: null,
    checkHandler: null,
    requestHandlerCount: 0,
    checkHandlerCount: 0,
    storageClears: [],
    cacheClears: 0,
    getUserAgent() {
      return userAgent;
    },
    setUserAgent(next) {
      userAgent = next;
    },
    setPermissionRequestHandler(fn) {
      this.requestHandlerCount += 1;
      this.requestHandler = fn;
    },
    setPermissionCheckHandler(fn) {
      this.checkHandlerCount += 1;
      this.checkHandler = fn;
    },
    clearStorageData(options) {
      this.storageClears.push(options);
      return Promise.resolve();
    },
    clearCache() {
      this.cacheClears += 1;
      return Promise.resolve();
    },
  };
}

test('previewPartitionForScope uses persist:dshd-preview- plus 20 hex chars', () => {
  const partition = previewPartitionForScope('shared');
  assert.equal(partition.startsWith(PREVIEW_PARTITION_PREFIX), true);
  assert.equal(PREVIEW_PARTITION_PREFIX, 'persist:dshd-preview-');
  const digest = partition.slice(PREVIEW_PARTITION_PREFIX.length);
  assert.equal(digest.length, 20);
  assert.match(digest, /^[0-9a-f]{20}$/);
  const expected = crypto.createHash('sha256').update('shared', 'utf8').digest('hex').slice(0, 20);
  assert.equal(digest, expected);
});

test('previewPartitionForScope defaults to shared and differs by scope', () => {
  assert.equal(previewPartitionForScope(), previewPartitionForScope('shared'));
  assert.notEqual(previewPartitionForScope('shared'), previewPartitionForScope('/tmp/proj'));
});

test('stripPreviewUserAgent removes Electron and leftover migrated UA tokens', () => {
  const stripped = stripPreviewUserAgent(BRIEF_UA);
  assert.equal(stripped.includes('Electron/'), false);
  assert.equal(stripped.includes(`${leftoverUaBrand}/`), false);
  assert.equal(stripped, 'Mozilla/5.0 Safari');
});

test('configurePreviewSession strips UA and allow-lists only the four permissions', () => {
  const ses = fakeSession();
  configurePreviewSession(ses);
  assert.equal(ses.getUserAgent().includes('Electron/'), false);
  assert.equal(ses.getUserAgent().includes(`${leftoverUaBrand}/`), false);

  const granted = (name) => {
    let result;
    ses.requestHandler(null, name, (ok) => { result = ok; });
    return result;
  };
  assert.equal(granted('clipboard-read'), true);
  assert.equal(granted('clipboard-sanitized-write'), true);
  assert.equal(granted('notifications'), true);
  assert.equal(granted('geolocation'), true);
  assert.equal(granted('clipboard-write'), false);
  assert.equal(granted('local-fonts'), false);
  assert.equal(ses.checkHandler(null, 'clipboard-sanitized-write'), true);
  assert.equal(ses.checkHandler(null, 'clipboard-write'), false);
  assert.equal(ses.checkHandler(null, 'local-fonts'), false);
  assert.equal(ALLOWED_PREVIEW_PERMISSIONS.has('clipboard-write'), false);
  assert.equal(ALLOWED_PREVIEW_PERMISSIONS.has('local-fonts'), false);
});

test('createPreviewSessionCache configures each partition once', () => {
  const minted = [];
  const cache = createPreviewSessionCache((partition) => {
    const ses = fakeSession();
    minted.push(partition);
    return ses;
  });
  const first = cache.getSession('shared');
  const second = cache.getSession('shared');
  assert.equal(first, second);
  assert.equal(minted.length, 1);
  assert.equal(first.requestHandlerCount, 1);
  assert.equal(first.checkHandlerCount, 1);
  const other = cache.getSession('/tmp/proj');
  assert.notEqual(other, first);
  assert.equal(minted.length, 2);
  assert.equal(other.requestHandlerCount, 1);
});

test('session cache lists sessions and sweeps cookies and cache', async () => {
  const minted = [];
  const cache = createPreviewSessionCache((partition) => {
    const ses = fakeSession();
    minted.push(partition);
    return ses;
  });
  const first = cache.getSession('shared');
  const second = cache.getSession('/tmp/proj');
  assert.equal(cache.listSessions().length, 2);
  assert.equal(cache.listSessions().includes(first), true);
  assert.equal(cache.listSessions().includes(second), true);
  await cache.clearCookies();
  await cache.clearCache();
  for (const ses of cache.listSessions()) {
    assert.deepEqual(ses.storageClears, [{
      storages: ['cookies', 'localstorage', 'indexdb', 'websql', 'serviceworkers'],
    }]);
    assert.equal(ses.cacheClears, 1);
  }
  const empty = createPreviewSessionCache(() => {
    throw new Error('empty cache must not mint');
  });
  await empty.clearCookies();
  await empty.clearCache();
  assert.deepEqual(empty.listSessions(), []);
});

test('previewGuestWebPreferences pin sandbox, isolation, and disable nodeIntegration', () => {
  const ses = fakeSession();
  const prefs = previewGuestWebPreferences({ session: ses });
  assert.equal(prefs.sandbox, true);
  assert.equal(prefs.nodeIntegration, false);
  assert.equal(prefs.contextIsolation, true);
  assert.equal(prefs.session, ses);
  assert.equal(prefs.preload, previewGuestPreloadPath());
  assert.match(prefs.preload, /preview-guest-preload\.js$/);
});
