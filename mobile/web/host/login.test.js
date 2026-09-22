import test from 'node:test';
import assert from 'node:assert/strict';
import { loginWithOffer } from './login.js';

test('loginWithOffer posts the offer token to /__remote__/login', async () => {
  const seen = [];
  const fetchImpl = async (url, init) => {
    seen.push({ url: String(url), init });
    return new Response('', { status: 302, headers: { location: '/' } });
  };
  await loginWithOffer({
    fetchImpl,
    origin: 'http://127.0.0.1:3180',
    offer: { v: 1, token: 'secret token', mode: 'lan' },
  });
  assert.equal(seen[0].url, 'http://127.0.0.1:3180/__remote__/login');
  assert.equal(seen[0].init.method, 'POST');
  assert.equal(seen[0].init.credentials, 'include');
  assert.equal(seen[0].init.redirect, 'manual');
  assert.equal(seen[0].init.headers['content-type'], 'application/x-www-form-urlencoded');
  assert.equal(seen[0].init.body, 'token=secret%20token');
});

test('loginWithOffer rejects a missing token or unauthorized status', async () => {
  await assert.rejects(() => loginWithOffer({
    fetchImpl: async () => new Response('nope', { status: 200 }),
    origin: 'http://x',
    offer: { token: '' },
  }));
  await assert.rejects(() => loginWithOffer({
    fetchImpl: async () => new Response('nope', { status: 401 }),
    origin: 'http://x',
    offer: { token: 'bad' },
  }));
});
