import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { openEventSockets } from './events.js';

class FakeSocket extends EventEmitter {
  constructor(url) {
    super();
    this.url = String(url);
    this.closed = false;
    queueMicrotask(() => this.emit('open'));
  }

  addEventListener(type, fn) {
    this.on(type, fn);
  }

  close() {
    this.closed = true;
    this.emit('close');
  }
}

test('openEventSockets upgrades mux and host after converting http to ws', async () => {
  const sockets = [];
  const WebSocketImpl = function WebSocketImpl(url) {
    const socket = new FakeSocket(url);
    sockets.push(socket);
    return socket;
  };
  const mux = [];
  const host = [];
  const ac = new AbortController();
  await openEventSockets({
    origin: 'http://127.0.0.1:3180',
    WebSocketImpl,
    onMux: (frame) => mux.push(frame),
    onHost: (frame) => host.push(frame),
    signal: ac.signal,
  });
  assert.deepEqual(sockets.map((socket) => socket.url).sort(), [
    'ws://127.0.0.1:3180/api/events.host',
    'ws://127.0.0.1:3180/api/events.mux',
  ].sort());
  const muxSocket = sockets.find((socket) => socket.url.endsWith('/api/events.mux'));
  muxSocket.emit('message', { data: JSON.stringify({
    type: 'server-request',
    rpcId: 'r1',
    method: 'events.mux',
    payload: { type: 'session/event', sessionId: 's1', event: { type: 'user/message', seq: 1, time: 1, data: {} } },
  }) });
  muxSocket.emit('message', { data: 'not-json' });
  assert.equal(mux[0].payload.type, 'session/event');
  ac.abort();
  assert.equal(sockets.every((socket) => socket.closed), true);
});
