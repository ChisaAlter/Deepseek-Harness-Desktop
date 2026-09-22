'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  retryFullPluginsFromIpc,
  restartAfterPluginUninstall,
} = require('./plugin-recovery-actions');

test('retryFullPluginsFromIpc clears skip through harness.retryFullPlugins', async () => {
  const calls = [];
  await retryFullPluginsFromIpc({
    harness: {
      retryFullPlugins: async () => {
        calls.push('retry');
        return { pluginRecovery: { skipUserPlugins: false } };
      },
    },
    cleanup: () => calls.push('cleanup'),
    startHarness: async () => calls.push('start'),
    saveConfig: () => calls.push('save'),
    emptyPluginRecovery: () => ({ skipUserPlugins: false }),
  });
  assert.deepEqual(calls, ['cleanup', 'retry']);
});

test('retryFullPluginsFromIpc without harness saves empty recovery then starts', async () => {
  const calls = [];
  await retryFullPluginsFromIpc({
    harness: null,
    startHarness: async () => calls.push('start'),
    saveConfig: (patch) => calls.push(`save:${patch.pluginRecovery.skipUserPlugins}`),
    emptyPluginRecovery: () => ({ skipUserPlugins: false }),
  });
  assert.deepEqual(calls, ['save:false', 'start']);
});

test('successful skip uninstall retries full; failed uninstall after stop does not', async () => {
  const calls = [];
  await restartAfterPluginUninstall({
    ok: true,
    stopped: true,
    retryFull: async () => calls.push('retry'),
    startHarness: async () => calls.push('start'),
  });
  await restartAfterPluginUninstall({
    ok: false,
    stopped: true,
    retryFull: async () => calls.push('retry'),
    startHarness: async () => calls.push('start'),
  });
  assert.deepEqual(calls, ['retry', 'start']);
});
