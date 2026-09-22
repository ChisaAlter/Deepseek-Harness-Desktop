'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

test('applyDaemonStdinLine stores a sanitized harness-cookie for host RPC', async () => {
  const { applyDaemonStdinLine, installDesktopRpcHooks } = await import('./dshd-daemon-hooks.mjs');
  assert.equal(applyDaemonStdinLine('harness-cookie dsh-browser-session=tok\r\nX: 1'), 'cookie');
  installDesktopRpcHooks();
  let seen = null;
  const prev = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    seen = { url: String(url), headers: init.headers };
    return new Response(JSON.stringify({
      type: 'server-response',
      rpcId: JSON.parse(init.body).rpcId,
      result: { ok: true, value: { items: [] } },
    }), { headers: { 'content-type': 'application/json' } });
  };
  try {
    applyDaemonStdinLine('harness-origin http://127.0.0.1:3080');
    const result = await globalThis.__dshdDesktopRpc.hostRpc({ method: 'session.list', payload: {} });
    assert.equal(result.ok, true);
    assert.equal(seen.headers.Cookie, 'dsh-browser-session=tok');
  } finally {
    globalThis.fetch = prev;
  }
});
