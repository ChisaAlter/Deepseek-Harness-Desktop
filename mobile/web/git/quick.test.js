import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveGitQuick } from './quick.js';
import { parseVcsStatus } from './vcs-parse.js';

function status(extra = {}) {
  return parseVcsStatus({ isRepo: true, ...extra });
}

// 决策表与 GitQuickShellTest.kt gitQuickUsesEnglishLabels 同表维护。
test('busy always shows disabled Commit with busy hint', () => {
  const quick = resolveGitQuick(status({ refName: 'main', hasWorkingTreeChanges: true }), true);
  assert.equal(quick.label, 'Commit');
  assert.equal(quick.disabled, true);
  assert.equal(quick.kind, 'show_hint');
  assert.equal(quick.hint, 'Git 操作进行中。');
});

test('no branch shows disabled Commit', () => {
  const quick = resolveGitQuick(status({}), false);
  assert.equal(quick.disabled, true);
  assert.equal(quick.hint, '请先创建并检出分支。');
});

test('changes without upstream and remote resolves plain commit', () => {
  const quick = resolveGitQuick(status({ refName: 'feat', hasWorkingTreeChanges: true }), false);
  assert.equal(quick.label, 'Commit');
  assert.equal(quick.action, 'commit');
  assert.equal(quick.disabled, false);
});

// 对应 Kotlin dirtyDefault 用例。
test('changes on default ref resolves Commit & push', () => {
  const quick = resolveGitQuick(status({
    refName: 'main', hasWorkingTreeChanges: true, isDefaultRef: true, hasPrimaryRemote: true, hasUpstream: true,
  }), false);
  assert.equal(quick.label, 'Commit & push');
  assert.equal(quick.action, 'commit_push');
});

test('changes on feature ref resolves Commit, push & PR', () => {
  const quick = resolveGitQuick(status({
    refName: 'feat', hasWorkingTreeChanges: true, hasPrimaryRemote: true, hasUpstream: true,
  }), false);
  assert.equal(quick.label, 'Commit, push & PR');
  assert.equal(quick.action, 'commit_push_pr');
});

test('clean without upstream resolves Publish repository or Push', () => {
  assert.equal(resolveGitQuick(status({ refName: 'main' }), false).label, 'Publish repository');
  assert.equal(resolveGitQuick(status({ refName: 'main', hasPrimaryRemote: true }), false).label, 'Push');
});

test('diverged branch is disabled Sync branch', () => {
  const quick = resolveGitQuick(status({ refName: 'main', hasUpstream: true, aheadCount: 1, behindCount: 2 }), false);
  assert.equal(quick.label, 'Sync branch');
  assert.equal(quick.disabled, true);
});

// 对应 Kotlin behind 用例。
test('behind resolves Pull', () => {
  const quick = resolveGitQuick(status({ refName: 'main', hasUpstream: true, behindCount: 2 }), false);
  assert.equal(quick.label, 'Pull');
  assert.equal(quick.kind, 'run_pull');
});

test('ahead resolves Push on default ref and Push & create PR on feature ref', () => {
  const onDefault = resolveGitQuick(status({ refName: 'main', hasUpstream: true, aheadCount: 1, isDefaultRef: true }), false);
  assert.equal(onDefault.label, 'Push');
  assert.equal(onDefault.action, 'push');
  const onFeature = resolveGitQuick(status({ refName: 'feat', hasUpstream: true, aheadCount: 1 }), false);
  assert.equal(onFeature.label, 'Push & create PR');
  assert.equal(onFeature.action, 'create_pr');
});

test('clean with open PR resolves View PR', () => {
  const quick = resolveGitQuick(status({ refName: 'feat', hasUpstream: true, pr: { state: 'open', number: 3 } }), false);
  assert.equal(quick.label, 'View PR');
  assert.equal(quick.kind, 'open_pr');
});

// 对应 Kotlin idle 用例。
test('clean synced branch is disabled Commit with up-to-date hint', () => {
  const quick = resolveGitQuick(status({ refName: 'main', hasUpstream: true, isDefaultRef: true }), false);
  assert.equal(quick.label, 'Commit');
  assert.equal(quick.disabled, true);
  assert.equal(quick.hint, '分支已是最新，无需操作。');
});
