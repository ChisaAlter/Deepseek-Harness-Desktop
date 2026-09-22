'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  launchTokenFromUrl,
  loadUrlAfterRedeem,
  redeemBrowserSession,
  probeHarnessReady,
  isUnpublishedHarnessNpm,
  applyHarnessCookieToSession,
} = require('./harness-browser-auth');

test('launchTokenFromUrl reads the one-shot query and ignores a bare origin', () => {
  assert.equal(launchTokenFromUrl('http://127.0.0.1:3080/?token=abc'), 'abc');
  assert.equal(launchTokenFromUrl('http://127.0.0.1:3080/'), '');
});

test('loadUrlAfterRedeem drops the spent launch token', () => {
  assert.equal(loadUrlAfterRedeem('http://127.0.0.1:3080/?token=abc'), 'http://127.0.0.1:3080/');
});

test('redeemBrowserSession is a no-op without a token', async () => {
  let called = 0;
  const result = await redeemBrowserSession('http://127.0.0.1:3080/', {
    fetchImpl: async () => {
      called += 1;
      return new Response('ok', { status: 200 });
    },
  });
  assert.equal(called, 0);
  assert.equal(result.cookie, '');
});

test('redeemBrowserSession uses redirect:manual and stores the Set-Cookie pair', async () => {
  let init;
  const result = await redeemBrowserSession('http://127.0.0.1:3080/?token=abc', {
    fetchImpl: async (_url, options) => {
      init = options;
      return new Response('', {
        status: 303,
        headers: { 'set-cookie': 'dsh-auth-127.0.0.1:3080=secret; HttpOnly; SameSite=Strict' },
      });
    },
  });
  assert.equal(init.redirect, 'manual');
  assert.equal(result.cookie, 'dsh-auth-127.0.0.1:3080=secret');
  assert.equal(result.origin, 'http://127.0.0.1:3080');
});

test('probeHarnessReady treats an open 200 as ready without a cookie', async () => {
  const result = await probeHarnessReady('http://127.0.0.1:3080/', {
    fetchImpl: async () => new Response('ok', { status: 200 }),
  });
  assert.equal(result.ok, true);
  assert.equal(result.cookie, '');
});

test('probeHarnessReady redeems a 303 token URL then retries with Cookie', async () => {
  const calls = [];
  const result = await probeHarnessReady('http://127.0.0.1:3080/?token=abc', {
    fetchImpl: async (url, options) => {
      calls.push({ url: String(url), redirect: options.redirect, cookie: options.headers?.Cookie });
      if (String(url).includes('token=')) {
        return new Response('', {
          status: 303,
          headers: { 'set-cookie': 'dsh-auth-x=tok; HttpOnly' },
        });
      }
      assert.equal(options.headers.Cookie, 'dsh-auth-x=tok');
      return new Response('ok', { status: 200 });
    },
  });
  assert.equal(result.ok, true);
  assert.equal(result.cookie, 'dsh-auth-x=tok');
  assert.equal(calls[0].redirect, 'manual');
});

test('isUnpublishedHarnessNpm flags GitHub-only alpha pins', () => {
  assert.equal(isUnpublishedHarnessNpm('0.1.1-rc.1'), false);
  assert.equal(isUnpublishedHarnessNpm('0.1.2-alpha.1'), true);
});

test('applyHarnessCookieToSession writes the pair onto the Electron session', async () => {
  const writes = [];
  const ses = {
    cookies: {
      set: async (detail) => {
        writes.push(detail);
      },
    },
  };
  const applied = await applyHarnessCookieToSession(ses, 'http://127.0.0.1:3080', 'dsh-auth-x=tok');
  assert.equal(applied.ok, true);
  assert.equal(writes[0].name, 'dsh-auth-x');
  assert.equal(writes[0].value, 'tok');
  assert.equal(writes[0].httpOnly, true);
});
