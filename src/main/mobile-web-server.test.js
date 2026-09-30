'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');

const { createMobileWebServer } = require('./mobile-web-server');

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve(server.address().port));
  });
}

function close(server) {
  return new Promise((resolve) => server.close(() => resolve()));
}

test('malformed LAN URLs and Host headers return 400 without interrupting later requests', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dshd-mweb-'));
  t.after(() => { fs.rmSync(root, { recursive: true, force: true }); });
  fs.writeFileSync(path.join(root, 'index.html'), '<html>still running</html>');
  const server = createMobileWebServer({ root });
  t.after(() => close(server));
  const port = await listen(server);
  const request = (pathname, headers = {}) => new Promise((resolve, reject) => {
    const req = http.get({ hostname: '127.0.0.1', port, path: pathname, headers }, (res) => {
      res.resume();
      res.on('end', () => resolve(res.statusCode));
    });
    req.on('error', reject);
    req.setTimeout(2_000, () => req.destroy(new Error('request did not finish')));
  });
  for (const pathname of ['/%', '/%E0%A4%A', '/%FF.js']) {
    assert.equal(await request(pathname), 400);
  }
  assert.equal(await request('/', { Host: '%' }), 400);
  assert.equal(await request('/'), 200);
});

test('mobile-web-server sets universally-safe security headers, no CSP (relay WS must stay open)', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dshd-mweb-'));
  t.after(() => { fs.rmSync(root, { recursive: true, force: true }); });
  fs.writeFileSync(path.join(root, 'index.html'), '<html></html>');

  const server = createMobileWebServer({ root });
  t.after(() => close(server));
  const port = await listen(server);

  const res = await fetch(`http://127.0.0.1:${port}/`);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(res.headers.get('referrer-policy'), 'no-referrer');
  assert.equal(res.headers.get('x-frame-options'), 'DENY');
  // Deliberately NO content-security-policy: the SPA connects a WebSocket to a
  // different relay host, and a same-origin connect-src would break pairing.
  assert.equal(res.headers.get('content-security-policy'), null);
  await close(server);
});
