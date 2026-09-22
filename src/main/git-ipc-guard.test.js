const test = require('node:test');
const assert = require('node:assert/strict');
const {
  GIT_IPC_FALLBACK_MESSAGE,
  gitIpcFailure,
  gitIpcNull,
  guardGitIpc,
} = require('./git-ipc-guard');

test('guardGitIpc passes through a resolving listener and its arguments', async () => {
  const guarded = guardGitIpc(async (event, cwd) => ({ ok: true, cwd, event }));
  const result = await guarded('evt', '/work');
  assert.deepEqual(result, { ok: true, cwd: '/work', event: 'evt' });
});

test('guardGitIpc resolves a rejected listener into the ok:false payload', async () => {
  const guarded = guardGitIpc(async () => {
    throw new Error('registry unreadable');
  });
  assert.deepEqual(await guarded(), { ok: false, message: 'registry unreadable' });
});

test('guardGitIpc catches synchronous throws too', async () => {
  const guarded = guardGitIpc(() => {
    throw new Error('sync boom');
  });
  assert.deepEqual(await guarded(), { ok: false, message: 'sync boom' });
});

test('gitIpcFailure falls back to the fixed message for non-Error and blank throws', () => {
  assert.deepEqual(gitIpcFailure('string throw'), { ok: false, message: GIT_IPC_FALLBACK_MESSAGE });
  assert.deepEqual(gitIpcFailure(new Error('   ')), { ok: false, message: GIT_IPC_FALLBACK_MESSAGE });
  assert.deepEqual(gitIpcFailure(undefined), { ok: false, message: GIT_IPC_FALLBACK_MESSAGE });
});

test('guardGitIpc with the null fallback resolves snapshot channels to null', async () => {
  const guarded = guardGitIpc(async () => {
    throw new Error('status walker crashed');
  }, gitIpcNull);
  assert.equal(await guarded(), null);
});
