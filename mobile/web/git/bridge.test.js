import test from 'node:test';
import assert from 'node:assert/strict';
import { gitCommitPayload, gitTunnelAction } from './bridge.js';

test('gitTunnelAction maps titlebar camelCase onto kebab tunnel actions', () => {
  assert.equal(gitTunnelAction('gitCreateBranch'), 'git-create-branch');
  assert.equal(gitTunnelAction('gitPublishRepository'), 'git-publish');
  assert.equal(gitTunnelAction('gitSwitchBranch'), 'git-switch-branch');
  assert.equal(gitTunnelAction('git-commit'), 'git-commit');
});

test('gitCommitPayload includes optional featureBranch and filePaths', () => {
  assert.deepEqual(gitCommitPayload({ message: 'm' }), { message: 'm', options: {} });
  assert.deepEqual(
    gitCommitPayload({ message: 'm', filePaths: ['a.js'], featureBranch: true }),
    { message: 'm', filePaths: ['a.js'], options: { featureBranch: true } },
  );
});
