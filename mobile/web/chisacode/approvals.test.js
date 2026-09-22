import test from 'node:test';
import assert from 'node:assert/strict';
import {
  approvalFromRequest,
  approvalsFromAgent,
  genericResponse,
  removeApproval,
  responseForAction,
} from './approvals.js';

test('approvalFromRequest keeps the daemon action list verbatim', () => {
  const approval = approvalFromRequest({
    id: 'req-1',
    name: 'shell',
    title: '运行命令',
    description: 'rm -rf build',
    actions: [
      { id: 'allow-once', label: '允许一次', behavior: 'allow', variant: 'primary' },
      { id: 'deny', label: '拒绝', behavior: 'deny', variant: 'danger' },
      { id: 'weird', label: '未知', behavior: 'mystery' },
      { id: '', label: '坏的', behavior: 'allow' },
    ],
  });
  assert.equal(approval.requestId, 'req-1');
  assert.equal(approval.title, '运行命令');
  assert.equal(approval.command, 'rm -rf build');
  // Unknown behaviors and empty ids are dropped; unknown variants normalize.
  assert.deepEqual(approval.actions, [
    { id: 'allow-once', label: '允许一次', behavior: 'allow', variant: 'primary' },
    { id: 'deny', label: '拒绝', behavior: 'deny', variant: 'danger' },
  ]);
});

test('approvalFromRequest falls back to name and empty actions', () => {
  const approval = approvalFromRequest({ id: 'req-2', name: 'question' });
  assert.equal(approval.title, 'question');
  assert.deepEqual(approval.actions, []);
  assert.equal(approvalFromRequest({ name: 'no-id' }), null);
  assert.equal(approvalFromRequest(null), null);
});

test('approvalsFromAgent reads pendingPermissions in daemon order', () => {
  const approvals = approvalsFromAgent({
    pendingPermissions: [
      { id: 'r1', name: 'a' },
      { id: 'r2', name: 'b' },
      { name: 'broken' },
    ],
  });
  assert.deepEqual(approvals.map((item) => item.requestId), ['r1', 'r2']);
  assert.deepEqual(approvalsFromAgent(undefined), []);
});

test('removeApproval clears one request id (cross-client resolution)', () => {
  const list = [{ requestId: 'r1' }, { requestId: 'r2' }];
  assert.deepEqual(removeApproval(list, 'r1').map((item) => item.requestId), ['r2']);
  assert.equal(removeApproval(list, 'missing').length, 2);
});

test('responseForAction and genericResponse build wire responses', () => {
  assert.deepEqual(
    responseForAction({ id: 'allow-once', behavior: 'allow' }),
    { behavior: 'allow', selectedActionId: 'allow-once' },
  );
  assert.deepEqual(genericResponse('deny'), { behavior: 'deny' });
  assert.throws(() => genericResponse('maybe'), /未知审批行为/);
});
