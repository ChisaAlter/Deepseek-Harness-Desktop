const test = require('node:test');
const assert = require('node:assert/strict');
const { isCleartextBaseUrl } = require('./cleartext-base-url');

test('isCleartextBaseUrl flags off-host http and spares https, loopback, junk', () => {
  assert.equal(isCleartextBaseUrl('http://gateway.example.com/v1'), true);
  assert.equal(isCleartextBaseUrl('http://192.168.1.5:8080'), true);
  assert.equal(isCleartextBaseUrl(' https://api.deepseek.com '), false);
  assert.equal(isCleartextBaseUrl('http://127.0.0.1:8000/v1'), false);
  assert.equal(isCleartextBaseUrl('http://localhost:11434'), false);
  assert.equal(isCleartextBaseUrl('http://[::1]:8080'), false);
  assert.equal(isCleartextBaseUrl(''), false);
  assert.equal(isCleartextBaseUrl('not a url'), false);
  assert.equal(isCleartextBaseUrl(undefined), false);
  assert.equal(isCleartextBaseUrl(42), false);
});
