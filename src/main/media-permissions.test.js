'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { installMediaPermissions, isHarnessOrigin } = require('./media-permissions');
const { systemNotificationsAllowed } = require('./system-notifications');

function fixture(primaryContents = {}, install = installMediaPermissions) {
  let checkHandler;
  let requestHandler;
  const ses = {
    setPermissionCheckHandler(fn) { checkHandler = fn; },
    setPermissionRequestHandler(fn) { requestHandler = fn; },
  };
  install(ses, () => primaryContents, {
    getMediaAccessStatus: () => 'granted',
    askForMediaAccess: async () => true,
  });
  return { checkHandler, requestHandler };
}

test('isHarnessOrigin accepts loopback http(s) only', () => {
  assert.equal(isHarnessOrigin('http://127.0.0.1:3080/'), true);
  assert.equal(isHarnessOrigin('http://localhost:3080/x'), true);
  assert.equal(isHarnessOrigin('https://example.com/'), false);
  assert.equal(isHarnessOrigin('dsh-app://app/'), false);
  assert.equal(isHarnessOrigin('not a url'), false);
});

test('media audio from the primary main frame is allowed; other media denied', async () => {
  const primary = { tag: 'primary' };
  const { checkHandler, requestHandler } = fixture(primary);

  assert.equal(checkHandler(primary, 'media', 'http://127.0.0.1:3080', { isMainFrame: true, mediaType: 'audio' }), true);
  assert.equal(checkHandler(primary, 'media', 'http://127.0.0.1:3080', { isMainFrame: true, mediaType: 'video' }), false);
  assert.equal(checkHandler({ tag: 'other' }, 'media', 'http://127.0.0.1:3080', { isMainFrame: true, mediaType: 'audio' }), false);
  assert.equal(checkHandler(primary, 'media', 'http://127.0.0.1:3080', { isMainFrame: false, mediaType: 'audio' }), false);
  assert.equal(checkHandler(primary, 'media', 'https://evil.example', { isMainFrame: true, mediaType: 'audio' }), false);
  assert.equal(checkHandler(primary, 'clipboard-read', 'https://anything', { isMainFrame: true }), true);

  let grant = await new Promise(resolve => requestHandler(primary, 'media', resolve,
    { isMainFrame: true, requestingUrl: 'http://127.0.0.1:3080', mediaTypes: ['audio'] }));
  assert.equal(grant, true);
  grant = await new Promise(resolve => requestHandler(primary, 'media', resolve,
    { isMainFrame: true, requestingUrl: 'http://127.0.0.1:3080', mediaTypes: ['audio', 'video'] }));
  assert.equal(grant, false);
});

for (const environment of [
  { platform: 'win32', defaultApp: true },
  { platform: 'win32', defaultApp: false },
  { platform: 'linux', defaultApp: true },
  { platform: 'darwin', defaultApp: true },
]) {
  test(`${environment.platform} ${environment.defaultApp ? 'source' : 'package'} notification permission checks and requests agree`, async () => {
    const permissionModule = { exports: {} };
    vm.runInNewContext(fs.readFileSync(path.join(__dirname, 'media-permissions.js'), 'utf8'), {
      module: permissionModule, process: environment, URL,
      require: () => ({ systemNotificationsAllowed: () => systemNotificationsAllowed(environment) }),
    });
    const primary = {};
    const { checkHandler, requestHandler } = fixture(primary, permissionModule.exports.installMediaPermissions);
    const expected = systemNotificationsAllowed(environment);
    assert.equal(checkHandler(primary, 'notifications', 'http://127.0.0.1:3080', {}), expected);
    assert.equal(await new Promise(resolve => requestHandler(primary, 'notifications', resolve, {})), expected);
    assert.equal(checkHandler(primary, 'clipboard-read', 'http://127.0.0.1:3080', {}), true);
    assert.equal(await new Promise(resolve => requestHandler(primary, 'clipboard-read', resolve, {})), true);
    assert.equal(checkHandler(primary, 'media', 'http://127.0.0.1:3080', { isMainFrame: true, mediaType: 'audio' }), true);
    assert.equal(await new Promise(resolve => requestHandler(primary, 'media', resolve,
      { isMainFrame: true, requestingUrl: 'http://127.0.0.1:3080', mediaTypes: ['audio', 'video'] })), false);
  });
}
