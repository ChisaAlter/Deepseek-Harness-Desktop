'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { installMediaPermissions, isHarnessOrigin } = require('./media-permissions');

function fixture(primaryContents = {}) {
  let checkHandler;
  let requestHandler;
  const ses = {
    setPermissionCheckHandler(fn) { checkHandler = fn; },
    setPermissionRequestHandler(fn) { requestHandler = fn; },
  };
  installMediaPermissions(ses, () => primaryContents, {
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
