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
