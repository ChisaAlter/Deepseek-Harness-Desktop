import test from 'node:test';
import assert from 'node:assert/strict';
import { callUnary, mintRpcId, respond } from './rpc.js';

test('mintRpcId is uuid-shaped without randomUUID', () => {
  const id = mintRpcId();
  assert.match(id, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
});

test('callUnary posts client-request and returns echoed result', async () => {
  const seen = [];
  const fetchImpl = async (url, init) => {
    seen.push({ url: String(url), init });
    const body = JSON.parse(init.body);
    return new Response(JSON.stringify({
      type: 'server-response',
      rpcId: body.rpcId,
      result: { ok: true, value: { version: '1' } },
    }), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  const out = await callUnary({
    fetchImpl, origin: 'http://127.0.0.1:3180', method: 'host.describe', payload: {},
  });
  assert.equal(out.ok, true);
  assert.equal(out.value.version, '1');
  assert.equal(seen[0].url, 'http://127.0.0.1:3180/api/host.describe');
  const sent = JSON.parse(seen[0].init.body);
  assert.equal(sent.type, 'client-request');
  assert.equal(sent.method, 'host.describe');
  assert.equal(seen[0].init.credentials, 'include');
  assert.equal(seen[0].init.headers['content-type'], 'application/json');
});

test('callUnary throws on HTTP failure and surfaces result.ok false', async () => {
  // 传输错误必须携带 status：启动试探对 401 静默、对其他状态报错。
  await assert.rejects(
    () => callUnary({
      fetchImpl: async () => new Response('nope', { status: 502 }),
      origin: 'http://x', method: 'session.list', payload: {},
    }),
    (error) => error.status === 502,
  );
  await assert.rejects(
    () => callUnary({
      fetchImpl: async () => new Response('unauthorized', { status: 401 }),
      origin: 'http://x', method: 'host.describe', payload: {},
    }),
    (error) => error.status === 401,
  );
  const out = await callUnary({
    fetchImpl: async (_url, init) => {
      const body = JSON.parse(init.body);
      return new Response(JSON.stringify({
        type: 'server-response', rpcId: body.rpcId,
        result: { ok: false, error: { code: 'bad-request', message: 'nope', details: { issues: [] } } },
      }));
    },
    origin: 'http://x', method: 'session.list', payload: {},
  });
  assert.equal(out.ok, false);
  assert.equal(out.error.code, 'bad-request');
});

test('respond posts client-response to /api/respond', async () => {
  const seen = [];
  const fetchImpl = async (url, init) => {
    seen.push({ url: String(url), init });
    return new Response(JSON.stringify({ accepted: true }), { status: 200 });
  };
  const receipt = await respond({
    fetchImpl,
    origin: 'http://127.0.0.1:3180',
    rpcId: 'req-1',
    value: { sessionId: 's1', approvalId: 'a1', outcome: 'allowed-once' },
  });
  assert.equal(receipt.accepted, true);
  assert.equal(seen[0].url, 'http://127.0.0.1:3180/api/respond');
  const sent = JSON.parse(seen[0].init.body);
  assert.equal(sent.type, 'client-response');
  assert.equal(sent.rpcId, 'req-1');
  assert.equal(sent.result.ok, true);
  assert.equal(sent.result.value.outcome, 'allowed-once');
});
