const EventEmitter = require('events');
const { isPluginTreeFailure } = require('./plugin-tree-failure');
const { stickySkipActive } = require('./launcher-gate');
const { isDshbotPresetEnabled } = require('./dshbot-preset');

const DEFAULT_STABLE_MS = 60_000;
const MAX_RESTART_DELAY_MS = 30_000;

function errorMessage(error) {
  if (error instanceof Error) return error.message;
  if (error && typeof error === 'object' && typeof error.message === 'string') return error.message;
  return String(error || 'Harness 启动失败');
}

function operationCancelled(message = 'Harness 启动已取消') {
  const error = new Error(message);
  error.code = 'HARNESS_OPERATION_CANCELLED';
  return error;
}

function isCancellation(error) {
  return error?.code === 'DSH_CANCELLED' || error?.code === 'HARNESS_OPERATION_CANCELLED';
}

function emptyPluginRecovery() {
  return { skipUserPlugins: false, reason: '', at: '', appVersion: '' };
}

class HarnessController extends EventEmitter {
  constructor(options) {
    super();
    this.dsh = options.dsh;
    this.remote = options.remote;
    this.loadConfig = options.loadConfig;
    this.createMainWindow = options.createMainWindow;
    this.getMainWindow = options.getMainWindow;
    this.showBoot = options.showBoot;
    this.showHarness = options.showHarness;
    this.sendToBoot = options.sendToBoot;
    this.saveConfig = options.saveConfig || (() => {});
    this.appVersion = String(options.appVersion || '0.0.0');
    this.healDanglingBundles = options.healDanglingBundles || (() => ({ ok: true, changed: false }));
    this.isBootLoaded = options.isBootLoaded || (() => false);
    this.getHarnessWebContents = options.getHarnessWebContents || (() => null);
    this.resolveLaunchTarget = options.resolveLaunchTarget;
    this.stripDroppedPlugins = options.stripDroppedPlugins;
    this.ensureDesktopInstallPlugin = options.ensureDesktopInstallPlugin || (() => {});
    this.removeDshMarketPreset = options.removeDshMarketPreset
      || (async () => ({ ok: true, changed: false }));
    this.ensureUsagePanelPlugin = options.ensureUsagePanelPlugin
      || (async () => ({ ok: true, added: false }));
    this.ensureSessionSearchOverlay = options.ensureSessionSearchOverlay
      || (async () => ({ ok: true }));
    this.ensureDshImPlugin = options.ensureDshImPlugin
      || (async () => ({ ok: true, added: false }));
    this.ensureDshbotPlugin = options.ensureDshbotPlugin
      || (async () => ({ ok: true, added: false }));
    this.removeDshbotPreset = options.removeDshbotPreset
      || (async () => ({ ok: true, changed: false }));
    this.applyDisabledBundles = options.applyDisabledBundles
      || (() => ({ ok: true, changed: false }));
    this.ensureWorkspace = options.ensureWorkspace;
    this.setTimer = options.setTimer || setTimeout;
    this.clearTimer = options.clearTimer || clearTimeout;
    this.now = options.now || Date.now;
    this.stableMs = Number(options.stableMs) >= 0
      ? Number(options.stableMs)
      : DEFAULT_STABLE_MS;

    this.operation = null;
    this.operationGeneration = 0;
    this.restartOperation = null;
    this.recoveryTimer = null;
    this.stableTimer = null;
    this.recoveryTask = null;
    this.pluginRecoveryTask = null;
    this.recoveryGeneration = 0;
    this.shuttingDown = false;
    this.recovery = {
      status: 'inactive',
      attempt: 0,
      nextRetryAt: null,
      reason: '',
    };
    this.pluginRecovery = {
      ...emptyPluginRecovery(),
      ...((this.loadConfig() || {}).pluginRecovery || {}),
    };

    this.onDshState = (snapshot) => {
      this.sendState(snapshot);
      if (!this.shuttingDown && snapshot?.state === 'error' && snapshot?.failure?.phase === 'runtime') {
        this.operationGeneration += 1;
        const task = this.looksLikePluginTreeFailure()
          ? this.beginPluginTreeRecovery()
          : this.beginRuntimeRecovery();
        task.catch((error) => {
          this.dsh.log(`恢复流程失败：${errorMessage(error)}`, 'error');
        });
      }
    };
    this.onDshLog = (line) => this.sendToBoot('shell:log', line);
    this.dsh.on('state', this.onDshState);
    this.dsh.on('log', this.onDshLog);
  }

  policy() {
    const config = this.loadConfig() || {};
    return {
      enabled: config.harnessAutoRestart !== false,
      maxAttempts: Number(config.harnessRestartMaxAttempts) || 3,
      baseDelayMs: Number(config.harnessRestartBaseDelayMs) || 1000,
    };
  }

  snapshot(dshSnapshot = this.dsh.snapshot()) {
    const policy = this.policy();
    return {
      ...dshSnapshot,
      pluginRecovery: { ...this.pluginRecovery },
      recovery: {
        ...this.recovery,
        enabled: policy.enabled,
        maxAttempts: policy.maxAttempts,
      },
    };
  }

  sendState(dshSnapshot) {
    const snapshot = this.snapshot(dshSnapshot);
    this.sendToBoot('shell:state', snapshot);
    this.emit('state', snapshot);
    return snapshot;
  }

  setRecovery(patch) {
    this.recovery = { ...this.recovery, ...patch };
    return this.sendState();
  }

  clearRecoveryTimer() {
    if (this.recoveryTimer) {
      this.clearTimer(this.recoveryTimer);
      this.recoveryTimer = null;
    }
  }

  clearStableTimer() {
    if (this.stableTimer) {
      this.clearTimer(this.stableTimer);
      this.stableTimer = null;
    }
  }

  clearTimers() {
    this.clearRecoveryTimer();
    this.clearStableTimer();
  }

  async ensureBootVisible() {
    await this.showBoot();
  }

  async beginRuntimeRecovery() {
    if (this.recoveryTask) {
      return this.recoveryTask;
    }
    const generation = ++this.recoveryGeneration;
    const task = (async () => {
      this.clearTimers();
      await Promise.allSettled([
        this.syncRemoteLogged(),
        this.ensureBootVisible(),
      ]);
      if (this.shuttingDown || generation !== this.recoveryGeneration) {
        return this.snapshot();
      }
      return this.scheduleRecovery();
    })().finally(() => {
      if (this.recoveryTask === task) {
        this.recoveryTask = null;
      }
    });
    this.recoveryTask = task;
    return task;
  }

  looksLikePluginTreeFailure(error = null) {
    const snapshot = this.dsh.snapshot();
    return [
      errorMessage(error),
      snapshot?.error,
      snapshot?.failure?.message,
      ...(Array.isArray(snapshot?.logs) ? snapshot.logs : []),
    ].some((value) => isPluginTreeFailure(value));
  }

  writePluginSkip(error) {
    this.pluginRecovery = {
      skipUserPlugins: true,
      reason: errorMessage(error),
      at: new Date(this.now()).toISOString(),
      appVersion: this.appVersion,
    };
    this.saveConfig({ pluginRecovery: this.pluginRecovery });
    return this.sendState();
  }

  clearPluginRecovery() {
    this.pluginRecovery = emptyPluginRecovery();
    this.saveConfig({ pluginRecovery: this.pluginRecovery });
    return this.sendState();
  }

  shouldSkipUserPlugins() {
    if (!this.pluginRecovery.skipUserPlugins) return false;
    // Shared predicate with ipc.js — one truth for "sticky for this build".
    if (stickySkipActive(this)) return true;
    this.clearPluginRecovery();
    return false;
  }

  async beginPluginTreeRecovery() {
    if (this.pluginRecoveryTask) return this.pluginRecoveryTask;
    const task = (async () => {
      this.writePluginSkip(this.dsh.snapshot().failure || this.dsh.snapshot().error);
      await this.ensureBootVisible();
      if (this.shuttingDown) throw operationCancelled();
      return this.replaceOperation({ showBoot: false });
    })().finally(() => {
      if (this.pluginRecoveryTask === task) this.pluginRecoveryTask = null;
    });
    this.pluginRecoveryTask = task;
    return task;
  }

  scheduleRecovery() {
    if (this.shuttingDown) {
      return this.snapshot();
    }
    this.clearRecoveryTimer();
    const policy = this.policy();
    const consumedAttempts = this.recovery.attempt || 0;
    if (!policy.enabled) {
      return this.setRecovery({
        status: 'cancelled',
        attempt: consumedAttempts,
        nextRetryAt: null,
        reason: 'disabled',
      });
    }
    if (consumedAttempts >= policy.maxAttempts) {
      return this.setRecovery({
        status: 'exhausted',
        attempt: consumedAttempts,
        nextRetryAt: null,
        reason: 'attempts-exhausted',
      });
    }

    const attempt = consumedAttempts + 1;
    const delay = Math.min(
      policy.baseDelayMs * (2 ** (attempt - 1)),
      MAX_RESTART_DELAY_MS,
    );
    const nextRetryAt = this.now() + delay;
    const snapshot = this.setRecovery({
      status: 'scheduled',
      attempt,
      nextRetryAt,
      reason: '',
    });
    this.recoveryTimer = this.setTimer(() => {
      this.recoveryTimer = null;
      this.runAutomaticRestart(attempt).catch((error) => {
        this.dsh.log(`自动恢复失败：${errorMessage(error)}`, 'error');
      });
    }, delay);
    return snapshot;
  }

  async runAutomaticRestart(attempt) {
    if (this.shuttingDown || this.recovery.status !== 'scheduled' || this.recovery.attempt !== attempt) {
      return this.snapshot();
    }
    const recoveryGeneration = this.recoveryGeneration;
    this.setRecovery({ status: 'restarting', nextRetryAt: null, reason: '' });
    try {
      await this.replaceOperation({ showBoot: false });
      if (this.shuttingDown || recoveryGeneration !== this.recoveryGeneration) {
        return this.snapshot();
      }
      this.startStableWindow(attempt);
      return this.snapshot();
    } catch (error) {
      if (this.shuttingDown || recoveryGeneration !== this.recoveryGeneration) {
        throw error;
      }
      await this.ensureBootVisible().catch(() => {});
      this.recovery = {
        ...this.recovery,
        status: 'failed',
        attempt,
        nextRetryAt: null,
      };
      this.scheduleRecovery();
      throw error;
    }
  }

  startStableWindow(attempt) {
    this.clearStableTimer();
    this.setRecovery({ status: 'monitoring', attempt, nextRetryAt: null, reason: '' });
    this.stableTimer = this.setTimer(() => {
      this.stableTimer = null;
      if (this.shuttingDown || this.dsh.state !== 'ready') {
        return;
      }
      this.setRecovery({ status: 'inactive', attempt: 0, nextRetryAt: null, reason: '' });
    }, this.stableMs);
  }

  runOperation(work) {
    if (this.operation) {
      return this.operation;
    }
    const generation = ++this.operationGeneration;
    const task = Promise.resolve()
      .then(() => work(generation))
      .finally(() => {
        if (this.operation === task) {
          this.operation = null;
        }
      });
    this.operation = task;
    return task;
  }

  assertOperationCurrent(generation) {
    if (this.shuttingDown || generation !== this.operationGeneration) {
      throw operationCancelled();
    }
  }

  start() {
    return this.runOperation((generation) => this.performStart({ showBoot: true, generation }));
  }

  async replaceOperation({ showBoot }) {
    const previousOperation = this.operation;
    this.operationGeneration += 1;
    await this.dsh.stop();
    await this.ensureBootVisible().catch(() => {});
    await previousOperation?.catch(() => {});
    if (this.shuttingDown) {
      throw operationCancelled();
    }
    return this.runOperation((generation) => this.performStart({ showBoot, generation }));
  }

  restart() {
    // Never join an in-flight restart: callers that mutate skip/disabled lists
    // before restart() must get a performStart that re-reads those flags.
    const previous = this.restartOperation;
    const task = (async () => {
      if (previous) {
        await previous.catch(() => {});
      }
      if (this.shuttingDown) {
        throw operationCancelled();
      }
      this.recoveryGeneration += 1;
      this.recoveryTask = null;
      this.clearTimers();
      this.recovery = { status: 'inactive', attempt: 0, nextRetryAt: null, reason: '' };
      return this.replaceOperation({ showBoot: true });
    })().finally(() => {
      if (this.restartOperation === task) {
        this.restartOperation = null;
      }
    });
    this.restartOperation = task;
    return task;
  }

  setStartupFailure(error) {
    const message = errorMessage(error);
    const current = this.dsh.snapshot();
    if (current.failure?.phase === 'runtime') {
      return;
    }
    if (current.state !== 'error' || current.failure?.phase !== 'startup') {
      this.dsh.setState('error', {
        error: message,
        failure: {
          phase: 'startup',
          message,
          code: null,
          signal: null,
          occurredAt: new Date(this.now()).toISOString(),
        },
      });
      this.dsh.log(message, 'error');
    }
  }

  async performStartOnce({ showBoot, generation, skipUserPlugins }) {
    const win = this.createMainWindow();
    if (showBoot) {
      await this.showBoot();
    }
    this.assertOperationCurrent(generation);
    this.dsh.setState('starting', { error: '', failure: null });
    const target = await this.resolveLaunchTarget();
    try {
      this.stripDroppedPlugins();
    } catch (error) {
      this.dsh.log(`插件清理失败：${errorMessage(error)}`, 'app');
    }
    try {
      const healed = this.healDanglingBundles();
      if (healed?.removed?.length) {
        this.dsh.log(`已修复悬挂插件 bundle：${healed.removed.join(', ')}`, 'app');
      }
    } catch (error) {
      this.dsh.log(`插件 bundle 修复失败：${errorMessage(error)}`, 'app');
    }
    const desktopInstall = this.ensureDesktopInstallPlugin();
    if (desktopInstall && desktopInstall.ok === false) {
      throw new Error(`桌面安装插件写入失败：${desktopInstall.reason || 'unknown'}`);
    }
    // Desktop-owned rows ride --patch overlays on EVERY start; the profile's
    // cordis.patch.yml is purely user-owned (ensure only strips legacy
    // managed blocks). Never pass that file to --patch: overlays still apply
    // under --skip-user-plugins, so it would re-mount every user row the
    // skip exists to bypass. The install and dsh-im overlays are required on
    // all starts; usage and session-search overlays join below on full
    // starts only.
    const patchFiles = [];
    if (desktopInstall?.overlayFile) {
      patchFiles.push(desktopInstall.overlayFile);
    }
    // The marketplace is desktop-owned (settings section `market` +
    // main-process curated engine); every start only clears legacy
    // dshmarket preset residue, log-only on failure.
    try {
      const market = await this.removeDshMarketPreset();
      this.assertOperationCurrent(generation);
      if (market && market.ok === false) {
        this.dsh.log(`清理 dshmarket 预置残留失败：${market.error || 'unknown'}`, 'app');
      } else if (market && market.changed) {
        this.dsh.log('已清理 dshmarket 桌面预置残留（市场已内置到桌面设置）', 'app');
      }
    } catch (error) {
      this.dsh.log(`清理 dshmarket 预置残留失败：${errorMessage(error)}`, 'app');
    }
    if (!skipUserPlugins) {
      try {
        const usage = await this.ensureUsagePanelPlugin();
        this.assertOperationCurrent(generation);
        if (usage && usage.ok === false) {
          this.dsh.log(`预置用量统计失败：${usage.error || 'unknown'}`, 'app');
        } else if (usage?.overlayFile) {
          patchFiles.push(usage.overlayFile);
        }
      } catch (error) {
        this.dsh.log(`预置用量统计失败：${errorMessage(error)}`, 'app');
      }
      try {
        const search = await this.ensureSessionSearchOverlay();
        this.assertOperationCurrent(generation);
        if (search && search.ok === false) {
          this.dsh.log(`预置会话搜索失败：${search.error || 'unknown'}`, 'app');
        } else if (search?.overlayFile) {
          patchFiles.push(search.overlayFile);
        }
      } catch (error) {
        this.dsh.log(`预置会话搜索失败：${errorMessage(error)}`, 'app');
      }
    } else {
      this.dsh.log('跳过用户插件：不预置用量统计插件', 'app');
      this.dsh.log('跳过用户插件：不预置会话搜索', 'app');
    }
    // dsh-im is desktop built-in Settings → Remote → Channels — not a user
    // plugin. Its overlay rides --patch on every start (including
    // skipUserPlugins recovery); the disable list never applies; missing
    // vendor deps fail start (desktop runtime damage, skip cannot fix it).
    try {
      const im = await this.ensureDshImPlugin();
      this.assertOperationCurrent(generation);
      if (im && im.ok === false) {
        throw new Error(`桌面内置 dsh-im 失败：${im.error || 'unknown'}`);
      }
      if (im?.overlayFile) {
        patchFiles.push(im.overlayFile);
      }
      if (im && im.ok) {
        this.dsh.log(im.added ? '已接入桌面内置 dsh-im（消息渠道）' : '桌面内置 dsh-im 已就绪', 'app');
      }
    } catch (error) {
      if (isCancellation(error)) throw error;
      if (error instanceof Error && error.message.startsWith('桌面内置 dsh-im 失败：')) {
        throw error;
      }
      throw new Error(`桌面内置 dsh-im 失败：${errorMessage(error)}`);
    }
    // dshbot is a standalone plugin: never force-ensured, never blocks start.
    // Default starts only clean legacy desktop-preset residue (user installs
    // via `dsh plugin add` stay untouched); config `dshbotPreset: true` keeps
    // a dev copy of the workspace package refreshed, log-only on failure.
    if (!skipUserPlugins && isDshbotPresetEnabled(this.loadConfig() || {})) {
      try {
        const dshbot = await this.ensureDshbotPlugin();
        this.assertOperationCurrent(generation);
        if (dshbot && dshbot.ok === false) {
          this.dsh.log(`预置 dshbot（开发模式）失败：${dshbot.error || 'unknown'}`, 'app');
        } else if (dshbot) {
          this.dsh.log(dshbot.added ? '已预置 dshbot（开发模式）' : 'dshbot 开发预置已就绪', 'app');
        }
      } catch (error) {
        this.dsh.log(`预置 dshbot（开发模式）失败：${errorMessage(error)}`, 'app');
      }
    } else {
      try {
        const removed = await this.removeDshbotPreset();
        this.assertOperationCurrent(generation);
        if (removed && removed.ok === false) {
          this.dsh.log(`清理 dshbot 预置残留失败：${removed.error || 'unknown'}`, 'app');
        } else if (removed && removed.changed) {
          this.dsh.log('已清理 dshbot 桌面预置残留（独立安装的 dshbot 不受影响）', 'app');
        }
      } catch (error) {
        this.dsh.log(`清理 dshbot 预置残留失败：${errorMessage(error)}`, 'app');
      }
    }
    try {
      const disabled = this.applyDisabledBundles((this.loadConfig() || {}).disabledPlugins);
      if (disabled && disabled.changed) {
        this.dsh.log('已按启动器禁用名单更新插件 bundles', 'app');
      } else if (disabled && disabled.ok === false && disabled.reason) {
        this.dsh.log(`应用插件禁用名单跳过：${disabled.reason}`, 'app');
      }
    } catch (error) {
      this.dsh.log(`应用插件禁用名单失败：${errorMessage(error)}`, 'app');
    }
    const startOptions = {
      ...target,
      skipUserPlugins,
      patchFiles,
    };
    const url = await this.dsh.start(startOptions);
      this.assertOperationCurrent(generation);
      if (this.dsh.state !== 'ready') {
        throw operationCancelled('Harness 在打开界面前已停止');
      }
      const { workspace } = this.loadConfig();
      try {
        await this.ensureWorkspace(url, workspace);
        this.dsh.log(`已注册工作区 ${workspace}`);
      } catch (error) {
        this.dsh.log(`工作区自动注册跳过：${errorMessage(error)}`, 'app');
      }
      this.assertOperationCurrent(generation);
      if (this.dsh.state !== 'ready') {
        throw operationCancelled('Harness 在打开界面前已停止');
      }
    try {
      await this.showHarness(url);
      this.assertOperationCurrent(generation);
      if (this.dsh.state !== 'ready') {
        throw operationCancelled('Harness 在界面加载期间已停止');
      }
    } catch (error) {
      if (isCancellation(error) || this.dsh.failure?.phase === 'runtime') {
        await this.ensureBootVisible().catch(() => {});
        throw isCancellation(error)
          ? error
          : operationCancelled('Harness 在界面加载期间已停止');
      }
      await this.dsh.stop();
      throw new Error(`Web UI 加载失败：${errorMessage(error)}`);
    }
    await this.syncRemoteLogged();
    if (this.loadConfig().openDevTools) {
      const harnessWc = this.getHarnessWebContents(win);
      (harnessWc || win.webContents).openDevTools({ mode: 'detach' });
    }
    return url;
  }

  async performStart({ showBoot, generation }) {
    const skipUserPlugins = this.shouldSkipUserPlugins();
    try {
      return await this.performStartOnce({ showBoot, generation, skipUserPlugins });
    } catch (error) {
      if (!skipUserPlugins && !this.shuttingDown && !isCancellation(error) && this.looksLikePluginTreeFailure(error)) {
        await this.dsh.stop().catch(() => {});
        this.writePluginSkip(error);
        try {
          return await this.performStartOnce({ showBoot: false, generation, skipUserPlugins: true });
        } catch (recoveryError) {
          if (!this.shuttingDown && !isCancellation(recoveryError)) {
            this.setStartupFailure(recoveryError);
            await this.ensureBootVisible().catch(() => {});
            this.sendState();
          }
          throw recoveryError;
        }
      }
      if (!this.shuttingDown && !isCancellation(error)) {
        this.setStartupFailure(error);
        await this.ensureBootVisible().catch(() => {});
        this.sendState();
      }
      throw error;
    }
  }

  retryFullPlugins() {
    this.clearPluginRecovery();
    return this.restart();
  }

  reload() {
    const win = this.getMainWindow();
    if (!win) {
      return Promise.resolve(null);
    }
    if (this.dsh.state === 'ready' && this.dsh.baseUrl) {
      return this.showHarness(this.dsh.baseUrl);
    }
    return this.start();
  }

  cancelRecovery() {
    this.recoveryGeneration += 1;
    this.recoveryTask = null;
    this.clearTimers();
    return this.setRecovery({
      status: 'cancelled',
      nextRetryAt: null,
      reason: 'user',
    });
  }

  /**
   * User-initiated stop from the launcher: cancel recovery/restart work,
   * stop the dsh kernel, and leave the shell idle without quitting Electron.
   */
  async stopDesktop() {
    this.recoveryGeneration += 1;
    this.operationGeneration += 1;
    this.recoveryTask = null;
    this.clearTimers();
    this.setRecovery({
      status: 'cancelled',
      attempt: 0,
      nextRetryAt: null,
      reason: 'user-stop',
    });
    const pendingRestart = this.restartOperation;
    const pendingOperation = this.operation;
    await Promise.allSettled([
      pendingRestart?.catch(() => {}),
      pendingOperation?.catch(() => {}),
    ]);
    if (this.dsh.state !== 'idle') {
      await this.dsh.stop();
    }
    return this.snapshot();
  }

  refreshPolicy() {
    const policy = this.policy();
    if (!policy.enabled && this.recovery.status === 'scheduled') {
      this.recoveryGeneration += 1;
      this.clearTimers();
      return this.setRecovery({
        status: 'cancelled',
        nextRetryAt: null,
        reason: 'disabled',
      });
    }
    if (this.recovery.status === 'scheduled' && this.recovery.attempt > policy.maxAttempts) {
      this.clearRecoveryTimer();
      return this.setRecovery({
        status: 'exhausted',
        nextRetryAt: null,
        reason: 'attempts-exhausted',
      });
    }
    return this.sendState();
  }

  /**
   * Remote startup failures must never be silent: the popup only shows
   * `snapshot().error`, so the dsh log is the sole boot-time trace.
   */
  async syncRemoteLogged() {
    try {
      await this.remote?.sync?.();
    } catch (error) {
      this.dsh.log(`手机 Remote 同步失败：${errorMessage(error)}`, 'app');
    }
  }

  async shutdown() {
    if (this.shuttingDown) {
      return;
    }
    this.shuttingDown = true;
    this.recoveryGeneration += 1;
    this.recoveryTask = null;
    this.clearTimers();
    const currentOperation = this.operation;
    const currentRestart = this.restartOperation;
    await Promise.allSettled([
      this.dsh.stop(),
      // ChisaCodeRemote's teardown face is stopDaemon() — a bare stop() call
      // would optional-chain into a silent no-op and leak the daemon + :3180.
      this.remote?.stopDaemon?.(),
      currentOperation,
      currentRestart,
    ].filter(Boolean));
    this.dsh.off('state', this.onDshState);
    this.dsh.off('log', this.onDshLog);
  }
}

module.exports = {
  HarnessController,
  DEFAULT_STABLE_MS,
  MAX_RESTART_DELAY_MS,
};
