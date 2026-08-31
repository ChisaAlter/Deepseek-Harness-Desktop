import test from 'node:test';
import assert from 'node:assert/strict';
import { hostCall, unwrapHost } from './backend.js';

test('hostCall uses client.hostRpc and throws harness-down copy', async () => {
  const calls = [];
  const client = {
    async hostRpc(method, payload) {
      calls.push([method, payload]);
      return { ok: true, value: { items: [1] } };
    },
  };
  const value = await hostCall(client, 'session.list', {});
  assert.deepEqual(value, { items: [1] });
  assert.deepEqual(calls, [['session.list', {}]]);
});

test('hostCall surfaces business errors and missing client method', async () => {
  await assert.rejects(
    () => hostCall({
      async hostRpc() {
        return { ok: false, error: { message: 'session-not-found' } };
      },
    }, 'session.history', {}),
    /session-not-found/,
  );
  await assert.rejects(
    () => hostCall({}, 'session.list', {}),
    /桌面端未启动|hostRpc/,
  );
});

test('unwrapHost maps ok:false error strings', () => {
  assert.equal(unwrapHost({ ok: true, value: 3 }), 3);
  assert.throws(() => unwrapHost({ ok: false, error: 'nope' }), /nope/);
});

test('gitCall unwraps nested git.js { ok:false, message }', async () => {
  const { gitCall } = await import('./backend.js');
  await assert.rejects(
    () => gitCall({
      async gitRpc() {
        return { ok: true, value: { ok: false, message: 'Git status is unavailable.' } };
      },
    }, 'git-status', 'C:\\'),
    /unavailable/,
  );
});
