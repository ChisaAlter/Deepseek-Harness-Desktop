# 桌面独立 Harness 家目录

桌面壳拉起官方 `dsh web`，但不得与官方 CLI 共用 `~/.dsh`。共用时，官方或历史写入的 web profile 会在新装/升级第一次启动加载，或在写入 `desktop-plugins/` 时因文件锁失败。

vendored 运行时已经在 `userData/runtime/<version>`。本设计只拆 **Harness 家目录**。

视觉语言仍是官方 `dsh web`。不增加家目录设置 UI。

## 决定

1. **永久桌面 home：** `path.join(app.getPath('userData'), 'dsh-home')`。不是恢复用的临时 `$DSH_HOME`。
2. **fresh：** 不从 `~/.dsh` 拷贝密钥、设置、会话、插件，也不清理那里的历史桌面托管块。
3. **Profile 名仍是 `web`。** 只换根目录。不换名共用 `~/.dsh`（home 级 patch 与 `profiles/node_modules` 仍会漏）。
4. **解析忽略 `DSH_HOME`。** 那是官方 CLI 覆盖项。测试/调试只用 `DSHD_HOME`。
5. **禁止** 给 Electron `process.env.DSH_HOME` 赋值。底栏 PTY 继承进程环境；泄漏后终端里的官方 `dsh` 会打到桌面 home。
6. **`dsh web` 与 `dsh plugin` 子进程必须覆盖 `DSH_HOME` 为桌面 home**，即使用户机器上已有官方值。
7. **`--skip-user-plugins` 状态机不变。** 本设计挡住官方 home 污染；桌面市场插件在升级后弄挂仍走既有两段启动。

## 成功标准

毒化的 `~/.dsh/profiles/web` 不能阻止桌面进入官方 Web UI。市场安装的包出现在桌面 home，不出现在 `~/.dsh`。

不承诺：桌面市场插件在桌面升级后一定能加载；Electron Setup 锁 `userData/runtime`；覆盖升级后旧会话仍在。

## 解析

模块在 `src/shared/dsh-home.js`：无 Electron 依赖，供 main 与 themes 共用。

1. `DSHD_HOME` 非空 → `path.resolve`
2. 否则 `setDesktopDshHome` 已绑定的绝对路径
3. 否则 `getDesktopDshHome()` throw；永不回落 `~/.dsh`

`whenReady` 第一件事：`setDesktopDshHome(desktopDshHomeFromUserData(app.getPath('userData')))` 并 `mkdirSync`。早于 IPC、主窗、Harness start。`app.setName` 已在 ready 之前，源码启动与安装包同一 userData 名。

`readHarnessThemeSettings` 在 home 未绑定或文件缺失时返回 `{}`，标题栏仍能画。`webProfileDir()` / workspace-authority 未绑定则 throw（被现有 `loadWorkspaceAuthority` 的 catch 收成空权威，测试进程不崩）。

## 注入

| 调用方 | `DSH_HOME` |
| --- | --- |
| `dsh.js` `spawnEnv` | 覆盖为桌面 home |
| `marketplace-install.js` `pluginEnv` | 覆盖为桌面 home |
| Host `install_dsh_plugin`（子进程内） | 继承上列 |
| PTY / git / 编辑器 / 更新安装器 | 不注入 |
| Electron `process.env` | 不设置 |

Boot 日志打一行桌面 home 绝对路径。

## 启动顺序（空 home）

heal 与预置插件写入桌面 `profiles/web`（可先写出 `cordis.patch.yml`），再 `dsh web`。上游 `initProfile` 不覆盖已有文件，会补 `package.json`。

## 数据落点

Electron userData 仍持有 `config.json`、`credentials.json`、运行时解压、市场缓存。Harness 会话、`settings.yaml`、MCP、skills、profile 插件只在 `dsh-home`。

Windows 当前路径：`%APPDATA%\Deepseek-Harness-Desktop\dsh-home`（插件：`profiles/web`）。macOS：`~/Library/Application Support/Deepseek-Harness-Desktop/dsh-home`。安装后桌面不读 `~/.dsh`。

覆盖升级：壳层默认 API key 与工作区路径保留；会话/主题/自定义模型须重配。

## 非目标

- 不改 vendor、不改 Cordis、不改恢复 FSM（版本变化仍先完整启动）
- 不增加家目录设置页
- 不杀端口策略变更（桌面仍可能杀掉占用 3080 的 `dsh`）
- 目录名保持短的 `dsh-home`（Windows MAX_PATH）

## 测试

- 忽略 `DSH_HOME`；尊重 `DSHD_HOME`；未配置 throw
- `applyDesktopDshHome` 覆盖已有 `DSH_HOME`
- `spawnEnv` / `pluginEnv` 带桌面 home；PTY env 没有该覆盖值
- themes 未配置不读真实 `~/.dsh`
- 单测用 `DSHD_HOME` 或 `setDesktopDshHome(tmpdir)`，禁止写真实 userData / `~/.dsh`
- `qa:source` / `qa:composer` / packaged smoke 不得向 Electron 注入 `DSH_HOME`；`dshd-smoke.json` 须记录 `desktopHome` 与 `Harness 家目录` 日志
