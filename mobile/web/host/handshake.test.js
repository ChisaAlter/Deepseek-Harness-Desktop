import test from 'node:test';
import assert from 'node:assert/strict';
import { handshake } from './handshake.js';

test('handshake describes then lists before opening sockets', async () => {
  const order = [];
  const call = async (method) => {
    order.push(method);
    if (method === 'host.describe') return { ok: true, value: { version: '1', cwd: '/tmp' } };
    if (method === 'session.list') return { ok: true, value: { items: [{ sessionId: 's1', blank: true, running: false, updatedAt: 1 }] } };
    if (method === 'workspace.list') return { ok: true, value: { items: [] } };
    throw new Error(method);
  };
  const connected = await handshake({
    call,
    connectEvents: async () => { order.push('events'); },
  });
  assert.deepEqual(order.slice(0, 3).sort(), ['host.describe', 'session.list', 'workspace.list'].sort());
  assert.equal(order[0], 'host.describe');
  assert.equal(order.at(-1), 'events');
  assert.equal(connected.host.cwd, '/tmp');
  assert.equal(connected.sessions.items[0].sessionId, 's1');
});

test('handshake does not open sockets when describe fails', async () => {
  let events = 0;
  await assert.rejects(() => handshake({
    call: async (method) => {
      if (method === 'host.describe') return { ok: false, error: { code: 'bad-request', message: 'nope' } };
      return { ok: true, value: {} };
    },
    connectEvents: async () => { events += 1; },
  }));
  assert.equal(events, 0);
});
