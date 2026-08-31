import test from 'node:test';
import assert from 'node:assert/strict';
import { parseVcsStatus, parseBranchList } from './vcs-parse.js';

// 对应 GitQuickShellTest.kt parseVcsStatusReadsNullPr。
test('parseVcsStatus reads null pr', () => {
  const status = parseVcsStatus(JSON.parse(
    '{"isRepo":true,"refName":"main","hasWorkingTreeChanges":true,"pr":null}',
  ));
  assert.equal(status.refName, 'main');
  assert.equal(status.hasWorkingTreeChanges, true);
  assert.equal(status.pr, null);
});

// 对应 GitQuickShellTest.kt parseVcsStatusReadsShellJson（src/main/git.js gitStatus 真实输出形状）。
test('parseVcsStatus reads desktop shell json', () => {
  const status = parseVcsStatus(JSON.parse(
    '{"isRepo":true,"refName":"feat","hasWorkingTreeChanges":true,"aheadCount":1,"behindCount":0,'
    + '"isDefaultRef":false,"hasPrimaryRemote":true,"hasUpstream":true}',
  ));
  assert.equal(status.refName, 'feat');
  assert.equal(status.hasWorkingTreeChanges, true);
  assert.equal(status.aheadCount, 1);
  assert.equal(status.hasPrimaryRemote, true);
});

test('parseVcsStatus defaults on missing input like VcsParse.kt', () => {
  const empty = parseVcsStatus(null);
  assert.equal(empty.isRepo, false);
  assert.equal(empty.refName, null);
  assert.equal(empty.aheadCount, 0);
  assert.equal(empty.pr, null);
  const bare = parseVcsStatus({});
  assert.equal(bare.isRepo, true, 'isRepo defaults true when object present (isRepo !== false)');
});

test('parseVcsStatus keeps open pr info', () => {
  const status = parseVcsStatus({ isRepo: true, refName: 'main', pr: { state: 'open', number: 7, url: 'https://x/pr/7' } });
  assert.deepEqual(status.pr, { state: 'open', number: 7, url: 'https://x/pr/7' });
});

// 对应 GitQuickShellTest.kt parseBranchListReadsGitShellJson。
test('parseBranchList reads git shell json', () => {
  const branches = parseBranchList(JSON.parse(
    '{"ok":true,"branches":[{"name":"main","isCurrent":true,"isRemote":false},'
    + '{"name":"feat","isCurrent":false,"isRemote":false}]}',
  ));
  assert.equal(branches.length, 2);
  assert.equal(branches[0].name, 'main');
  assert.equal(branches[0].isCurrent, true);
  assert.equal(branches[1].name, 'feat');
});

test('parseBranchList drops malformed rows and missing list', () => {
  assert.deepEqual(parseBranchList(null), []);
  assert.deepEqual(parseBranchList({}), []);
  assert.deepEqual(
    parseBranchList({ branches: [{ noName: true }, 'x', { name: 'origin/dev', isRemote: true }] }),
    [{ name: 'origin/dev', isRemote: true, isCurrent: false, switchable: true, hint: '' }],
  );
});
