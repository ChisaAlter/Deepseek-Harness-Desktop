import test from 'node:test';
import assert from 'node:assert/strict';
import { runStackedGit } from '../git/stack.js';

test('commit_push runs commit then push', async () => {
  const calls = [];
  await runStackedGit(async (action, extra) => {
    calls.push([action, extra]);
  }, 'commit_push', { message: 'm' });
  assert.deepEqual(calls, [
    ['git-commit', { message: 'm' }],
    ['git-push', { message: 'm' }],
  ]);
});

test('commit_push_pr runs commit, push, then create change request', async () => {
  const calls = [];
  await runStackedGit(async (action) => { calls.push(action); }, 'commit_push_pr', {});
  assert.deepEqual(calls, ['git-commit', 'git-push', 'git-create-change-request']);
});

test('plain commit is a single git-commit', async () => {
  const calls = [];
  await runStackedGit(async (action) => { calls.push(action); }, 'commit', {});
  assert.deepEqual(calls, ['git-commit']);
});

test('create PR pushes first and resumes only the remaining PR step', async () => {
  const calls = [];
  let completed;
  await assert.rejects(runStackedGit(async (step) => {
    calls.push(step);
    if (step === 'git-create-change-request') throw new Error('PR unavailable');
  }, 'create_pr'), (error) => {
    completed = error.completedSteps;
    return error.message === 'PR unavailable';
  });
  assert.deepEqual(calls, ['git-push', 'git-create-change-request']);
  calls.length = 0;
  await runStackedGit(async (step) => calls.push(step), 'create_pr', {}, { completed });
  assert.deepEqual(calls, ['git-create-change-request']);
});

test('resuming a partial commit/push/PR never commits again', async () => {
  let failure;
  await assert.rejects(runStackedGit(async (step) => {
    if (step === 'git-push') throw new Error('push disconnected');
  }, 'commit_push_pr'), (error) => {
    failure = error;
    return error.message === 'push disconnected';
  });
  assert.deepEqual(failure.completedSteps, ['git-commit']);
  const retried = [];
  await runStackedGit(async (step) => retried.push(step), 'commit_push_pr', {}, { completed: failure.completedSteps });
  assert.deepEqual(retried, ['git-push', 'git-create-change-request']);
});

test('progress is bound to the original operation sequence', async () => {
  await assert.rejects(runStackedGit(() => assert.fail('no write'), 'commit_push', {}, { completed: ['git-push'] }), /progress/);
});

test('branch continuation is one locked sequence and never creates the branch twice', async () => {
  let completed;
  await assert.rejects(runStackedGit(async (step) => {
    if (step === 'git-push') throw new Error('offline');
  }, 'create_branch_pr'), (error) => {
    completed = error.completedSteps;
    return error.message === 'offline';
  });
  assert.deepEqual(completed, ['git-create-branch']);
  const calls = [];
  await runStackedGit(async (step) => calls.push(step), 'create_branch_pr', {}, { completed });
  assert.deepEqual(calls, ['git-push', 'git-create-change-request']);
});
