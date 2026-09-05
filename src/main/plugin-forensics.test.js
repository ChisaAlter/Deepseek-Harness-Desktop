'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
  classifyGenericFailure,
  extractSuspectNames,
  extractEvidence,
  buildForensicsSummary,
  inspectPlugins,
  isPresetPlugin,
  isInBoxPackageName,
} = require('./plugin-forensics');

test('extractSuspectNames reads bundle, package, and compose failures', () => {
  const text = [
    'cannot resolve profile bundle "evil-pack"',
    "Cannot find package 'missing-mod'",
    'ERR_MODULE_NOT_FOUND: Cannot find package "@acme/broken"',
    'failed to compose client package "@acme/compose"',
  ].join('\n');
  assert.deepEqual(extractSuspectNames(text).sort(), [
    '@acme/broken',
    '@acme/compose',
    'evil-pack',
    'missing-mod',
  ]);
});

test('generic crashes are not blamed on a plugin', () => {
  assert.equal(classifyGenericFailure('FATAL ERROR: Reached heap limit Allocation failed - JavaScript heap out of memory'), 'oom');
  assert.equal(classifyGenericFailure('listen EADDRINUSE: address already in use 127.0.0.1:3080'), 'port-in-use');
  assert.equal(classifyGenericFailure("'node' is not recognized as an internal or external command"), 'missing-node');
  const inspected = inspectPlugins({
    logs: 'heap out of memory\ncannot resolve profile bundle "evil-pack"',
    plugins: [{ name: 'evil-pack', spec: '1.0.0' }],
    bundles: ['evil-pack'],
  });
  assert.equal(inspected.genericCause, 'oom');
  assert.deepEqual(inspected.suspects, []);
  assert.equal(inspected.plugins[0].suspect, false);
});

test('loader application failures identify the leaf plugin rather than the include wrapper', () => {
  const logs = 'failed to apply loader entry include (cordis:include): failed to apply loader entry stats (@acme/stats): invalid stored record';
  assert.deepEqual(extractSuspectNames(logs), ['@acme/stats']);
  const result = inspectPlugins({ logs, plugins: [{ name: '@acme/stats' }] });
  assert.equal(result.plugins[0].suspect, true);
  assert.equal(result.evidence[0].name, '@acme/stats');
});

test('legacy session cache schema failures are not attributed to user plugins', () => {
  const logs = "failed to apply loader entry session-projection-cache (@deepseek-ai/dsh-session-projection-cache): domain 'session_projcache': stored record 'old' in table 'sessions' does not match its schema";
  const result = inspectPlugins({ logs, pluginTreeFailure: true, plugins: [{ name: '@acme/stats' }] });
  assert.equal(result.genericCause, 'session-cache');
  assert.equal(result.desktopRuntimeDamage, false);
  assert.deepEqual(result.suspects, []);
  assert.equal(result.plugins[0].suspect, false);
  assert.equal(classifyGenericFailure("domain 'other': stored record 'old' does not match its schema"), '');
});

test('an incompatible user-installed dshbot is a disableable suspect, not desktop damage', () => {
  const logs = "failed to apply loader entry include (cordis:include): failed to import loader entry dsh-bot (dshbot): The requested module '@deepseek-ai/dsh-settings' does not provide an export named 'settingsNamespace'";
  const result = inspectPlugins({ logs, pluginTreeFailure: true, plugins: [{ name: 'dshbot' }, { name: 'other-plugin' }], bundles: ['dshbot', 'other-plugin'] });
  assert.deepEqual(extractSuspectNames(logs), ['dshbot']);
  assert.equal(result.desktopRuntimeDamage, false);
  assert.equal(result.plugins.find(row => row.name === 'dshbot').suspect, true);
  assert.equal(result.plugins.find(row => row.name === 'other-plugin').suspect, false);
  assert.equal(isPresetPlugin('dshbot'), false);
});

test('inspectPlugins flags suspects and presets without deleting the latter', () => {
  const inspected = inspectPlugins({
    logs: 'cannot resolve profile bundle "evil-pack"',
    plugins: [
      { name: 'dsh-usage-panel', spec: 'file:vendor' },
      { name: 'evil-pack', spec: '1.0.0' },
    ],
    bundles: ['dsh-usage-panel', 'evil-pack'],
    disabledPlugins: ['evil-pack'],
  });
  assert.equal(inspected.plugins.find((row) => row.name === 'dsh-usage-panel').preset, true);
  assert.equal(inspected.plugins.find((row) => row.name === 'evil-pack').suspect, true);
  assert.equal(inspected.plugins.find((row) => row.name === 'evil-pack').disabled, true);
  assert.equal(isPresetPlugin('dsh-usage-panel'), true);
  // dshbot is a standalone user plugin now, so forensics may suspect/disable it.
  assert.equal(isPresetPlugin('dshbot'), false);
  // The marketplace is desktop-owned code, not a mounted preset plugin.
  assert.equal(isPresetPlugin('dshmarket'), false);
  assert.equal(isPresetPlugin('evil-pack'), false);
});

test('inspectPlugins surfaces orphan suspects, evidence, and summary', () => {
  const inspected = inspectPlugins({
    logs: 'cannot resolve profile bundle "ghost-pack"',
    lastStartError: 'failed to compose client package "@acme/broken"',
    pluginTreeFailure: true,
    recovery: { skipUserPlugins: true, reason: 'test', at: '2026-01-01', appVersion: '1.0.0' },
    plugins: [{ name: 'good', spec: '1.0.0' }],
    bundles: ['good'],
  });
  assert.equal(inspected.orphanSuspects.length, 2);
  assert.ok(inspected.evidence.length >= 2);
  assert.equal(inspected.recovery.skipUserPlugins, true);
  assert.equal(inspected.pluginTreeFailure, true);
  assert.equal(inspected.summary.suspectCount, 4);
  assert.equal(inspected.summary.hasOrphans, true);
  assert.deepEqual(buildForensicsSummary(inspected).suspectCount, 4);
});

test('in-box fork package suspects are flagged as desktop runtime damage', () => {
  assert.equal(isInBoxPackageName('@deepseek-ai/dsh-client-ui-settings-market'), true);
  assert.equal(isInBoxPackageName('@deepseek-ai/dsh-client-ui-settings-market/client'), true);
  assert.equal(isInBoxPackageName('@acme/unrelated'), false);

  const inspected = inspectPlugins({
    logs: "Cannot find package '@deepseek-ai/dsh-client-ui-settings-market' imported from /profiles/web/",
    pluginTreeFailure: true,
    plugins: [{ name: 'good', spec: '1.0.0' }],
    bundles: ['good'],
  });
  assert.equal(inspected.desktopRuntimeDamage, true);
  assert.equal(inspected.summary.desktopRuntimeDamage, true);
  const row = inspected.orphanSuspects.find(
    (item) => item.name === '@deepseek-ai/dsh-client-ui-settings-market',
  );
  assert.equal(row.inBox, true);
  assert.equal(row.orphan, true);
});

test('desktop built-in dsh-im suspects are flagged as desktop runtime damage', () => {
  assert.equal(isInBoxPackageName('@xmanrui/dsh-im'), true);
  assert.equal(isInBoxPackageName('@xmanrui/dsh-im/client'), true);
  assert.equal(isInBoxPackageName('dsh-im'), true);

  const inspected = inspectPlugins({
    logs: "Cannot find package '@xmanrui/dsh-im' imported from /profiles/web/",
    pluginTreeFailure: true,
    plugins: [{ name: 'good', spec: '1.0.0' }],
    bundles: ['good'],
  });
  assert.equal(inspected.desktopRuntimeDamage, true);
  const row = inspected.orphanSuspects.find((item) => item.name === '@xmanrui/dsh-im');
  assert.equal(row.inBox, true);
});

test('desktop built-in usage-panel suspects are flagged as desktop runtime damage', () => {
  assert.equal(isInBoxPackageName('dsh-usage-panel'), true);
  assert.equal(isInBoxPackageName('dsh-usage-panel/client'), true);

  const inspected = inspectPlugins({
    logs: "Cannot find package 'dsh-usage-panel' imported from /profiles/web/",
    pluginTreeFailure: true,
    plugins: [{ name: 'good', spec: '1.0.0' }],
    bundles: ['good'],
  });
  assert.equal(inspected.desktopRuntimeDamage, true);
  const row = inspected.orphanSuspects.find((item) => item.name === 'dsh-usage-panel');
  assert.equal(row.inBox, true);
  assert.equal(row.preset, true);
});

test('desktop install overlay path suspects are flagged as desktop runtime damage', () => {
  assert.equal(
    isInBoxPackageName('file:///dsh-home/profiles/web/desktop-plugins/install-dsh-plugin/install-dsh-plugin.mjs'),
    true,
  );
  assert.equal(
    isInBoxPackageName('C:\\dsh-home\\profiles\\web\\desktop-plugins\\install-dsh-plugin\\install-dsh-plugin.mjs'),
    true,
  );
  assert.equal(isInBoxPackageName('install-dsh-plugin'), false);
});

test('a profile plugin shadowing an in-box name stays a disableable suspect', () => {
  const inspected = inspectPlugins({
    logs: "Cannot find package '@deepseek-ai/dsh-client-ui-settings-market'",
    plugins: [{ name: '@deepseek-ai/dsh-client-ui-settings-market', spec: '1.0.0' }],
    bundles: [],
  });
  assert.equal(inspected.desktopRuntimeDamage, false);
  assert.equal(inspected.summary.desktopRuntimeDamage, false);
  assert.equal(inspected.orphanSuspects.length, 0);
  assert.equal(inspected.plugins[0].suspect, true);
  assert.equal(inspected.plugins[0].inBox, undefined);
});

test('non in-box orphans do not raise the runtime damage flag', () => {
  const inspected = inspectPlugins({
    logs: 'cannot resolve profile bundle "ghost-pack"',
    plugins: [],
    bundles: [],
  });
  assert.equal(inspected.desktopRuntimeDamage, false);
  assert.equal(inspected.orphanSuspects[0].inBox, false);
});
