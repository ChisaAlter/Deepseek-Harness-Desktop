const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { pathKeys, prependPath } = require('./env-path');

test('prependPath writes extras onto Path and does not add PATH', () => {
  const env = { Path: 'C:\\Windows\\System32' };
  prependPath(env, ['D:\\extras\\npm', 'D:\\app\\resources']);
  assert.equal(
    env.Path,
    `D:\\extras\\npm${path.delimiter}D:\\app\\resources${path.delimiter}C:\\Windows\\System32`,
  );
  assert.equal(env.PATH, undefined);
  assert.deepEqual(pathKeys(env), ['Path']);
});

test('prependPath writes extras onto PATH when that is the existing key', () => {
  const env = { PATH: 'C:\\Windows\\System32' };
  prependPath(env, ['D:\\extras\\npm']);
  assert.equal(env.PATH, `D:\\extras\\npm${path.delimiter}C:\\Windows\\System32`);
  assert.equal(env.Path, undefined);
  assert.deepEqual(pathKeys(env), ['PATH']);
});

test('prependPath fills Windows System32 when inherited PATH is empty', () => {
  const env = {};
  prependPath(env, ['D:\\extras\\npm'], { platform: 'win32', systemRoot: 'C:\\Windows' });
  assert.match(env.PATH, /System32/);
  assert.ok(env.PATH.startsWith(`D:\\extras\\npm${path.delimiter}`));
  assert.deepEqual(pathKeys(env), ['PATH']);
});

test('prependPath leaves the original PATH unchanged when extras are empty', () => {
  const env = { Path: 'C:\\Windows\\System32' };
  prependPath(env, [], { platform: 'win32', systemRoot: 'C:\\Windows' });
  assert.equal(env.Path, 'C:\\Windows\\System32');
  assert.equal(env.PATH, undefined);
});
