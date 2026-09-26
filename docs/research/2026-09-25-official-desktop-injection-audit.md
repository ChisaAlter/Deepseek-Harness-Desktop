# DSHD 功能迁出与官方 Desktop 注入可行性审查

审查日期：2026-09-25。对象是本仓当前工作树，对照官方 DeepSeek Harness `477b4f420553e8a52c2fbccc464d7561b239c443`（`dsh-v0.1.7-rc.2`）。本报告由 Codex 检查功能索引、fork 登记、实现与固定 SHA 源码，并让 ChatGPT 对相同范围做独立逐项审查后复核。**这是源码级可行性判断，尚未在官方发行版安装独立插件、测试 Launcher 注入或完成迁移版实机验收。** 工作树有未提交改动，`active` 是功能卡状态，并不保证默认开启或当前安装版已验收。

## 结论

**停止合并整棵 vendored Harness，有现实可行的迁移路线；“Launcher 每次启动官方应用后注入全部修改，用户以后任意升级都原样可用”没有源码依据。** 官方 Desktop 本身支持外部 Host/Client 插件。优先使用该加载机制；Launcher 负责安装、启停、兼容性检查和伴随进程。CDP 注入可作验证手段，但不会使 DOM、编辑器内部状态或原生窗口接口变稳定。

思考炫光**可以**迁为独立 Client 插件。原版公开会话运行态与输入提交阶段，并在输入卡中实际渲染 `conversation.input.overlay`，卡片还有 `data-composer-card` 锚点。插件可在此量取卡片、绘制边光；4px 外扩、裁切和层叠需要 CSS/DOM 适配与像素实测。它属于下表 **C**，不是“必须修改 InputBar 源码”。鼠标特效更独立；金属漆、背景、透明主题等可以迁出，但会受官方元素样式和表面结构变化影响。

迁移中仍需逐项核对公开接缝的是：**精确 Lexical 键入事件、同会话编辑重发、会话/工作区准入及持久化语义、工具调用落盘前校验、与官方原生 guest/退出/快捷键分发直接耦合的行为**。就已核实的 rc.2 公共接口而言，不能把这些完整合同当作普通 CSS 或页面插件。若进一步源码核对确认缺口，可向上游增加公开扩展点、维护有限补丁，或改变产品交互合同；启动后注入脚本不会自动解决它们。

## 判定口径与官方基础

| 类别 | 含义 |
| --- | --- |
| A | 官方已具备基础能力；不表示我方全部细节相同。 |
| B | 独立 Host/Client 插件可拥有功能，正常使用公开接口与自身 DOM/Canvas。 |
| C | 可由插件加官方页面 DOM/CSS 适配、或伴随进程实现；存在版本兼容或完整保真缺口。**C 不等于修改官方源码。** |
| D | 当前公开接缝不足以承载指定的**原样合同**；需新公开扩展点、有限源码补丁，或改变该合同。未读尽实现/未做原版实验者标“D 待证”，不宣称逻辑上只有改源码一条路。 |
| E | Launcher、操作系统窗口、数据目录、安装与打包层；不属于页面注入，通常可作为独立程序。 |

下面证据来自**官方固定 SHA**，不是已修改的 `vendor/deepseek-harness`：

1. [官方 Desktop README](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/apps/desktop/README.md) 说明 Desktop 装载外部插件、拥有自己的 `profiles/desktop`，并提供原生 Browser、恢复和更新；[Client 模块文档](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/docs/subsystems/client-modules.md#L78) 规定 `dsh.client`、`platform: web` 与 `exports["./client"]`。**安装插件是现成路径，替换官方 ASAR 不是同一机制。**
2. [原版输入卡](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/packages/client/ui-conversation/src/client/skeleton/InputBar.tsx#L375)、[输入槽与状态契约](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/packages/client/ui-conversation/src/client/contract/slots.ts#L194)、[Session Hook](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/packages/client/ui-session/src/client/index.ts#L163) 提供炫光运行态和挂载点；[输入契约](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/packages/client/ui-conversation/src/client/contract/input.ts#L216) 不公开 Lexical update tags 或完整编辑会话命令。
3. [右栏扩展文档](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/packages/client/ui-sidebar-right/README.md#L79) 允许注册新 tab、正文与标题。[根布局](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/packages/client/ui-layout/src/client/index.ts#L172) 有 `shell.overlay`，**没有**我方新增的 `shell.titlebar.trailing` 和 `shell.terminalDrawer`；独立新 tab 与现有标题栏/底栏位置不能混为一谈。
4. [主题接口](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/packages/client/ui-theme/src/client/index.ts#L274) 支持第三方主题和 token override；[设置接口](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/packages/client/ui-settings-general/src/client/index.ts#L197) 有 `settings.section` / `settings.general.item`。我方 `settings.appearance.item` 不是迁移前提，但独立设置存储仍需实现。
5. [原版工具图片槽](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/packages/client/ui-tool/src/client/contract/slots.ts#L45) 已存在，且 [ToolRow 实际调用](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/packages/client/ui-tool/src/client/tool/components/ToolRow.tsx#L282)；但 [原版通用工具卡](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/packages/client/ui-tool/src/client/tool/toolviews/GenericToolCard.tsx#L32) 没有把任意工具结果图片交给该槽。[systemPrompt.section](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/packages/core/system-prompt/README.md#L59) 可由插件注册自有节段和数值顺序。两者证明“现在有 fork”不能直接推出“必须 fork”，也不能把基础槽位误判为完整功能。
6. [原版 ui-workspace](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/packages/client/ui-workspace/src/client/index.ts#L147) 已有归档/取消归档和相关入口；但我方 [归档功能卡](../features/session-archive.md) 还规定未知 ID、删除级联、显示开关等额外行为。

以下逐项依据 [功能索引](../features/README.md) 的 **46 项 active** 和 **5 项 proposed**；当前源码差异由 [fork 登记](../../src/shared/harness-desktop-forks.js) 辅助定位。表中的“高/中/低”是**静态判断置信度**，不是通过率。表内 `V/` 表示 `vendor/deepseek-harness/packages/`；`vendor/`、`src/`、`scripts/` 等无别名前缀均相对仓库根。含 `*` 的入口是文件组模式。

## 视觉、动效、入口（14 项 active）

| 功能卡与当前入口 | 判断 | 依据、缺口 |
| --- | --- | --- |
| [desktop-branding](../features/desktop-branding.md) · `V/client/ui-brand-official/`、`src/shared/product-identity.js` | C + E／高 | 页面品牌可用槽位或 DOM/CSS 适配；安装身份、应用图标、托盘/任务栏和原生关于页属于官方进程/打包，页面插件不能改其身份。 |
| [wallpaper-gallery](../features/wallpaper-gallery.md) · `V/client/ui-theme/src/client/WallpaperGalleryModal.tsx`、`src/main/wallpaper-catalog.js` | C／中高 | 图库 UI、图源服务可拆出；壁纸与各表面混色、弹窗设置入口需适配。 |
| [background-gradient](../features/background-gradient.md) · `V/client/ui-theme/src/wallpaper.ts` | C／高 | 光斑本身可用独立 DOM/CSS；全界面可见性取决于页面填充、Composer 压暗带和终端表面。 |
| [cursor-effects](../features/cursor-effects.md) · `V/client/ui-theme/src/cursor-fx.ts` | B／高 | 自有 Canvas/WebGL、指针监听和插件卸载即可；保留闲置/隐藏暂停及减弱动效。只覆盖主文档，不自动覆盖 guest 和独立原生窗。 |
| [metallic-paint](../features/metallic-paint.md) · `V/client/ui-theme/src/styles/metallic-paint.css` | C（低耦合）／高 | CSS 足以绘制，但作用于官方现有按钮，需兼容样式优先级、背景图层、主题 token。 |
| [transparent-theme](../features/transparent-theme.md) · `V/client/ui-theme/src/wallpaper.ts`、Ghostty 渲染 | C；终端透明需专门验证／高 | 主题 token/CSS 可改普通表面；我方 Ghostty 画布 alpha/清屏不等价于 `canvas { background: transparent }`。如果坚持修改官方终端渲染器而无配置接口，该局部为 D。 |
| [sidebar-mask](../features/sidebar-mask.md) · `V/client/ui-theme/src/client/index.ts` | B/C／中高 | 基础填充可用主题 override；当前所有遮罩、标题行和玻璃层完全一致需 CSS 适配。 |
| [composer-beam](../features/composer-beam.md) · `V/client/ui-conversation/src/client/ComposerBeam.tsx` | **C／高** | 原版 `useInput` + `useSession` 可判定 busy/running，`conversation.input.overlay` 与 `data-composer-card` 可挂绘制层；四角尺寸、4px 裁切、光晕层叠和点击命中需验证。**无需先改官方 InputBar 或 Lexical。** |
| [composer-typing-fx](../features/composer-typing-fx.md) · `V/client/ui-conversation/src/client/TypingFxLayer.tsx` | C；精确语义 D 待证／中 | DOM input/composition/selection 事件可近似回显；当前实现读取 Lexical update tags 排除粘贴、撤销、草稿恢复等。原版公开 `useInput` 不给这些来源标签；等价迁移要编辑器观测扩展点或内部适配。 |
| [composer-family-width](../features/composer-family-width.md) · `V/client/ui-conversation/src/client/skeleton/ComposerResizeHandles.tsx`、`V/client/ui-chat/src/client/chat/StatsPills.module.css` | C／中高 | 宽度联动跨输入卡、统计、Dock 和 Hero；可量取和注入 CSS 变量，但需逐组件适配。 |
| [composer-draft-transition](../features/composer-draft-transition.md) · `V/client/ui-conversation/src/client/skeleton/ConversationRoot*` | C；生命周期接口待证／中 | 首发前后位置连续性可尝试 DOM/FLIP；必须验证 React 挂载、滚动、焦点、取消时序，纯 CSS 不足。 |
| [settings-select](../features/settings-select.md) · `V/client/ui-primitives/src/SettingsSelect.tsx` | C／中高 | 插件自有设置项可直接用相同控件；替换官方所有既有选择器需要组件/DOM 接入，CSS 不能代替 Menu 行为。 |
| [account-settings-entry](../features/account-settings-entry.md) · `V/client/ui-settings-general/src/client/SettingsRoot.tsx` | C／中 | 自有设置页有公开槽；把官方账户菜单、更新/远程入口完全收束并保留焦点/回退，需核实其菜单接缝。 |
| [account-browser-sign-in](../features/account-browser-sign-in.md) · `V/client/ui-settings-account/src/client/index.ts` | C + E／中 | 系统浏览器打开可走官方外链或伴随程序；每次登录尝试只自动打开一次仍要按原版认证流核实。当前 `window.shell.openExternal` 不能直接假定存在。 |

[动效总约定](../motion.md) 不是第 52 张功能卡：插件自己的进出场属于 B；换官方现有动画样式属于 C；要求官方组件在卸载后继续退场、保留旧标签或首发位移，则要组件生命周期接缝，当前不能保证仅靠 CSS。

## 会话、模型、工具与数据（12 项 active）

| 功能卡与当前入口 | 判断 | 依据、缺口 |
| --- | --- | --- |
| [vision-fallback](../features/vision-fallback.md) · `V/llm/llm-vision-fallback/`、`V/core/agent-loop/` | C；完整路由 D 待证／中低 | 图片描述服务可独立；准入、主请求重写、重放及失败语义发生在 Agent/LLM 路径，需核查原版 middleware 是否足够。 |
| [dsh-tools](../features/dsh-tools.md) · `V/llm/llm/`、`V/core/agent-loop/`、`V/core/session/` | D 待证／中低 | 工具名/ID 的落盘前校验、重试与旧日志修复不是 UI 注入。需先核对官方是否已有相同校验/可插入的预持久化 hook；若没有，就需官方扩展点或核心补丁。 |
| [custom-instructions](../features/custom-instructions.md) · `V/client/ui-conversation/src/index.ts`、`V/client/ui-conversation/src/client/input/submission-policy.ts` | **B 候选／中高** | 原版 `systemPrompt.section()` 与 `variable()` 可注册自有贡献，不必改 `SECTION_ORDERS`；配独立设置行和存储。须验 live 更新、`{{x}}` 原文不被二次插值、全局/子 scope、`complete` 覆盖以及在已知插件组合中位于末段；数值 order 不能保证未来任意插件后仍排最后。当前设置到 prompt 接线待核。 |
| [session-archive](../features/session-archive.md) · `V/client/ui-workspace/`、`V/workspace/workspace/` | **A 归档基础 + C 界面差异；Host 增量待核／中** | 原版已有归档 UI/RPC；我方列表开关、默认折叠、归档行不可直接打开属于 UI。已归档根才可删除、子代理级联、部分失败事件顺序、未知 unarchive 拒绝属于 Host 合同，须对照原版实现与公开拦截/服务接口后再分 A/B/D。 |
| [no-directory-sessions](../features/no-directory-sessions.md) · `V/api/workspace-controller/`、`V/workspace/workspace/`、`V/client/ui-workspace/` | C；完整合同 D 候选／中 | scratch cwd、避免登记 workspace、历史成员重新接纳、删除后全视图隐藏和安全空会话复用跨 Host/Client。不能只添加“无目录”按钮。官方公开 workspace/session API 需逐项核实。 |
| [plugin-session-navigation](../features/plugin-session-navigation.md) · `V/api/session-controller/`、`V/client/ui-workspace/`、`V/client/ui-conversation/` | C；完整合同 D 候选／中 | `presentation.owner/title/managed`、列表隔离、持久标题、历史空会话不可复用属于跨层协议；原版输入契约没有我方 `conversation.input.managed`。Bot 自有 tab 可做，但不能视为原会话体验等价。 |
| [message-edit](../features/message-edit.md) · `V/client/ui-message-edit/`、`V/client/ui-conversation/src/client/input/facade.ts` | **D 候选／中高** | 最新用户消息在**同一 Session/Composer** 编辑重发，还需草稿恢复、跳过普通提交裁决和追加日志修订。原版公开输入 actions 没有 `beginEdit`；仅 `setDraft` 或另开会话不满足合同。若其他官方服务没有等价入口，须加编辑会话扩展点/补丁。 |
| [tool-result-images](../features/tool-result-images.md) · `V/client/ui-tool/`、`V/client/ui-attachment/` | **A（read_image）+ C；任意工具通用路径 D 候选／中高** | 原版已有 `tool.call.images` 和读图图库；但默认 `GenericToolCard` 未将任意工具的结果图片传给 `ToolRow`，`tool.call.toolview` 又按具体工具名分发。插件可为已知 MCP/浏览器工具名注册视图；要无遗漏覆盖未来任意工具，需通用 fallback 扩展点或补丁。持久附件链仍待实测。 |
| [composer-stats-peak-valley](../features/composer-stats-peak-valley.md) · `V/client/ui-conversation/src/client/chat/PeakValleyRow.tsx` | B/C／中高 | 独立状态条可经 Composer dock；成本/峰谷数据和宽度联动需迁出原命名空间并核实统计源。 |
| [session-cost-display](../features/session-cost-display.md) · `V/client/ui-conversation/src/client/chat/PeakValleyRow.tsx`、`V/client/ui-conversation/src/client/chat/SessionCostCard.tsx` | C／中 | 画数字容易，峰谷桶、子代理、历史用量和唯一价格源的累计口径需要原版数据投影。 |
| [usage-stats](../features/usage-stats.md) · `vendor/dsh-usage-panel/` | B（UI）+ C（数据）／高 | 已是独立插件形态；会话投影、旧日志修复和价格源仍与当前 core 配置耦合，需数据兼容验证。 |
| [skills-groups](../features/skills-groups.md) · `V/host/skill-inventory/`、`V/client/ui-settings-skills/` | B/C／中 | 分组元数据、自有管理页和批量操作可迁；原设置页原位替换及官方启停写回语义需核实。 |

## 工作面板与桌面宿主（4 项 active）

| 功能卡与当前入口 | 判断 | 依据、缺口 |
| --- | --- | --- |
| [surfaces-work-loops](../features/surfaces-work-loops.md) · `V/client/ui-surfaces/`、`V/client/ui-files/`、`V/client/ui-diff/`、`src/main/preview.js` | **B（各内容）+ C（整体布局）／高** | 原版已有右栏新 tab 扩展；Files 搜索/保存、Diff、选区送聊可拆为自有页与 Host RPC。当前单一 Surfaces 右栏、与原 sidebar 互斥、资源路径和布局几何需适配；不能把官方基础 Files/Browser 等同完整工作环。 |
| [terminal-drawer](../features/terminal-drawer.md) · `src/main/pty.js`、`V/client/ui-user-terminal/` | **B（PTY/UI）+ C（同一底栏位置）／高** | 官方已有终端；自有 Ghostty 与 PTY 服务可插件化/伴随化。原版没有 `shell.terminalDrawer`；可尝试 overlay/DOM 重排，底栏网格和选区送聊需实测。若要求稳定的布局扩展契约，可向上游增槽；关闭不 kill 的任务生命周期另核。 |
| [git-titlebar](../features/git-titlebar.md) · `src/main/git.js`、`V/client/ui-git/` | **B（Git 服务）+ C（标题栏）／高** | Git CLI、授权及 stage/commit/push 可转 Host RPC；原版右栏可承载自有 Git 页。当前 Git 胶囊在 **Web 布局的标题栏区域**；原版没有我方 `shell.titlebar.trailing` 槽。DOM 适配可能复现位置；新增公开槽可降低维护量，但不是目前证成的前置条件。官方逐轮审阅不等于工作树 Git 管理。 |
| [directory-picker-drives](../features/directory-picker-drives.md) · `V/host/directory-picker-browse/`、`V/host/directory-picker/` | A 基础 + C／中高 | 官方已有原生选目录；我方“此电脑”卷枚举/跨盘/手机浏览可独立服务，但替换官方既有选择流程的入口待证。 |

Browser 是 `surfaces-work-loops` 的子域：官方已有受限 Browser bridge/guest。当前 `src/main/preview.js` 和 `ui-preview/` 的截图、录制、PiP、元素选择、mini 与右栏同 guest、独立置顶预览窗包含 **C + E**。外部浏览器/伴随窗口能提供类似功能，却不自动共享官方 guest 的会话、历史、焦点和遮挡；若要求直接控制官方 guest 而公开 bridge 不提供命令，该局部需官方原生扩展点。独立文件窗同理。

## 插件生态、远程与桌宠（8 项 active）

| 功能卡与当前入口 | 判断 | 依据、缺口 |
| --- | --- | --- |
| [marketplace-settings](../features/marketplace-settings.md) · `src/main/marketplace-*.js`、`V/client/ui-settings-market/` | A 基础 + C／高 | 官方已有插件安装/激活；目录、收藏、详情可独立设置页。安装事务须对接官方 `profiles/desktop`，不能直接沿用我方 `profiles/web` 写入及重启控制。 |
| [remote-settings](../features/remote-settings.md) · `src/main/dshd-remote.js`、`vendor/dsh-im/` | C／中高 | IM 服务与设置页可迁；网关启停、桌面内置/不可禁用语义和官方鉴权需适配。 |
| [mobile-remote](../features/mobile-remote.md) · `mobile/web/`、`mobile/android/`、`src/shared/dshd-host-tunnel.js` | C + E／高 | SPA、Android、relay 可独立；当前 Host cookie/origin/RPC 隧道来自 DSHD，官方不能假定提供同一桥。真机、公网 relay 和 Android WebView 仍按功能卡验收。 |
| [remote-workspace](../features/remote-workspace.md) · `vendor/dsh-remote/`、`src/main/dsh-remote-desktop.js` | B（SSH 服务）+ C（桌面入口）／高 | SSH/SFTP/镜像已有独立插件形态；picker 槽、工具路由、overlay、启停重启需适配。现有手册的真实 SSH 往返和安装版 UI 尚未运行。 |
| [dshbot](../features/dshbot.md) · `vendor/dshbot/`、`src/main/dshbot-desktop.js` | B（业务）+ C/D（受管会话）／中高 | 目录、记忆、调度、工具适合 Host/Client 插件；同 transcript、受管 Composer、展示隔离与固定会话依赖上一节 `plugin-session-navigation`。内置且 skip 仍加载属当前装配策略。 |
| [whale-assistant](../features/whale-assistant.md) · `vendor/dsh-whale/`、`src/main/dsh-whale-desktop.js` | B（人格/工具）+ C/D（联动）／高 | 已有 bundle/client 包形态；设置 `settings.pet.item`、固定会话、桌宠 RPC、内置装配需改接。现有精确版本依赖显示插件仍有兼容门槛。 |
| [desktop-pet](../features/desktop-pet.md) · `src/main/desktop-pet.js`、`src/renderer/pet.*` | E；会话联动 C／高 | 宠物原生窗和位置/托盘状态可由伴随程序拥有；功能卡说明旧实现保留但默认隐藏。 |
| [desktop-live2d-pet](../features/desktop-live2d-pet.md) · `src/main/desktop-live2d.js`、`src/renderer/pet-live2d.*` | E + C／高 | 透明窗、点击穿透、养成/物理可独立；官方会话、审批、截图识别等联动需插件桥，不属于普通页面 CSS 注入。 |

## 启动、交付与工程层（8 项 active、5 项 proposed）

| 功能卡与当前入口 | 状态／判断 | 依据、缺口 |
| --- | --- | --- |
| [boot-page](../features/boot-page.md) · `src/renderer/boot.*`、`src/main/harness-controller.js` | active · E；官方基础恢复 A／高 | 启动仪表与插件取证发生在 Client 插件加载**之前**，可保留在 Launcher；不能靠已启动页面的插件接管官方首屏/致命恢复。 |
| [dsh-home](../features/dsh-home.md) · `src/shared/dsh-home.js` | active · E／高 | 我方隔离 `dsh-home/profiles/web`；官方使用自己的 Desktop profile。数据、凭据、插件清单与可执行依赖须分别迁移，不是设置一个环境变量。 |
| [desktop-launcher](../features/desktop-launcher.md) · `src/main-launcher/index.js`、`src/launcher/` | active · E／高 | 可改为官方应用/插件的管理入口；当前 peer 握手、停止、恢复和安装目标仍指 DSHD，不能原样复用。 |
| [data-import](../features/data-import.md) · `src/main/data-import.js` | active · E；反向格式待证／高 | 当前方向是**官方 → DSHD**，不是 DSHD → 官方；排除内部 profile/storage/OAuth。迁往官方要另做只读盘点、映射和回滚，不能反向调用现有导入器。 |
| [windows-installer](../features/windows-installer.md) · `package.json`、`build/installer.nsh` | active · E／高 | 可分发 Launcher 和伴随程序；不能由 Client 插件改变官方已签名程序的产品身份/资源。 |
| [task-protection](../features/task-protection.md) · `src/main/task-protection.js`、`vendor/dsh-task-control/` | active · A 基础 + C/D/E 增强／高 | 官方已有任务退出确认；我方还覆盖 Bot 调度、PTY、preview、组件、安装。要在官方进程内以相同顺序阻断退出/停止，须先核实其任务接纳/退出接口；若未开放则需扩展点或补丁。伴随进程只管自己的一部分。 |
| [core-regression-gates](../features/core-regression-gates.md) · `.github/workflows/test.yml` | active · 工程门禁／高 | 不是待注入 UI；迁移后仍需真实官方版本组合的核心回归。 |
| [harness-upstream-sync](../features/harness-upstream-sync.md) · `src/shared/harness-sync.js` | active · 工程流程／高 | 独立插件可减少三方源码合并；仍需按官方版本做 API、DOM 和数据兼容审查。 |
| [launcher-distribution](../features/launcher-distribution.md) · `electron-builder.launcher.yml`、`src/launcher/delta/` | **proposed** · E／高 | 已有代码但功能卡仍属拟议；完整双线路、签名及增量交付未据此验收。当前目录补丁实现与卡片“重建 Setup”方向不同。 |
| [launcher-components](../features/launcher-components.md) · `src/launcher/components/` | **proposed** · E／高 | 有组件监管代码；签名包信任、退出协调和独立生命周期仍按拟议门槛验收。 |
| [desktop-build-runtime](../features/desktop-build-runtime.md) · `scripts/after-pack.js` | **proposed** · E／高 | 当前 DSHD 打包/复用机制，不是注入能力；迁出后仍需打包自己的插件和伴随程序。 |
| [office-runtime](../features/office-runtime.md) · 拟议 Office runtime | **proposed** · A 基础 + C/E／中 | 官方文档已有 Python/Node/pnpm 和 Office 技能；我方只读预览、范围渲染、recalc/授权闭包不能据卡片视为已实现。 |
| [keyboard-shortcuts](../features/keyboard-shortcuts.md) · `V/client/shortcuts/src/policy.ts` | **proposed，部分实现** · A 基础 + C/D／高 | 默认键位可走注册；**原生 main 已消费的按键，页面无法事后撤销**。完整 local-first 分发策略须核实官方原生层是否可配置；若不能，再要扩展点或补丁。 |

## 哪些原样合同尚缺已证实的公开接缝

“必须注入源码”应按**具体原样合同**，而不是按功能名称判定。rc.2 的公开接口已经足够承载许多视觉效果，但以下合同尚不能证明由普通独立插件完整实现：

| 原样合同 | 已确认缺口 | 最小解法或替代方案 |
| --- | --- | --- |
| 键入回显精确区分键入、IME、粘贴、撤销、恢复 | `useInput` 有文本与阶段，无 Lexical update tags | 新增只读编辑器事件/来源接口；或做 DOM 近似版并明确降级。 |
| 同一 Session 的最新消息编辑、替换与重发 | 公共 actions 无 `beginEdit`；Host 日志修订和投影还需事务 | 新增编辑生命周期与持久化扩展点；或改为新会话/新消息交互。 |
| 无目录/插件受管会话的历史身份、隐藏与复用 | 当前多个 Host/Client fork 共同约束，已见原版无我方字段 | 核对现有 Session/Workspace 服务后补最小公开协议；或放弃原样导航合同。 |
| 工具调用持久化前校验/重试和旧日志修复 | 发生在 LLM、Agent Loop、Session 写入前；页面事件来得太晚 | 核对原版钩子/是否已吸收；没有则补核心 hook 或有限补丁。 |
| Web 布局的标题栏区域与底部抽屉 | 根布局无我方标题栏/抽屉槽 | DOM 重排或右栏 tab/overlay 是 C 类路线；正式增槽可降低适配维护量，尚不能据槽位缺失直接判 D。 |
| 同一 Browser guest 的专属动作 | Client 插件不直接拥有 Electron guest；现有 bridge 命令覆盖范围待核 | 独立伴随窗是 E，但同 guest 行为不自动等价。先查官方 bridge；缺命令时再申请原生扩展点或补丁。 |
| 官方进程首屏、退出仲裁、原生快捷键先行消费、安装身份 | 这些动作在 Client 启动前或 Electron main/打包层 | Launcher 只管理自有阶段；要改变官方内部阶段需官方原生扩展点或维护补丁。 |

这张表区分**已证实的公开接口不足**与**尚未读尽全部官方路径**。尤其 `vision-fallback`、`dsh-tools`、`no-directory-sessions`、`session-archive` 的最终 D/A 边界，还需细查固定 SHA 的 Agent、Session、Workspace 实现后才能冻结结论。维护一份“私有整包替换插件”虽然可以不改磁盘上的官方源码，但版本耦合与三方合并成本仍接近 fork，不能计作 B。

## Launcher 启动后注入的实际边界

如果官方发行版允许外部调试目标，Launcher 理论上可在主 Web 页面加载后执行 JS/CSS，并在页面刷新后重注入，足以**展示**炫光、鼠标轨迹、背景和按钮扫光。这只是条件性技术推断：本轮未确认官方打包版是否接受调试端口、主页面目标是否可达，也未运行该 PoC。它不赋予插件未公开的 Lexical 语义、Host 落盘前钩子或 Electron main/guest 权限。

产品化还要处理首屏早于注入、导航/崩溃后重挂、多个窗口和版本变化。调试端口具有广泛页面控制能力；[现有 CDP 探针](../../scripts/run-cdp-surface-probe.mjs)已通过页面求值读取/操作 UI，不能把它当成普通用户安装插件的等价信任边界。需要限定本机访问、生命周期和失败回退。官方签名不为外部插件背书；[官方 Desktop 运行结构](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/apps/desktop/README.md#L77)表明 Host 插件与官方 Host 同处 Node 进程，不能当作低权限视觉沙箱。Git、PTY、远程伴随桥也不能仅凭 loopback 地址信任请求，应有独立鉴权、操作授权及会话/工作区绑定，并保留官方 guest、profile 和安装权限边界。既然官方已有外部 Client 插件加载，应先走插件；CDP 只用于验证缺失接口与极少数不得已的兼容适配。

## 迁移验证顺序与更新承诺

1. **先做最小原版安装实验。** 在独立 `profiles/desktop` 装一个真正的外部 Client/Host 插件，验证加载、设置持久化、卸载与 rc.2/下一版更新后保留；记录实际官方 Desktop 二进制来源与版本。当前未完成，不能据源码推断发行包兼容。
2. **视觉 PoC。** 先迁 `cursor-effects`、`composer-beam`、`metallic-paint`；对炫光逐帧比较运行/停止、无会话、尺寸变化、缩放、透明主题、点击命中；对输入特效分别测打字、中文 IME、粘贴、撤销、历史草稿。只有通过这些场景才能把“能显示”提升为“产品级可用”。
3. **分离工作面板内容与宿主。** 将 Git/Files/Diff/PTY 服务改成自有 Host RPC 或伴随进程；优先落在官方右栏 tab。若产品仍要求当前标题栏/底栏/同 guest，向上游提出最小槽位/命令扩展，而非复制整个 `ui-layout`。
4. **先保全数据再切换底座。** 只读盘点 DSHD 与官方的 home、Session JSONL、附件、设置、凭据和插件清单；做 DSHD → 官方的专门迁移器与可回滚试运行。现有 `data-import` 方向相反。
5. **按版本声明兼容。** 保持官方应用由官方更新，插件声明支持的版本范围，并设启动前兼容检查、启动 smoke 与失败恢复。先验证模块图/Host 插件在不兼容时是否还能让官方应用启动；不能假定插件自己的判断一定能在加载失败之前运行。用户也可能从官方快捷方式启动或被官方重启，绕过 Launcher。C 类 DOM 适配在运行后发现不匹配时应停绘；这与“插件成功加载”“官方应用成功启动”是三个不同保证。

官方文档说明升级会保留已安装插件，也提供第三方插件失败后的恢复路径；这不等于其 API、DOM、数据格式或宿主权限在未来版本永远兼容，或能自动隔离每一个不兼容插件。**“用户不再等待我们合并整棵 DSH”是迁移目标**，成立条件是外部插件在官方升级后的加载、失败恢复和数据兼容均通过验证；任意版本零维护、全部定制逐像素保真不能承诺。

## 当前证据限制与待核问题

- ChatGPT 首轮全面审查只读了固定 SHA 的选定导出路径。Codex 另用 Git 对象复核了 `ui-layout`、`ui-sidebar-right`、`ui-tool`、`system-prompt`、`ui-workspace`。仍需补看官方 `apps/desktop/src/`、Session/Workspace、Agent/LLM、远程鉴权与 Office 的完整实现，才能收紧 D 候选项。
- [自定义指令功能卡](../features/custom-instructions.md) 说 `ui-conversation/src/index.ts` 注册 `ui:custom-instructions`；当前该入口只看到设置字段配置，Client 保存链仍在。**设置存在，当前工作树模型请求接线待核**；不以旧验收记录推定现在仍有效。这是额外发现，未运行模型验证。
- [launcher-distribution](../features/launcher-distribution.md) 要求增量重建目标 Setup；当前 `src/launcher/delta/install.js` 仍将已安装路径传给 `applyDeltaFile()`。计划与当前实现不能混称，也不能由此推断能更新官方签名安装。
- `vendor/dsh-whale/package.json` 仍有精确运行依赖版本，且 [鲸鱼功能卡](../features/whale-assistant.md) 记录过兼容门禁造成插件缺席。调整 peer 范围仅解决准入，不证明运行和存储兼容。
- 本报告不改产品代码，没有进行官方插件安装、官方打包版/CDP 实验、端到端迁移或真实模型测试。外部发行资产的可获得性与后续版本接口应按实验时的官方发布再次核验。

相关背景：[官方 Desktop 与本项目对比](2026-09-25-official-desktop-comparison.md)、[设计语言](../design-language.md)、[Motion 清单](../motion.md)、[桌面特性索引](../features/README.md)。
