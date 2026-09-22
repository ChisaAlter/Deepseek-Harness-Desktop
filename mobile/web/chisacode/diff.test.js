import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DIFF_SCOPES,
  diffFileBadge,
  diffFileView,
  diffScopeLabel,
  diffViewState,
  fetchMobileDiff,
} from './diff.js';

test('diff scopes cover uncommitted and base with Chinese labels', () => {
  assert.deepEqual(DIFF_SCOPES.map((scope) => scope.id), ['uncommitted', 'base']);
  assert.equal(diffScopeLabel('uncommitted'), '未提交');
  assert.equal(diffScopeLabel('base'), '对比主干');
});

test('diffViewState distinguishes non-git by error code, not message text', () => {
  assert.deepEqual(
    diffViewState({ error: { code: 'NOT_GIT_REPO', message: 'not a git repository' }, files: [] }),
    { kind: 'non-git' },
  );
  assert.deepEqual(
    diffViewState({ error: { code: 'UNKNOWN', message: 'git binary missing' }, files: [] }),
    { kind: 'error', message: 'git binary missing' },
  );
  assert.deepEqual(diffViewState({ error: null, files: [] }), { kind: 'empty' });
  assert.deepEqual(diffViewState(undefined), { kind: 'empty' });
});

test('diffViewState maps files with hunks, headers, and line types', () => {
  const state = diffViewState({
    error: null,
    files: [{
      path: 'src/app.js',
      isNew: false,
      isDeleted: false,
      additions: 2,
      deletions: 1,
      hunks: [{
        oldStart: 10, oldCount: 3, newStart: 10, newCount: 4,
        lines: [
          { type: 'context', content: 'const a = 1;', tokens: [{ text: 'const', style: 'keyword' }] },
          { type: 'remove', content: 'old();' },
          { type: 'add', content: 'next();' },
          { type: 'weird', content: 'kept as context' },
        ],
      }],
    }],
  });
  assert.equal(state.kind, 'files');
  const file = state.files[0];
  assert.equal(file.status, 'ok');
  assert.equal(file.hunks[0].header, '@@ -10,3 +10,4 @@');
  assert.deepEqual(file.hunks[0].lines.map((line) => line.type), ['context', 'remove', 'add', 'context']);
  // Highlight tokens are intentionally dropped — no fake syntax colors.
  assert.equal('tokens' in file.hunks[0].lines[0], false);
});

test('diffFileView tolerates malformed payloads and keeps binary/too_large status', () => {
  const view = diffFileView({ path: 'a.bin', status: 'binary', hunks: null, additions: 'x' });
  assert.equal(view.status, 'binary');
  assert.equal(view.additions, 0);
  assert.deepEqual(view.hunks, []);
  assert.equal(diffFileView({ path: 'big', status: 'too_large' }).status, 'too_large');
  assert.equal(diffFileView({ path: 'ok', status: 'nonsense' }).status, 'ok');
  // Pathless files are dropped by diffViewState.
  assert.deepEqual(diffViewState({ error: null, files: [{ status: 'ok' }] }), { kind: 'empty' });
});

test('diffFileBadge labels binary, too-large, new, and deleted files', () => {
  assert.equal(diffFileBadge({ status: 'binary' }), '二进制');
  assert.equal(diffFileBadge({ status: 'too_large' }), '文件过大');
  assert.equal(diffFileBadge({ isNew: true, status: 'ok' }), '新增');
  assert.equal(diffFileBadge({ isDeleted: true, status: 'ok' }), '已删除');
  assert.equal(diffFileBadge({ status: 'ok' }), '');
});

test('fetchMobileDiff sends the compare scope and rejects unknown scopes', async () => {
  const calls = [];
  const client = {
    async getCheckoutDiff(cwd, compare) {
      calls.push([cwd, compare]);
      return { cwd, files: [], error: null };
    },
  };
  const state = await fetchMobileDiff(client, '/repo', 'base');
  assert.deepEqual(calls, [['/repo', { mode: 'base' }]]);
  assert.deepEqual(state, { kind: 'empty' });
  await assert.rejects(() => fetchMobileDiff(client, '/repo', 'staged'), /未知的改动范围/);
});

test('fetchMobileDiff propagates transport failures as thrown errors', async () => {
  const client = {
    async getCheckoutDiff() {
      throw new Error('request timed out');
    },
  };
  await assert.rejects(() => fetchMobileDiff(client, '/repo', 'uncommitted'), /timed out/);
});
