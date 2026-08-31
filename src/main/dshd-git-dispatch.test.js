'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  GIT_TUNNEL_ACTIONS,
  isAllowedGitAction,
  dispatchGitTunnel,
} = require('./dshd-git-dispatch');

test('git tunnel allowlist matches titlebar set and excludes stage/pty/writeFile', () => {
  assert.equal(isAllowedGitAction('git-status'), true);
  assert.equal(isAllowedGitAction('git-create-branch'), true);
  assert.equal(isAllowedGitAction('git-publish'), true);
  assert.equal(isAllowedGitAction('git-stage'), false);
  assert.equal(isAllowedGitAction('git-unstage'), false);
  assert.equal(isAllowedGitAction('git-discard'), false);
  assert.equal(isAllowedGitAction('writeFile'), false);
  assert.equal(isAllowedGitAction('ptySpawn'), false);
  assert.ok(GIT_TUNNEL_ACTIONS.has('git-commit'));
});

test('dispatchGitTunnel rejects unknown actions without calling git', async () => {
  let called = 0;
  await assert.rejects(
    () => dispatchGitTunnel({
      action: 'git-stage',
      cwd: '/repo',
      payload: {},
      git: { gitStage: async () => { called += 1; } },
    }),
    /不允许/,
  );
  assert.equal(called, 0);
});

test('dispatchGitTunnel maps stacked commit payload onto gitCommit', async () => {
  const calls = [];
  const git = {
    gitCommit: async (cwd, message, filePaths, onProgress, options) => {
      calls.push({ cwd, message, filePaths, options });
      return { ok: true };
    },
  };
  const result = await dispatchGitTunnel({
    action: 'git-commit',
    cwd: 'C:\\proj',
      payload: { message: 'wip', filePaths: ['a.ts'], options: { featureBranch: 'feat' } },
    git,
  });
  assert.equal(result.ok, true);
  assert.deepEqual(calls[0], {
    cwd: 'C:\\proj',
    message: 'wip',
    filePaths: ['a.ts'],
    options: { featureBranch: 'feat' },
  });
});
