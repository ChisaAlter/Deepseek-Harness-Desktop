import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createServer } from 'node:http';
import { once } from 'node:events';
import WebSocket, { WebSocketServer } from 'ws';
import { HarnessClient } from './src/channels/shared/harness-client.mjs';
import { createModernHarnessTransport } from './plugin-src/host/harness-modern-transport.mjs';

async function fixture(t, interactionKind) {
  const records = [];
  const subscriptions = new Map();
  const results = [];
  let requestId;
  let eventSerial = 0;
  const item = (ws, streamId, value) => ws.send(JSON.stringify({ type: 'item', streamId, value }));
  function append(type, data) {
    const entry = { type: 'event', event: { seq: records.length, time: Date.now(), type, data } };
    records.push(entry);
    for (const [ws, streams] of subscriptions) for (const [id, stream] of streams) {
      if (stream.endpoint === 'session/follow' && ws.readyState === 1) item(ws, id, entry);
    }
  }
  function finishTurn() {
    append('assistant/message', { turn: 1, message: { content: [{ type: 'text', text: 'verified reply' }] } });
    append('turn/end', { turn: 1, reason: 'completed' });
  }
  const server = createServer(async (req, res) => {
    if (req.headers.cookie !== 'test=authenticated') return res.writeHead(401).end();
    let text = '';
    for await (const chunk of req) text += chunk;
    const request = JSON.parse(text);
    const { rpcId, method, payload } = request;
    assert.equal(req.url, `/api/${method}`);
    assert.ok(payload.args);
    let value = {};
    if (method === 'session/prompt') {
      requestId = payload.args.request.requestId;
      assert.equal(requestId, rpcId);
      append('turn/start', { turn: 1 });
      append('user/message', { turn: 1, source: { kind: 'user', rpcId: requestId } });
      append('tool/call', { turn: 1, name: 'test-tool', callId: 'call-1', arguments: { test: true } });
      if (!interactionKind) finishTurn();
      else if (interactionKind !== 'hold') for (const [ws, streams] of subscriptions) for (const [id, stream] of streams) {
        if (stream.endpoint !== '$events' || ws.readyState !== 1) continue;
        item(ws, id, { type: 'waterfall', eventId: 'decision-1', agentId: 'session-1',
          event: interactionKind === 'approval' ? 'approval/request' : 'user-questions/request',
          request: interactionKind === 'approval' ? { toolName: 'test-tool', callId: 'call-1' }
            : { questions: [{ id: 'q1', question: 'Continue?' }] },
        });
      }
      value = { accepted: true };
    } else if (method === '$events/result') {
      results.push(payload.args);
      if (payload.args.outcome.kind === 'result') finishTurn();
    } else if (method === 'session/cancel') {
      assert.deepEqual(payload.args.request, { sessionId: 'session-1' });
      finishTurn();
    } else if (method === 'session/modelCatalog') {
      value = { groups: [], failures: [], default: { provider: 'mock', model: 'mock' }, routableProviders: ['mock'] };
    } else return res.writeHead(404).end();
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ type: 'server-response', rpcId, result: { ok: true, value } }));
  });
  const wss = new WebSocketServer({ noServer: true });
  server.on('upgrade', (req, socket, head) => {
    if (req.url !== '/api/remote.mux' || req.headers.cookie !== 'test=authenticated') return socket.destroy();
    wss.handleUpgrade(req, socket, head, (ws) => {
      const streams = new Map();
      subscriptions.set(ws, streams);
      ws.on('close', () => subscriptions.delete(ws));
      ws.on('message', (data) => {
        const frame = JSON.parse(String(data));
        if (frame.type === 'cancel') { streams.delete(frame.streamId); return; }
        streams.set(frame.streamId, frame);
        if (frame.endpoint === '$events') item(ws, frame.streamId, { type: 'ready', clientId: `client-${++eventSerial}`, host: { home: '/test' } });
        else if (frame.endpoint === 'session/follow') item(ws, frame.streamId, {
          type: 'snapshot', records, cursor: records.length - 1, hasMore: false,
          projections: { values: { modelSelection: { next: { provider: 'mock', model: 'mock' } } } },
        });
        else if (frame.endpoint === 'workspace/follow') item(ws, frame.streamId, { type: 'baseline', value: { items: [], archivedSessionIds: [] } });
      });
    });
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => { for (const ws of wss.clients) ws.terminate(); wss.close(); server.close(); });
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  const transport = createModernHarnessTransport({ baseUrl,
    fetchImpl: (url, options) => fetch(url, { ...options, headers: { ...options.headers, cookie: 'test=authenticated' } }),
    createWebSocket: (url) => new WebSocket(url, { headers: { cookie: 'test=authenticated' } }),
  });
  return { harness: new HarnessClient({ baseUrl, ...transport }), transport, results, subscriptions };
}

for (const kind of [undefined, 'approval', 'question']) {
  test(`modern IM prompt, ownership, ${kind ?? 'reply'} and history round trip`, { timeout: 8_000 }, async (t) => {
    const { harness, results } = await fixture(t, kind);
    let interactions = 0;
    const answer = await harness.ask('session-1', 'test', {
      signal: AbortSignal.timeout(5_000),
      onInteraction: kind ? async (interaction) => {
        interactions++;
        assert.equal(interaction.kind, kind);
        assert.equal(interaction.recovered, false);
        if (kind === 'approval') assert.equal(interaction.toolCall.name, 'test-tool');
        await interaction.respond({ ok: true, value: kind === 'approval'
          ? { sessionId: 'session-1', approvalId: 'decision-1', outcome: 'allowed-once' }
          : { sessionId: 'session-1', answer: { answers: [{ id: 'q1', selected: [], custom: 'yes' }] } },
        });
      } : undefined,
    });
    assert.equal(answer, 'verified reply');
    assert.equal(interactions, kind ? 1 : 0);
    if (kind) assert.deepEqual(results[0].outcome, { kind: 'result', value: kind === 'approval'
      ? 'allowed-once' : { answers: [{ id: 'q1', selected: [], custom: 'yes' }] } });
  });
}

test('modern transport validates origin and preserves cancellation', async (t) => {
  const { transport, harness } = await fixture(t);
  await assert.rejects(transport.fetchImpl('http://example.com/api/session.list'), /Unexpected Harness origin/);
  assert.throws(() => transport.createWebSocket('ws://example.com/api/events.mux'), /Unexpected Harness origin/);
  await assert.rejects(harness.health({ signal: AbortSignal.abort(new Error('cancelled')) }), /cancelled/);
  assert.equal((await harness.getSessionModels('session-1')).routable, true);
});

test('modern stop cancels only the IM caller owning the active turn', { timeout: 8_000 }, async (t) => {
  const { harness } = await fixture(t, 'hold');
  const control = { owner: {}, key: 'chat-1' };
  let markStarted;
  const started = new Promise((resolve) => { markStarted = resolve; });
  const reply = harness.ask('session-1', 'test', {
    control, signal: AbortSignal.timeout(5_000), onUpdate: markStarted,
  });
  await started;
  assert.equal(await harness.stopActiveTurn('session-1', { owner: {}, key: 'chat-2' }), false);
  assert.equal(await harness.stopActiveTurn('session-1', control), true);
  assert.equal(await reply, 'verified reply');
});
