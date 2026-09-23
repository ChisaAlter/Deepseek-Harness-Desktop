const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const exec = require('./git-exec');
const { createWorkspaceAuthority } = require('./workspace-authority');

let calls;
let target;
let rows;
let failCommand;
test.mock.method(exec, 'run', async (command, args) => {
  assert.equal(command, 'gh');
  calls.push(args);
  if (args[1] === failCommand) return { code: 1, stdout: '', stderr: 'lookup failed' };
  if (args[1] === 'view') return { code: 0, stdout: JSON.stringify(target) };
  if (args[1] === 'list') return { code: 0, stdout: JSON.stringify(rows) };
  assert.equal(args[1], 'create');
  return { code: 0, stdout: 'https://github.com/upstream/app/pull/7\n' };
});
const { gitCreateChangeRequest, setWorkspaceAuthority } = require('./git');
const { lookupOpenPullRequest, rememberLastKnownPr, resolveLastKnownPr, resetLastKnownPrCache } = require('./git-pullrequest');
const { setTextGenerator } = require('./git-generate');

function git(cwd, ...args) {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8', env: exec.gitChildEnv() });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
}

function fixture(t, { headRemote = 'origin', headOwner = 'me', baseOwner = 'upstream', headBranch = 'feature' } = {}) {
  calls = [];
  rows = [];
  failCommand = undefined;
  target = { nameWithOwner: `${baseOwner}/app`, url: `https://github.com/${baseOwner}/app`, defaultBranchRef: { name: 'main' } };
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-pr-target-'));
  setWorkspaceAuthority(createWorkspaceAuthority({ workspace: cwd }));
  t.after(() => {
    setWorkspaceAuthority(null);
    setTextGenerator(null);
    resetLastKnownPrCache();
    fs.rmSync(cwd, { recursive: true, force: true });
  });
  git(cwd, 'init', '-b', 'main');
  git(cwd, 'config', 'user.name', 'Test');
  git(cwd, 'config', 'user.email', 'test@local');
  git(cwd, 'commit', '--allow-empty', '-m', 'base');
  git(cwd, 'remote', 'add', 'origin', `https://github.com/${headRemote === 'origin' ? headOwner : baseOwner}/app.git`);
  if (headRemote !== 'origin') git(cwd, 'remote', 'add', headRemote, `https://github.com/${headOwner}/app.git`);
  git(cwd, 'remote', 'add', 'upstream', target.url);
  git(cwd, 'update-ref', 'refs/remotes/upstream/main', 'HEAD');
  git(cwd, 'update-ref', 'refs/remotes/origin/main', 'HEAD');
  git(cwd, 'symbolic-ref', 'refs/remotes/origin/HEAD', 'refs/remotes/origin/main');
  git(cwd, 'checkout', '-b', 'feature');
  git(cwd, 'commit', '--allow-empty', '-m', 'feature change');
  git(cwd, 'update-ref', `refs/remotes/${headRemote}/${headBranch}`, 'HEAD');
  git(cwd, 'config', 'branch.feature.remote', headRemote);
  git(cwd, 'config', 'branch.feature.merge', `refs/heads/${headBranch}`);
  return cwd;
}

const input = { preserveProvided: true, title: 'Fix', body: 'Description' };
const value = (args, flag) => args[args.indexOf(flag) + 1];

for (const scenario of [
  { name: 'origin fork to upstream', expected: 'me:feature' },
  { name: 'same repository', headOwner: 'upstream', expected: 'feature' },
  { name: 'non-origin fork', headRemote: 'fork', expected: 'me:feature' },
  { name: 'renamed tracking branch on fork', headBranch: 'published', expected: 'me:published' },
]) {
  test(`PR create pins the target and head for ${scenario.name}`, async (t) => {
    const cwd = fixture(t, scenario);
    const result = await gitCreateChangeRequest(cwd, input);
    assert.equal(result.ok, true);
    assert.equal(calls.filter(args => args[1] === 'view').length, 1);
    const created = calls.find(args => args[1] === 'create');
    assert.equal(value(created, '--repo'), target.url);
    assert.equal(value(created, '--head'), scenario.expected);
    assert.equal(value(created, '--base'), 'main');
    for (const listed of calls.filter(args => args[1] === 'list')) {
      assert.equal(value(listed, '--repo'), target.url);
      assert.equal(value(listed, '--head'), scenario.headBranch || 'feature');
    }
  });
}

test('PR lookup ignores the same branch in another fork and opens the matching PR', async (t) => {
  const cwd = fixture(t);
  rows = ['other', 'me'].map((owner, index) => ({
    number: index + 1, title: 'Fix', url: `${target.url}/pull/${index + 1}`,
    headRefName: 'feature', baseRefName: 'main', state: 'OPEN', isCrossRepository: true,
    headRepository: { nameWithOwner: `${owner}/app` }, headRepositoryOwner: { login: owner },
  }));
  const result = await gitCreateChangeRequest(cwd, input);
  assert.equal(result.status, 'opened_existing');
  assert.equal(result.number, 2);
  assert.equal(calls.some(args => args[1] === 'create'), false);
});

for (const command of ['view', 'list']) {
  test(`PR creation stops when gh ${command} fails`, async (t) => {
    const cwd = fixture(t);
    failCommand = command;
    const result = await gitCreateChangeRequest(cwd, input);
    assert.equal(result.ok, false);
    assert.equal(calls.some(args => args[1] === 'create'), false);
  });
}

test('PR content uses the target remote history rather than the fork default', async (t) => {
  const cwd = fixture(t);
  git(cwd, 'update-ref', 'refs/remotes/origin/main', 'HEAD');
  let summary;
  setTextGenerator(async (request) => {
    summary = request.commitSummary;
    return { error: 'Stop after inspecting generated content input.' };
  });
  const result = await gitCreateChangeRequest(cwd, {});
  assert.equal(result.ok, false);
  assert.match(summary, /feature change/);
  assert.equal(calls.some(args => args[1] === 'create'), false);
});

test('PR content refuses an unfetched target base instead of using origin', async (t) => {
  const cwd = fixture(t);
  target.defaultBranchRef.name = 'develop';
  const result = await gitCreateChangeRequest(cwd, {});
  assert.equal(result.ok, false);
  assert.match(result.message, /Fetch the pull request target branch/);
  assert.equal(calls.some(args => args[1] === 'create'), false);
});

test('PR creation uses the target default instead of the origin default', async (t) => {
  const cwd = fixture(t);
  target.defaultBranchRef.name = 'develop';
  assert.equal((await gitCreateChangeRequest(cwd, input)).ok, true);
  assert.equal(value(calls.find(args => args[1] === 'create'), '--base'), 'develop');
});

test('explicit gh-merge-base overrides the target default', async (t) => {
  const cwd = fixture(t);
  git(cwd, 'config', 'branch.feature.gh-merge-base', 'release');
  assert.equal((await gitCreateChangeRequest(cwd, input)).ok, true);
  assert.equal(value(calls.find(args => args[1] === 'create'), '--base'), 'release');
});

test('malformed target metadata blocks creation', async (t) => {
  const cwd = fixture(t);
  target = { nameWithOwner: 'upstream/app' };
  assert.equal((await gitCreateChangeRequest(cwd, input)).ok, false);
  assert.equal(calls.some(args => args[1] === 'create'), false);
});

test('PR badge cache does not survive a target repository change', async (t) => {
  const cwd = fixture(t);
  const looked = await lookupOpenPullRequest(cwd, 'feature');
  rememberLastKnownPr('key', { ...looked.headContext, pr: { number: 1 } });
  assert.deepEqual(resolveLastKnownPr('key', looked.headContext), { number: 1 });
  assert.equal(resolveLastKnownPr('key', { ...looked.headContext, targetRepositoryUrlKey: 'github.com/other/app' }), null);
  assert.deepEqual(resolveLastKnownPr('key', { ...looked.headContext, targetRepositoryUrlKey: undefined }), { number: 1 });
});
