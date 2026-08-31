import test from 'node:test';
import assert from 'node:assert/strict';
import {
  applyPermissionProjectionFrame,
  applyPermissionSnapshot,
  permissionCommand,
  permissionFromEvents,
  permissionFromProjections,
  permissionLabel,
} from './permission.js';

test('permissionCommand is the host slash line', () => {
  assert.equal(permissionCommand('read-only'), '/permission read-only');
  assert.equal(permissionLabel('workspace-write'), '工作区写入');
});

test('permissionFromEvents folds preset and plan/mode', () => {
  assert.deepEqual(
    permissionFromEvents([
      { event: { type: 'permission/preset', data: { preset: 'workspace-write' } } },
      { event: { type: 'plan/mode', data: { active: true } } },
    ]),
    { current: 'workspace-write', planOn: true },
  );
});

test('permissionFromProjections prefers host values.permissions and plan pending fold', () => {
  assert.deepEqual(
    permissionFromProjections({
      values: {
        permissions: { currentValue: 'read-only', options: [] },
        plan: { active: false, pending: true },
      },
    }),
    { current: 'read-only', planOn: true },
  );
  assert.deepEqual(
    permissionFromProjections({
      values: { permissions: { currentValue: 'workspace-write' }, plan: { active: false, pending: false } },
    }),
    { current: 'workspace-write', planOn: false },
  );
});

test('applyPermissionSnapshot does not wipe a known chip when the page omits permission events', () => {
  assert.deepEqual(
    applyPermissionSnapshot({
      projections: { values: { permissions: { currentValue: 'read-only' }, plan: { active: false, pending: false } } },
      events: [{ event: { type: 'user/message' } }],
      previous: { current: 'workspace-write', planOn: false },
    }),
    { current: 'read-only', planOn: false },
  );
  assert.deepEqual(
    applyPermissionSnapshot({
      projections: { values: {} },
      events: [],
      previous: { current: 'workspace-write', planOn: true },
    }),
    { current: 'workspace-write', planOn: true },
  );
});

test('applyPermissionProjectionFrame updates permissions and plan live', () => {
  const base = { current: 'workspace-write', planOn: false };
  assert.deepEqual(
    applyPermissionProjectionFrame(base, {
      type: 'session/projection',
      key: 'permissions',
      value: { currentValue: 'read-only' },
    }),
    { current: 'read-only', planOn: false },
  );
  assert.deepEqual(
    applyPermissionProjectionFrame(base, {
      type: 'session/projection',
      key: 'plan',
      value: { active: true, pending: false },
    }),
    { current: 'workspace-write', planOn: true },
  );
});
