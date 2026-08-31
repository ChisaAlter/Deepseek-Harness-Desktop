'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  HOST_RPC_METHODS,
  isAllowedHostMethod,
  assertLoopbackHarnessOrigin,
  forwardHostRpc,
  forwardHostRespond,
  HARNESS_DOWN_MESSAGE,
  slimHostRpcValue,
} = require('./dshd-host-tunnel');

test('allowlist includes session/workspace/host browse and excludes privileged methods', () => {
  assert.equal(isAllowedHostMethod('session.list'), true);
  assert.equal(isAllowedHostMethod('session.selectModel'), true);
  assert.equal(isAllowedHostMethod('workspace.archiveSession'), true);
  assert.equal(isAllowedHostMethod('host.listDirectory'), true);
  assert.equal(isAllowedHostMethod('host.createDirectory'), true);
  assert.equal(isAllowedHostMethod('host.pickDirectory'), false);
  assert.equal(isAllowedHostMethod('host.openPath'), false);
  assert.equal(isAllowedHostMethod('settings.describe'), false);
  assert.equal(isAllowedHostMethod('credentials.set'), false);
  assert.equal(isAllowedHostMethod('llm.discoverModels'), false);
  assert.equal(isAllowedHostMethod('mcpServers/list'), false);
  assert.equal(isAllowedHostMethod('commands/list'), true);
  assert.equal(isAllowedHostMethod('commands/execute'), true);
  assert.equal(HOST_RPC_METHODS.has('session.prompt'), true);
});

test('assertLoopbackHarnessOrigin rejects empty, non-http, and non-loopback origins', () => {
  assert.throws(() => assertLoopbackHarnessOrigin(''), /桌面端未启动/);
  assert.throws(() => assertLoopbackHarnessOrigin('https://127.0.0.1:3080'), /loopback/);
  assert.throws(() => assertLoopbackHarnessOrigin('http://example.com:3080'), /loopback/);
  assert.throws(() => assertLoopbackHarnessOrigin('http://192.168.1.2:3080'), /loopback/);
  assert.equal(assertLoopbackHarnessOrigin('http://127.0.0.1:3080'), 'http://127.0.0.1:3080');
  assert.equal(assertLoopbackHarnessOrigin('http://localhost:3080/'), 'http://localhost:3080');
});

test('forwardHostRpc rejects methods outside the allowlist without calling fetch', async () => {
  let called = 0;
  await assert.rejects(
    () => forwardHostRpc({
      origin: 'http://127.0.0.1:3080',
      method: 'settings.describe',
      payload: {},
      fetchImpl: async () => {
        called += 1;
        return new Response('{}');
      },
    }),
    /不允许/,
  );
  assert.equal(called, 0);
});

test('forwardHostRpc pins Host, strips Origin/Referer/Cookie/sec-fetch, and refuses gzip', async () => {
  /** @type {Request | null} */
  let seen = null;
  const result = await forwardHostRpc({
    origin: 'http://127.0.0.1:3080',
    method: 'session.list',
    payload: { cursor: 'x' },
    fetchImpl: async (url, init) => {
      seen = new Request(url, init);
      return new Response(JSON.stringify({
        type: 'server-response',
        rpcId: JSON.parse(init.body).rpcId,
        result: { ok: true, value: { items: [] } },
      }), { headers: { 'content-type': 'application/json' } });
    },
  });
  assert.equal(result.ok, true);
  assert.ok(seen);
  assert.equal(new URL(seen.url).pathname, '/api/session.list');
  assert.equal(seen.headers.get('host'), '127.0.0.1:3080');
  assert.equal(seen.headers.get('origin'), null);
  assert.equal(seen.headers.get('referer'), null);
  assert.equal(seen.headers.get('cookie'), null);
  assert.equal(seen.headers.get('sec-fetch-site'), null);
  assert.equal(seen.headers.get('accept-encoding'), 'identity');
  const body = JSON.parse(await seen.clone().text());
  assert.equal(body.type, 'client-request');
  assert.equal(body.method, 'session.list');
  assert.equal(body.payload.cursor, 'x');
});

test('forwardHostRpc posts Typert commands/execute under /api/commands/execute', async () => {
  /** @type {Request | null} */
  let seen = null;
  const result = await forwardHostRpc({
    origin: 'http://127.0.0.1:3080',
    method: 'commands/execute',
    payload: { args: { agentId: 's1', line: '/permission read-only', images: [] } },
    fetchImpl: async (url, init) => {
      seen = new Request(url, init);
      return new Response(JSON.stringify({
        type: 'server-response',
        rpcId: JSON.parse(init.body).rpcId,
        result: { ok: true, value: { commandId: 'cmd-1', result: { kind: 'success' } } },
      }), { headers: { 'content-type': 'application/json' } });
    },
  });
  assert.equal(result.ok, true);
  assert.equal(result.value.commandId, 'cmd-1');
  assert.ok(seen);
  assert.equal(new URL(seen.url).pathname, '/api/commands/execute');
  const commandBody = JSON.parse(await seen.clone().text());
  assert.equal(commandBody.method, 'commands/execute');
  assert.equal(commandBody.payload.args.line, '/permission read-only');
  assert.deepEqual(commandBody.payload.args.images, []);
});

test('forwardHostRpc fails visibly when harness origin is empty', async () => {
  await assert.rejects(
    () => forwardHostRpc({ origin: '', method: 'session.list', payload: {} }),
    new RegExp(HARNESS_DOWN_MESSAGE),
  );
});

test('forwardHostRespond posts /api/respond without browser Origin', async () => {
  /** @type {Request | null} */
  let seen = null;
  await forwardHostRespond({
    origin: 'http://127.0.0.1:3099',
    rpcId: 'rpc-1',
    value: { sessionId: 's', approvalId: 'a', outcome: 'allowed-once' },
    fetchImpl: async (url, init) => {
      seen = new Request(url, init);
      return new Response(JSON.stringify({ type: 'rpc-receipt', rpcId: 'rpc-1' }), {
        headers: { 'content-type': 'application/json' },
      });
    },
  });
  assert.ok(seen);
  assert.equal(new URL(seen.url).pathname, '/api/respond');
  assert.equal(seen.headers.get('origin'), null);
  assert.equal(seen.headers.get('host'), '127.0.0.1:3099');
  const body = JSON.parse(await seen.clone().text());
  assert.equal(body.type, 'client-response');
  assert.equal(body.rpcId, 'rpc-1');
});

test('slimHostRpcValue drops assistant/chunk from session.history', () => {
  const value = {
    hasMore: true,
    events: [
      { event: { type: 'user/message', seq: 1 } },
      { event: { type: 'assistant/chunk', seq: 2 } },
      { event: { type: 'assistant/chunk', seq: 3 } },
      { event: { type: 'assistant/message', seq: 4 } },
    ],
  };
  const slim = slimHostRpcValue('session.history', value);
  assert.deepEqual(slim.events.map((entry) => entry.event.type), ['user/message', 'assistant/message']);
  assert.equal(slim.hasMore, true);
  assert.equal(slimHostRpcValue('session.list', value), value);
});

test('forwardHostRpc slims session.history before returning to the phone', async () => {
  const result = await forwardHostRpc({
    origin: 'http://127.0.0.1:3080',
    method: 'session.history',
    payload: { sessionId: 's1', maxMessages: 50 },
    fetchImpl: async (_url, init) => {
      const rpcId = JSON.parse(init.body).rpcId;
      return new Response(JSON.stringify({
        type: 'server-response',
        rpcId,
        result: {
          ok: true,
          value: {
            hasMore: false,
            events: [
              { event: { type: 'assistant/chunk', seq: 1 } },
              { event: { type: 'assistant/message', seq: 2 } },
            ],
          },
        },
      }), { headers: { 'content-type': 'application/json' } });
    },
  });
  assert.equal(result.ok, true);
  assert.deepEqual(result.value.events.map((entry) => entry.event.type), ['assistant/message']);
});
