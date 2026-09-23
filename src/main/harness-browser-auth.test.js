'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { getEventListeners } = require('node:events');
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

test('probeHarnessReady forwards its AbortSignal into the nested redemption fetch', async () => {
  // AUD-03: readiness gave the signal to the first fetch and the origin retry but
  // not to `redeemBrowserSession`, so a stalled redemption could outlive the
  // readiness budget. Every fetch the probe issues must carry the same signal.
  const seen = [];
  const result = await probeHarnessReady('http://127.0.0.1:3080/?token=abc', {
    timeoutMs: 50,
    fetchImpl: async (url, options) => {
      seen.push({ url: String(url), signal: options.signal });
      if (seen.length === 1) {
        return new Response('', { status: 401 });
      }
      if (seen.length === 2) {
        return new Response('', {
          status: 303,
          headers: { 'set-cookie': 'dsh-auth-x=tok; HttpOnly' },
        });
      }
      return new Response('ok', { status: 200 });
    },
  });
  assert.equal(result.ok, true);
  assert.equal(result.cookie, 'dsh-auth-x=tok');
  assert.equal(seen.length, 3, 'expected 401 -> redemption -> origin retry');
  assert.equal(seen[0].signal instanceof AbortSignal, true);
  assert.equal(seen[1].url.includes('token='), true, 'second call is the nested redemption');
  assert.equal(
    seen[1].signal,
    seen[0].signal,
    'nested redemption must receive the readiness AbortSignal',
  );
  assert.equal(seen[2].signal, seen[0].signal);
});

test('probeHarnessReady aborts a stalled redemption within the readiness budget', async () => {
  let aborted = false;
  let calls = 0;
  const started = Date.now();
  const result = await probeHarnessReady('http://127.0.0.1:3080/?token=abc', {
    timeoutMs: 60,
    fetchImpl: async (_url, options) => {
      calls += 1;
      if (calls === 1) {
        return new Response('', { status: 401 });
      }
      // Redemption fetch: hang until the readiness signal aborts, then reject
      // the way a real aborted fetch does.
      return new Promise((_resolve, reject) => {
        const fail = () => {
          aborted = true;
          reject(new DOMException('The operation was aborted.', 'AbortError'));
        };
        if (options.signal?.aborted) fail();
        else options.signal?.addEventListener('abort', fail, { once: true });
      });
    },
  });
  const elapsed = Date.now() - started;
  assert.equal(result.ok, false);
  assert.equal(aborted, true, 'the stalled redemption must be aborted');
  assert.ok(elapsed < 2000, `probe returned in ${elapsed}ms, not hanging past the budget`);
});

test('probeHarnessReady rejects a pre-aborted caller without issuing a request', async () => {
  const reason = new Error('caller already cancelled');
  const controller = new AbortController();
  controller.abort(reason);
  let calls = 0;
  await assert.rejects(
    probeHarnessReady('http://127.0.0.1:3080/?token=abc', {
      signal: controller.signal,
      fetchImpl: async () => {
        calls += 1;
        return new Response('unexpected', { status: 200 });
      },
    }),
    (error) => error === reason,
  );
  assert.equal(calls, 0);
});

test('probeHarnessReady removes its caller abort listener after readiness', async () => {
  const controller = new AbortController();
  const result = await probeHarnessReady('http://127.0.0.1:3080/', {
    signal: controller.signal,
    fetchImpl: async () => new Response('ok', { status: 200 }),
  });
  assert.equal(result.ok, true);
  assert.equal(getEventListeners(controller.signal, 'abort').length, 0);
});

test('redeemBrowserSession passes an injected AbortSignal to fetch', async () => {
  const controller = new AbortController();
  let init;
  await redeemBrowserSession('http://127.0.0.1:3080/?token=abc', {
    signal: controller.signal,
    fetchImpl: async (_url, options) => {
      init = options;
      return new Response('', { status: 200 });
    },
  });
  assert.equal(init.signal, controller.signal);
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
