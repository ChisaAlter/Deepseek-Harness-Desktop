'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  DEFAULT_PUBLIC_APP_BASE_URL,
  DEFAULT_RELAY_ENDPOINT,
  normalizePublicAppBaseUrl,
  preferredLanIp,
  isVirtualOrLinkLocalIpv4,
} = require('./lan');

test('preferredLanIp skips link-local and prefers RFC1918', () => {
  assert.equal(preferredLanIp(['169.254.1.2', '192.168.1.8']), '192.168.1.8');
  assert.equal(preferredLanIp(['100.64.1.2', '10.0.0.4']), '10.0.0.4');
  assert.equal(preferredLanIp(['127.0.0.1', '169.254.9.9']), '');
  assert.equal(preferredLanIp(['8.8.8.8']), '8.8.8.8');
});

test('isVirtualOrLinkLocalIpv4 covers APIPA and CGNAT', () => {
  assert.equal(isVirtualOrLinkLocalIpv4('169.254.10.1'), true);
  assert.equal(isVirtualOrLinkLocalIpv4('100.64.0.1'), true);
  assert.equal(isVirtualOrLinkLocalIpv4('100.127.0.1'), true);
  assert.equal(isVirtualOrLinkLocalIpv4('192.168.0.1'), false);
});

test('DEFAULT_PUBLIC_APP_BASE_URL is nginx SPA path not the relay port', () => {
  assert.equal(DEFAULT_PUBLIC_APP_BASE_URL, 'http://125.124.85.212:3389/dshd');
  assert.doesNotMatch(DEFAULT_PUBLIC_APP_BASE_URL, /:8411/);
  assert.match(DEFAULT_PUBLIC_APP_BASE_URL, /\/dshd$/);
});

test('normalizePublicAppBaseUrl keeps empty and rejects relay port / RFC1918', () => {
  assert.equal(normalizePublicAppBaseUrl(''), '');
  assert.equal(normalizePublicAppBaseUrl('   '), '');
  assert.equal(normalizePublicAppBaseUrl('http://125.124.85.212:8411'), '');
  assert.equal(normalizePublicAppBaseUrl('http://125.124.85.212:8411/'), '');
  assert.equal(normalizePublicAppBaseUrl('http://192.168.1.8:3180'), '');
  assert.equal(normalizePublicAppBaseUrl('http://10.0.0.4/dshd'), '');
  assert.equal(normalizePublicAppBaseUrl('not a url'), '');
  assert.equal(normalizePublicAppBaseUrl('ftp://125.124.85.212/dshd'), '');
  assert.equal(
    normalizePublicAppBaseUrl('http://125.124.85.212/dshd/'),
    'http://125.124.85.212/dshd',
  );
  assert.equal(
    normalizePublicAppBaseUrl('http://125.124.85.212/dshd', { relayEndpoint: DEFAULT_RELAY_ENDPOINT }),
    'http://125.124.85.212/dshd',
  );
  assert.equal(
    normalizePublicAppBaseUrl('http://125.124.85.212:3389/dshd/'),
    'http://125.124.85.212:3389/dshd',
  );
});
