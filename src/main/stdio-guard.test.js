'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { EventEmitter } = require('node:events');
const {
  guardStream,
  handleUncaughtException,
  isBrokenPipeStreamError,
  shouldSwallowUncaught,
} = require('./stdio-guard');

function errWith(code, syscall) {
  const err = new Error(`${code}: broken pipe, ${syscall || 'write'}`);
  err.code = code;
  if (syscall) {
    err.syscall = syscall;
  }
  return err;
}

test('stream guard swallows broken-pipe errors without throwing', () => {
  const stream = new EventEmitter();
  const logs = [];
  guardStream(stream, (message) => logs.push(message));
  // Without a listener EventEmitter would throw on 'error'.
  stream.emit('error', errWith('EPIPE', 'write'));
  stream.emit('error', errWith('EIO', 'write'));
  stream.emit('error', errWith('EBADF', 'write'));
  stream.emit('error', errWith('ERR_STREAM_DESTROYED'));
  assert.deepEqual(logs, []);
});

test('stream guard logs non-broken-pipe stream errors', () => {
  const stream = new EventEmitter();
  const logs = [];
  guardStream(stream, (message) => logs.push(message));
  stream.emit('error', errWith('ENOSPC', 'write'));
  assert.equal(logs.length, 1);
  assert.match(logs[0], /ENOSPC/);
});

test('stream guard installs exactly once', () => {
  const stream = new EventEmitter();
  guardStream(stream);
  guardStream(stream);
  assert.equal(stream.listenerCount('error'), 1);
});

test('uncaught classifier only accepts broken-pipe writes', () => {
  assert.equal(shouldSwallowUncaught(errWith('EPIPE', 'write')), true);
  assert.equal(shouldSwallowUncaught(errWith('EPIPE', 'writev')), true);
  assert.equal(shouldSwallowUncaught(errWith('ERR_STREAM_DESTROYED')), true);
  // Read-side failures may be real bugs — must stay visible.
  assert.equal(shouldSwallowUncaught(errWith('EIO', 'read')), false);
  assert.equal(shouldSwallowUncaught(errWith('EBADF', 'write')), false);
  assert.equal(shouldSwallowUncaught(errWith('EPIPE', 'read')), false);
  assert.equal(shouldSwallowUncaught(new Error('TypeError: boom')), false);
  assert.equal(shouldSwallowUncaught(null), false);
});

test('handleUncaughtException swallows EPIPE write and logs it', () => {
  const logs = [];
  let shown = 0;
  const outcome = handleUncaughtException(errWith('EPIPE', 'write'), {
    log: (message) => logs.push(message),
    showError: () => { shown += 1; },
  });
  assert.equal(outcome, 'swallowed');
  assert.equal(shown, 0);
  assert.equal(logs.length, 1);
});

test('handleUncaughtException reports every other error like Electron default', () => {
  const logs = [];
  const shown = [];
  const boom = new Error('boom');
  const outcome = handleUncaughtException(boom, {
    log: (message) => logs.push(message),
    showError: (err) => shown.push(err),
  });
  assert.equal(outcome, 'reported');
  assert.deepEqual(shown, [boom]);
  assert.equal(logs.length, 1);
  assert.match(logs[0], /boom/);
});

test('isBrokenPipeStreamError covers stdio codes only', () => {
  assert.equal(isBrokenPipeStreamError(errWith('EPIPE', 'write')), true);
  assert.equal(isBrokenPipeStreamError(errWith('ENOSPC', 'write')), false);
  assert.equal(isBrokenPipeStreamError(undefined), false);
});
