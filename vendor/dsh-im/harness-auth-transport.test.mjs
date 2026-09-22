import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { test } from 'node:test';
import { WebSocketServer } from 'ws';
import { HarnessClient } from './src/channels/weixin/harness-client.mjs';
import { createHarnessAuthTransport } from './plugin-src/host/harness-auth-transport.mjs';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';

test('transport cookies are accepted by the vendored Harness BrowserAuth', async () => {
  const output = await build({
    entryPoints: [fileURLToPath(new URL('../deepseek-harness/packages/client/connection/src/browser-auth.ts', import.meta.url))],
    bundle: true, platform: 'node', format: 'esm', write: false,
  });
  const { BrowserAuth } = await import(`data:text/javascript;base64,${Buffer.from(output.outputFiles[0].text).toString('base64')}`);
  let record;
  const auth = await BrowserAuth.create({}, {
    async modifyRecord(key, update) { record = await update(record) ?? record; return record; },
  }, 30);
  const transport = createHarnessAuthTransport({ webServer: { port: 3080 }, connection: auth }, 'http://127.0.0.1:3080', {
    fetchImpl(url, options) {
      assert.equal(options.redirect, 'manual');
      assert.equal(auth.isAuthenticated({ headers: { ...options.headers, host: '127.0.0.1:3080' } }), true);
      assert.equal(auth.isAuthenticated({ headers: { ...options.headers, host: '127.0.0.1:3081' } }), false);
    },
  });
  await transport.fetchImpl('http://127.0.0.1:3080/api/host.describe');
});

test('Weixin health and event sockets authenticate against the same protected Host', async (t) => {
  const server = createServer(async (req, res) => {
    if (req.headers.cookie !== 'session=test') return res.writeHead(401).end();
    let body = '';
    for await (const chunk of req) body += chunk;
    const { rpcId } = JSON.parse(body);
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ type: 'server-response', rpcId, result: { ok: true, value: {} } }));
  });
  const wss = new WebSocketServer({ noServer: true });
  server.on('upgrade', (req, socket, head) => {
    if (req.headers.cookie !== 'session=test') return socket.destroy();
    wss.handleUpgrade(req, socket, head, (ws) => ws.send('authenticated'));
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => { for (const ws of wss.clients) ws.terminate(); wss.close(); server.close(); });
  const port = server.address().port;
  const baseUrl = `http://127.0.0.1:${port}`;
  const ctx = {
    webServer: { port },
    connection: {
      authenticatedUrl: (url) => `${url}?token=test`,
      authorizeIndex(req, res) {
        assert.equal(req.headers.host, `127.0.0.1:${port}`);
        assert.equal(new URL(req.url).searchParams.get('token'), 'test');
        res.writeHead(303, { 'set-cookie': 'session=test; HttpOnly; Path=/' });
        res.end();
      },
    },
  };
  await assert.rejects(new HarnessClient({ baseUrl }).health(), { code: 'harness-auth-required' });
  const transport = createHarnessAuthTransport(ctx, baseUrl);
  assert.equal(await new HarnessClient({ baseUrl, ...transport }).health(), true);
  const socket = transport.createWebSocket(`ws://127.0.0.1:${port}/api/events.mux`);
  assert.equal(String((await once(socket, 'message'))[0]), 'authenticated');
  socket.close();
  assert.throws(() => transport.fetchImpl('https://example.com/api/host.describe'), /another origin/);
  assert.throws(() => transport.createWebSocket('ws://example.com/api/events.mux'), /another origin/);
  assert.deepEqual(createHarnessAuthTransport(ctx, 'https://example.com'), {});
  assert.deepEqual(createHarnessAuthTransport({ webServer: { port }, connection: {} }, baseUrl), {});
});
