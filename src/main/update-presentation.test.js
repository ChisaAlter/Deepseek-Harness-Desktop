'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { updateFailureKind, presentUpdate } = require('./update-presentation');

test('failure kinds map network errors to operation-network', () => {
  assert.equal(updateFailureKind({ phase: 'error', failedOperation: 'check', message: 'net::ERR_NAME_NOT_RESOLVED' }), 'check-network');
  assert.equal(updateFailureKind({ phase: 'error', failedOperation: 'download', message: 'Error: ETIMEDOUT' }), 'download-network');
  assert.equal(updateFailureKind({ phase: 'error', failedOperation: 'install', message: 'checksum mismatch' }), 'install');
  assert.equal(updateFailureKind({ phase: 'error', failedOperation: 'install', preparationFailure: 'tasks-changed' }), 'tasks-changed');
  assert.equal(updateFailureKind({ phase: 'error', message: 'x' }), 'install');
});

test('presentUpdate projects only semantic fields', () => {
  assert.deepEqual(presentUpdate({ phase: 'idle' }), { phase: 'idle' });
  assert.deepEqual(presentUpdate({ phase: 'available', version: '0.4.0' }), { phase: 'available', version: '0.4.0' });
  assert.deepEqual(presentUpdate({ phase: 'downloading', version: '0.4.0', percent: 42.9, raw: 'leak' }),
    { phase: 'downloading', version: '0.4.0', percent: 42 });
  assert.deepEqual(presentUpdate({ phase: 'error', failedOperation: 'check', message: 'ETIMEDOUT', secrets: 'x' }),
    { phase: 'error', failure: 'check-network' });
});
