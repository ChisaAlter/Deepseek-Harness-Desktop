# 模块：插件启动恢复

## 职责与非目标

**职责：** 启动器按包问诊（禁用 / 删除 / 再试）；boot 侧跳过用户插件树 / 重试 / 日志。  
**非目标：** 不自动静默删除用户插件；不伪造「已满配」状态；通用崩溃不归咎某个插件。

## 用户路径

见 [../flows/plugin-recovery.md](../flows/plugin-recovery.md)。

## 架构要点

- 问诊：`plugin-forensics.js` 解析上次日志；`listInstalledPlugins()` 列包；禁用走 `applyDisabledBundles` + 壳层 `disabledPlugins`。  
- 失败分类与跳过：`plugin-tree-failure.js`、`plugin-recovery-actions.js`。  
- Controller 持有 recovery 模式；boot-recovery 渲染跳过动作。启动失败时启动器留下。

## 实现入口

- `plugin-forensics.js`、`plugins.js`、`harness-controller.js`、`plugin-tree-failure.js`、`plugin-recovery-actions.js`
- `src/renderer/launcher.js`、`src/renderer/boot-recovery.js`
- Preload launcher：`pluginForensics`、`disablePlugin`、`enablePlugin`、`removePlugin`、`skipUserPlugins`、`retryFullPlugins`

## 不变量

- 跳过与重试路径必须可测、可导出日志。  
- 造障类 QA 不得静默标 Pass。
- 官方 `~/.dsh` 隔离（[dsh-home.md](dsh-home.md)）不能代替跳过**桌面** `dsh-home` 里的用户插件。
- 预置包 `dsh-usage-panel` 不允许删除；官方模板 bundle 不允许禁用。市场已内置为桌面自有代码，`dshmarket` 不再是预置包。

## 门槛

- QA：`TC-LAUNCH-005`、`TC-INST-004` … `TC-INST-007`

## 延伸阅读

- [../superpowers/specs/2026-08-18-plugin-startup-recovery-design.md](../../superpowers/specs/2026-08-18-plugin-startup-recovery-design.md)
- [boot-lifecycle.md](boot-lifecycle.md)
- [../../features/desktop-launcher.md](../../features/desktop-launcher.md)
