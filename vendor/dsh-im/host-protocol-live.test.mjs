import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:net';
import { test } from 'node:test';
import WebSocket from 'ws';
import { HarnessClient } from './src/channels/shared/harness-client.mjs';
import { createModernHarnessTransport } from './plugin-src/host/harness-modern-transport.mjs';

test('IM health, workspace, session, models and events against the real built Harness', {
  skip: process.env.DSH_IM_LIVE_TEST !== '1', timeout: 120_000,
}, async (t) => {
  const home = await mkdtemp(join(tmpdir(), 'dsh-im-protocol-'));
  const reservation = createServer().listen(0, '127.0.0.1');
  await once(reservation, 'listening');
  const port = reservation.address().port;
  await new Promise((resolve) => reservation.close(resolve));
  const root = fileURLToPath(new URL('../deepseek-harness/', import.meta.url));
  const child = spawn(process.execPath, [join(root, 'apps/cli/lib/bin.js'), 'web', '--host', '127.0.0.1', '--port', String(port), '--no-open'], {
    cwd: root, env: { ...process.env, DSH_HOME: home }, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'],
  });
  let output = '';
  child.stdout.on('data', (chunk) => { output += chunk; });
  child.stderr.on('data', (chunk) => { output += chunk; });
  t.after(async () => {
    if (child.exitCode === null) { child.kill(); await once(child, 'exit'); }
    await rm(home, { recursive: true, force: true });
  });
  let cookie;
  for (let i = 0; i < 180; i++) {
    const url = output.match(new RegExp(`http://127\\.0\\.0\\.1:${port}/?\\?token=[A-Za-z0-9_-]+`))?.[0];
    if (url) {
      const response = await fetch(url, { redirect: 'manual' });
      cookie = response.headers.get('set-cookie')?.split(';')[0];
      if (cookie) break;
    }
    if (child.exitCode !== null) throw new Error('Isolated Harness exited before readiness');
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  assert.ok(cookie, 'isolated Harness issued a session cookie');
  const baseUrl = `http://127.0.0.1:${port}`;
  const transport = createModernHarnessTransport({ baseUrl,
    fetchImpl: (url, options) => fetch(url, { ...options, headers: { ...options.headers, cookie }, redirect: 'manual' }),
    createWebSocket: (url) => new WebSocket(url, { headers: { cookie } }),
  });
  const harness = new HarnessClient({ baseUrl, workspace: home, ...transport });
  assert.equal(await harness.health(), true);
  const sessionId = await harness.createSession();
  assert.equal(await harness.sessionExists(sessionId), true);
  assert.equal((await harness.listWorkspaceSessions(home)).sessions.length, 1);
  await harness.listModels();
  await harness.getSessionModels(sessionId);
  const controller = new AbortController();
  let markOpen;
  const opened = new Promise((resolve) => { markOpen = resolve; });
  const events = harness.watchInteractions(sessionId, { signal: controller.signal, onOpen: markOpen });
  const timer = setTimeout(() => controller.abort(new Error('events did not open')), 5_000);
  try {
    await Promise.race([opened, events.then(() => controller.signal.throwIfAborted())]);
  } finally {
    clearTimeout(timer);
    controller.abort();
    await events;
  }
});
