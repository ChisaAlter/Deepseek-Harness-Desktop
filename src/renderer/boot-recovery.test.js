'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const {
  skipStartingCopy,
  startupErrorLabel,
  retryActionLabel,
  downloadLogLabel,
  openLauncherLabel,
  showLauncherBridge,
  isImportantBootLog,
} = require('./boot-recovery');

test('skip starting copy matches the spec', () => {
  assert.deepEqual(skipStartingCopy(), {
    status: '正在以官方组合启动',
    hint: '第三方插件导致上次启动失败，已暂时跳过',
  });
});

test('recovery-fail label is 启动失败 and retry stays 重试', () => {
  assert.equal(startupErrorLabel(), '启动失败');
  assert.equal(retryActionLabel(false), '重试');
  assert.equal(retryActionLabel(true), '立即重启');
  assert.equal(downloadLogLabel(), '下载日志');
});

test('launcher bridge shows only on a settled startup failure', () => {
  assert.equal(openLauncherLabel(), '回启动器排查');
  assert.equal(showLauncherBridge('error'), true);
  // Starting / ready / stopping never show the bridge — plugin-level
  // recovery lives on the launcher Recovery Board, reached from failures.
  for (const state of ['idle', 'starting', 'ready', 'stopping']) {
    assert.equal(showLauncherBridge(state), false, state);
  }
});

test('boot page error actions are transient-only plus the launcher bridge', () => {
  const html = fs.readFileSync(path.join(__dirname, 'boot.html'), 'utf8');
  const actions = html.slice(html.indexOf('id="actions"'), html.indexOf('</div>', html.indexOf('id="actions"')));
  assert.match(actions, /id="retry"/);
  assert.match(actions, /id="cancel-restart"/);
  assert.match(actions, /id="open-launcher"[^>]*hidden/);
  assert.match(actions, /id="save-log"/);
  // No plugin-level recovery controls on the boot page — the Recovery Board
  // owns attribution / per-plugin disable / skip.
  assert.doesNotMatch(actions, /disable|skip|forensic/i);
});

test('boot log filter keeps plugin-tree lines', () => {
  assert.equal(isImportantBootLog('plugin tree failed to load'), true);
  assert.equal(isImportantBootLog('cannot get property "tools" without inject'), true);
  assert.equal(isImportantBootLog('cannot resolve profile bundle "ghost"'), true);
  assert.equal(isImportantBootLog('listening on 127.0.0.1'), false);
});

test('boot.html loads boot-recovery.js before boot.js', () => {
  const html = fs.readFileSync(path.join(__dirname, 'boot.html'), 'utf8');
  const recovery = html.indexOf('src="boot-recovery.js"');
  const boot = html.indexOf('src="boot.js"');
  assert.ok(recovery >= 0);
  assert.ok(boot > recovery);
});
