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
| [docs/decisions/](../decisions/README.md) | 决策记录：动机、被否方案、代价（含 rejected/archived 生命周期） | 否；卡只写「是什么」，「为什么」链到决策记录 |
| harness Agent Notes | 上游决策记录 | 否；桌面相关卡可链接 |
| `.cursor/rules/*.mdc` | 短 always-on 不变量 | 否；文末链到本卡，细节以卡为准 |

本树**不做**第二套 Wiki，不复制 harness doc-sync。卡片半页内；长文留在 handbook / spec / note。

## 何时新建 / 更新

- **新建：** 产品行为已定且会被反复改（尤其易被 Agent 冲掉）时，从 [_template.md](_template.md) 复制。
- **status 取值：** `active` 现行契约；`proposed` 方案已定未落地；`killed` 负契约（防复活的死亡名单，文件名带 `_` 前缀）。被否提案不建卡，进 [decisions/rejected/](../decisions/README.md)。
- **更新：** 不变量或关键路径变了；或改完后刷新 `last verified`。
- **局部修复不改契约：** 会话写明「无卡 / 不改产品契约」，diff 仍应尽量小。
- **非琐碎改动**还须同 PR 新增/更新 [docs/decisions/](../decisions/README.md) 决策记录。

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
| [desktop-branding](desktop-branding.md) | 桌面与 Web 侧栏「鲸屿 · Whale Isle」，保留 Harness 归属 | `ui-brand-official` 品牌槽位 | 定向测试、官方构建、深浅色复核 |
| [vision-fallback](vision-fallback.md) | 识图路由的图片准入、描述与主请求重写 | llm-vision-fallback / agent-loop | 无密钥组合与图片准入 |
| [core-regression-gates](core-regression-gates.md) | 核心会话、模型和工具回归阻断 CI | test.yml | 核心集合与 CI 契约 |
| [wallpaper-gallery](wallpaper-gallery.md) | Appearance 行 + 图库窗；图源只在窗内 | `WallpaperRow` / `WallpaperGalleryModal` | TC-APP-002…010 |
| [background-gradient](background-gradient.md) | 无背景图时的流动渐变特效底（独立 block） | `BackgroundEffectRow` / `applyWallpaperLayer` | TC-APP-015 |
| [cursor-effects](cursor-effects.md) | 指针划过处的装饰特效：像素拖尾 / 流体飞溅二选一，预设 + 自定义 | `CursorEffectRow` / `applyCursorFxLayer` | ui-theme client specs |
| [metallic-paint](metallic-paint.md) | 原生 button hover 叠加半透明银灰扫光（附加层，不替换原 hover） | `metallic-paint.css` / `installThemeStyles` | ui-theme client-styles spec |
| [transparent-theme](transparent-theme.md) | 外观「透明主题」开关：有壁纸时全表面 0% 填充、压暗 mask 移除 | `ThemeRuntime.setTransparentTheme` / `TRANSPARENT_ATTR` | vendor ui-theme client specs |
| [sidebar-mask](sidebar-mask.md) | 外观「隐藏侧栏遮罩」开关：侧栏与工作区同底，只留分割线 | `ThemeRuntime.setSidebarMask` / `SIDEBAR_UNMASKED_FILL` | vendor ui-theme client specs |
| [marketplace-settings](marketplace-settings.md) | 设置内市场（桌面自有代码）；无独立窗 | `marketplace-install` / `ui-settings-market` | TC-EXT-001…005 |
| [surfaces-work-loops](surfaces-work-loops.md) | 右栏工作环，非空态卡片 | preview / ui-files | TC-SURF-001…007 |
| [tool-result-images](tool-result-images.md) | 工具结果中的 MCP / 浏览器图片在原位查看，走既有持久附件 gallery | vendor ui-tool / ui-attachment | focused ui-tool specs + doc-sync |
| [boot-page](boot-page.md) | 仪器启动画布 + 插件进度/恢复 | `boot.*` / harness-controller | TC-INST-003…007、012、013 |
| [terminal-drawer](terminal-drawer.md) | 底栏 PTY 工作环 | `pty.js` / ui-user-terminal | TC-TERM-001…004（TC-WS-006 仓） |
| [settings-select](settings-select.md) | 设置内值选择统一为官方胶囊 + Menu | `SettingsSelect` | vendor client spec |
| [account-settings-entry](account-settings-entry.md) | 设置与远程配对收束到账户菜单，缺席时保留原入口 | `ui-settings-account` / `settings.launcher` | 定向测试、官方构建、桌面复核 |
| [account-browser-sign-in](account-browser-sign-in.md) | 桌面登录链接就绪时自动打开系统浏览器 | `ui-settings-account` / `shell.openExternal` | 定向测试、桌面复核 |
| [mobile-remote](mobile-remote.md) | 侧栏远程弹窗 + `mobile/web` SPA；入口开放，配对默认关闭 | `DshdRemote` / `ui-settings-remote` | 以卡内实机矩阵为准；0.3.1 不将 Web/Android 排除项记为 Pass |
| [remote-settings](remote-settings.md) | 设置→远程双标签（网关 + dsh-im）；未配置时默认服务器模式 | `ui-settings-remote` / `dsh-im-desktop` | 桌面装配回归；真实账号绑定/收发按卡内门槛验收 |
| [remote-workspace](remote-workspace.md) | SSH 机器管理、远程目录选择与镜像工作区 | `dsh-remote-desktop` / `vendor/dsh-remote` / picker fork | ensure/overlay/skip-compose + 远程负路径测试；实机验收单独记录 |
| [dshbot](dshbot.md) | 桌面内置 Bots：vendor 快照 + overlay 每次启动挂载（含 skip） | `dshbot-desktop` / `legacy-dshbot-preset` | 升级 / 用户数据保留 |
| [plugin-session-navigation](plugin-session-navigation.md) | 插件固定会话的持久化标题、普通列表隔离与空会话聊天布局 | vendor session-controller / ui-workspace / ui-conversation | 投影、导航与真实插件桌面链路 |
| [dsh-home](dsh-home.md) | 桌面 `userData/dsh-home`；Harness 不读官方 `~/.dsh` | `dsh-home.js` / spawnEnv | TC-INST-009、011；TC-WS-006 |
| [desktop-launcher](desktop-launcher.md) | 冷启动闸门：更新询问、启停桌面、版本、插件问诊 | `launcher.*` / launcher-gate | TC-LAUNCH-001…007 |
| [launcher-distribution](launcher-distribution.md) | 现有启动器轻量分发、双线路完整包与独立增量包（拟议） | `launcher.*` / 分发服务 / release workflows | 唯一启动器、签名清单、双镜像与 CI Setup 实机 |
| [launcher-components](launcher-components.md) | 现有启动器按需安装并监管独立工具或服务（拟议） | `launcher.*` / component supervisor | 签名包、运行与回滚实机 |
| [data-import](data-import.md) | 启动器只读导入官方会话/插件名单 | `data-import.js` | TC-LAUNCH-004 |
| [session-archive](session-archive.md) | 归档隐藏；已归档里恢复/删除 | ui-workspace / workspace RPC | TC-CHAT-010、013 |
| [no-directory-sessions](no-directory-sessions.md) | 「无工作目录」会话（Host scratch cwd）；删除工作区即隐藏其会话，重新添加目录才回来 | vendor `workspace` / `api/workspace-controller` / `ui-workspace` / `ui-conversation` | vendor client+host specs + 桌面 marker 单测 |
| [git-titlebar](git-titlebar.md) | 标题栏分支/提交/推拉；登记工作区即授权 | `git.js` / workspace-authority | TC-WS-006、TC-GIT-001…007 |
| [usage-stats](usage-stats.md) | 设置内跨会话 Token 用量；预置改版 dsh-usage-panel | `usage-panel-preset` / vendor 插件 | TC-EXT-008 |
| [composer-beam](composer-beam.md) | 运行态输入卡四角连续边光，4px 裁切壳不覆盖 dock | vendor ui-conversation InputBar | vendor focused CSS + Chromium 像素复现 |
| [composer-typing-fx](composer-typing-fx.md) | 外观分区可配置键入特效：叠加层 echo + 自定义光标，不碰 Lexical 文本 DOM | vendor ui-conversation `TypingFxLayer` / `TypingFxRow` | vendor focused specs + tsc + 桌面 marker 单测 |
| [composer-family-width](composer-family-width.md) | 输入卡改宽时统计行、Dock 卡与空会话 Hero 控件联动跟随 | vendor ui-chat / ui-conversation / ui-goal CSS | vendor vitest + 桌面 marker 单测 + 实机坐标 |
| [composer-stats-peak-valley](composer-stats-peak-valley.md) | 会话统计/峰谷行与输入卡宽度对齐；官方峰谷时状态条与开关 | vendor `ui-conversation` / `ui-model-selection` | vendor client specs（peak-valley / chat-apply / host） |
| [message-edit](message-edit.md) | 最新用户消息编辑后始终在当前会话重发 | vendor `ui-message-edit` | vendor client/host specs + test:gui + keyless edit e2e |
| [composer-draft-transition](composer-draft-transition.md) | 草稿首次发送时输入框连续落位、不贴底回弹 | vendor `ui-conversation` | 组件回归 + keyless 逐帧几何 |
| [windows-installer](windows-installer.md) | NSIS 品牌化安装器；`/S` 静默与 artifact 名不变 | `build.nsis` / `build/installer.nsh` | installer-branding 单测；TC-INST-001、009、010 |
| [dsh-tools](dsh-tools.md) | 工具调用名/ID 校验、失败重试与旧会话投影修复 | vendor llm / agent-loop / session / tools | focused Harness specs |
| [harness-upstream-sync](harness-upstream-sync.md) | 上游三方合并、桌面特性保真与集成验收 | `harness-sync` / `harness-desktop-forks` | sync/forks、构建、GUI/核心契约与源码冒烟 |
| [desktop-pet](desktop-pet.md) | Desktop shell 内受限宠物浮层：Codex 皮肤、点击/拖拽动画、右键换肤、托盘开关与位置持久化 | `desktop-pet` / `desktop-pets` / `window` / `tray` | TC-DESK-010；focused tests |
| [desktop-live2d-pet](desktop-live2d-pet.md) | 整屏透明 BrowserWindow 的 Live2D 鲸鱼娘伙伴：点击穿透、拖拽/抛掷物理、对话气泡、token 投喂成长与养成状态卡 | `desktop-live2d` / `pet-growth` / `pet-stats` / `pet-live2d.*` | `node --test` focused（101）；TC-DESK-011 |
| [whale-assistant](whale-assistant.md) | 第一方 `dsh-whale` 插件：常驻 whale-girl 助理会话 + 设置分区 + 侧栏入口 + preset 统筹工具 + pet-outbox 桌宠桥 | `dsh-whale-desktop` / `vendor/dsh-whale` / `pet-dsh-watch` | `dsh-whale-desktop.test.js` + skip-compose 契约 |
| [directory-picker-drives](directory-picker-drives.md) | 目录选择器 Win32 卷选择层：「此电脑」列出全部盘符，可跨盘选工作区 | vendor `directory-picker` / `directory-picker-browse` | vendor spec + marker 单测 |
| [custom-instructions](custom-instructions.md) | 设置→通用自定义指令，作为系统提示词末段随每次请求发送 | `ui-conversation.customInstructions` / `SystemPromptProjection` | ui-conversation 定向测试 + 真实模型验证 |
| [session-cost-display](session-cost-display.md) | 会话累计费用显示与按峰谷分桶计价；开关关闭时整行隐藏 | `PeakValleyRow` / `billedUsage` 投影 / `ui-model-selection` | vendor client specs + 设置开关回归 |
| [skills-groups](skills-groups.md) | 技能分组多选 tag picker 与分组开关批量切换 | vendor skills 设置（fork） | vendor 51/51 + fork 门禁 |
| [desktop-build-runtime](desktop-build-runtime.md) | 桌面清单与打包运行时契约：scripts/依赖/build 字段、vendor 资源与 afterPack 装配 | `package.json` / `package-contract.test.js` / `after-pack.js` | 结构契约测试 + packaged smoke |
