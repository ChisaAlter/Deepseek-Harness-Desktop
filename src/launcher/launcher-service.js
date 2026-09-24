const { app, dialog } = require('electron');
const { getLauncherWindow, getMainWindow, dismissMainWindow } = require('../main/window');
const update = require('../main/update');
const dataImport = require('../main/data-import');
const marketInstall = require('../main/marketplace-install');
const { listInstalledPlugins: listProfilePlugins, OFFICIAL_TEMPLATE_BUNDLES } = require('../main/plugins');
const { kernelIsRunning, disablePlugins, enablePlugin } = require('../main/profile-ops');
const { inspectPlugins, isPresetPlugin } = require('../main/plugin-forensics');
const { isPluginTreeFailure } = require('../main/plugin-tree-failure');
const { readLastDesktopStart, stickySkipActive, peekParkedUpdateCheck } = require('../main/launcher-gate');
const { loadConfig, saveConfig, normalizeLauncherConfigPatch } = require('../main/config');
const releaseSource = require('./release-source');
const runtimeInstall = require('./runtime-install');
const { isLauncherPackage, runtimeTarget, desktopStateDir } = require('./product');

function configLocale(config = loadConfig()) {
  return config.locale === 'en' ? 'en' : 'zh';
}

/**
 * The launcher's application service: every launcher-surface operation the
 * renderer can reach (status, desktop start/stop, releases, updates, import,
 * plugin forensics) lives here so ipc.js stays a thin authorization+transport
 * layer. `deps` carries the runtime handles only the composition root has —
 * the harness controller, its start/stop entry points, and the shared
 * configPayload builder (also used by the harness get-config surface).
 */
function createLauncherService(deps) {
  const {
    dsh,
    harness,
    startHarness,
    startDesktop,
    stopDesktopCleanup,
    configPayload,
  } = deps;

  function collectForensics() {
    const listed = listProfilePlugins();
    const config = loadConfig();
    const lastStart = readLastDesktopStart(desktopStateDir(app));
    const logs = Array.isArray(dsh?.logs)
      ? dsh.logs.map((row) => (typeof row === 'string' ? row : row.message || row.line || String(row)))
      : [];
    const corpus = [logs.join('\n'), lastStart.error].filter(Boolean).join('\n');
    const recovery = harness?.pluginRecovery && typeof harness.pluginRecovery === 'object'
      ? harness.pluginRecovery
      : (config.pluginRecovery || {});
    return inspectPlugins({
      logs,
      lastStartError: lastStart.error,
      pluginTreeFailure: isPluginTreeFailure(corpus),
      recovery,
      plugins: listed.plugins || [],
      bundles: listed.bundles || [],
      disabledPlugins: config.disabledPlugins,
    });
  }

  async function stopKernelIfRunning() {
    if (!dsh || typeof dsh.stop !== 'function') {
      return false;
    }
    if (!kernelIsRunning(dsh)) {
      return false;
    }
    await dsh.stop();
    return true;
  }

  // Releases without SHA512SUMS.txt must never install silently: the user
  // explicitly accepts the unverified download or nothing is fetched.
  async function confirmUnverifiedInstall(info) {
    const win = getLauncherWindow() || getMainWindow() || undefined;
    const en = configLocale() === 'en';
    const result = await dialog.showMessageBox(win, {
      type: 'warning',
      buttons: en ? ['Install anyway', 'Cancel'] : ['仍要安装', '取消'],
      defaultId: 1,
      cancelId: 1,
      title: en ? 'Unverified installer' : '安装包无法校验',
      message: en
        ? `Release ${info?.tag || info?.latest || ''} has no SHA512SUMS.txt manifest, so the installer cannot be verified. Install anyway?`
        : `版本 ${info?.tag || info?.latest || ''} 未提供 SHA512SUMS.txt 校验清单，无法验证安装包完整性。仍要下载并安装吗？`,
      noLink: true,
    });
    return result.response === 0;
  }

  let importAbort = null;

  async function runImportTask(options = {}, onProgress) {
    if (importAbort) {
      return { ok: false, error: 'import-in-progress' };
    }
    const controller = new AbortController();
    importAbort = controller;
    try {
      const kernelStopped = await stopKernelIfRunning();
      const sourceHome = typeof options.sourceHome === 'string' ? options.sourceHome : undefined;
      const extraSkillDirs = Array.isArray(options.extraSkillDirs)
        ? options.extraSkillDirs.filter((row) => typeof row === 'string')
        : [];
      const overwrite = options.overwrite === true;
      const userDataDir = desktopStateDir(app);
      const result = await dataImport.runImport({
        sourceHome,
        extraSkillDirs,
        overwrite,
        userDataDir,
        selectedRels: Array.isArray(options.selectedRels) ? options.selectedRels : [],
        selectedSkillIds: Array.isArray(options.selectedSkillIds) ? options.selectedSkillIds : [],
        selectedPluginNames: Array.isArray(options.selectedPluginNames) ? options.selectedPluginNames : [],
        selectedMcpIds: Array.isArray(options.selectedMcpIds) ? options.selectedMcpIds : [],
        selectedSettingIds: Array.isArray(options.selectedSettingIds) ? options.selectedSettingIds : [],
        selectedPresetIds: Array.isArray(options.selectedPresetIds) ? options.selectedPresetIds : [],
        importAttachments: options.importAttachments === true,
        signal: controller.signal,
        onProgress,
        installPlugin: (spec) => marketInstall.installImportPlugin(spec, { token: loadConfig().githubToken }),
      });
      return {
        ...result,
        kernelStopped,
        hold: dataImport.probeImportHold({ sourceHome, extraSkillDirs }).hold,
      };
    } finally {
      if (importAbort === controller) {
        importAbort = null;
      }
    }
  }

  // --- Managed-runtime (slim launcher) layer -------------------------------
  //
  // In the full package the launcher manages itself: installRelease/update
  // keep their self-update semantics (quit after launch). In the slim package
  // the same IPC ops retarget to the desktop product — the launcher survives
  // the installer and adopts the new registration instead of quitting. The
  // heavy lifting lives in runtime-install.js so the cold-start gate in
  // index.js can share it.

  function installedInfo(options) {
    return runtimeInstall.installedInfo(options);
  }

  function configuredRoute() {
    return runtimeInstall.configuredRoute();
  }

  function desktopSnapshot() {
    if (isLauncherPackage()) {
      const running = runtimeInstall.probeDesktopRunning();
      return { state: running ? 'running-external' : 'idle', external: true };
    }
    return harness ? harness.snapshot() : dsh.snapshot();
  }

  function installRuntimeOp(options = {}, onProgress) {
    return runtimeInstall.installRuntime(options, onProgress, {
      confirmUnverified: confirmUnverifiedInstall,
    });
  }

  async function installUpdateOp(onProgress) {
    if (isLauncherPackage()) {
      return installRuntimeOp({}, onProgress);
    }
    try {
      return await update.installUpdate(onProgress, { confirmUnverified: confirmUnverifiedInstall });
    } catch (error) {
      return {
        status: 'error',
        current: update.currentVersion(),
        repoUrl: update.REPO_URL,
        releasesUrl: update.RELEASES_PAGE,
        htmlUrl: update.RELEASES_PAGE,
        latest: '',
        assetName: '',
        assetUrl: '',
        launched: false,
        message: error.message || String(error),
      };
    }
  }

  async function installReleaseOp(tag, onProgress) {
    if (isLauncherPackage()) {
      return installRuntimeOp({ tag }, onProgress);
    }
    try {
      return await update.installRelease(tag, onProgress, { confirmUnverified: confirmUnverifiedInstall });
    } catch (error) {
      return { status: 'error', launched: false, message: error.message || String(error) };
    }
  }

  function startOp() {
    if (isLauncherPackage()) {
      return runtimeInstall.startExternalDesktop();
    }
    const wasSticky = stickySkipActive(harness);
    if (harness && typeof harness.clearPluginRecovery === 'function') {
      harness.clearPluginRecovery();
    }
    const start = typeof startDesktop === 'function' ? startDesktop : startHarness;
    // Clearing sticky while already ready would otherwise early-return with skip mode still live.
    if (wasSticky) {
      return start({ forceRestart: true });
    }
    return start();
  }

  function startSkippedOp() {
    if (isLauncherPackage()) {
      // Cross-process plugin skip is not plumbed yet; forward the flag for
      // future desktop-side honoring and start anyway.
      return runtimeInstall.startExternalDesktop(['--skip-user-plugins']);
    }
    if (harness && typeof harness.writePluginSkip === 'function') {
      harness.writePluginSkip(new Error('launcher-skip-user-plugins'));
    }
    const start = typeof startDesktop === 'function' ? startDesktop : startHarness;
    // Must force restart: plain start() no-ops when already ready / joins an
    // in-flight boot that captured skipUserPlugins=false before this click.
    return start({ forceRestart: true });
  }

  async function stopOp() {
    if (isLauncherPackage()) {
      return runtimeInstall.stopExternalDesktop();
    }
    const wasRunning = kernelIsRunning(dsh);
    if (typeof stopDesktopCleanup === 'function') {
      stopDesktopCleanup();
    }
    if (harness && typeof harness.stopDesktop === 'function') {
      await harness.stopDesktop();
    } else {
      await stopKernelIfRunning();
    }
    dismissMainWindow();
    return {
      ok: true,
      stopped: wasRunning ? !kernelIsRunning(dsh) : false,
    };
  }

  async function removePluginOp(name, onProgress) {
    const raw = String(name || '').trim();
    if (!raw) {
      return { ok: false, error: 'missing-name' };
    }
    if (isPresetPlugin(raw) || OFFICIAL_TEMPLATE_BUNDLES.has(raw)) {
      return { ok: false, error: 'preset' };
    }
    const kernelStopped = await stopKernelIfRunning();
    const result = await marketInstall.uninstallPlugin(raw, { onProgress });
    const disabled = (loadConfig().disabledPlugins || []).filter((item) => item !== raw);
    saveConfig({ disabledPlugins: disabled });
    return { ...result, kernelStopped, forensics: collectForensics() };
  }

  return {
    status() {
      const lastStart = readLastDesktopStart(desktopStateDir(app));
      const forensics = collectForensics();
      // Peek only: this poll also runs from the pre-created *hidden* launcher,
      // and the previous drain-on-status lost a late result before the user
      // ever saw the window. The main process drains it when the window is
      // really visible (`openLauncher` / window `show`), which is also where
      // the ask's generation and quit guards live.
      return {
        config: configPayload(loadConfig()),
        desktop: desktopSnapshot(),
        lastStart,
        recovery: forensics.recovery,
        forensicsSummary: forensics.summary,
        forensics,
        version: update.currentVersion(),
        pendingUpdateCheck: peekParkedUpdateCheck(),
        // Managed-runtime surface: which desktop install exists, which mirror
        // feeds it, and whether this process is the slim launcher package.
        installed: installedInfo(),
        downloadRoute: configuredRoute(),
        routes: releaseSource.listRoutes(),
        launcherPackage: isLauncherPackage(),
      };
    },

    saveLauncherConfig(patch) {
      const next = saveConfig(normalizeLauncherConfigPatch(patch || {}));
      return configPayload(next);
    },

    async checkUpdate() {
      if (isLauncherPackage()) {
        // The launcher's "check for updates" is about the managed runtime:
        // nothing installed → nothing to update (the install card is the
        // surface), so the snapshot clamps 'available' to 'none'.
        return runtimeInstall.checkDesktopUpdate();
      }
      return update.checkUpdate();
    },

    installUpdate: installUpdateOp,

    async listReleases() {
      if (isLauncherPackage()) {
        const route = configuredRoute() || 'github';
        const result = await releaseSource.listFor(route, {
          installedVersion: installedInfo().version,
        });
        return { ...result, installed: installedInfo() };
      }
      return update.listReleases();
    },

    installRelease: installReleaseOp,

    installRuntime: installRuntimeOp,

    cancelRuntimeInstall: runtimeInstall.cancelRuntimeInstall,

    uninstallApp() {
      return update.launchUninstaller({ target: runtimeTarget() });
    },

    scanImport(payload) {
      if (typeof payload === 'string') {
        return dataImport.scanImport({ sourceHome: payload });
      }
      const options = payload && typeof payload === 'object' ? payload : {};
      return dataImport.scanImport({
        sourceHome: typeof options.sourceHome === 'string' ? options.sourceHome : undefined,
        extraSkillDirs: Array.isArray(options.extraSkillDirs) ? options.extraSkillDirs : [],
      });
    },

    async pickImportSource() {
      const win = getLauncherWindow();
      const result = await dialog.showOpenDialog(win || undefined, {
        title: configLocale() === 'en' ? 'Choose official home' : '选择官方数据目录',
        defaultPath: require('node:os').homedir(),
        properties: ['openDirectory'],
      });
      if (result.canceled || !result.filePaths[0]) {
        return null;
      }
      return result.filePaths[0];
    },

    async pickSkillDir() {
      const win = getLauncherWindow();
      const result = await dialog.showOpenDialog(win || undefined, {
        title: configLocale() === 'en' ? 'Choose a skill folder' : '选择技能目录',
        defaultPath: require('node:os').homedir(),
        properties: ['openDirectory'],
      });
      if (result.canceled || !result.filePaths[0]) {
        return null;
      }
      return result.filePaths[0];
    },

    runImport: runImportTask,

    cancelImport() {
      if (!importAbort) {
        return { ok: false };
      }
      importAbort.abort();
      return { ok: true };
    },

    stopDesktop: stopOp,

    pluginForensics: collectForensics,

    async disablePlugins(names) {
      const result = await disablePlugins(names, { dsh, startHarness });
      return result.ok === true ? { ...result, forensics: collectForensics() } : result;
    },

    async disablePlugin(name) {
      const raw = String(name || '').trim();
      if (!raw) {
        return { ok: false, error: 'missing-name' };
      }
      const result = await disablePlugins([raw], { dsh, startHarness });
      return result.ok === true ? { ...result, forensics: collectForensics() } : result;
    },

    async enablePlugin(name) {
      const raw = String(name || '').trim();
      if (!raw) {
        return { ok: false, error: 'missing-name' };
      }
      const result = await enablePlugin(raw, { dsh, startHarness });
      return { ...result, forensics: collectForensics() };
    },

    removePlugin: removePluginOp,

    startDesktop: startOp,

    startDesktopSkipped: startSkippedOp,

    retryFullPlugins() {
      if (isLauncherPackage()) {
        return runtimeInstall.startExternalDesktop();
      }
      if (harness && typeof harness.clearPluginRecovery === 'function') {
        harness.clearPluginRecovery();
      }
      return startDesktop({ recoveryLaunch: true, forceRestart: true });
    },
  };
}

module.exports = { createLauncherService };
