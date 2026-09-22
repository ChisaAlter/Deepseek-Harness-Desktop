'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  isHttpOrHttpsUrl,
  isLoopbackHost,
  isPreviewableUrl,
  newPreviewTabId,
  normalizePreviewUrl,
  PreviewUrlNormalizationError,
} = require('./preview-url');

test('newPreviewTabId returns a unique id with the dshd-tab_ prefix', () => {
  const a = newPreviewTabId();
  const b = newPreviewTabId();
  assert.notEqual(a, b);
  assert.equal(a.startsWith('dshd-tab_'), true);
});

test('isLoopbackHost accepts loopback tokens', () => {
  for (const host of ['localhost', '127.0.0.1', '0.0.0.0', '::1', '[::1]']) {
    assert.equal(isLoopbackHost(host), true, host);
  }
  for (const host of ['example.com', '192.168.1.10', '10.0.0.1', '']) {
    assert.equal(isLoopbackHost(host), false, host);
  }
});

test('isPreviewableUrl is loopback http(s) only', () => {
  assert.equal(isPreviewableUrl('http://127.0.0.1:3000'), true);
  assert.equal(isPreviewableUrl('https://example.com'), false);
  assert.equal(isPreviewableUrl('http://localhost:5173'), true);
  assert.equal(isPreviewableUrl('http://[::1]:5173'), true);
  assert.equal(isPreviewableUrl('ws://localhost:5173'), false);
  assert.equal(isPreviewableUrl('file:///etc/passwd'), false);
  assert.equal(isPreviewableUrl('not-a-url'), false);
  assert.equal(isPreviewableUrl(''), false);
});

test('isHttpOrHttpsUrl accepts any http(s) document and rejects other schemes', () => {
  assert.equal(isHttpOrHttpsUrl('https://example.com'), true);
  assert.equal(isHttpOrHttpsUrl('http://127.0.0.1:3000'), true);
  assert.equal(isHttpOrHttpsUrl('http://evil.example'), true);
  assert.equal(isHttpOrHttpsUrl('file:///etc/passwd'), false);
  assert.equal(isHttpOrHttpsUrl('javascript:alert(1)'), false);
  assert.equal(isHttpOrHttpsUrl('ftp://example.com'), false);
  assert.equal(isHttpOrHttpsUrl(''), false);
});

test('normalizePreviewUrl treats bare loopback as http', () => {
  assert.equal(normalizePreviewUrl('localhost:5173'), 'http://localhost:5173/');
  assert.equal(normalizePreviewUrl('127.0.0.1:3000'), 'http://127.0.0.1:3000/');
  assert.equal(normalizePreviewUrl('127.0.0.1:3000/app'), 'http://127.0.0.1:3000/app');
  assert.equal(normalizePreviewUrl('0.0.0.0:4173'), 'http://0.0.0.0:4173/');
  assert.equal(normalizePreviewUrl('[::1]:8080'), 'http://[::1]:8080/');
  assert.equal(normalizePreviewUrl('http://127.0.0.1:3000'), 'http://127.0.0.1:3000/');
});

test('normalizePreviewUrl treats bare public hosts as https', () => {
  assert.match(normalizePreviewUrl('example.com'), /^https:\/\/example\.com\/?/);
  assert.equal(normalizePreviewUrl('example.com'), 'https://example.com/');
});

test('normalizePreviewUrl respects explicit schemes', () => {
  assert.equal(normalizePreviewUrl('https://localhost:5173'), 'https://localhost:5173/');
  assert.equal(normalizePreviewUrl('http://example.com/path?q=1'), 'http://example.com/path?q=1');
});

test('normalizePreviewUrl rejects empty input', () => {
  assert.throws(() => normalizePreviewUrl(''), PreviewUrlNormalizationError);
  try {
    normalizePreviewUrl('   ');
    assert.fail('expected URL normalization to fail');
  } catch (error) {
    assert.ok(error instanceof PreviewUrlNormalizationError);
    assert.equal(error.reason, 'empty');
    assert.equal(error.inputLength, 3);
    assert.equal('rawUrl' in error, false);
    assert.equal('cause' in error, false);
  }
});

test('normalizePreviewUrl rejects unsupported protocols', () => {
  try {
    normalizePreviewUrl('ftp://example.com');
    assert.fail('expected URL normalization to fail');
  } catch (error) {
    assert.ok(error instanceof PreviewUrlNormalizationError);
    assert.equal(error.reason, 'unsupported-protocol');
    assert.equal(error.protocol, 'ftp:');
    assert.equal(error.inputLength, 'ftp://example.com'.length);
  }
});

test('normalizePreviewUrl rejects unparseable input without retaining credentials', () => {
  const rawUrl = 'https://user:password@example.com:bad/path?access_token=secret#fragment';
  try {
    normalizePreviewUrl(rawUrl);
    assert.fail('expected URL normalization to fail');
  } catch (error) {
    assert.ok(error instanceof PreviewUrlNormalizationError);
    assert.equal(error.reason, 'parse');
    assert.equal(error.inputLength, rawUrl.length);
    assert.equal(error.protocol, 'https:');
    assert.equal('rawUrl' in error, false);
    assert.ok(error.cause instanceof Error);
    assert.equal(error.message.includes(error.cause.message), false);
    assert.match(error.message, /^Invalid preview URL \(parse: https:; input length \d+\)\.$/);
    assert.doesNotMatch(error.message, /user|password|access_token|secret|fragment/);
  }
});
