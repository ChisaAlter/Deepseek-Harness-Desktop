'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { accountView, validateBrowserDestination } = require('./account-backend');
const { connectWelcome } = require('./welcome-backend');
const { resolveDesktopStartupLocale, resolveDesktopLocale } = require('./desktop-locale');

const signedOut = {
  status: 'signed-out',
  links: { usageUrl: 'https://platform.deepseek.com/usage', topUpUrl: 'https://platform.deepseek.com/topup' },
  attempt: null,
};

test('accountView validates shape and projects only UI-safe fields', () => {
  const view = accountView(signedOut);
  assert.equal(view.status, 'signed-out');
  assert.equal(view.attempt, null);
  assert.throws(() => accountView({ status: 'weird', attempt: null, links: signedOut.links }), /invalid state/);
  assert.throws(() => accountView({ ...signedOut, links: { usageUrl: 'file:///x', topUpUrl: signedOut.links.topUpUrl } }), /invalid browser destination/);
  const waiting = {
    ...signedOut,
    attempt: { id: 'a1', phase: 'waiting-browser', authorizeUrl: 'https://platform.deepseek.com/auth?x=1', secret: 'nope' },
  };
  const v2 = accountView(waiting);
  assert.equal(v2.attempt.phase, 'waiting-browser');
  assert.equal(v2.attempt.secret, undefined);
});

test('browser destinations: https or loopback-http only, no credentials', () => {
  assert.doesNotThrow(() => validateBrowserDestination('https://example.com/x'));
  assert.doesNotThrow(() => validateBrowserDestination('http://127.0.0.1:3080/x'));
  assert.throws(() => validateBrowserDestination('http://example.com/x'));
  assert.throws(() => validateBrowserDestination('https://u:p@example.com/x'));
  assert.throws(() => validateBrowserDestination('file:///etc/passwd'));
});

test('welcome save validates key shape before writing', async () => {
  const backend = connectWelcome('http://127.0.0.1:3080', () => 'session=x');
  assert.deepEqual(await backend.save(''), { ok: false });
  assert.deepEqual(await backend.save('has space'), { ok: false });
  assert.deepEqual(await backend.save('KEY="quoted"'), { ok: false });
});

test('locale resolution follows preference then OS languages', () => {
  assert.equal(resolveDesktopLocale('zh-CN').id, 'zh-CN');
  assert.equal(resolveDesktopLocale('en-US').id, 'en');
  assert.equal(resolveDesktopStartupLocale('zh', []).id, 'zh-CN');
  assert.equal(resolveDesktopStartupLocale(null, ['de-DE', 'zh-TW']).id, 'zh-CN');
  assert.equal(resolveDesktopStartupLocale(null, ['de-DE', 'fr-FR']).id, 'en');
});
