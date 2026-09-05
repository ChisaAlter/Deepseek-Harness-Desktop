import test from 'node:test';
import assert from 'node:assert/strict';
import * as realApi from './daemon-client.bundle.js';
import { pairFromOfferUrl, reconnectSticky, saveSecret } from './session.js';

async function assertConnectionTimeout(mode) {
  const bag = new Map();
  const previousStorage = globalThis.localStorage;
  globalThis.localStorage = {
    getItem: (key) => bag.get(key) ?? null,
    setItem: (key, value) => bag.set(key, value),
  };
  saveSecret('srv_unresponsive', {
    deviceId: 'dev_test', deviceSecret: 'a'.repeat(64),
    daemonPublicKeyB64: Buffer.alloc(32, 1).toString('base64'),
    relayEndpoint: 'relay.example:8411', useTls: false,
  });
  let client;
  let deadline;
  const api = {
    ...realApi,
    parseConnectionOfferFromUrl: () => ({
      serverId: 'srv_unresponsive',
      daemonPublicKeyB64: Buffer.alloc(32, 1).toString('base64'),
      relay: { endpoint: 'relay.example:8411', useTls: false },
      authBootstrap: { pairingToken: 'token_test' },
    }),
    DaemonClient: class extends realApi.DaemonClient {
      constructor(options) {
        super({
          ...options, connectTimeoutMs: 10,
          transportFactory: () => ({
            send() {}, close() {},
            onOpen: () => () => {}, onClose: () => () => {},
            onError: () => () => {}, onMessage: () => () => {},
          }),
        });
        client = this;
      }
    },
  };
  try {
    const connection = mode === 'saved computer'
      ? reconnectSticky(api, 'srv_unresponsive')
      : pairFromOfferUrl(api, 'http://example/#offer=test');
    const result = await Promise.race([
      connection.then(() => 'connected', (error) => error.message),
      new Promise((resolve) => { deadline = setTimeout(() => resolve('still waiting for pairing'), 150); }),
    ]);
    assert.notEqual(result, 'still waiting for pairing');
    assert.match(result, /timed out/i);
    let status;
    const unsubscribe = client.subscribeConnectionStatus((state) => { status = state.status; });
    unsubscribe();
    assert.equal(status, 'disposed');
  } finally {
    clearTimeout(deadline);
    await client?.close();
    globalThis.localStorage = previousStorage;
  }
}

for (const mode of ['saved computer', 'pairing offer']) {
  test(`${mode} timeout settles and closes the abandoned client`, () => assertConnectionTimeout(mode));
}

test('automatic reconnect after pairing uses the issued device secret, never the consumed token', async () => {
  const previousStorage = globalThis.localStorage;
  const bag = new Map();
  globalThis.localStorage = { getItem: (key) => bag.get(key) ?? null, setItem: (key, value) => bag.set(key, value) };
  const hellos = [];
  const sockets = [];
  let resumed;
  let timer;
  let client;
  const secondHello = new Promise((resolve) => { resumed = resolve; });
  const publicKey = Buffer.alloc(32, 1).toString('base64');
  const api = {
    ...realApi,
    buildRelayWebSocketUrl: () => 'ws://test',
    parseConnectionOfferFromUrl: () => ({
      serverId: 'srv_reconnect', daemonPublicKeyB64: publicKey,
      relay: { endpoint: 'relay:8411', useTls: false },
      authBootstrap: { pairingToken: 'once-only', expiresAtMs: Date.now() + 60000 },
    }),
    DaemonClient: class extends realApi.DaemonClient {
      constructor(options) {
        super({
          ...options, reconnect: { ...options.reconnect, baseDelayMs: 1 },
          transportFactory: () => {
            const handlers = {};
            const index = sockets.length;
            sockets.push(handlers);
            return {
              onOpen: (fn) => { queueMicrotask(fn); return () => {}; },
              onMessage: (fn) => { handlers.message = fn; return () => {}; },
              onClose: (fn) => { handlers.close = fn; return () => {}; },
              onError: () => () => {}, close() {},
              getRelaySecurityContext: () => ({ clientPublicKeyB64: publicKey, authChallenge: `challenge-${index}` }),
              send(raw) {
                const hello = JSON.parse(raw);
                if (hello.type !== 'hello') return;
                hellos.push(hello);
                queueMicrotask(() => {
                  if (index === 0) handlers.message(JSON.stringify({
                    type: 'relay_device_auth_result', ok: true,
                    deviceId: options.relayDeviceAuth.deviceId, deviceSecret: 'a'.repeat(64),
                  }));
                  handlers.message(JSON.stringify({ type: 'session', message: {
                    type: 'status', payload: { status: 'server_info', serverId: 'srv_reconnect' },
                  } }));
                  if (index === 1) resumed();
                });
              },
            };
          },
        });
        client = this;
      }
    },
  };
  try {
    await pairFromOfferUrl(api, 'http://example/#offer=test');
    sockets[0].close({ code: 1006, reason: 'network changed' });
    await Promise.race([secondHello, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('reconnect did not occur')), 1000); })]);
    assert.equal(hellos[0].relayDeviceAuth.pairingToken, 'once-only');
    assert.equal(hellos[1].relayDeviceAuth.pairingToken, undefined);
    assert.equal(typeof hellos[1].relayDeviceAuth.proof, 'string');
  } finally {
    clearTimeout(timer);
    await client?.close();
    globalThis.localStorage = previousStorage;
  }
});
