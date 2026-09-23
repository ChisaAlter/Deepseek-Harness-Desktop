'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
  READ_CONTEXT_TTL_MS,
  READ_CONTEXT_MAX_LIFETIME_MS,
  createGitReadContext,
  isReadOnlyInvocation,
  isReadOnlyConfigInvocation,
  isReadOnlyRemoteInvocation,
  isReadOnlySymbolicRefInvocation,
  armReadContext,
  acquireReadContext,
  touchReadContext,
  invalidateReadContext,
  resetReadContexts,
  readContextSize,
} = require('./git-read-context');

/** A fake git that records every invocation and returns distinct stdout. */
function fakeGit() {
  const calls = [];
  const runGitImpl = async (cwd, args) => {
    calls.push({ cwd, args });
    return { code: 0, stdout: `${args.join(' ')}@${calls.length}`, stderr: '' };
  };
  return { calls, runGitImpl };
}

test('isReadOnlyInvocation caches reads and refuses writes', () => {
  assert.equal(isReadOnlyInvocation(['status', '--porcelain=v2', '--branch']), true);
  assert.equal(isReadOnlyInvocation(['rev-parse', '--is-inside-work-tree']), true);
  assert.equal(isReadOnlyInvocation(['diff', 'HEAD', '--numstat']), true);
  assert.equal(isReadOnlyInvocation(['remote', 'get-url', 'origin']), true);
  assert.equal(isReadOnlyInvocation(['symbolic-ref', '--quiet', 'HEAD']), true);

  assert.equal(isReadOnlyInvocation(['fetch', '--quiet', 'origin']), false);
  assert.equal(isReadOnlyInvocation(['add', '--', 'a.txt']), false);
  assert.equal(isReadOnlyInvocation(['checkout', 'main']), false);
  assert.equal(isReadOnlyInvocation(['pull', '--ff-only']), false);
  assert.equal(isReadOnlyInvocation(['commit', '-m', 'x']), false);
  assert.equal(isReadOnlyInvocation(['push']), false);
  assert.equal(isReadOnlyInvocation([]), false);
});

test('git config is cached only for its getter forms', () => {
  assert.equal(isReadOnlyConfigInvocation(['config', '--get', 'branch.main.remote']), true);
  assert.equal(isReadOnlyConfigInvocation(['config', '--get-all', 'x']), true);
  assert.equal(isReadOnlyConfigInvocation(['config', '--list']), true);
  assert.equal(isReadOnlyConfigInvocation(['config', '-l']), true);
  // `git config user.name=T` writes; `--unset`/`--replace-all` mutate.
  assert.equal(isReadOnlyConfigInvocation(['config', 'user.name', 'T']), false);
  assert.equal(isReadOnlyConfigInvocation(['config', '--unset', 'x']), false);
  assert.equal(isReadOnlyConfigInvocation(['config', '--replace-all', 'x', 'y']), false);
});

test('the context answers a repeated read from memory and spawns once', async () => {
  const { calls, runGitImpl } = fakeGit();
  const context = createGitReadContext({ runGitImpl });
  const args = ['status', '--porcelain=v2', '--branch'];
  const first = await context.run('/repo', args);
  const second = await context.run('/repo', args);
  assert.equal(calls.length, 1, 'identical reads must not spawn twice');
  assert.equal(first, second, 'the cached answer is returned');
});

test('concurrent identical reads share one in-flight spawn', async () => {
  let resolvePending;
  let spawns = 0;
  const runGitImpl = (cwd, args) => {
    spawns += 1;
    return new Promise((resolve) => {
      resolvePending = () => resolve({ code: 0, stdout: args.join(' '), stderr: '' });
    });
  };
  const context = createGitReadContext({ runGitImpl });
  const args = ['status', '--porcelain=v2', '--branch'];
  const a = context.run('/repo', args);
  const b = context.run('/repo', args);
  assert.equal(spawns, 1, 'the second call joins the first request');
  resolvePending();
  await Promise.all([a, b]);
});

test('writes are never answered from the context', async () => {
  const { calls, runGitImpl } = fakeGit();
  const context = createGitReadContext({ runGitImpl });
  await context.run('/repo', ['status', '--porcelain=v2', '--branch']);
  await context.run('/repo', ['status', '--porcelain=v2', '--branch']);
  assert.equal(calls.length, 1);
  await context.run('/repo', ['add', '--', 'a.txt']);
  await context.run('/repo', ['add', '--', 'a.txt']);
  assert.equal(calls.length, 3, 'mutations always run for real');
});

test('a context stays scoped to its own worktree', async () => {
  const { calls, runGitImpl } = fakeGit();
  const context = createGitReadContext({ runGitImpl });
  const args = ['status', '--porcelain=v2', '--branch'];
  await context.run('/repo-a', args);
  await context.run('/repo-b', args);
  assert.equal(calls.length, 2, 'a different root must not reuse the entry');
});

test('calls with custom limits are not shared', async () => {
  const { calls, runGitImpl } = fakeGit();
  const context = createGitReadContext({ runGitImpl });
  const args = ['status', '--porcelain=v2', '--branch'];
  await context.run('/repo', args);
  await context.run('/repo', args, { maxBytes: 10 });
  await context.run('/repo', args, { maxBytes: 10 });
  assert.equal(calls.length, 3, 'bounded/streaming calls keep their own contract');
});

test('forget drops matching entries and keeps the rest', async () => {
  const { calls, runGitImpl } = fakeGit();
  const context = createGitReadContext({ runGitImpl });
  await context.run('/repo', ['diff', 'HEAD', '--numstat']);
  await context.run('/repo', ['symbolic-ref', '--quiet', '--short', 'HEAD']);
  context.forget((args) => args[0] !== 'diff');
  await context.run('/repo', ['diff', 'HEAD', '--numstat']);
  await context.run('/repo', ['symbolic-ref', '--quiet', '--short', 'HEAD']);
  assert.equal(calls.length, 3, 'only the forgotten command is re-read');
});

test('status snapshots are stored and readable inside the context', () => {
  const { runGitImpl } = fakeGit();
  const context = createGitReadContext({ runGitImpl });
  assert.equal(context.getStatus(), null);
  const snapshot = { refName: 'main' };
  context.setStatus(snapshot);
  assert.equal(context.getStatus(), snapshot);
});

test('an armed context is served inside the window and expires after it', () => {
  resetReadContexts();
  let now = 1_000;
  const { runGitImpl } = fakeGit();
  const context = armReadContext('owner-1', '/repo', { runGitImpl, now: () => now });
  // Exactly at the boundary the entry is still live; acquisition slides usedAt.
  now += READ_CONTEXT_TTL_MS;
  assert.equal(acquireReadContext('owner-1', '/repo', now), context, 'valid at the boundary');
  // Past the window it is dropped and revoked.
  now += READ_CONTEXT_TTL_MS + 1;
  assert.equal(acquireReadContext('owner-1', '/repo', now), null, 'expired entries are dropped');
  assert.equal(context.isRevoked(), true);
  assert.equal(readContextSize(), 0);
});

test('a slow fetch slides the idle window but not the absolute lifetime', () => {
  resetReadContexts();
  let now = 0;
  const { runGitImpl } = fakeGit();
  const context = armReadContext('owner-1', '/repo', { runGitImpl, now: () => now });
  // A 3s fetch exceeds the 2s idle window. Once it settles the refresh touches
  // its own context, so the PR sibling still reaches it instead of re-walking
  // the whole status path.
  now += 3_000;
  assert.equal(touchReadContext('owner-1', '/repo', context, now), true);
  assert.equal(acquireReadContext('owner-1', '/repo', now), context);
  // The absolute cap still wins over touches.
  now += READ_CONTEXT_MAX_LIFETIME_MS;
  assert.equal(touchReadContext('owner-1', '/repo', context, now), false);
  assert.equal(acquireReadContext('owner-1', '/repo', now), null, 'absolute cap wins');
});

test('repeat acquisition keeps sliding the idle window', () => {
  resetReadContexts();
  let now = 0;
  const { runGitImpl } = fakeGit();
  const context = armReadContext('owner-1', '/repo', { runGitImpl, now: () => now });
  for (let index = 0; index < 5; index += 1) {
    now += READ_CONTEXT_TTL_MS - 100;
    assert.equal(acquireReadContext('owner-1', '/repo', now), context);
  }
  now += READ_CONTEXT_MAX_LIFETIME_MS;
  assert.equal(acquireReadContext('owner-1', '/repo', now), null, 'absolute cap stops it');
});

test('a context is never served to a different owner or worktree', () => {
  resetReadContexts();
  let now = 0;
  const { runGitImpl } = fakeGit();
  const context = armReadContext('owner-1', '/repo-a', { runGitImpl, now: () => now });
  assert.equal(acquireReadContext('owner-2', '/repo-a', now), null, 'owner scoped');
  assert.equal(acquireReadContext('owner-1', '/repo-b', now), null, 'worktree scoped');
  assert.equal(acquireReadContext('owner-1', '/repo-a', now), context);
  resetReadContexts();
});

test('a second refresh by the same owner supersedes the first without serving its memory', () => {
  resetReadContexts();
  let now = 0;
  const { runGitImpl } = fakeGit();
  const first = armReadContext('owner-1', '/repo', { runGitImpl, now: () => now });
  const second = armReadContext('owner-1', '/repo', { runGitImpl, now: () => now });
  assert.notEqual(second, first);
  assert.equal(first.isRevoked(), false, 'arm does not reach into the other context');
  assert.equal(acquireReadContext('owner-1', '/repo', now), second);
  resetReadContexts();
});

test('invalidate revokes a captured context, not just the registry entry', async () => {
  resetReadContexts();
  let now = 0;
  const { calls, runGitImpl } = fakeGit();
  const context = armReadContext('owner-1', '/repo', { runGitImpl, now: () => now });
  await context.run('/repo', ['status', '--porcelain=v2', '--branch']);
  invalidateReadContext('/repo');
  assert.equal(context.isRevoked(), true, 'an in-flight holder must see the write');
  await context.run('/repo', ['status', '--porcelain=v2', '--branch']);
  assert.equal(calls.length, 2, 'a revoked context stops answering from memory');
  resetReadContexts();
});

test('invalidate drops one worktree or every worktree', () => {
  resetReadContexts();
  let now = 0;
  const { runGitImpl } = fakeGit();
  armReadContext('owner-1', '/a', { runGitImpl, now: () => now });
  armReadContext('owner-2', '/b', { runGitImpl, now: () => now });
  assert.equal(readContextSize(), 2);
  invalidateReadContext('/a');
  assert.equal(readContextSize(), 1);
  assert.equal(acquireReadContext('owner-1', '/a', now), null);
  invalidateReadContext();
  assert.equal(readContextSize(), 0);
});

test('arming a fresh context revokes the previous one for that owner and worktree', () => {
  resetReadContexts();
  let now = 0;
  const { runGitImpl } = fakeGit();
  const context = armReadContext(undefined, '/repo', { runGitImpl, now: () => now });
  assert.equal(acquireReadContext(undefined, '/repo', now), context);
  resetReadContexts();
});

test('remote writes are never memoized', () => {
  for (const write of [
    ['remote', 'add', 'origin', 'url'],
    ['remote', 'set-head', 'origin', '--auto'],
    ['remote', 'set-url', 'origin', 'url'],
    ['remote', 'rename', 'origin', 'upstream'],
    ['remote', 'remove', 'origin'],
    ['remote', 'prune', 'origin'],
    ['remote', 'update'],
  ]) {
    assert.equal(isReadOnlyRemoteInvocation(write), false, write.join(' '));
  }
  for (const read of [
    ['remote'],
    ['remote', '-v'],
    ['remote', 'get-url', 'origin'],
    ['remote', 'show', 'origin'],
  ]) {
    assert.equal(isReadOnlyRemoteInvocation(read), true, read.join(' '));
  }
});

test('symbolic-ref writes are never memoized', () => {
  assert.equal(isReadOnlySymbolicRefInvocation(['symbolic-ref', '--quiet', 'HEAD']), true);
  assert.equal(isReadOnlySymbolicRefInvocation(['symbolic-ref', 'refs/remotes/origin/HEAD', 'refs/remotes/origin/main']), false);
  assert.equal(isReadOnlySymbolicRefInvocation(['symbolic-ref', '--delete', 'x']), false);
  assert.equal(isReadOnlySymbolicRefInvocation(['symbolic-ref', '-d', 'x']), false);
  assert.equal(isReadOnlySymbolicRefInvocation(['symbolic-ref', '-m', 'reason', 'a', 'b']), false);
  assert.equal(isReadOnlyInvocation(['remote', 'set-head', 'origin', '--auto']), false);
  assert.equal(isReadOnlyInvocation(['symbolic-ref', 'x', 'y']), false);
});

test('a missing symbolic-ref answer is not reused after a remote set-head write', async () => {
  const { calls, runGitImpl } = fakeGit();
  const context = createGitReadContext({ runGitImpl });
  const head = ['symbolic-ref', '--quiet', 'refs/remotes/origin/HEAD'];
  await context.run('/repo', head);
  await context.run('/repo', ['remote', 'set-head', 'origin', '--auto']);
  await context.run('/repo', head);
  assert.equal(calls.length, 3, 'the post-write symbolic-ref must re-run');
});
