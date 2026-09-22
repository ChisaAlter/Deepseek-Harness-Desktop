'use strict';

async function retryFullPluginsFromIpc({
  harness,
  startHarness,
  saveConfig,
  emptyPluginRecovery,
  cleanup,
}) {
  if (harness) {
    if (typeof cleanup === 'function') cleanup();
    return harness.retryFullPlugins();
  }
  saveConfig({ pluginRecovery: emptyPluginRecovery() });
  await startHarness();
  return undefined;
}

async function restartAfterPluginUninstall({
  ok,
  stopped,
  retryFull,
  startHarness,
}) {
  if (ok) return retryFull();
  if (stopped) return startHarness();
  return undefined;
}

module.exports = {
  retryFullPluginsFromIpc,
  restartAfterPluginUninstall,
};
