'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { consumeSse, openMuxSse, shouldForwardMuxEnvelope } = require('./dshd-mux-sse');

test('consumeSse reads data: JSON and keeps a partial tail', () => {
  const first = consumeSse([
    ': connected',
    '',
    'data: {"type":"server-request","rpcId":"r1","payload":{"type":"approval/requested","sessionId":"s1","approvalId":"a1","toolName":"bash"}}',
    '',
    'data: {"type":"not-a-request"}',
    '',
    'data: {"type":"server-request","rpcId":"r2","payload":{"type":"host/session-status","sessionId":"s1","running":true}}',
    '',
    'data: {"type":"server-request","rpcId":"partial"',
  ].join('\n'));
  assert.equal(first.envelopes.length, 2);
  assert.equal(first.envelopes[0].payload.type, 'approval/requested');
  assert.equal(first.envelopes[1].payload.running, true);
  assert.match(first.rest, /partial/);
});

test('openMuxSse fetches /api/events.mux as SSE and emits envelopes', async () => {
  const chunks = [
    ': connected\n\n',
    'data: {"type":"server-request","rpcId":"r9","payload":{"type":"approval/requested","sessionId":"s","approvalId":"a","toolName":"pwsh"}}\n\n',
  ];
  let i = 0;
  const stream = new ReadableStream({
    pull(controller) {
      if (i >= chunks.length) {
        controller.close();
        return;
      }
      controller.enqueue(new TextEncoder().encode(chunks[i]));
      i += 1;
    },
  });
  const seen = [];
  await openMuxSse({
    origin: 'http://127.0.0.1:3080',
    onEnvelope: (envelope) => seen.push(envelope),
    fetchImpl: async (href, init) => {
      assert.equal(new URL(href).pathname, '/api/events.mux');
      assert.equal(init.headers.accept, 'text/event-stream');
      return { ok: true, body: stream };
    },
  });
  assert.equal(seen.length, 1);
  assert.equal(seen[0].rpcId, 'r9');
  assert.equal(seen[0].payload.toolName, 'pwsh');
});

test('shouldForwardMuxEnvelope drops assistant/chunk session events and keeps approvals', () => {
  assert.equal(shouldForwardMuxEnvelope({
    type: 'server-request',
    rpcId: 'r-chunk',
    payload: { type: 'session/event', sessionId: 's1', event: { type: 'assistant/chunk' } },
  }), false);
  assert.equal(shouldForwardMuxEnvelope({
    type: 'server-request',
    rpcId: 'r-ask',
    payload: {
      type: 'approval/requested',
      sessionId: 's1',
      approvalId: 'a1',
      toolName: 'pwsh',
    },
  }), true);
  assert.equal(shouldForwardMuxEnvelope({
    type: 'server-request',
    rpcId: 'r-tool',
    payload: { type: 'session/event', sessionId: 's1', event: { type: 'tool/call' } },
  }), true);
});
