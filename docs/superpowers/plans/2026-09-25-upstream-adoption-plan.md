# 上游能力按需接入完整计划（鲸屿 × DSH 0.1.7-rc.2）

状态：修订提案；产品能力尚未按本计划实施或验收。修订日期：2026-09-25。

本版依据当前工作树、官方版本查询及 GPT 第 23 轮审查重新制定，替代旧稿。[候选调研](../../research/2026-09-25-upstream-adoption-candidates.md)和[桌面对比](../../research/2026-09-25-official-desktop-comparison.md)保留为历史输入；冲突以本版的具名证据为准。架构选择及已有决定审计见[接入提案](../../decisions/proposed/architecture/2026-09-25-upstream-capability-adoption.md)。

**本次只修订文档。** 下文施工、测试、构建、安装和重启都是后续实施要求。源码中存在某个包、临时隐藏失败入口、未运行的测试，都不等于能力已交付。

## 1. 官方版本与证据范围

### 1.1 查询基线（2026-09-25 19:43，Asia/Shanghai）

| 对象 | 结果 | 使用规则 |
| --- | --- | --- |
| [官方最新 GitHub 发布](https://github.com/deepseek-ai/deepseek-harness/releases/tag/dsh-v0.1.7-rc.2) | `dsh-v0.1.7-rc.2`；发布时间 2026-09-24 14:10:21 UTC；`prerelease=true` | 最新发布仍是候选版，不称稳定版 |
| Git tag / 远端 master | 均为 `477b4f420553e8a52c2fbccc464d7561b239c443` | 本次查询未发现比 pin 新的 master；不是永久性结论 |
| [npm 官方 registry](https://registry.npmjs.org/@deepseek-ai%2Fdsh) | `latest=0.1.5-rc.3`；`next=0.1.7-rc.2`；`alpha=0.1.7-alpha.2` | 显式钉 `0.1.7-rc.2`，不以无版本安装或 npm latest 代替 |
| [本地 pin](../../../vendor/harness-upstream.json) | ref/npm 为 rc.2，SHA 同上 | 本轮接入已有上游能力，无需重复覆盖 vendor |
| 当前桌面树 | `HEAD=5eed678db9c`，大量已存在修改及未跟踪文件 | 当前源码事实以工作树为准；不等同干净 HEAD 或发布包 |

查询来自 GitHub Releases API、`commits/master`、`git ls-remote`、npm registry；可追溯到[固定 SHA](https://github.com/deepseek-ai/deepseek-harness/tree/477b4f420553e8a52c2fbccc464d7561b239c443)。开工及候选冻结时重查；出现新发布先比较接口/持久化变化，再决定下一轮同步，不在阶段中途追随浮动 master。

### 1.2 当前代码确认与旧稿纠正

| ID | 源码或只读探查 | 方案影响 |
| --- | --- | --- |
| F1 | `src/main/dsh.js::buildLaunch` 用独立 Node 启动 `dsh web --patch ... --no-open`；`scripts/after-pack.js` 组装并归档 Harness | 按独立 Node 的真实解包目录适配，不照搬官方 desktop-host/ASAR 环境 |
| F2 | `src/main/index.js::restartWithCleanup` 先清 PTY/preview；`quitApp/before-quit` 提前置 `quitting` | 确认必须先于清理/退出标记；取消后资源和驻留逻辑须保持 |
| F3 | `update-updater.js` 调 `quitAndInstall`；`update.js` 全包先 `launchInstaller` 再延迟退出；Launcher 另有 stop/external install | 只加 before-quit 对话框无法覆盖中断入口 |
| F4 | 官方 `apps/desktop-host/src/update-tasks.ts` 只拦 `connection/request`；Schedule runtime、Bots timer/hook 可独立投递 | HTTP 锁不等于所有任务来源的接纳锁 |
| F5 | `packages/schedule/schedule/src/index.ts::catalog()` 读 Host 全部 active/inactive 提醒及原 Session，不加载历史 | 用公开服务检查未来/到期及冷 Session；不只遍历 live agents，不复制存储解析 |
| F6 | `packages/bundle/web-app/cordis.patch.yml` 默认关闭 time-context/schedule/ui-schedule；sidebar-browser 仅 desktop profile 默认启用 | 包存在不等于启用；不因本计划擅自打开调度 |
| F7 | 从业务包直接 resolve engine 失败；从实际 `libreoffice-kit/package.json` 为 importer 可解析 **win32-x64 0.1.1**，目录有 `prebuilds.json/bin/program`；WASM 未找到 | **撤回旧稿“引擎缺失、现在转换必失败”。** pnpm 隔离依赖须从实际消费者解析；本轮未执行转换，不能证明引擎运行/发布闭包可用 |
| F8 | `scripts/libreoffice-packages.mjs`：目标 native 在 kit 中有声明则必须存在，否则才选 WASM | Windows x64 必须交付声明的 native，不把漏包静默兜底成 WASM |
| F9 | `packages/client/shortcuts/src/client/index.ts` 按 runtime 同时选默认键、存储、native/DOM 分发；官方 desktop 需要 keyboard bridge | 快捷键决策包括完整 adapter，不只是 localStorage 与文件二选一 |
| F10 | ui-files 的 extension 类型占 `dsh-resource://file/session/**`；`FilePreview.tsx` 还服务 Files 内嵌预览 | 两类入口都须接 Office；扩展名 suffix pattern 不能抢路由 |
| F11 | `ui-deliverables/FileDiff.tsx` 有 split/wrap/highlight，单比较 5000 行上限，hunk 高亮在 useMemo；ui-diff 初始展开多文件 | 不直接复制同步高亮；多文件及长行需另设有界工作量 |
| F12 | 根 npm test 只覆盖 shell/mobile/scripts JS；client AGENTS 禁止 feature 插件直接运行时引用另一个 feature 插件 | 单列 vendor 测试；Office 用槽位，Diff 提到静态共享呈现层 |
| F13 | 当前未跟踪的 `src/main/ipc-delta.js` → `src/launcher/delta/install.js` 会先 stopExternalDesktop，再下载并调用 applyDeltaFile；apply.js 直接 rename/delete 安装树文件，失败再走 fullInstall | 这是独立于 blockmap 的实际入口；不能只按旧 Launcher 提案中的“重建 Setup”推导安全性 |
| F14 | `src/main/ipc-components.js` 单独注册 before-quit 并直接调用 svc.shutdown；main-launcher 也有独立退出清理 | preventDefault 不停止其他监听器；所有破坏性监听必须移到协调器提交后 |
| F15 | `packages/client/shortcuts/src/client/registry.ts::dispatch` 用 runtime/platform 推导 desktop priority，绕过 region/modal 限制；官方 README 明示可抢终端 Ctrl+C | desktop 默认键与输入优先级必须解耦，鲸屿不能只切 runtime 然后声称终端已受保护 |

本轮证据限于源码阅读、版本查询和模块解析。源码启动、实际转换、离线安装、签名/SmartScreen、性能及远程行为均待实施验收。旧卡历史通过记录不能替代本次候选 SHA 的结果。

## 2. 完整目标、保留契约与不采用项

### 2.1 必交付结果

1. 真退出、重启/停止运行时、覆盖安装或版本切换前，告知活动任务、排队工作、已启用调度受到的影响；取消后继续使用。
2. 快捷键可搜索、修改、清除、恢复；菜单/按钮/自有面板/Browser guest 共用目录与已接受的配置版本。
3. Agent 用随包 Python/Node、Office 库和技能创建、定点编辑、结构校验 DOCX/PPTX/XLSX；三者均可在 Files 预览。完整目标包括 kit CLI 指定页/区域渲染、PDF 导出及 XLSX 重算到新文件。
4. 自有 Git Diff 支持 unified/split、对齐、同步滚动、高亮、折行，保留 Git 操作及工作区授权。
5. rc.2 的逐轮审阅、关联打开、持久提醒、对话中新工具、可选自动审阅在鲸屿组合下有具名兼容证据。

### 2.2 继续遵守

- Electron 壳 + 独立 Node `dsh web` + desktop-owned overlays；不替换成官方 desktop profile。
- [设计语言](../../design-language.md)、[动效](../../motion.md)、主题/背景和关闭控件位置；UI 修改先更新对应设计条目，复用语义 token、ui-primitives。
- 当前[工作环卡](../../features/surfaces-work-loops.md)规定 `ui-surfaces` 是 DSHD 右栏呈现所有者，原生右栏仅兼容专有资源、两轨互斥。旧 proposed 文档的相反方案不当作已实现现状。
- [dsh-home](../../features/dsh-home.md) 与官方 `~/.dsh` 隔离，不覆盖用户 profile/会话/插件配置/快捷键。
- closeToTray=true 关窗只隐藏，Host 继续运行；Launcher 关闭按桌面/独立组件的实际状态处理。
- Files 搜索/编辑/保存队列/引用入对话、终端、Browser/PiP、原生只读预览及已有恢复路径保留。

### 2.3 本版裁定

| 项目 | 选择 | 边界 |
| --- | --- | --- |
| 官方 onboarding/tray/mandatory-update/crash-report/desktop-host 整体 | 不采用 | 保留鲸屿 Launcher/壳，仅参考局部实现 |
| ui-sidebar-browser | 不采用 | 已有自有 Browser；上游 iframe/native bridge 两种分支，翻 overlay 不等于接入 |
| ui-directory-picker-native | 本轮保留 browse | 本地原有目录选择照常，手机/远程浏览 Host 目录；未来接入须分路、丢弃迟到结果，wire 不支持中止已打开的系统对话框 |
| Schedule/time-context | 默认关闭、显式开启 | 退出保护不自动启用，不迁移 Bots、不重复投递；C3 验证启用链 |
| Inspector/render_document | 不补捆绑/不注册 | Inspector 上游已改可选；render_document 没有上游工具注册 |
| Office 可选联网组件 | 不替代首版内置 | Windows x64 完整桌面包离线可用；体积若需改变分发须另提方案 |
| cli:false/隐藏 Office renderer | 仅临时诊断或止损 | 不满足 P3，必须独立标记未完成 |

本计划首发实机目标为 Windows x64；其他平台保持源码兼容和既有门禁，未运行不得称已验证。

## 3. 顺序与阶段出口

| 阶段 | 前置与产出 | 出口 |
| --- | --- | --- |
| P0 | 基线、入口/生产者清单、卡范围、真实依赖和兼容基线 | §5 完成；仍不代表产品交付 |
| P1 | P0 后：中断协调器、Host 检查/接纳控制、Launcher 握手 | Q1–Q17 全过 |
| P2 | P1 后：命令目录、设备持久化、原生输入适配 | K1–K10 全过 |
| P3 | P0 闭包裁定、P1 保护安装；按 P2 后推进 Office 全链路 | O1–O12 及格式矩阵必需格全过 |
| P4 | P2 命令基础；按 P3 后推进共享 Diff 和测量 | D1–D8 全过 |
| C | P0 开始、每阶段重跑受影响项 | 最终同一候选 SHA 的 C1–C8 全过 |

P1/P2/P3/P4/C 全部通过才称本计划完成。P0 止损不抵扣 P3；失败不得改名“遗留”以关闭阶段。

## 4. 范围、责任和回退单位

### 4.1 卡与代码所有者

每阶段先写 `Touching: <feature-id>`，读对应 handbook 和 Allowed touch；新行为先建卡或补齐现有卡。下表是拟触及面，不自动扩大现有卡授权；超范围按仓库约定处理。

| 阶段 | 卡/handbook | 预计接线位置 |
| --- | --- | --- |
| P1 生命周期 | desktop-launcher、launcher-distribution、dshbot、terminal-drawer；boot-lifecycle/tray-update/ipc-preload/dshbot | `src/main/index.js`、`update.js`、`update-updater.js`、`ipc-delta.js`、`ipc-components.js` 及 IPC 调用方；`src/main-launcher/index.js`、`src/launcher/launcher-service.js`、`runtime-install.js`、`delta/install.js`、`delta/apply.js`、组件 shutdown 接线；新增 `src/main/task-protection.js`、`vendor/dsh-task-control/`；Schedule/Bots/IM 的窄入口适配 |
| P2 快捷键 | 新 keyboard-shortcuts 卡；surfaces/terminal/ipc-preload | menu、主帧/guest preload、preview owner；vendor shortcuts/ui-shortcuts/ui-titlebar/ui-surfaces 和自有命令注册点 |
| P3 Office/打包 | 新 office-runtime 卡；desktop-build-runtime、dsh-home、surfaces-work-loops；build-release/dsh-home/surfaces | after-pack、实际 resolver manifest/锁/打包配置、dsh、fork 清单；workspace-dependencies/skill-office 装配，ui-files/documentpreview 槽位 |
| P4 Diff | surfaces-work-loops；必要时拆新卡；surfaces | vendor ui-diff/ui-deliverables/ui-primitives 的共享呈现、类型、CSS、测试 |
| 集成/审查 | harness-upstream-sync；build-release | ensure/preflight/skip-compose、vendor README、包 README、决策双语对、相关卡 |

`desktop-plugins/` 是 `dsh-home/profiles/web` 内的生成部署目录，仓库根目前没有该源码目录。新受控插件源码放 `vendor/dsh-task-control/`，循现有命名包、junction/复制及 --patch 装配；必须进产物闭包、skip 启动和 preflight。

### 4.2 脏工作树中的回退规则

1. 每阶段保存拟编辑文件的原始字节、hash、当前 diff、未跟踪清单与 owner manifest；不能仅用 HEAD 作基线。
2. 结束记录本阶段精确 hunks/新增文件。文件被其他任务再改时逐 hunk 合并回退，禁止 reset --hard、整树 restore、清空 vendor 或替用户 stash。
3. overlay 仅拥有自己的命名条目；迁移前保存原 managed block，只移除确属自身的内容。迁移/overlay/preflight 同一装配事务，未知用户行保留。
4. 实施时新增 `docs/superpowers/evidence/2026-09-25-upstream-adoption/`，各阶段记录基线、命令/退出码、fixture/产物 hash、实机结果、失败原因和恢复演练。实现者与独立审查者分别签明结论。

## 5. P0：基线与接入裁定

- 复查 §1 官方版本；记录 Node/Electron/pnpm、系统/CPU/内存/DPI、pin、工作树基线。先跑 C 的改动前基线，区分既有失败与新增回归。
- 逐一追踪 §6.1 的调用方、首次副作用和重入；包括工作区/配置/插件对齐 restart、清理 PTY/guest 的 reload、slim 外部停止、独立 delta 的安装树写入及 full fallback、所有 before-quit 清理监听。
- 创建生产者 manifest：客户端/远程 API、Schedule、Bots timer/hook/手动 run/ask/群成员唤醒、IM 渠道、jobs、桌面 PTY。每项写出接纳点、in-flight 完成界限、暂停/恢复 owner；不能把 connection 鉴权等同 connection/request 事件。
- 给当前可启用的来源接 §6.3；未知插件或未纳入的生产者标 coverage unknown，阻止自动提交更新。
- 记录 converter/skill/kit 三个 importer 的模块解析和 engine manifest，区分源码/staging/干净解包 runtime。源码 native 已在，不能凭业务包 resolve 失败补装或删依赖。真实转换属于 P3。
- 固定默认关闭调度、Bots 分工、desktop shortcuts adapter、Node Office 闭包、共享 Diff owner。新增卡只写拟交付契约，不提前标已验证。

P0 出口：以上清单各有证据，所有中断入口有映射；新插件包/槽位/共享 API 有唯一 owner；既有失败及止损明确标记；创建 Q/K/O/D/C 账本。实际安装包能力未知时继续列为待验证，不声称 P0 已证明 P3。

## 6. P1：退出、停止、重启和更新保护

### 6.1 全入口清单

| 入口 | 位置 | 保护必须先于 |
| --- | --- | --- |
| 菜单/托盘/IPC 真退出、closeToTray=false、最后 Launcher 关闭 | index/close-behavior/IPC/tray | committed quitting、窗口/PTY/guest 清理、Host stop |
| 菜单/托盘/工作区/配置/插件对齐重启 | restartWithCleanup、force restart 调用方 | 需随重启生效的破坏性配置提交、cleanup、restart |
| 页面 reload | reloadWithCleanup | PTY/guest 清理；Host 活着也可能损失用户终端工作 |
| Launcher 停止桌面 | launcher-service::stopOp | cleanup、stopDesktop/stopKernel、dismissMainWindow |
| blockmap 更新 | update-updater | quitAndInstall |
| 完整包 fallback/指定版本 | update::installFromAsset 及 installRelease/installUpdate | launchInstaller，不等安装器启动后再问 |
| slim 安装/切换/停止外部桌面 | runtime-install、launcher-service、main-launcher | 强停、替换文件、启动安装器；先与目标桌面受认证窄接口握手 |
| 独立 delta → full fallback | ipc-delta → delta/install → delta/apply | stopExternalDesktop、目标树 staging/rename/delete；下载/静态校验可先在安装树外进行，首次写安装树前须持有排他安装事务 |
| 附属退出监听 | ipc-components::before-quit、main-launcher::before-quit | svc.shutdown、销毁 tray 等清理；不依赖另一个监听器 preventDefault 来阻止副作用 |

下载/验签可提前；只有准备提交安装时才冻结接纳。旧桌面无握手能力时要求正常退出并确认进程已结束，不能回退成直接杀进程。slim 自身退出只报告实际受管组件影响，不假装远端 Host 也被关闭。

delta 必须改为“解析/下载/校验 → 协调确认 → 正常停目标并确认退出 → 排他安装事务 → 再验基线 → 写入/恢复”。安装期间 Launcher 的启动/其他安装入口不能重开目标。fallback 继续持有同一事务、同一目标版本与制品身份，不能再走一次未保护的 installRelease；若目标变化则旧确认失效。写入后失败只有确认旧树恢复完整才可进入同目标 full fallback；恢复未知时保留 staging/备份和日志，显示恢复入口，不清掉唯一可恢复数据或自动宣称成功。该修订不顺便重写 delta 制品格式。

事务身份至少绑定规范化安装目录、安装实例、base version/基线 hash、target version、delta artifact hash、操作 generation；进入 full fallback 时另核验完整包的 hash 并通过完整包 guard，不把对 delta 字节的确认当成对任意 Setup 的许可。**用户取消、锁拒绝、coverage unknown、旧 generation 均为保护终态，不触发 full fallback**。只有工件缺失/校验失败/基线不符或已证明完整恢复的 apply 失败可候选 fallback；没有已确认的相同目标与操作范围就重新请求对应确认。校验无效 delta 时桌面尚未停止。

### 6.2 检查语义与归属

Host 提供必要摘要：`activeWork[]/scheduledWork[]/sources[]/coverage/hostGeneration/observedAt`，不传提示词、凭据。壳汇入其 PTY/组件信息。

| 来源 | 计入范围 | 排除/去重/未知 |
| --- | --- | --- |
| Agent/inbox/jobs | 生成、工具执行、审批等待、子 Agent、nextTurn/nextStep、running/stopping job | 同活动根归并，保留明细 ID |
| Schedule | catalog 中所有 active，包含未来/到期、冷 Session | inactive/删除不计未来义务；不唤醒 Session，不扫历史 |
| Bots | control-plane 对持久 catalog 的只读检查：enabled routine、pendingRun/running、未消费 inbox | 同 run 的队列/Agent 投影合并；停用 routine 的残余活动工作仍计入 |
| 重复投影 | `(host, source, taskId/runId)` | 仅同源 ID/显式映射去重；不能按标题合并独立任务 |
| PTY/preview/受管组件 | 按本次操作实际销毁的活 PTY、运行工作、guest 状态 | 无 Agent 不等于没有 shell 工作 |
| 服务不存在 | 有效配置及 Loader 共同确认 intentional-disabled 才排除 | 加载失败、未知状态、检查超时均是 unknown |

默认不启用 Schedule，Bots 不迁移、不双重登记。退出提示明确“退出期间提醒无法投递；重启按该调度器恢复规则处理”，不保证补发或执行成功。

### 6.3 状态机与接纳控制

新增一个主进程协调器，操作 `quit/restart/stop/reload/install`，Host 端对受支持来源提供同步接纳判定及 in-flight 令牌。保证锁成立后没有**新的独立工作**从已登记入口被接纳；已受理活动及其后代仍可观察、可停止。不宣称任意第三方插件都已隔离。

1. `idle → acquiring`：串行破坏性请求，同类合并；不同目标版本不得抢占确认。锁带随机 owner token、Host generation、单调 lock generation、操作与制品 hash。
2. 原子关闭已登记入口的接纳，再 drain 先前的短 admission 区段，**不等待 Agent 全部自然结束**。客户端写请求、Schedule 的 resolveAgent/followup、Bots catalog 修改/触发、IM/hook、jobs/PTY 新建都接入。异步恢复 Session 后再次验令牌才可投递。
3. 锁中 Schedule/Bots 保留 due 状态，不推进 nextRun、不标已投递；解锁后循原恢复规则继续。已有工作的后代继承活动根身份，提交停止时一并纳入，不能藏在“新任务被拒”之外。
4. inspect/acquire/cancel/renew/release 走独立特权控制通道，不被自身普通请求锁阻断；验证壳身份/目标运行时代际。loopback 不是充分授权，Renderer/guest 不能自造 owner token。
5. 检查默认预算 3 s、短区段 drain 10 s，作为可配置部署值。失败/超时是 unknown。普通退出可让用户明确强制退出；更新/安装遇到锁失败、coverage unknown、drain 超时则中止，保留下载，要求重试或先正常停止。
6. 锁稳定后检查并展示单一确认框：活动、调度、两者、未知；默认取消。无影响且 coverage 完整才直接提交。框内不反复弹窗；generation 变化让旧确认失效，再出新摘要。
7. `awaiting-confirmation → committing`：确认绑定操作/目标/hash/代际；只有真退出/自更新路径置 quitting，其他操作按类型停止已确认会被中断的资源。reload 不误停整个 Host。所有附属退出清理都由协调器提交后调用并等待；before-quit 仅用一次 committed 标记放行，不再问一次。启动失败回可见 Launcher。
8. 提交前取消/检查失败/部分锁失败，在 finally 释放本代参与者、撤 prepared 配置，确认前绝不清 PTY/guest，取消后 quitting=false。installer 未启动且确认无写入可同样恢复；提交后 delta/installer 失败先进入恢复态，只有目标树完整且安装进程已确定终止才释放安装事务，禁止笼统 finally 解锁后启动半更新版本。
9. 等待确认由壳续约（建议 5 s、失联 30 s）；owner 断开取消旧确认并释放未提交锁。**committing 不因租约到期重新开放任务**：由目标退出/安装结果或恢复握手收敛；旧 owner/旧 generation unlock 无效。
10. 正常及 skip 都挂载保护插件，等生产者登记/服务检查就绪才开放自动更新。插件不可用时保持明确的取消/退出恢复入口，不制造关不掉的应用。

### 6.4 验收单

| ID | 场景 | 必须成立 |
| --- | --- | --- |
| Q1 | 生成/审批等待/子任务 | 正确报告，取消后继续 |
| Q2 | inbox/jobs/PTY | 分别覆盖；无 Agent 的活 PTY 也提示 |
| Q3 | 未来/到期/冷 Session 提醒 | 不漏报、不激活 Session |
| Q4 | completed/deleted/disabled/inactive | 不永久误报，残余活动另计 |
| Q5 | intentional-disabled 与 unavailable | 前者有证据排除，后者 unknown |
| Q6 | 同源重复投影/异源同名 | 正确去重，不双投递 |
| Q7 | 无影响真退出/关窗驻留 | 前者直接退，后者 Host/调度继续 |
| Q8 | 连点退出/重启/安装 | 一框一次提交；取消后资源和驻留恢复 |
| Q9 | blockmap/全包/指定版本/slim | 保护先于首次 stop/installer；校验失败不误停 |
| Q10 | 获取锁中到期/冷恢复、Bots timer/hook/run | 无检查后独立投递，解除后恢复无重复 |
| Q11 | Client/IM 请求、已受理工作后代 | 新工作被拒，已有工作仍可识别和停止 |
| Q12 | 永不 drain、检查超时、旧版无握手、锁/coverage 拒绝 | 更新不提交且不转 full fallback；取消/正常退出仍可用 |
| Q13 | owner 断线/崩溃/旧代 unlock/续约失败 | 无死锁或安装中错误放行 |
| Q14 | skip/服务缺失/未知生产者 | 保护仍在；不能证明安全则不自动安装 |
| Q15 | 配置重启/reload 取消、installer 启动失败 | prepared 状态撤回，可再次操作 |
| Q16 | 多个 before-quit 监听、组件正在运行后取消 | 无提前 shutdown/tray 销毁；确认后每个资源恰清理一次 |
| Q17 | 独立 delta 成功、校验失败、取消、旧 generation、写入失败/fallback/恢复失败、并发启动 | 无效工件不先停桌面；保护终态不 fallback；首次 stop/写入前保护；恢复确认前禁止 fallback/重开；同目标事务与备份保留，完整包 guard 再校验身份 |

## 7. P2：统一快捷键

### 7.1 采用的方案

- 复用 ctx.shortcuts 的 registry/protocol/UI。将 provider 的环境/存储/键盘来源整理为显式 adapter；鲸屿可信主帧使用 window.shell 窄接口并选择 desktop:windows，Host 仍是 web。不伪造完整 dshDesktop 对象触发其他插件误判。
- 主进程唯一写 `userData/keybindings.json`，沿用 schema/revision/sequence。Web origin 存储保留；首次迁移只接收可信主帧、有效 schema 且目标文件不存在时的配置，备份源并留映射回执。其他浏览器/手机仍用 Web 默认/存储。
- 盘点菜单五个 accelerator、PanelToggles、Files/Browser/Diff/Agents、终端抽屉及关闭动作，复用相同业务含义的 command id。Ctrl+\ 保持开合 DSHD 右栏，不能两轨各注册一个相同动作。
- 菜单/按钮只读已接受的 catalog/config；原生菜单按 command id + revision 交同一 dispatcher。Electron accelerator 无法表达的键只显示正确键帽，由 native adapter 处理。
- 验证主帧 sender、guest window/preview owner 和真实焦点，带 accepted revision/代际；外部网页无配置写入和通用 IPC 权限。
- 每个物理输入只有一个执行 owner；明确把 desktop 默认键/文件格式与输入优先级解耦。新增显式 policy 参数和纯判定函数于 shortcuts 的共享协议层，registry dispatch 与壳/guest adapter 共用；鲸屿选择下表的 local-first 策略，官方其他部署保持其原策略，不再从 runtime===desktop 隐式继承抢占。
- 损坏/未来 schema 不被 Restore All 覆盖；写失败保留有效配置与录制草稿；多窗口用 revision 冲突判定，不用异步返回顺序覆盖新值。

### 7.2 输入优先级（Windows，确定的产品选择）

“绑定”包括默认键及用户覆盖；用户覆盖不能绕过下表的局部保护，在受保护上下文中不生效，设置页须能说明其生效范围。冲突录制仍遵守上游固定动作不可覆盖规则。`pass` 表示不消费原事件，交局部控件/PTY；不是吞键后假装未处理。

| 上下文 | Ctrl+C 已绑定 / 未绑定 | Ctrl+W 已绑定 / 未绑定 | 其他命令与菜单 |
| --- | --- | --- | --- |
| 终端获焦 | 两者都交现有终端处理，保留中断/终端自身复制规则，不执行应用命令 | 两者都原样进入终端，不关页签/窗口 | 其他组合先过终端保留键及 command.regions；局部已处理则 pass，禁止用户绑定强行抢占 |
| 普通文本框/编辑器 | 两者均由控件执行复制，不运行绑定的应用命令 | 两者都保留控件既有行为；无局部处理也不退成关闭应用 | command.regions 不包含 editable 则 pass；固定编辑动作优先 |
| 普通页面（无编辑焦点、无 modal） | 已绑定且 resolve handled 才运行；未绑定保留选区复制 | 已绑定才运行对应关闭命令（按当前页签/窗口目标）；未绑定不隐式退出应用 | 遵守 regions/resolve；关闭窗口仍走 closeToTray/任务保护；held repeat 不重复执行业务 |
| modal（含 settings） | 两者均保留弹窗内复制 | 仅弹窗显式声明的关闭动作可处理，否则不执行外层关闭 | 只允 command.modals 明确允许的命令；用户覆盖不扩大许可；不关后台页签 |
| 快捷键录制或 IME composition | 录制只采集组合；IME 交输入法，均不触发业务动作 | 同左；只保留录制器明确的取消/关闭规则 | 录制期间禁业务菜单；输入法/Dead key 规则先于应用 dispatch |
| Browser guest / iframe | 无法同步证明局部上下文时一律交 guest；文本输入/终端类 guest 同上述保护 | 同左，不凭宿主推测焦点吞键 | 其他安全命令需可信 guest owner、实际焦点和有效 revision；外部页面没有命令/配置权限 |
| 显式原生菜单点击 | 不伪造成 Ctrl+C 按键；Copy 走对应局部复制动作 | 不伪造成 Ctrl+W 按键；显式关闭命令按目标执行 | 以 command id 调用且仍受 modal/recording 约束；终端获焦不禁止用户显式点菜单关闭，但实际中断先经 P1 |

实现采用“**先同步裁定，再消费**”：主帧依赖 region/modal 的组合交当前 DOM dispatcher 裁定，native 层不先 preventDefault；native 可以观察录制状态，但不再执行同一命令。guest 若没有可信、同步的局部判定能力就 pass，不能先截获再经异步 IPC 被 registry 拒绝后静默丢键，也不能用伪造键重放补救。任何 handled/blocked 消费必须遵守同一 policy；上下文过期不取得消费权。P2 的 adapter 协议与测试要覆盖焦点/弹窗在原生观测与分发之间变化。

### 7.3 验收单

| ID | 场景 | 必须成立 |
| --- | --- | --- |
| K1 | 搜索/改键/清除/恢复 | 重启持久，固定动作只读 |
| K2 | 菜单/按钮/标题栏键帽 | 实时一致，无双份 accelerator |
| K3 | 自有面板/原生兼容页签 | 可改键且目标正确，单可见右栏 |
| K4 | 冲突/固定键/单双键重叠 | 正确拒绝、可重新录制 |
| K5 | 终端/文本/页面下 Ctrl+C、Ctrl+W 各自已绑定和未绑定 | 逐格满足 §7.2；终端两键交局部一次，输入框不被关窗，页面只执行有效绑定 |
| K6 | 主帧/iframe/guest/guest 重建 | 一键恰执行一次，旧 owner 输入被拒 |
| K7 | IME/Dead/录制/弹窗/repeat、显式菜单、上下文变化 | 逐格满足 §7.2；禁止 modal/recording 越权，无“native 已吞、registry 拒绝”丢键 |
| K8 | 损坏/未来版本/写失败 | 可修复、可重试，旧字节保留 |
| K9 | 多窗口/旧 revision/恶意 sender | 不覆盖新值、不越权 |
| K10 | Web 迁移/回退 | 一次且保留源，旧版不重写未知 schema |

## 8. P3：Office 完整链路

### 8.1 资源与实际运行位置

| 资源 | 输入 | 使用位置 |
| --- | --- | --- |
| Python/Office 库、独立 Node/pnpm | vendor scripts/primary-runtime/lock.json + prepare.ts，固定下载 SHA-256 | resources/primary-runtime；首调复制到拟新增 `dsh-home/workspace-dependencies/<payloadDigest>` |
| 三种技能/标准库检查器 | packages/skill/skill-office/assets | resources/office-skills，显式 assetRoot，供 Python 直接访问 |
| converter/skill/tool、kit/native engine 全依赖 | 实际 overlay resolver manifest、pnpm lock、消费者闭包 | after-pack staging → Harness 归档 → 用户数据下真实解包树，不能指回源码 .pnpm |
| 装配配置 | desktop-owned ensure/overlay、buildLaunch preflight | 每启 --patch，含 skip；不覆盖用户配置 |

实施步骤：

1. 按锁生成 win-x64 primary-runtime/office-skills，记录 digest、平台、版本、文件清单、许可/校验。用户首调不得依赖联网、系统 Python/Office 或 PATH。
2. 将新增 bare plugin 加入真正解析 overlay 的 manifest/依赖锁、build profile、runtime 收集与 fork/skip 断言。只向根 Electron dependencies 加 kit 无法满足独立 Host。
3. 按 officePackageDirectories 同等规则保留 kit 完整闭包；从 kit importer 检查 engine/prebuilds 及其所有资源。Win x64 声明 native 却缺失则构建失败；不静默用 WASM。
4. after-pack 全量复制及 deploy 精简两条路径均验证，归档/干净解包再验路径和 hash。纯 Node 不执行 ASAR 内文件；office-engine.ts 在非 ASAR 本来就 no-op，不能当缺包补救。
5. overlay 显式设置 workspace-dependencies.source/root、skill-office.assetRoot/node/cli。node 为 standalone Node，cli 为实际解包 kit/lib/cli.js；不搜系统可执行文件。
6. 首调沿用 staging→校验→原子安装，失败保留旧树；按 digest 分目录，切换成功前旧 payload 可用，返回路径与当前 manifest 一致。磁盘不足/权限/中断不改会话/profile。
7. 记录包字节增量、解包量、复制时长、磁盘峰值。按现有流程签名并列 exe/dll 覆盖、验签结果及实际 SmartScreen 展示；不承诺脚本能保证无 SmartScreen 提示。

### 8.2 Files 预览接线

- ui-files 声明 Office 内容槽位（拟新增，传发起 Session/规范化地址）；ui-sidebar-documentpreview 注入既有 Office/Spreadsheet 呈现。组件 props-only，不跨 feature 直接 import。
- 同时覆盖 Files 内嵌 FilePreview 和 desktop resource viewer，不新建第二常驻右栏、不靠 suffix pattern。
- DOCX/PPTX：officeToPdf.render→PDF；XLSX：现有 Spreadsheet viewer。文本/图像/HTML、草稿/保存/送对话保持原路径。
- workspaceFiles 每次授权检查不变，拒绝跨工作区/symlink/junction 逃逸；不把任意绝对路径交无授权 converter。版本/generation 变化丢弃旧缓存结果。
- loading/cancel/error/超限/加密/缺字体均可见；不伪造 Office 编辑器。独立原生只读窗口按自己的既有支持集工作。

### 8.3 格式矩阵

| 能力 | DOCX | PPTX | XLSX | 完整出口 |
| --- | --- | --- | --- | --- |
| 创建/定点编辑 | 段落、表格、页眉页脚 | 指定 slide/文本/图形 | sheet/单元格/公式 | 三者必需；目标变更与非目标结构均检查 |
| 结构校验 | ZIP/XML/关系/要求文本 | ZIP/XML/关系/页数 | ZIP/XML/关系/sheet 数 | 不等于排版/计算结果正确 |
| Files 只读预览 | PDF | PDF | Spreadsheet | 三者必需；隐藏入口不通过 |
| CLI 区域图及 PDF | 指定页 | 指定 slide | 指定 sheet/范围 | 本完整版本必需；含字体/图表样本 |
| 重算到新文件 | 不适用 | 不适用 | 已知公式及期望值 | XLSX 必需，不改原文件缓存 |
| 旧二进制/宏格式 | DOC 按已有预览 | PPT 按已有预览 | XLS/XLSM 按已有支持 | 不新增创建/编辑/宏执行承诺，逐项写支持或拒绝 |

### 8.4 验收单

| ID | 场景 | 必须成立 |
| --- | --- | --- |
| O1 | 干净安装、离线首调 | 返回可用绝对路径/版本/digest，不依赖源码/PATH |
| O2 | 三格式生成/定点改 | 目标变化正确、非目标结构保留 |
| O3 | 无效/损坏/加密/Strict OOXML | 结构化报告，失败不覆盖源文件 |
| O4 | Files 树/对话文件/资源页签 | 三者可预览，Session 正确，无双栏 |
| O5 | source/干净 win-unpacked/Setup | 真实 kit importer 能解析并运行 engine |
| O6 | 缺资源/字体、架构/版本错配 | 必需闭包缺失阻断交付，错误可行动 |
| O7 | 指定图/PDF/新文件重算 | 格式矩阵通过，cli:false 不通过 |
| O8 | 中断/磁盘不足/并发/升级失败 | 旧 payload 留存，无半安装路径返回 |
| O9 | 超限/取消/队列/缓存更新 | 有界、可取消、不串旧结果 |
| O10 | 越界/symlink/远程 | 授权不放宽，按 Host 归属处理 |
| O11 | 分发与签名 | 产物 hash、签名/SmartScreen 观察、体积数据可查 |
| O12 | 降级/回滚 | 选回兼容 digest；未证实兼容不强行复用 |

## 9. P4：Diff 复用与性能

### 9.1 接线步骤

1. 从 ui-deliverables/FileDiff 提取无业务所有权的呈现到 ui-primitives 窄模块：split rows/行号/wrap/同步滚动/可取消高亮。只接纯数据/回调，不带 Host 查询、Git 动作、feature locales。
2. ui-deliverables 保留 turn snapshot 读取/生命周期；ui-diff 保留工作树/暂存/分支、stage/unstage/discard。分别适配共享格式；不直接跨 feature import。
3. 映射 old/new path、rename、纯增删、无末尾换行、binary、错误、截断与省略数。5000 行仅单比较绘制上限，多文件做按需挂载/分片，不能每文件都跑满。
4. 原文先可读/可选/可复制；长行/预算超限跳过高亮并说明。首次 grammar/tokenize 使用可测小于 50 ms 的 worker 或可中断分片，不把同步长任务原样挪进 timer。
5. 文件/主题/模式变化取消旧 generation；双栏高度/wrap/缩放不引发滚动反馈。截断仅影响呈现，Git 动作仍作用于完整正确范围。

### 9.2 D5 预登记测量协议

- 同一 Windows x64/电源模式、1440×900 CSS 视口，记录 CPU/RAM/DPI、Electron/Chromium/SHA，无并发构建。冷态全新 renderer、热态同页重复，各 5 次保留 min/median/max 和全部原始值，不以小样本声称 p95。
- 固定 hash fixture：1000 行单文件、6000 行、100000 字符长行、100×200 行多文件、二进制/rename/纯增删、同文件切换 20 次。
- 记录原文可读时间、首屏、每个高亮相关主线程 task 时长、输入响应、mounted row 数、堆峰值/关闭回落、旧结果丢弃数；保存 trace，不只平均总时长。
- 硬要求：每个高亮相关主线程任务 **<50 ms**（设计语言）；本计划新增候选出口：1000 行原文首屏冷 ≤1000 ms/热 ≤300 ms，大数据/长行 ≤1000 ms 给首屏原文或截断说明，交互响应 ≤100 ms。环境无法有效测量记未完成，不事后放宽。
- 行数/缓存配额有界，关闭重开两轮不持续累积对象；记录实测堆量，不编造未测内存阈值。隐藏 DOM、延迟同一长任务不算达标。

### 9.3 验收单

| ID | 场景 | 必须成立 |
| --- | --- | --- |
| D1 | 工作树/暂存/分支 | split/unified、wrap/同步/高亮可用 |
| D2 | 纯增删/rename/无末尾换行 | 路径行号、单栏回退正确 |
| D3 | binary/5000+/多文件 | 说明/省略范围明确，负载有界 |
| D4 | stage/unstage/discard | 完整正确范围，权限/确认不变 |
| D5 | 冷热/长行/多文件 | §9.2 通过并留 trace |
| D6 | 文件/主题/模式快速切换 | 不串旧结果、不滚动循环 |
| D7 | 逐轮 review | 原快照语义不变，不混成仓库 diff |
| D8 | 高亮失败/未就绪/超限 | 原文可读可复制，复制不带行号 |

## 10. C：贯穿阶段的兼容验收

| ID | 能力 | 操作及约束 | 时点 |
| --- | --- | --- | --- |
| C1 | changes-review | 卡片→tab、split/wrap/highlight；Host 重启不保留快照依原语义，不承诺持久化 | P0/P2/P4 |
| C2 | 关联打开 | listEditors/openInEditor/showItemInFolder/openWithSystemDefault，关联缺失/中文空格路径/授权 | P0/P3 |
| C3 | 显式启用调度 | 插件/设置启用 time-context/schedule/ui-schedule、依赖联动/用户覆盖/重启保留/冷投递/禁用；Bots 独立 | P0/P1 |
| C4 | 对话中新工具 | 同 Session 启用后看到/调用，卸载失效不留陈旧工具 | P0/P3 |
| C5 | 可选 auto-review | 不默认开启；允许人工审批时拒绝→用户继续、审阅失败独立提示；不提高原授权 | P0/P1 |
| C6 | 工作环 | 单右栏、编辑保存/草稿、终端/背压、Browser/PiP/原生预览、关闭位置 | 每个相关阶段 |
| C7 | 远程/身份 | 手机 browse、工作归属/鉴权不变；本地退出不声称关闭远端 Host | P1/P2/P3 |
| C8 | 正常/skip、full/slim、升级恢复 | 保护/Office 不因 skip 丢失，slim 不假装带 Office，独立 home/用户配置保留 | 每阶段/最终 |

失败在 owning feature 内定点修复并补证据；超范围列阻塞，不扩成无关模块重写。

## 11. 验证命令与完成证据

### 11.1 Windows 命令约定

后续实施使用 PowerShell，禁用 bash。本轮文档不执行产品测试/构建。启动前清除本会话继承变量：

```powershell
Remove-Item Env:ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue
npm start
```

vendor 命令先 Push-Location vendor/deepseek-harness，结束 Pop-Location；定向测试用 `pnpm exec vitest run <实际测试路径>`，沿用配置，不能强制 Node 覆盖 client DOM 环境。先用 rg --files 确认测试列表；新增测试名称只代表待创建。

### 11.2 分阶段最小检查集

Shell 列从根执行 `node --test`，简写文件名补 `src/main/`；vendor 列路径相对 vendor 根，同组缩写补完整父目录后传入 Vitest，不能依赖 shell 展开通配符。

| 阶段 | Shell owning 检查 | vendor owning 检查 | 实机 |
| --- | --- | --- | --- |
| P0 | dsh.test.js、skip-compose-contract.test.js、after-pack-workspace.test.js；新 overlay 断言 | packages/bundle/web-app/tests/web-app.spec.ts、browser-defaults.spec.ts；新装配 fixture | 正常/skip roster、有效配置来源 |
| P1 | 新 task-protection/Launcher handshake/退出监听顺序；update.test.js、update-updater.test.js、close-behavior.test.js、ipc-authorization.test.js；根相对路径 `src/launcher/delta/install.test.js`、`delta.test.js`、`src/launcher/components/index.test.js` | apps/desktop-host/tests/quit-inspection.spec.ts 作参考；packages/schedule/schedule/tests 中 runtime/recovery/serial-delivery/update-restart；新 task-control、Bots admission | Q1–Q17，竞争/超时/安装前观察/取消继续/delta 恢复 |
| P2 | 新 menu/adapter/guest 授权及重复分发；现有 IPC/preview 授权 | packages/client/shortcuts/tests、ui-shortcuts/tests、ui-titlebar/tests/keybindings.client.spec.ts、panel-toggles.client.spec.tsx、ui-workspace/tests/shortcuts.client.spec.ts | K1–K10，键盘/IME/PTY/guest/重启 |
| P3 | after-pack.test.js、after-pack-workspace.test.js、skip-compose-contract.test.js；新 archive/extracted Office 闭包 | packages/skill/tool-workspace-dependencies/tests、skill-office/tests；packages/document/office-to-pdf/tests；client/ui-sidebar-documentpreview 的 office suites、Files route/save；scripts/libreoffice-engine.spec.ts、primary-runtime/prepare.spec.ts | O1–O12，随包解释器、真实 native engine、格式矩阵 |
| P4 | src/shared/single-right-panel-contract.test.js、Git IPC 授权 | packages/client/ui-diff/tests、ui-deliverables/tests/changes-diff.client.spec.ts、review-tab.client.spec.tsx；新 ui-primitives 共享 Diff/高亮任务边界 | D1–D8，真实 Git fixture/屏幕/trace |

通用要求：

- 产品改动后 owning tests；桌面 JS 按卡跑根 npm test。根结果不覆盖 vendor TS/TSX，官方 desktop-host 单测不替代鲸屿集成。
- vendor host/client 修改执行定向测试、pnpm run typecheck；client/组合产物必须 pnpm run build:official，不能单 client build 绕过品牌/闭包。依修改面补 package/dependency/slot/doc 门禁，完整矩阵交 CI。
- 文档跑 npm run check:governance、npm run doc-sync；双语对先重录 sidecar。按实际输出报告，不固化 6/6、8/8 数字。
- UI 阶段留同构建的焦点/错误/空态/大数据可见证据，并按用户偏好重启源码应用。旧实例占单实例锁不算新版本已验收。
- 分发候选按根 npm run pack、npm run dist 生成同源 Windows 制品；smoke:source/smoke:packaged/qa:packaged 按当前脚本参数运行。改 slim 追加 pack:launcher/dist:launcher。源码、干净 win-unpacked、Setup 安装后分别验证，使用隔离测试 home。
- 发布与签名走既有流程及授权；本计划不是发布授权。不可运行/平台跳过注明原因，不计通过，不删断言或弱化门禁。

### 11.3 账本与完成定义

每个 Q/K/O/D/C ID 有 pass/fail/not-run/not-applicable、fixture/命令/退出码、环境/版本/hash、日志/截图/trace 和审查结论。全部必需项 pass 且无 blocking 才更新 owning 卡 last verified；不能提前把 proposed 改 implemented。

## 12. 失败与回滚演练

| 阶段 | 触发 | 回滚单位/保护 | 恢复证据 |
| --- | --- | --- | --- |
| P1 | 启动阻塞、取消仍锁、漏拦中断 | 停未提交安装，按 owner/generation 释放；只退本阶段 overlay/控制接线、回上一运行时；不绕保护强装 | 请求/调度恢复，PTY/preview/驻留可用，再次退出正常 |
| P1 delta 提交后 | 中途写入/恢复失败、目标重启竞争 | 保持安装排他状态；逐文件核对备份恢复及基线 hash；未知恢复保留全部恢复材料、不清 staging、不自动 fallback、不启动混合树 | 原目标完整恢复或同目标全包修复经验证；记录所有文件的恢复结果后才释放 |
| P2 | 误拦/双触发/损坏配置覆盖 | 撤本阶段 native 订阅/菜单 adapter；保留配置及迁移源，旧 schema 不写新文件 | IME/终端正常、原字节保留、多窗无残留 |
| P3 | 缺闭包/复制中断/升级失败 | 恢复已验证 runtime/archive/overlay 组合和兼容 digest；新 payload 留诊断；回收前校验目录所有权 | 离线生成/预览恢复，文档/profile/session/schedule/官方 home 不变 |
| P4 | 卡死/错误操作范围/review 回归 | 退共享呈现及两端 adapter 的任务 hunks，不回滚用户仓库内容 | 旧 Diff/Git 动作/单右栏恢复 |
| 跨版本 | 无窗/启动回归/持久化不兼容 | 已验证安装包+runtime；先在隔离数据副本验旧版可读写，不直接让旧版写现用 home | 可见 Launcher、旧版启动、数据兼容结论及副本 hash |

换 runtime/payload 不证明会话可降级。每次版本切换检查对应持久化变更；本计划不主动改 Session/Schedule 格式，也不清空 home 作为恢复。回退失败必须可见且停在可操作的 Launcher。

## 13. GPT 审查对应与最终交付包

| 审查项 | 本版落实 |
| --- | --- |
| B1 入口不全 | §6.1 覆盖退出/restart/reload/stop、blockmap/full/slim/独立 delta 及附属 before-quit 清理，确认前禁副作用 |
| B2 漏生产者 | §5/§6.3 manifest、admission drain、独立控制、owner/generation、续约/取消 |
| B3 调度矛盾 | 默认关闭前置；catalog 全 active/未来/冷 Session；disabled/unknown 与同源去重 |
| B4 降级冒充完成 | §8 格式矩阵/CLI 完整目标；降级不关 P3；F7 纠正 importer 错误诊断 |
| B5 验证笼统 | §9.2 预登记 <50 ms 与原始 trace；§11 shell/vendor/实机分开 |
| B6 回退缺失 | §4 task-owned 原始字节/hunks；§12 锁/配置/payload/数据恢复 |
| S1 adapter | §7 desktop runtime+设备文件+native，revision 和一次分发 |
| S2 Office 运行环境 | §8 按独立 Node 解包树闭包验证，ASAR no-op 不冒充修复 |
| S3 browser/picker | §2.3 不采用/维持 browse 及后续约束 |
| S4 证据时效 | §1 时间/渠道/SHA/npm tag、源码与未运行证据明确 |
| 第 24 轮 R1 独立 delta | F13/§6.1/§6.3/Q17 显式安装事务、身份、保护终态不 fallback、完整包再 guard；补 F14/Q16 附属退出监听 |
| 第 24 轮 R2 输入优先级 | F15/§7.2 明确 local-first 矩阵及消费权，K5/K7 有确定预期，不沿用上游 desktop 抢占 |

最终提交阶段补丁、owning 卡/决策/handbook、Q/K/O/D/C 账本、源码及干净安装验证、Office 样本/hash、Diff trace、回退演练与限制。截图、单测绿灯或 overlay 行存在都不能单独代替完整交付。

## 14. 资料入口

- [设计语言](../../design-language.md)、[Feature Spine](../../features/README.md)、[维护系统](../../maintenance/README.md)、[Handbook](../../handbook/README.md)。
- [boot-lifecycle](../../handbook/modules/boot-lifecycle.md)、[tray-update](../../handbook/modules/tray-update.md)、[build-release](../../handbook/modules/build-release.md)、[dsh-home](../../handbook/modules/dsh-home.md)、[surfaces](../../handbook/modules/surfaces.md)。
- [update-tasks](../../../vendor/deepseek-harness/apps/desktop-host/src/update-tasks.ts)、[quit-inspection](../../../vendor/deepseek-harness/apps/desktop-host/src/quit-inspection.ts)、[schedule](../../../vendor/deepseek-harness/packages/schedule/schedule/src/index.ts)、[shortcuts](../../../vendor/deepseek-harness/packages/client/shortcuts/src/client/index.ts)。
- [workspace dependencies](../../../vendor/deepseek-harness/packages/skill/tool-workspace-dependencies/README.md)、[office skills](../../../vendor/deepseek-harness/packages/skill/skill-office/README.md)、[engine closure](../../../vendor/deepseek-harness/scripts/libreoffice-packages.mjs)、[runtime prepare](../../../vendor/deepseek-harness/scripts/primary-runtime/prepare.ts)。
- [vendor AGENTS](../../../vendor/deepseek-harness/AGENTS.md)、[client AGENTS](../../../vendor/deepseek-harness/packages/client/AGENTS.md)；检查选择遵循 .devin/skills/dshd-checks、dshd-maintenance。

