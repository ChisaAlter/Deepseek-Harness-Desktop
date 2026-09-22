'use strict';

/**
 * Shared profile/config mutation core for the two surfaces that flip plugins
 * or renderer-writable settings: the launcher/harness IPC handlers in
 * ipc.js and the loopback desktop-control channel (desktop-install-control)
 * that in-Harness plugins such as dsh-whale call. The module-level align
 * chain below serializes disable/enable writes with their Harness restart
 * across BOTH surfaces, so a second caller cannot join a restart that
 * started before its write landed.
 */

const { loadConfig, saveConfig, normalizeRendererConfigPatch } = require('./config');
const {
  applyDisabledBundles,
  setBundleEnabled,
  OFFICIAL_TEMPLATE_BUNDLES,
} = require('./plugins');
const { DSH_IM_ALIASES } = require('./dsh-im-desktop');
const { DSHBOT_ALIASES } = require('./dshbot-desktop');
const { DSH_MARKET_ALIASES } = require('./dsh-market-desktop');
const { DSH_WHALE_ALIASES } = require('./dsh-whale-desktop');
const { USAGE_PANEL_ALIASES } = require('./usage-panel-preset');
const { isPresetPlugin } = require('./plugin-forensics');

const HARNESS_DOWN_AFTER_DISABLE = '插件禁用名单已写入，但 Harness 没有重新起来。请从现有入口重启。';
const HARNESS_DOWN_AFTER_ENABLE = '插件启用已写入，但 Harness 没有重新起来。请从现有入口重启。';

function uniqueNames(names) {
  return [...new Set((Array.isArray(names) ? names : [])
    .map((name) => String(name || '').trim())
    .filter(Boolean))];
}

function pluginDisableGuardError(name) {
  if (OFFICIAL_TEMPLATE_BUNDLES.has(name)) {
    return 'official-template';
  }
  if (DSH_IM_ALIASES.includes(name)
    || DSH_MARKET_ALIASES.includes(name)
    || DSHBOT_ALIASES.includes(name)
    || DSH_WHALE_ALIASES.includes(name)
    || USAGE_PANEL_ALIASES.includes(name)) {
    return 'desktop-builtin';
  }
  return null;
}

/** Removal guards mirror the launcher's remove-plugin channel. */
function pluginRemoveGuardError(name) {
  if (isPresetPlugin(name) || OFFICIAL_TEMPLATE_BUNDLES.has(name)) {
    return 'preset';
  }
  return null;
}

function dshKernelState(dsh) {
  if (!dsh) {
    return '';
  }
  if (typeof dsh.state === 'string' && dsh.state) {
    return dsh.state;
  }
  if (typeof dsh.snapshot === 'function') {
    return dsh.snapshot().state || '';
  }
  return '';
}

function kernelNeedsAlign(dsh) {
  const state = dshKernelState(dsh);
  return state === 'ready' || state === 'starting' || state === 'error';
}

function kernelIsRunning(dsh) {
  const state = dshKernelState(dsh);
  return state !== 'idle' && state !== '';
}

let profileAlignChain = Promise.resolve();

function enqueueProfileAlign(work) {
  const run = profileAlignChain.then(work, work);
  profileAlignChain = run.catch(() => {});
  return run;
}

async function alignHarnessAfterProfileChange(startHarness, downError) {
  if (typeof startHarness !== 'function') {
    return { harnessRestarted: false, error: downError };
  }
  try {
    await startHarness();
    return { harnessRestarted: true };
  } catch {
    return { harnessRestarted: false, error: downError };
  }
}

/**
 * Disable user plugins: union into disabledPlugins, rewrite the profile
 * bundle list, then realign Harness when a kernel is live. Mirrors the
 * launcher's shell:disable-plugins / shell:disable-plugin handlers.
 */
async function disablePlugins(names, { dsh, startHarness } = {}) {
  const list = uniqueNames(names);
  if (!list.length) {
    return { ok: false, error: 'missing-names' };
  }
  for (const raw of list) {
    const guardError = pluginDisableGuardError(raw);
    if (guardError) {
      return { ok: false, error: guardError, name: raw };
    }
  }
  const config = loadConfig();
  const disabled = [...new Set([...(config.disabledPlugins || []), ...list])];
  applyDisabledBundles(disabled);
  saveConfig({ disabledPlugins: disabled });
  if (!kernelNeedsAlign(dsh)) {
    return { ok: true, harnessRestarted: false };
  }
  return enqueueProfileAlign(async () => {
    const align = await alignHarnessAfterProfileChange(startHarness, HARNESS_DOWN_AFTER_DISABLE);
    return { ok: true, ...align };
  });
}

/**
 * Re-enable one plugin: drop it from disabledPlugins, put its bundle back
 * (when still a dependency), then realign. Mirrors shell:enable-plugin —
 * including the quirk that the disabled-list write commits even when the
 * bundle re-add reports a failure.
 */
async function enablePlugin(name, { dsh, startHarness } = {}) {
  const raw = String(name || '').trim();
  if (!raw) {
    return { ok: false, error: 'missing-name' };
  }
  const disabled = (loadConfig().disabledPlugins || []).filter((item) => item !== raw);
  const enabled = setBundleEnabled(raw, true);
  applyDisabledBundles(disabled);
  saveConfig({ disabledPlugins: disabled });
  if (enabled.ok === false) {
    return { ok: false, ...enabled, harnessRestarted: false };
  }
  if (!kernelNeedsAlign(dsh)) {
    return { ok: true, ...enabled, harnessRestarted: false };
  }
  return enqueueProfileAlign(async () => {
    const align = await alignHarnessAfterProfileChange(startHarness, HARNESS_DOWN_AFTER_ENABLE);
    return { ok: true, ...enabled, ...align };
  });
}

/**
 * Apply a renderer-writable config patch with the same normalization and
 * side effects as shell:save-config: login item, theme apply, Harness
 * restart-policy refresh, and a deferred profile-align restart when a
 * built-in plugin toggle changed. Returns the saved config.
 */
function applyRendererConfigPatch(patch, { app, applyAppTheme, harness, startHarness, log } = {}) {
  const safePatch = normalizeRendererConfigPatch(patch || {});
  const next = saveConfig(safePatch);
  if (app && typeof app.setLoginItemSettings === 'function') {
    app.setLoginItemSettings({ openAtLogin: Boolean(next.openAtLogin) });
  }
  if (Object.prototype.hasOwnProperty.call(safePatch, 'theme') && typeof applyAppTheme === 'function') {
    applyAppTheme();
  }
  if (harness && [
    'harnessAutoRestart',
    'harnessRestartMaxAttempts',
    'harnessRestartBaseDelayMs',
  ].some((key) => Object.prototype.hasOwnProperty.call(safePatch, key))) {
    harness.refreshPolicy();
  }
  if (
    harness
    && typeof startHarness === 'function'
    && (Object.prototype.hasOwnProperty.call(safePatch, 'dshbotEnabled')
      || Object.prototype.hasOwnProperty.call(safePatch, 'whaleAssistantEnabled'))
  ) {
    // The Bots / whale-assistant toggles change which overlays the next
    // start composes: return the saved config first, then restart Harness
    // off-thread.
    setImmediate(() => {
      void enqueueProfileAlign(() => alignHarnessAfterProfileChange(startHarness, 'built-in plugin toggle restart failed'))
        .then((result) => {
          if (result && result.harnessRestarted !== true && typeof log === 'function') {
            log(`切换内置插件后重启 Harness 失败：${result.error || 'unknown'}`);
          }
        })
        .catch(() => {});
    });
  }
  return next;
}

module.exports = {
  HARNESS_DOWN_AFTER_DISABLE,
  HARNESS_DOWN_AFTER_ENABLE,
  pluginDisableGuardError,
  pluginRemoveGuardError,
  dshKernelState,
  kernelNeedsAlign,
  kernelIsRunning,
  enqueueProfileAlign,
  alignHarnessAfterProfileChange,
  disablePlugins,
  enablePlugin,
  applyRendererConfigPatch,
};
