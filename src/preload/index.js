const { contextBridge, ipcRenderer } = require('electron');

const SHELL_ROLES = new Set(['boot', 'harness', 'launcher']);

function shellRole(argv = process.argv) {
  const prefix = '--dshd-shell-role=';
  const value = argv.find((item) => typeof item === 'string' && item.startsWith(prefix));
  const role = value ? value.slice(prefix.length) : '';
  return SHELL_ROLES.has(role) ? role : null;
}

// The remote feature switch lives in src/main/config.js
// (REMOTE_FEATURE_ENABLED) and reaches this sandboxed preload through the
// `additionalArguments` of the owning window/view. When off (or when the
// argument is missing) the four remote methods are omitted so
// ui-settings-remote does not register the sidebar icon.
function remoteFeatureEnabled(argv = process.argv) {
  const prefix = '--dshd-remote-feature=';
  const value = argv.find((item) => typeof item === 'string' && item.startsWith(prefix));
  return value ? value.slice(prefix.length) === '1' : false;
}

function invoke(renderer, channel) {
  return (...args) => renderer.invoke(channel, ...args);
}

function send(renderer, channel) {
  return (...args) => renderer.send(channel, ...args);
}

function subscribe(renderer, channel) {
  return (handler) => {
    const listener = (_event, payload) => handler(payload);
    renderer.on(channel, listener);
    return () => renderer.removeListener(channel, listener);
  };
}

function windowApi(renderer) {
  return {
    windowAction: send(renderer, 'shell:window'),
    getWindowState: invoke(renderer, 'shell:window-state'),
    onWindowState: subscribe(renderer, 'shell:window-state'),
    onTheme: subscribe(renderer, 'shell:theme'),
  };
}

function configApi(renderer) {
  return {
    getConfig: invoke(renderer, 'shell:get-config'),
    saveConfig: invoke(renderer, 'shell:save-config'),
  };
}

function bootApi(renderer) {
  return {
    ...windowApi(renderer),
    getConfig: invoke(renderer, 'shell:get-config'),
    getState: invoke(renderer, 'shell:get-state'),
    restart: invoke(renderer, 'shell:restart'),
    cancelRestart: invoke(renderer, 'shell:cancel-restart'),
    saveBootLog: invoke(renderer, 'shell:save-boot-log'),
    openLauncher: invoke(renderer, 'shell:open-launcher'),
    onState: subscribe(renderer, 'shell:state'),
    onLog: subscribe(renderer, 'shell:log'),
    onPluginBoot: subscribe(renderer, 'shell:plugin-boot'),
  };
}

function harnessApi(renderer, remoteFeature) {
  return {
    ...windowApi(renderer),
    ...configApi(renderer),
    openExternal: invoke(renderer, 'shell:open-external'),
    openSettings: invoke(renderer, 'shell:open-settings'),
    openLauncher: invoke(renderer, 'shell:open-launcher'),
    retryFullPlugins: invoke(renderer, 'shell:retry-full-plugins'),
    checkUpdate: invoke(renderer, 'shell:check-update'),
    installUpdate: invoke(renderer, 'shell:install-update'),
    onUpdateProgress: subscribe(renderer, 'shell:update-progress'),
    reportChrome: send(renderer, 'shell:chrome-metrics'),
    listMarketplace: invoke(renderer, 'shell:list-marketplace'),
    refreshMarketplace: invoke(renderer, 'shell:refresh-marketplace'),
    listWallpaperCatalog: invoke(renderer, 'shell:list-wallpaper-catalog'),
    downloadWallpaper: invoke(renderer, 'shell:download-wallpaper'),
    listInstalledPlugins: invoke(renderer, 'shell:list-installed-plugins'),
    installPlugin: invoke(renderer, 'shell:install-plugin'),
    installMarketplacePlugin: invoke(renderer, 'shell:install-marketplace-plugin'),
    uninstallPlugin: invoke(renderer, 'shell:uninstall-plugin'),
    openMarketplace: invoke(renderer, 'shell:open-marketplace'),
    onPluginProgress: subscribe(renderer, 'shell:plugin-progress'),
    gitStatus: invoke(renderer, 'shell:git-status'),
    gitFetchForStatus: invoke(renderer, 'shell:git-fetch-status'),
    gitReadPullRequest: invoke(renderer, 'shell:git-pull-request'),
    gitInit: invoke(renderer, 'shell:git-init'),
    gitDiff: invoke(renderer, 'shell:git-diff'),
    gitCommit: invoke(renderer, 'shell:git-commit'),
    gitPush: invoke(renderer, 'shell:git-push'),
    gitPull: invoke(renderer, 'shell:git-pull'),
    onGitProgress: subscribe(renderer, 'shell:git-progress'),
    onGitWorkspacesChanged: subscribe(renderer, 'shell:git-workspaces-changed'),
    gitCreateChangeRequest: invoke(renderer, 'shell:git-create-change-request'),
    gitPublishRepository: invoke(renderer, 'shell:git-publish'),
    openWorkspacePath: invoke(renderer, 'shell:open-workspace-path'),
    listDir: invoke(renderer, 'shell:list-dir'),
    readFile: invoke(renderer, 'shell:read-file'),
    readFileMedia: invoke(renderer, 'shell:read-file-media'),
    writeFile: invoke(renderer, 'shell:write-file'),
    listEditors: invoke(renderer, 'shell:list-editors'),
    openInEditor: invoke(renderer, 'shell:open-in-editor'),
    showItemInFolder: invoke(renderer, 'shell:show-item-in-folder'),
    openDshHome: invoke(renderer, 'shell:open-dsh-home'),
    openWithSystemDefault: invoke(renderer, 'shell:open-with-default'),
    gitStage: invoke(renderer, 'shell:git-stage'),
    gitUnstage: invoke(renderer, 'shell:git-unstage'),
    gitDiscard: invoke(renderer, 'shell:git-discard'),
    gitStatusEntries: invoke(renderer, 'shell:git-status-entries'),
    gitBranchList: invoke(renderer, 'shell:git-branch-list'),
    gitSwitchBranch: invoke(renderer, 'shell:git-switch-branch'),
    gitCreateBranch: invoke(renderer, 'shell:git-create-branch'),
    ptyCreate: invoke(renderer, 'shell:pty-create'),
    ptyWrite: invoke(renderer, 'shell:pty-write'),
    ptyResize: invoke(renderer, 'shell:pty-resize'),
    ptyKill: invoke(renderer, 'shell:pty-kill'),
    onPtyData: subscribe(renderer, 'shell:pty-data'),
    onPtyExit: subscribe(renderer, 'shell:pty-exit'),
    previewOpen: invoke(renderer, 'shell:preview-open'),
    previewWorkspaceFile: invoke(renderer, 'shell:preview-workspace-file'),
    previewNavigate: invoke(renderer, 'shell:preview-navigate'),
    previewBack: invoke(renderer, 'shell:preview-back'),
    previewForward: invoke(renderer, 'shell:preview-forward'),
    previewReload: invoke(renderer, 'shell:preview-reload'),
    previewHardReload: invoke(renderer, 'shell:preview-hard-reload'),
    previewStop: invoke(renderer, 'shell:preview-stop'),
    previewZoomIn: invoke(renderer, 'shell:preview-zoom-in'),
    previewZoomOut: invoke(renderer, 'shell:preview-zoom-out'),
    previewResetZoom: invoke(renderer, 'shell:preview-zoom-reset'),
    previewSetColorScheme: invoke(renderer, 'shell:preview-color-scheme'),
    previewClearCookies: invoke(renderer, 'shell:preview-clear-cookies'),
    previewClearCache: invoke(renderer, 'shell:preview-clear-cache'),
    previewCaptureScreenshot: invoke(renderer, 'shell:preview-capture-screenshot'),
    previewPickElement: invoke(renderer, 'shell:preview-pick-element'),
    previewCancelPick: invoke(renderer, 'shell:preview-cancel-pick'),
    previewSetAnnotationTheme: invoke(renderer, 'shell:preview-annotation-theme'),
    previewOpenPictureInPicture: invoke(renderer, 'shell:preview-open-pip'),
    previewClosePictureInPicture: invoke(renderer, 'shell:preview-close-pip'),
    previewStartRecording: invoke(renderer, 'shell:preview-start-recording'),
    previewStopRecording: invoke(renderer, 'shell:preview-stop-recording'),
    onPreviewRecordingFrame: subscribe(renderer, 'shell:preview-recording-frame'),
    previewSaveRecording: invoke(renderer, 'shell:preview-save-recording'),
    previewRevealArtifact: invoke(renderer, 'shell:preview-reveal-artifact'),
    previewCopyArtifactToClipboard: invoke(renderer, 'shell:preview-copy-artifact'),
    previewState: invoke(renderer, 'shell:preview-state'),
    previewOpenDevTools: invoke(renderer, 'shell:preview-devtools'),
    previewDiscover: invoke(renderer, 'shell:preview-discover'),
    previewResize: invoke(renderer, 'shell:preview-resize'),
    previewHide: invoke(renderer, 'shell:preview-hide'),
    previewShow: invoke(renderer, 'shell:preview-show'),
    previewClose: invoke(renderer, 'shell:preview-close'),
    onPreviewStateChange: subscribe(renderer, 'shell:preview-state-change'),
    onOpenPreviewUrl: subscribe(renderer, 'shell:open-preview-url'),
    ...(remoteFeature ? {
      getRemote: invoke(renderer, 'shell:get-remote'),
      saveRemote: invoke(renderer, 'shell:save-remote'),
      rotateRemoteToken: invoke(renderer, 'shell:rotate-remote-token'),
      unbindRemoteDevice: invoke(renderer, 'shell:unbind-remote-device'),
      renameRemoteDevice: invoke(renderer, 'shell:rename-remote-device'),
    } : {}),
  };
}

function launcherApi(renderer) {
  return {
    ...windowApi(renderer),
    getConfig: invoke(renderer, 'shell:get-config'),
    saveLauncherConfig: invoke(renderer, 'shell:save-launcher-config'),
    launcherStatus: invoke(renderer, 'shell:launcher-status'),
    checkUpdate: invoke(renderer, 'shell:check-update'),
    installUpdate: invoke(renderer, 'shell:install-update'),
    onUpdateProgress: subscribe(renderer, 'shell:update-progress'),
    scanImport: invoke(renderer, 'shell:scan-import'),
    runImport: invoke(renderer, 'shell:run-import'),
    pickImportSource: invoke(renderer, 'shell:pick-import-source'),
    pickSkillDir: invoke(renderer, 'shell:pick-skill-dir'),
    listReleases: invoke(renderer, 'shell:list-releases'),
    installRelease: invoke(renderer, 'shell:install-release'),
    pluginForensics: invoke(renderer, 'shell:plugin-forensics'),
    disablePlugin: invoke(renderer, 'shell:disable-plugin'),
    disablePlugins: invoke(renderer, 'shell:disable-plugins'),
    enablePlugin: invoke(renderer, 'shell:enable-plugin'),
    removePlugin: invoke(renderer, 'shell:remove-plugin'),
    startDesktop: invoke(renderer, 'shell:start-desktop'),
    stopDesktop: invoke(renderer, 'shell:stop-desktop'),
    uninstallApp: invoke(renderer, 'shell:uninstall-app'),
    skipUserPlugins: invoke(renderer, 'shell:start-desktop-skipped'),
    retryFullPlugins: invoke(renderer, 'shell:retry-full-plugins'),
    onPluginProgress: subscribe(renderer, 'shell:plugin-progress'),
    onDesktopFailed: subscribe(renderer, 'shell:desktop-failed'),
    onDesktopReady: subscribe(renderer, 'shell:desktop-ready'),
    onShowTab: subscribe(renderer, 'shell:show-tab'),
    onLauncherHint: subscribe(renderer, 'shell:launcher-hint'),
  };
}

function buildShellApi(role, renderer, remoteFeature = remoteFeatureEnabled()) {
  if (role === 'boot') return bootApi(renderer);
  if (role === 'harness') return harnessApi(renderer, remoteFeature);
  if (role === 'launcher') return launcherApi(renderer);
  return null;
}

const role = shellRole();
const isMainFrame = process.isMainFrame !== false;
const api = isMainFrame ? buildShellApi(role, ipcRenderer) : null;

if (api) {
  contextBridge.exposeInMainWorld('shell', api);
}

if (typeof module !== 'undefined') {
  module.exports = { buildShellApi, shellRole, remoteFeatureEnabled };
}
