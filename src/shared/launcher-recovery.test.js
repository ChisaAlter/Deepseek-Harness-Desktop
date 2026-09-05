'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
  shouldShowRecovery,
  recoveryVerdict,
  desktopRuntimeDamageVerdict,
  sortPluginRows,
  pluginErrorLabel,
} = require('./launcher-recovery');

test('shouldShowRecovery covers sticky skip, last failure, suspects, and generic causes', () => {
  assert.equal(shouldShowRecovery(null, { skipUserPlugins: true }, null, null), true);
  assert.equal(shouldShowRecovery({ ok: false, error: 'boom' }, null, null, null), true);
  assert.equal(shouldShowRecovery(null, null, { genericCause: 'oom' }, null), true);
  assert.equal(shouldShowRecovery(null, null, { suspects: [{ name: 'evil' }] }, null), true);
  assert.equal(shouldShowRecovery(null, null, null, { state: 'error' }), true);
  assert.equal(shouldShowRecovery({ ok: null }, null, { plugins: [] }, { state: 'ready' }), false);
});

test('recoveryVerdict explains sticky skip and suspects', () => {
  assert.match(
    recoveryVerdict(null, { skipUserPlugins: true }, null),
    /跳过用户插件/,
  );
  assert.match(
    recoveryVerdict(null, null, { suspects: [{ name: 'evil-pack' }] }),
    /evil-pack/,
  );
  assert.match(
    recoveryVerdict({ ok: false, error: 'tree failed' }, null, null),
    /上次启动失败/,
  );
});

test('sortPluginRows prioritizes orphans and suspects', () => {
  const rows = sortPluginRows([
    { name: 'zeta', suspect: false },
    { name: 'alpha', suspect: true },
    { name: 'orphan', orphan: true, suspect: true },
  ]);
  assert.deepEqual(rows.map((row) => row.name), ['orphan', 'alpha', 'zeta']);
});

test('in-box runtime damage outranks sticky skip and blames no plugin', () => {
  const forensics = {
    desktopRuntimeDamage: true,
    orphanSuspects: [
      { name: '@deepseek-ai/dsh-client-ui-settings-market', inBox: true },
      { name: 'ghost-pack', inBox: false },
    ],
  };
  const verdict = recoveryVerdict(null, { skipUserPlugins: true }, forensics);
  assert.match(verdict, /内置组件损坏/);
  assert.match(verdict, /@deepseek-ai\/dsh-client-ui-settings-market/);
  assert.doesNotMatch(verdict, /ghost-pack/);
  assert.doesNotMatch(verdict, /恢复完整插件/);
  assert.match(verdict, /setup:harness/);
  assert.equal(desktopRuntimeDamageVerdict(forensics), verdict);

  const rows = sortPluginRows([
    { name: 'orphan', orphan: true, suspect: true },
    { name: '@deepseek-ai/dsh-client-ui-settings-market', orphan: true, suspect: true, inBox: true },
  ]);
  assert.equal(rows[0].name, '@deepseek-ai/dsh-client-ui-settings-market');
});

test('pluginErrorLabel maps known codes', () => {
  assert.equal(pluginErrorLabel('official-template'), '官方模板插件不可禁用。');
  assert.equal(pluginErrorLabel('unknown-code'), 'unknown-code');
});

test('session cache diagnosis outranks sticky skip without recommending plugin removal', () => {
  const verdict = recoveryVerdict(null, { skipUserPlugins: true }, { genericCause: 'session-cache' });
  assert.match(verdict, /会话缓存/);
  assert.match(verdict, /不要删除/);
  assert.doesNotMatch(verdict, /恢复完整插件/);
});
