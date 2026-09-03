# Feature Spine（产品知识脊梁）

可执行的产品契约索引：每张卡绑定用户路径、不变量、默认可改文件、测试门槛与来源链接。Agent 改产品行为时先读卡、声明 `Touching: <id>`，再动手。

蓝图与模块详解见 [产品手册](../handbook/README.md)。

## 与其他文档的分工

| 层 | 职责 | 本树是否替代 |
| --- | --- | --- |
| [docs/handbook/](../handbook/README.md) | 蓝图、流程、模块当前态 | 否；卡片挂手册章 |
| [design-language.md](../design-language.md) / [motion.md](../motion.md) | 视觉与动效语言 | 否；卡片只链接 |
| [superpowers/specs](../superpowers/specs/) / [plans](../superpowers/plans/) | 设计与施工过程 | 否；定稿后把**不变量**收进卡片 |
| [qa/production-acceptance-test-cases.md](../qa/production-acceptance-test-cases.md) | 发版实机验收：每次发布前对 CI windows 安装包走完 | 否；卡片 `gates` 挂用例 ID |
| harness Agent Notes | 上游决策记录 | 否；桌面相关卡可链接 |
| `.cursor/rules/*.mdc` | 短 always-on 不变量 | 否；文末链到本卡，细节以卡为准 |

本树**不做**第二套 Wiki，不复制 harness doc-sync。卡片半页内；长文留在 handbook / spec / note。

## 何时新建 / 更新

- **新建：** 产品行为已定且会被反复改（尤其易被 Agent 冲掉）时，从 [_template.md](_template.md) 复制。
- **更新：** 不变量或关键路径变了；或改完后刷新 `last verified`。
- **局部修复不改契约：** 会话写明「无卡 / 不改产品契约」，diff 仍应尽量小。

## 会话开场模板

```text
Touching: wallpaper-gallery
Goal: <一句>
Do not: Appearance 图源、邻域重构
Gate: <卡上 gates>
```

提交说明建议：`feature(<id>): …`。协议全文见仓库根 [AGENTS.md](../../AGENTS.md#feature-spine)。

## 索引

| id | 一句话 | 主入口 | gates 摘要 |
| --- | --- | --- | --- |
| [wallpaper-gallery](wallpaper-gallery.md) | Appearance 行 + 图库窗；图源只在窗内 | `WallpaperRow` / `WallpaperGalleryModal` | TC-APP-002…010 |
| [transparent-theme](transparent-theme.md) | 外观「透明主题」开关：有壁纸时全表面 0% 填充、压暗 mask 移除 | `ThemeRuntime.setTransparentTheme` / `TRANSPARENT_ATTR` | vendor ui-theme client specs |
| [marketplace-settings](marketplace-settings.md) | 设置内市场（桌面自有代码）；无独立窗 | `marketplace-install` / `ui-settings-market` | TC-EXT-001…005 |
| [surfaces-work-loops](surfaces-work-loops.md) | 右栏工作环，非空态卡片 | preview / ui-files | TC-SURF-001…007 |
| [boot-page](boot-page.md) | 仪器启动画布 + 插件进度/恢复 | `boot.*` / harness-controller | TC-INST-003…007、012、013 |
| [terminal-drawer](terminal-drawer.md) | 底栏 PTY 工作环 | `pty.js` / ui-user-terminal | TC-TERM-001…004（TC-WS-006 仓） |
| [settings-select](settings-select.md) | 设置内值选择统一为官方胶囊 + Menu | `SettingsSelect` | vendor client spec |
| [mobile-remote](mobile-remote.md) | 侧栏远程弹窗 + `mobile/web` SPA；**停放**（`REMOTE_FEATURE_ENABLED=false`） | `ChisaCodeRemote` / `ui-settings-remote` | 停放期 TC-REM N/A；TC-NEG-001 默认不听 |
| [remote-settings](remote-settings.md) | 设置→远程双标签（网关 + dsh-im）；**停放** | `ui-settings-remote` / `dsh-im-desktop` | 停放期无入口 |
| [dshbot](dshbot.md) | 独立 dsh 插件：桌面不预置、可选安装 | `vendor/dshbot` / `removeDshbotPreset` | TC-EXT-007 |
| [dsh-home](dsh-home.md) | 桌面 `userData/dsh-home`；Harness 不读官方 `~/.dsh` | `dsh-home.js` / spawnEnv | TC-INST-009、011；TC-WS-006 |
| [desktop-launcher](desktop-launcher.md) | 冷启动闸门：更新询问、启停桌面、版本、插件问诊 | `launcher.*` / launcher-gate | TC-LAUNCH-001…007 |
| [data-import](data-import.md) | 启动器只读导入官方会话/插件名单 | `data-import.js` | TC-LAUNCH-004 |
| [session-archive](session-archive.md) | 归档隐藏；已归档里恢复/删除 | ui-workspace / workspace RPC | TC-CHAT-010、013 |
| [no-directory-sessions](no-directory-sessions.md) | 「无工作目录」会话（Host scratch cwd）；删除工作区即隐藏其会话，重新添加目录才回来 | vendor `workspace` / `api/workspace-controller` / `ui-workspace` / `ui-conversation` | vendor client+host specs + 桌面 marker 单测 |
| [git-titlebar](git-titlebar.md) | 标题栏分支/提交/推拉；登记工作区即授权 | `git.js` / workspace-authority | TC-WS-006、TC-GIT-001…007 |
| [usage-stats](usage-stats.md) | 设置内跨会话 Token 用量；预置改版 dsh-usage-panel | `usage-panel-preset` / vendor 插件 | TC-EXT-008 |
| [composer-family-width](composer-family-width.md) | 拖动输入卡改宽时统计行/Dock 卡联动跟随 | vendor ui-chat / ui-conversation / ui-goal CSS | vendor vitest + 桌面 marker 单测 |
| [composer-stats-peak-valley](composer-stats-peak-valley.md) | 会话统计/峰谷行与输入卡宽度对齐；官方峰谷时状态条与开关 | vendor `ui-conversation` / `ui-model-selection` | vendor client specs（peak-valley / chat-apply / host） |
| [message-edit](message-edit.md) | 最新用户消息就地编辑并重发；fork-beforeSeq 子会话 | vendor `ui-message-edit` | vendor client spec + test:gui |
| [windows-installer](windows-installer.md) | NSIS 品牌化安装器；`/S` 静默与 artifact 名不变 | `build.nsis` / `build/installer.nsh` | installer-branding 单测；TC-INST-001、009、010 |
| [dsh-tools](dsh-tools.md) | 工具调用名/ID 校验、失败重试与旧会话投影修复 | vendor llm / agent-loop / session / tools | focused Harness specs |
