'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeRemotePatch } = require('./remote-patch');

test('normalizeRemotePatch persists relay TLS beside the normalized endpoint input', () => {
  assert.deepEqual(
    normalizeRemotePatch({ remoteRelayUrl: 'https://relay.example.com:443/path' }),
    {
      remoteRelayUrl: 'https://relay.example.com:443/path',
      remoteRelayUseTls: true,
    },
  );
  assert.deepEqual(
    normalizeRemotePatch({ remoteRelayUrl: 'ayase.cn:443' }),
    {
      remoteRelayUrl: 'ayase.cn:443',
      remoteRelayUseTls: true,
    },
  );
  assert.deepEqual(
    normalizeRemotePatch({ remoteRelayUrl: 'relay.example.com:8411' }),
    { remoteRelayUrl: 'relay.example.com:8411', remoteRelayUseTls: false },
  );
});

test('normalizeRemotePatch does not let the renderer set relay TLS independently', () => {
  assert.throws(
    () => normalizeRemotePatch({ remoteRelayUseTls: true }),
    /not renderer-writable/,
  );
});
