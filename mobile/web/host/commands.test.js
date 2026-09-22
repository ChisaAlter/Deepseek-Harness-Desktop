import test from 'node:test';
import assert from 'node:assert/strict';
import {
  admitCommandResult,
  commandExecutePayload,
  commandListPayload,
  isSlashSubmitLine,
  mapHostSlashList,
} from './commands.js';

test('command payloads wrap Typert args with agentId and required images', () => {
  assert.deepEqual(commandListPayload('session-1'), { args: { agentId: 'session-1' } });
  assert.deepEqual(
    commandExecutePayload('session-1', '/permission read-only'),
    { args: { agentId: 'session-1', line: '/permission read-only', images: [] } },
  );
  assert.deepEqual(
    commandExecutePayload('session-1', '/plan', [{ mediaType: 'image/png', data: 'abc', extra: true }]),
    { args: { agentId: 'session-1', line: '/plan', images: [{ mediaType: 'image/png', data: 'abc' }] } },
  );
});

test('mapHostSlashList copies host descriptors into the popup rows', () => {
  assert.deepEqual(
    mapHostSlashList([
      { name: 'permission', description: 'Switch preset', input: { hint: '<preset>' } },
      { name: 'compact', description: 'Compact' },
    ]),
    [
      { name: 'permission', argumentHint: '<preset>', description: 'Switch preset' },
      { name: 'compact', argumentHint: '', description: 'Compact' },
    ],
  );
  assert.deepEqual(mapHostSlashList(undefined), []);
});

test('isSlashSubmitLine is leading-/ after trim, not a mid-sentence slash', () => {
  assert.equal(isSlashSubmitLine('/permission read-only'), true);
  assert.equal(isSlashSubmitLine('  /plan off'), true);
  assert.equal(isSlashSubmitLine('hello /permission'), false);
  assert.equal(isSlashSubmitLine(''), false);
});

test('admitCommandResult requires a commandId and surfaces handler errors', () => {
  assert.deepEqual(
    admitCommandResult({ commandId: 'cmd-1', result: { kind: 'success', text: 'preset read-only' } }, '/permission read-only'),
    { commandId: 'cmd-1', result: { kind: 'success', text: 'preset read-only' } },
  );
  assert.throws(() => admitCommandResult(undefined, '/permission nope'), /未知命令：\/permission nope/);
  assert.throws(
    () => admitCommandResult({ commandId: 'cmd-2', result: { kind: 'error', text: 'unknown preset' } }, '/permission x'),
    /unknown preset/,
  );
});
