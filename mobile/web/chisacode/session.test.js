import test from 'node:test';
import assert from 'node:assert/strict';
import {
  agentRows,
  buildClientRelayUrl,
  normalizeOfferUrl,
  pairFromOfferUrl,
  reconnectSticky,
  savedComputerRows,
} from './session.js';

if (!globalThis.localStorage) {
  const bag = new Map();
  globalThis.localStorage = {
    getItem: (key) => (bag.has(key) ? bag.get(key) : null),
    setItem: (key, value) => { bag.set(key, String(value)); },
    removeItem: (key) => { bag.delete(key); },
  };
}

test('buildClientRelayUrl always passes role=client and useTls===true only', () => {
  const calls = [];
  const api = {
    buildRelayWebSocketUrl(params) {
      calls.push(params);
      const proto = params.useTls ? 'wss' : 'ws';
      return `${proto}://${params.endpoint}/ws?role=${params.role}&serverId=${params.serverId}`;
    },
  };

  const clear = buildClientRelayUrl(api, {
    endpoint: '125.124.85.212:8411',
    useTls: false,
    serverId: 'srv_1',
  });
  assert.equal(calls[0].role, 'client');
  assert.equal(calls[0].useTls, false);
  assert.match(clear, /^ws:\/\//);
  assert.match(clear, /role=client/);

  const tls = buildClientRelayUrl(api, {
    endpoint: 'relay.example.com:443',
    useTls: true,
    serverId: 'srv_2',
  });
  assert.equal(calls[1].role, 'client');
  assert.equal(calls[1].useTls, true);
  assert.match(tls, /^wss:\/\//);
});

test('buildClientRelayUrl treats truthy-but-not-true useTls as false', () => {
  const calls = [];
  const api = {
    buildRelayWebSocketUrl(params) {
      calls.push(params);
      return 'ws://x';
    },
  };
  buildClientRelayUrl(api, { endpoint: 'h:1', useTls: 'yes', serverId: 's' });
  assert.equal(calls[0].useTls, false);
  assert.equal(calls[0].role, 'client');
});

test('reconnectSticky uses role=client and stored useTls', async () => {
  const SECRET_KEY = 'dsh-chisacode-device-secrets';
  localStorage.setItem(SECRET_KEY, JSON.stringify({
    srv_test: {
      deviceId: 'dev_1',
      deviceSecret: 'x'.repeat(64),
      relayEndpoint: '125.124.85.212:8411',
      daemonPublicKeyB64: 'abc',
      useTls: false,
      savedAt: 1,
    },
  }));

  const calls = [];
  class MockDaemonClient {
    constructor(opts) {
      this.opts = opts;
    }

    async connect() {}
  }
  const api = {
    buildRelayWebSocketUrl(params) {
      calls.push(params);
      return 'ws://test/ws';
    },
    DaemonClient: MockDaemonClient,
  };

  await reconnectSticky(api, 'srv_test');

  assert.equal(calls[0].role, 'client');
  assert.equal(calls[0].useTls, false);
  assert.equal(calls[0].serverId, 'srv_test');
});

test('pairFromOfferUrl uses offer v2 bootstrap auth and persists the issued device secret', async () => {
  localStorage.setItem('dsh-chisacode-device-secrets', JSON.stringify({
    srv_pair: {
      deviceId: 'dev_revoked_0000',
      deviceSecret: 'x'.repeat(64),
      daemonPublicKeyB64: 'old-key',
      relayEndpoint: 'old.example:443',
      useTls: true,
    },
  }));
  const relayCalls = [];
  let clientOptions;
  class MockDaemonClient {
    constructor(options) {
      clientOptions = options;
    }

    async connect() {
      clientOptions.onRelayDeviceAuthResult({
        ok: true,
        deviceId: clientOptions.relayDeviceAuth.deviceId,
        deviceSecret: 's'.repeat(64),
      });
    }
  }
  const offer = {
    v: 2,
    serverId: 'srv_pair',
    daemonPublicKeyB64: 'daemon-key',
    authBootstrap: { pairingToken: 'one-time-token' },
    relay: { endpoint: '125.124.85.212:8411', useTls: false },
  };
  const api = {
    parseConnectionOfferFromUrl(value) {
      assert.match(value, /#offer=/);
      return offer;
    },
    createRelayDeviceId: () => 'dev_pair_1234',
    buildRelayWebSocketUrl(params) {
      relayCalls.push(params);
      return 'ws://125.124.85.212:8411/ws?role=client';
    },
    DaemonClient: MockDaemonClient,
  };

  const paired = await pairFromOfferUrl(api, 'http://192.168.1.8:3180/#offer=encoded');

  assert.equal(paired.serverId, 'srv_pair');
  assert.deepEqual(clientOptions.relayDeviceAuth, {
    version: 1,
    serverId: 'srv_pair',
    deviceId: 'dev_revoked_0000',
    pairingToken: 'one-time-token',
  });
  assert.equal(relayCalls[0].role, 'client');
  const saved = JSON.parse(localStorage.getItem('dsh-chisacode-device-secrets'));
  assert.equal(saved.srv_pair.deviceId, 'dev_revoked_0000');
  assert.equal(saved.srv_pair.deviceSecret, 's'.repeat(64));
});

test('pairing works without crypto.randomUUID (http://<lan-ip> is not a secure context)', async () => {
  // Real phone browsers open the pairing page over plain http on a LAN IP —
  // NOT a secure context, so `crypto.randomUUID` does not exist there. Only
  // `getRandomValues` is universally available. This locks the fallback.
  localStorage.removeItem('dsh-chisacode-client-id');
  localStorage.removeItem('dsh-chisacode-device-secrets');
  const realCrypto = globalThis.crypto;
  Object.defineProperty(globalThis, 'crypto', {
    configurable: true,
    value: { getRandomValues: realCrypto.getRandomValues.bind(realCrypto) },
  });
  try {
    let clientOptions;
    class MockDaemonClient {
      constructor(options) {
        clientOptions = options;
      }

      async connect() {
        clientOptions.onRelayDeviceAuthResult({
          ok: true,
          deviceId: clientOptions.relayDeviceAuth.deviceId,
          deviceSecret: 's'.repeat(64),
        });
      }
    }
    const api = {
      parseConnectionOfferFromUrl: () => ({
        v: 2,
        serverId: 'srv_insecure',
        daemonPublicKeyB64: 'daemon-key',
        authBootstrap: { pairingToken: 'one-time-token' },
        relay: { endpoint: '125.124.85.212:8411', useTls: false },
      }),
      createRelayDeviceId: () => 'dev_insecure_1',
      buildRelayWebSocketUrl: () => 'ws://125.124.85.212:8411/ws?role=client',
      DaemonClient: MockDaemonClient,
    };

    const paired = await pairFromOfferUrl(api, 'http://192.168.1.8:3180/#offer=encoded');

    assert.equal(paired.serverId, 'srv_insecure');
    assert.match(clientOptions.clientId, /^mob_[0-9a-f]{16}$/);
  } finally {
    Object.defineProperty(globalThis, 'crypto', { configurable: true, value: realCrypto });
  }
});

test('normalizeOfferUrl accepts full and pasted offer fragments without decoding as v1', () => {
  const current = 'http://192.168.1.8:3180/';
  assert.equal(
    normalizeOfferUrl('#offer=v2-payload', current),
    'http://192.168.1.8:3180/#offer=v2-payload',
  );
  assert.equal(
    normalizeOfferUrl('offer=v2-payload', current),
    'http://192.168.1.8:3180/#offer=v2-payload',
  );
  assert.equal(normalizeOfferUrl('https://example.com/no-offer', current), '');
});

test('savedComputerRows lists complete sticky records most-recent first', () => {
  const complete = {
    deviceId: 'dev_a',
    deviceSecret: 'sec_a',
    daemonPublicKeyB64: 'pk_a',
    relayEndpoint: '192.168.1.8:8411',
  };
  assert.deepEqual(savedComputerRows({
    srv_old: { ...complete, savedAt: 100 },
    srv_new: { ...complete, relayEndpoint: 'relay.lan:8411', savedAt: 200 },
    // Incomplete records cannot reconnect — they must not render as choices.
    srv_broken: { deviceId: 'dev_b', savedAt: 300 },
  }), [
    { serverId: 'srv_new', relayEndpoint: 'relay.lan:8411', savedAt: 200 },
    { serverId: 'srv_old', relayEndpoint: '192.168.1.8:8411', savedAt: 100 },
  ]);
  assert.deepEqual(savedComputerRows({}), []);
  assert.deepEqual(savedComputerRows(undefined), []);
});

test('agentRows maps the upstream directory payload into the mobile session list', () => {
  assert.deepEqual(agentRows({
    entries: [{
      agent: {
        id: 'agent-1',
        title: 'Remote audit',
        status: 'running',
        cwd: '/workspace',
      },
    }],
  }), [{
    sessionId: 'agent-1',
    title: 'Remote audit',
    projections: { values: { title: 'Remote audit' } },
    running: true,
    cwd: '/workspace',
    chisacodeAgent: {
      id: 'agent-1',
      title: 'Remote audit',
      status: 'running',
      cwd: '/workspace',
    },
  }]);
});
