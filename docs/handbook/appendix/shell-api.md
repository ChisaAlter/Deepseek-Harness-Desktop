# 附录：`window.shell` 能力索引

来源：[`src/preload/index.js`](../../../src/preload/index.js)。角色由 `--dshd-shell-role=boot|harness|launcher` 决定；仅主 frame 暴露。

## Boot 角色

| API | IPC channel |
| --- | --- |
| `windowAction` | `shell:window` (send) |
| `getWindowState` | `shell:window-state` |
| `onWindowState` | `shell:window-state` |
| `onTheme` | `shell:theme` |
| `getConfig` | `shell:get-config` |
| `getState` | `shell:get-state` |
| `restart` | `shell:restart` |
| `cancelRestart` | `shell:cancel-restart` |
| `saveBootLog` | `shell:save-boot-log` |
| `onState` | `shell:state` |
| `onLog` | `shell:log` |
| `onPluginBoot` | `shell:plugin-boot` |

## Launcher 角色

窗口 API 同 boot 的 `windowApi`。配置只走 `saveLauncherConfig`（`quitAfterStart` / `autoStartDesktop` / `askOnUpdate`），不得写 renderer 补丁字段。

| API | Channel |
| --- | --- |
| `getConfig` | `shell:get-config` |
| `saveLauncherConfig` | `shell:save-launcher-config` |
| `launcherStatus` | `shell:launcher-status` |
| `checkUpdate` / `installUpdate` | `shell:check-update` / `shell:install-update` |
| `scanImport` / `runImport` / `pickImportSource` / `pickSkillDir` | `shell:scan-import` / `shell:run-import` / `shell:pick-import-source` / `shell:pick-skill-dir` |
| `listReleases` / `installRelease` | `shell:list-releases` / `shell:install-release` |
| `pluginForensics` | `shell:plugin-forensics` |
| `disablePlugin` / `enablePlugin` / `removePlugin` | `shell:disable-plugin` / `shell:enable-plugin` / `shell:remove-plugin` |
| `startDesktop` / `skipUserPlugins` / `retryFullPlugins` | `shell:start-desktop` / `shell:start-desktop-skipped` / `shell:retry-full-plugins` |

订阅：`onUpdateProgress`、`onPluginProgress`、`onDesktopFailed`、`onDesktopReady`、`onShowTab`、`onLauncherHint`。boot / harness 不得调用导入、装指定 Release、问诊。

## Harness 角色（含窗口 + 配置）

窗口与配置同 boot 的 `windowApi` + `configApi`（含 `saveConfig`），并增加：

### 壳 / 设置 / 更新 / 插件

| API | Channel |
| --- | --- |
| `openExternal` | `shell:open-external` |
| `openSettings` | `shell:open-settings` |
| `retryFullPlugins` | `shell:retry-full-plugins` |
| `checkUpdate` / `installUpdate` | `shell:check-update` / `shell:install-update` |
| `onUpdateProgress` | `shell:update-progress` |
| `reportChrome` | `shell:chrome-metrics` (send) |
| `listMarketplace` / `refreshMarketplace` | `shell:list-marketplace` / `shell:refresh-marketplace` |
| `listWallpaperCatalog` / `downloadWallpaper` | `shell:list-wallpaper-catalog` / `shell:download-wallpaper` |
| `listInstalledPlugins` | `shell:list-installed-plugins` |
| `installPlugin` / `installMarketplacePlugin` / `uninstallPlugin` | `shell:install-plugin` / `shell:install-marketplace-plugin` / `shell:uninstall-plugin` |
| `openMarketplace` | `shell:open-marketplace` |
| `onPluginProgress` | `shell:plugin-progress` |

### Git

`gitStatus`、`gitFetchForStatus`、`gitReadPullRequest`、`gitInit`、`gitDiff`、`gitCommit`、`gitPush`、`gitPull`、`gitCreateChangeRequest`、`gitPublishRepository`、`gitStage`、`gitUnstage`、`gitDiscard`、`gitStatusEntries`、`gitBranchList`、`gitSwitchBranch`、`gitCreateBranch`、`onGitProgress`、`onGitWorkspacesChanged` — channel 前缀 `shell:git-*` / `shell:git-progress` / `shell:git-workspaces-changed`（主进程监视 `dsh-home/storages/workspace.json`，登记变更后推送，标题栏据此立即刷新状态）。

### 工作区 FS

`openWorkspacePath`、`listDir`、`readFile`、`readFileMedia`、`writeFile`、`listEditors`、`openInEditor`、`showItemInFolder`、`openWithSystemDefault`。

### PTY

`ptyCreate`、`ptyWrite`、`ptyResize`、`ptyKill`、`onPtyData`、`onPtyExit`。

### Preview（Browser surface / Files 悬浮预览）

`previewOpen` … `previewClose`、`previewOpenFileWindow`、订阅 `onPreviewStateChange` / `onOpenPreviewUrl` / `onPreviewRecordingFrame` — 详见 preload 同文件列表。`previewOpenFileWindow` 只接收 `cwd + relativePath`，由 main 复用 workspace authority 与 token URL 打开单实例只读置顶窗。曾有的 `previewAutomation*`（含 evaluate / CDP 输入注入）因零消费者、暴露面过大已整链删除（2026-08-25）；恢复须新 feature 卡 + 权限模型。

## 维护

增删 API 时同步本附录与 `shell-api.test.js`；手册模块章只链到本页，不复制全表。
