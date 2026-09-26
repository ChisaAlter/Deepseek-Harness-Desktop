# Feature: Boot page

| Field | Value |
| --- | --- |
| **id** | `boot-page` |
| **status** | `active` |
| **last verified (restart)** | 2026-09-08 — 105 项 controller/window/IPC 检查通过；延迟 boot 导航回归及隔离 Electron 内置重启恢复可见 Bot 界面通过 |
| **last verified (boot canvas)** | 2026-09-18 — 用户提供的 `assets/whale-spin.svg` 原样用作 112px 中区旋转加载动画，减少动态效果时换 `assets/whale-head.png`；Electron 两帧验证旋转/静态切换，32 项定向与全量 1775 项通过（2 跳过）；源码预启动构建受已有 openNoDirectory 类型错误阻塞。 |
| **implementation note (boot canvas)** | 2026-09-25 — 三段响应式布局、隐藏按钮样式和恢复跳板条件已更新；本次没有运行测试或检查运行时画面，验证待补。 |
| **last verified (IPC auth, B2)** | 2026-09-20 — boot 角色授权边界复核：`ipcSenderRole` 仅在 sender 属于主窗 boot webContents、frame 为其**顶层 frame**、URL 通过 `isLocalAppNavigationUrl` 且 sender 未销毁时才返回 `IPC_ROLES.BOOT`；子 frame、已销毁 sender、导航离开 boot 页、被替换的 webContents 一律 `null`，`assertIpcSender` 抛 `ERR_DSH_IPC_SENDER`。`ipc-authorization.test.js` 7/7。boot 页动作面仍限定为 `shell:restart` / `shell:open-launcher` 等既有通道，本轮未新增 boot 侧 IPC，也未改 `--boot-*` 作用域。 |
| **last verified** | 2026-09-26 — 日志分区双页制落地（原型 `boot-redesign-b2-logzone.html` L1）：场景页只留 mark/brand/status/hint + 底缘「详细 · 日志 NN」把手；`page-details` 整页覆盖承载栏头/failure/recovery/actions/log + 「回到场景」/Escape；`canAct`（error/scheduled/restarting）自动翻开、手动关闭当轮免疫重开；把手计数取 `snapshot.logs.length`，live 追加经 `appendLog` 递增。无 jsdom，结构由 `boot-recovery.test.js` 静态断言钉死（8/8）；headless Edge 实拍 error 自动翻开与场景页返回均正确。决策见 [boot-log-details-page](../decisions/implemented/product/2026-09-26-boot-log-details-page.md)。前次：2026-09-19 — 最小化/还原闪屏两连修：①`data-harness-covered` 下 boot 文档 `visibility:hidden` + html/body 画布透明，合成层空窗期回落到与 harness 页面同步的窗口背景而非仪器画布；②harness BrowserView `backgroundThrottling:false`，窗口隐藏期间持续产帧，消除还原时主表面先上屏、View 帧晚一拍的空白闪屏（浅色主题下表现为白屏）。window-harness-cover 契约 11 项通过。此前：2026-09-18 — 用户提供的 `assets/whale-spin.svg` 原样用作 112px 中区旋转加载动画，减少动态效果时换 `assets/whale-head.png`；Electron 两帧验证旋转/静态切换，32 项定向与全量 1775 项通过（2 跳过）；源码预启动构建受已有 openNoDirectory 类型错误阻塞。 |

## User paths

1. 冷启动先开启动器（更新 / 导入 / 版本 / 问诊）。启动桌面端后，主窗见仪器画布场景页：顶部状态戳、中央鲸鱼旋转加载动画（`assets/whale-spin.svg` 2 秒循环 112px，`.mark` 提到扫描线遮罩之上，`prefers-reduced-motion` 换 `assets/whale-head.png` 静态头像）与 Whale Isle 名称、状态与说明；底缘中央把手「详细 · 日志 NN」实时记日志行数，点开（或 Escape/「回到场景」返回）进入同画布的详情页——栏头小鲸标 + BOOT LOG、故障详情、恢复动作与等宽日志栏内滚动；动作面浮出（error / 恢复排程 / 重启中）时详情页自动翻开，用户手动关闭后同轮不再自动弹；插件进度留在此页。
2. 就绪后露出官方 Web UI；不切到官方「正在加载插件」页代替 boot。
3. 失败：ERROR 态、重试、导出日志；自动重启排程或进行期间隐藏「回启动器排查」跳板，恢复停止后该跳板可打开启动器 home tab（Recovery Board）；用户插件弄挂可跳过插件树后再试完整插件。插件级排查（归因、逐项/批量禁用）在 Recovery Board 做，不在 boot 页。

## Invariants

- 启动页是整窗仪器画布例外；`--boot-*` **不得**扩散到启动器、设置、关闭遮罩、标题栏或官方 Web UI。
- 启动画布的品牌名为 Whale Isle；保留仪器画布视觉（扫描线、角轨、状态戳）与既有恢复语义；日志与诊断/动作收进详情页（`page-details`，同一画布整页覆盖），场景页保持纯净，布局可按窗口高度响应式调整。
- 插件进度只呈现 controller / 插件事件提供的状态，不估算百分比或添加虚构步骤；启动器跳板只在 settled `error` 且恢复状态非 `scheduled` / `restarting` 时出现。
- 禁止 NERV / MAGI / SEELE / EVA 等商标或官方标志挪用。
- 插件装载进度留在 boot 画布。
- 未完成的 boot 导航由恢复与手动重启共享等待；旧导航不得在新的 Harness 揭示后覆盖主界面。
- 恢复动作与 [plugin-recovery 流程](../handbook/flows/plugin-recovery.md) 一致。
- boot 页动作面 = 瞬时动作（重试 / 取消自动重启 / 下载日志）+「回启动器排查」跳板，仅此四件；插件级恢复操作**只**存在于启动器 Recovery Board，boot 页不得长出自己的副本（`boot-recovery.test.js` 钉死动作行内容）。跳板仅在 settled `error` 态出现（自动重启排程/进行中不出现），经 `shell:open-launcher`（BOOT 角色 → 启动器 home tab）。
- 覆盖安装同一桌面版本时，`userData/runtime/<version>` 必须与安装包 Harness pin + 归档大小一致；无戳或戳不匹配则重新解压。不得只因 `bin.js` 存在而沿用旧 runtime。

## Allowed touch

- `src/renderer/boot.html` / `boot.css` / `boot.js` / `boot-tokens.css` / `boot-recovery.js`
- `src/main/harness-controller.js`、`harness-extract.js`、`window.js`、`window-harness-cover.test.js`（boot 布局断言）、`boot-log-dump.js`、`plugin-tree-failure.js`、`plugin-recovery-actions.js`
- `assets/whale-spin.svg`、`assets/whale-head.png` — 用户指定的加载与品牌资源
- 本卡、[启动页决策记录](../decisions/implemented/product/2026-09-25-boot-page-responsive-instrument-canvas.md)、handbook boot / plugin-recovery 章、[design-language 桌面启动页段](../design-language.md#桌面启动页)及其英文配对

## Do not touch

- 把 `--boot-*` 用到非启动页
- 用空态卡片或官方加载页替换仪器画布产品路径

## Gates

| Kind | What |
| --- | --- |
| Automated | boot / harness-controller / plugin-recovery 单测；`qa:packaged` 可 rehearsal overlay stamp（**不能**当发版 Pass） |
| Manual / QA | 每次发布前 [production-acceptance](../qa/production-acceptance-test-cases.md)：`TC-INST-003`…`007`、`TC-INST-012`、`TC-INST-013`；对象=CI Setup |

## Sources

- Decision: [启动页使用三段响应式仪器画布](../decisions/implemented/product/2026-09-25-boot-page-responsive-instrument-canvas.md)
- Decision: [日志分区双页制：场景纯净、诊断与动作收进详情页](../decisions/implemented/product/2026-09-26-boot-log-details-page.md)
- Decision: [统一鲸鱼品牌资源](../decisions/implemented/product/2026-09-18-whale-brand-assets.md)

- Handbook：[../handbook/modules/boot-lifecycle.md](../handbook/modules/boot-lifecycle.md)、[../handbook/flows/boot-to-ready.md](../handbook/flows/boot-to-ready.md)
- Design：[../design-language.md](../design-language.md#桌面启动页)
- Spec：[../superpowers/specs/2026-08-18-plugin-startup-recovery-design.md](../superpowers/specs/2026-08-18-plugin-startup-recovery-design.md)
