# T3 丝滑移植 — 测试审查与完成审计

> 分支：`research/t3code-message-render-ux`  
> 执行依据：`docs/refactors/t3code-message-render-ux-plan.md`  
> 审查日期：2026-08-03

## 1. 目标 → 交付物清单

| 目标（计划）                        | 交付物                                                                                       | 状态       |
| ----------------------------------- | -------------------------------------------------------------------------------------------- | ---------- |
| Slice A 锚定几何纯函数              | `agent-stream/turn-anchor-metrics.ts` + 17 测试                                              | ✅         |
| Slice B 新回合锚定滚动（web）       | `turn-anchor-controller.ts`（21 测试）+ strategy-web/native/view/agent-panel 接线 + e2e spec | ✅         |
| Slice C projection ack busy         | `ComposerSendSnapshot` + `hasServerAcknowledgedComposerSend`（多信号）                       | ✅         |
| Slice D 回合/work-log 折叠          | `turn-fold.ts`（7 测试）+ view.tsx 折叠渲染                                                  | ✅         |
| Slice E web markdown + 高亮缓存策略 | `highlight-cache` `cacheable` 选项（3 新测试）；react-markdown 降级                          | ✅（降级） |
| 全链门禁                            | typecheck / lint / vitest / Playwright 定向 spec                                             | ✅（见下） |

## 2. 环境门槛矩阵

### 2.1 单元/逻辑层（node 环境 vitest）

| 文件                                                                                                                                                              | 测试数                | 结果                   |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------- | ---------------------- |
| `turn-anchor-metrics.test.ts`                                                                                                                                     | 17                    | ✅ 17/17               |
| `turn-anchor-controller.test.ts`                                                                                                                                  | 21                    | ✅ 21/21               |
| `turn-fold.test.ts`                                                                                                                                               | 7                     | ✅ 7/7                 |
| `session-stream-reducers.test.ts`                                                                                                                                 | 60（含 6 新 ack）     | ✅ 60/60               |
| `highlight-cache.test.ts`                                                                                                                                         | 12（含 3 新缓存策略） | ✅ 12/12               |
| `strategy-web.test.tsx`                                                                                                                                           | 2                     | ✅ 2/2（JSDOM 契约级） |
| 回归：`bottom-anchor-controller` / `web-virtualization` / `turn-footer` / `permission-response` / `spacing` / `message` / `markdown-text.web` / `markdown-styles` | —                     | ✅ 全绿                |

**合计**：14 个文件 167 测试全过。

### 2.2 平台验证要求（AGENTS.md 合规）

| 切片               | 要求                     | 执行                                                                                                                                                                                                                                                                                                           |
| ------------------ | ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| B（滚动）          | 真实 web                 | ✅ `e2e/turn-anchor.spec.ts`（Playwright Desktop Chrome，mock agent 真实流式，连续 5 轮全绿）                                                                                                                                                                                                                  |
| C（busy）          | 真实 web                 | ✅ 服务端 messageId 回显已闭环：server 单测 + server e2e（真实 daemon 投影 id == 客户端 id）+ web e2e 断言（投影后第二轮消息可入队，2 轮全绿）；真实 provider 不回显（SDK uuid 语义），见 §3.5                                                                                                                 |
| D（折叠）          | 真实 web                 | ✅ `e2e/work-log-fold.spec.ts`（Playwright Desktop Chrome，mock 新增「end the turn with a tool run」尾置工具模式——文本在前、read/grep/edit/bash 在后，跨过完成回合折叠成为徽章组；断言 idle 后折叠为 1 +「+3」、点击展开 4、再点折叠；连续 3 轮 + 合并回归全绿；server mock 单测覆盖尾置队列结构与无循环重复） |
| E（markdown 缓存） | 无平台差异（跨端纯函数） | ✅ 单测覆盖（`highlight-cache.test.ts` 12/12）                                                                                                                                                                                                                                                                 |
| 桌面               | 真实 Electron            | ✅ 已完成（2026-08-04，见下）——dev 模式 Electron app 与 electron-builder 打包产物双门禁，B/C/D/E 全绿                                                                                                                                                                                                          |

**桌面验证（真实 Electron，2026-08-04）**：

- **dev 模式门禁** `packages/app/e2e/desktop-slices.script.ts`：`_electron.launch` 启动真实 Electron（`packages/desktop`，`CHISACODE_WEB_PLATFORM=electron` + Metro + 独立 daemon）；bridge `desktop_daemon_status` 确认连接后 reload 重连；seed mock agent（raw DaemonClient 直连 `ws://127.0.0.1:6767/ws`，绕开 e2e 端口保护）；逐切片断言——B 发送后用户行停在视口上半部、C 投影 ack 释放 busy 后第二轮消息可入队并 flush、D 尾置工具回合折叠为「+3」点击展开 4 徽章、E 流式代码围栏（`cacheable:false` 高亮路径）渲染出围栏文本。**连续 3 轮全绿**。
- **打包构建门禁** `packages/app/e2e/desktop-packaged-slices.script.ts`：electron-builder 重建 x64 产物（fresh server dist + fresh `expo export` web bundle），解压 `ChisaCode-Setup-1.0.2-x64.zip` 启动真实 `ChisaCode.exe`（`chisacode://app/` 协议 + 桌面自管 daemon `desktopManaged:true`）；`CHISACODE_ENABLE_DEV_PROVIDERS=1` 显式启用 dev 提供者（打包 daemon 强制 `CHISACODE_NODE_ENV=production`，mock 为 dev-only 注册，见 §3.6）；同四切片断言全绿。**连续 2 轮全绿**。
- 支撑改动：server mock 尾置工具模式新增流式代码围栏（Slice E 可观察载体）；server 新增 `CHISACODE_ENABLE_DEV_PROVIDERS`（打包/e2e 门禁专用，registry 单测覆盖）。

**声明**：native 的 `requestTurnAnchor` 委托给既有 bottom-anchor `requestLocalAnchor`（sticky-bottom 语义保留，非 no-op），未声称 native turn-anchor 语义验证。B/C/D/E 已完成真实 web + 真实 Electron（dev 与打包）双平台门禁。

### 2.3 预存失败（非本次引入，stash 验证）

| 文件                                                           | 错误                                    | 证据                                                 |
| -------------------------------------------------------------- | --------------------------------------- | ---------------------------------------------------- |
| `layout.test.ts` / `model.test.ts` / `render-strategy.test.ts` | Unistyles 未配置主题                    | 完整 stash 我的改动后仍失败（`Test Files 3 failed`） |
| `.expo/types/router.d.ts`                                      | Expo 生成物被后台 dev 进程改写（17:39） | `git check-ignore` 确认 git-ignored；非我改动        |

### 2.4 e2e 结论（Playwright，Windows 本机）— 已修复/归因，2026-08-03 终局

**已修复（本次）**：

| 问题                                                                   | 修复                                                                                                                                  | 证据                                                                           |
| ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| 按钮文案不匹配：DOM 为中文「停止智能体」，helper 用 `/stop\|cancel/i`  | helper 正则补 `\|停止\|取消`（`composer.ts` / `agent-stream.ts`）                                                                     | `agent-stream-ui.spec.ts` 测试 1、2 主体从 stop-button 超时 → 通过             |
| 82 个未跟踪 `.js` e2e 编译产物掩盖 `.ts` 改动（Playwright 双跑旧产物） | `git clean -f packages/app/e2e/`（同时误删未跟踪的 `turn-anchor.spec.ts`，已重写）                                                    | 测试主体稳定通过                                                               |
| Windows cleanup `EBUSY: rmdir`（daemon git watcher 持句柄）            | `removeDirectoryWithRetry`（`e2e/helpers/workspace.ts`，指数退避重试；同步用于 `global-setup.ts` 的 CHISACODE_HOME/fakeToolBin 清理） | 测试 1、2 **全绿含 cleanup**；全局 teardown 的 `agent-index.sqlite` EBUSY 消除 |

**归因（预存分支级故障，非本次引入）**：

`agent-stream-ui.spec.ts` 测试 3（及所有走 `openHomeWithProject` 的 spec，如 `workspace-setup-runtime.spec.ts`）
在侧边栏步骤超时。根因链（证据闭环）：

1. `src/app/h/[serverId]/index.tsx`（提交 `2d79df991` "Place Soft Home path and branch under the composer"）无条件重定向 `/` → `/h/:serverId/new`（Soft Home）；
2. `left-sidebar.tsx` 无条件渲染 `SidebarV2`（`src/sidebar-v2/` 未跟踪 WIP），经典 `sidebar-workspace-list.tsx` 已无任何引用点；
3. 经典 testid `sidebar-project-row-*` / `sidebar-workspace-row-*` 永不出现在 DOM，e2e helper 与之完全失配；
4. 对照运行 `workspace-setup-runtime.spec.ts`（同 helper 同断言）同样 2 失败、重试同点失败 → 与我的改动无关（该 spec 不经过 agent-stream 任何改动路径）。

**结论**：`?open=agent:` 路由本身工作正常（测试 1、2 依赖它且通过）；「路由失效」的早期归因不成立。
真正预存故障是 Soft Home + SidebarV2 侧边栏迁移与旧 e2e helper 失配，属仓库工作区既有状态（SidebarV2 为未提交 WIP），
修复方向是更新 e2e helper 到 SidebarV2 testid 或为 SidebarV2 补 testid——属独立任务，不在本计划范围。
本次的 turn-anchor 行为验证（测试 1、2 覆盖：发送锚定、滚动脱离、回底恢复）已在真实 web 完成。

**2026-08-04 补充评估（桌面验证收尾时复查）**：`withWorkspace` fixture 被 7 个 spec 使用（`00-sessions-empty` / `agent-stream-ui` / `composer-attachments` / `workspace-cwd` / `workspace-lifecycle` / `workspace-navigation-regression` / `workspace-open-in-editor`），其 `navigateTo` = `openHomeWithProject`（等 `sidebar-project-row-*`）→ `selectWorkspaceInSidebar`（等 `sidebar-workspace-row-*`）→ `waitForTabBar`。SidebarV2 主页（Soft Home）只渲染 thread 行（`SidebarV2Row` 无任何 testid，项目名仅出现在卡片 projectLabel 文本），无稳定的项目行选择器；工作区侧边栏（`sidebar-workspace-list.tsx`）仍保留 `sidebar-workspace-row-*`，但需先进入 workspace 才可见。建议修复方向（独立任务）：为 `SidebarV2Row` 补 `testID`（如 `sidebar-v2-thread-{id}` + 项目名可检索），或把 `withWorkspace.navigateTo` 改为路由直开（`buildHostWorkspaceOpenRoute`，与 `openAgentRoute` 同模式）。本次未修（非 T3 范围，属 SidebarV2 迁移任务）。

## 3. 关键决策记录（生产级审查）

### 3.1 Slice E 降级：不引入 react-markdown

- **证据**：`react-markdown` / `remark-gfm` / `rehype-*` / `shiki` 在 `packages/app/package.json` 均不存在
- **理由**：ChisaCode 已有自研跨端高亮（`@chisacode/highlight` + `HighlightedCodeBlock`）与文件链接解析（`assistant-file-links`）；引入 react-markdown 会新建一条 web-only 渲染路径，破坏 RN 跨端一致性，并带来 lockfile/包体积/安全面变更
- **落地**：改为对齐 T3 的「流式期间不写高亮缓存」策略（`tokenizeToLines` 增 `cacheable: false` 选项），零新依赖、跨端一致
- **与 T3 的差异**：T3 在 `isStreaming` 时 **read+write 均跳过**；ChisaCode 流式期间 **只跳过 write，read 仍尝试**（有意微优化——缓存键是完整内容，命中只能是已完成代码块；有单测背书）
- **后续跟踪**：web-only 表现力（表格/详情/外链 favicon）留作独立路线图项，需产品决策

### 3.2 Slice D 范围收敛

- **证据**：ChisaCode 已有 `collapseCompletedTurnThoughtsForDisplay`（已完成回合的 thought + 前置 tool_call 折叠为 summary）
- **落地**：回合折叠不重复实现；本次只补 work-log 徽章折叠（`MAX_VISIBLE_WORK_LOG_ENTRIES=1` + "+N" 展开）

### 3.3 Slice B 架构

- 独立 `turn-anchor-controller`（21 单测），不动 `bottom-anchor-controller`（回归全绿）
- web 先行；native `requestTurnAnchor` 委托 bottom-anchor `requestLocalAnchor`（sticky-bottom 语义保留）
- `isTurnAnchorEnabled` 默认 false，可整体关闭

### 3.4 Slice C 架构

- `submit.ts` 通用契约不动；ack 派生（`hasServerAdoptedOptimisticUserMessage`）供装配层使用
- 说明：composer busy 接线（把 isProcessing 改为 projection ack）**未完成**——纯函数已交付，装配需 composer 状态机改造（独立任务，见 §5）

### 3.5 Slice B 锚定装配的三层修复（e2e 真实 web 暴露，2026-08-03）

`turn-anchor.spec.ts`（真实 web）最初间歇失败，逐层定位并修复了三个独立问题：

1. **触发竞态**：面板原用「扫描流中 optimistic user_message」声明式触发——daemon 快时 optimistic 条目在渲染前即被投影（adopted），effect 永远看不到 optimistic 标记 → 锚定不触发。改为 **composer 派发回调**：`submitMessageWithProjectionAck` 在 dispatch 后同步读取乐观 id，经 `onOptimisticMessageDispatched` 通知面板 → `requestTurnAnchor`（直接提交与 queue flush 共用同一条 wrapper，busy ack 同步受益）
2. **锚行解析失效**：`strategy-web` 的 `requestTurnAnchor` handle 未写入 `turnAnchorRequestRef`，measurement 的 anchorIndex 恒为 null（positionAnchor 12 帧后放弃）。改为 **positioning 时惰性解析**（getMeasurement 内按 ref 现扫 data）
3. **服务器投影 id 变更**：daemon 投影的 canonical user_message 用服务端 id（`sendPromptToAgent` 未透传客户端 messageId），`mergeCanonicalUserWithOptimistic` 按 ordinal 合并后乐观 id 从流中消失 → 按 id 解析失败。回退策略：**id 未命中时锚定末条 user_message**（语义上即刚发送的行）；另加「无滚动溢出时保持 pending 等增长、目标不可达时钳制到最大可滚」两条几何修正

**遗留 → 已闭环（2026-08-04）**：Slice C 的 `hasServerAdoptedOptimisticUserMessage` 同 id 检查此前在真实链路不命中——服务端已修复：`sendPromptToAgent` 将客户端 messageId 并入 `runOptions.messageId`，mock provider 回显为投影 user_message 的 messageId（客户端按 `stream.ts` 既有逻辑用 messageId 派生 StreamItem id，同 id 投影后 ack 与锚定精确解析均命中）。门禁：server 单测 + server e2e（真实 daemon 投影 id == 客户端 id）+ web e2e（投影后第二轮消息可入队断言，2 轮全绿）。真实 provider（Claude）不回显（SDK 拥有消息 uuid，rewind 锚点依赖），依赖末条回退安全网。

### 3.6 打包/e2e daemon 的 dev 提供者 opt-in（2026-08-04）

- **证据**：真实打包验证时 `create_agent` 报「Unknown provider 'mock'」——desktop 的 `node-entrypoint-launcher.ts` 对打包产物强制 `CHISACODE_NODE_ENV=production`（`createElectronNodeEnv` 覆写），而 mock 属于 `DEV_AGENT_PROVIDER_DEFINITIONS`（`buildResolvedBuiltinProviders` 仅在 `isDev` 时注册）；无任何 env 旁路
- **落地**：`buildProviderRegistry` 新增 `enableDevProviders` 选项（`config.ts` 从 `CHISACODE_ENABLE_DEV_PROVIDERS=1` 解析，仅打包/e2e 门禁使用；生产 daemon 不设置），经 `ProviderSnapshotManager` → `bootstrap` 透传；mock `isAvailable()` 恒真，无需额外改动
- **门禁**：`provider-registry.test.ts` 新增 opt-in 断言（`enableDevProviders: true` 注册 mock），39 测试全绿；dev 模式行为不变（`isDev` 分支未动）

## 4. 测试审查发现的问题与修复

| 问题                                             | 修复                                            |
| ------------------------------------------------ | ----------------------------------------------- |
| 测试期望与 T3 语义不符（缺高度应 null 而非 1px） | 修正 `getRowBottom` 测试                        |
| controller 尝试上限后 pendingRequest 未清空      | 修复并测试                                      |
| `lastContentHeight` 状态冗余导致 grew 判定错误   | 删除，用参数直判                                |
| 只读 measurement 在测试中赋值                    | `mutable` 视图                                  |
| 多层嵌套回调 lint                                | 抽模块级 helper / 抽组件（`WorkLogMoreButton`） |
| `agent.cwd` 误加依赖                             | 移除                                            |
| e2e poll 中 `toBeLessThanOrEqual(async fn)` 非法 | 改为 poll 布尔断言                              |

## 5. 未完成项（如实声明）

| 项                                            | 原因                             | 建议                                                                                                           |
| --------------------------------------------- | -------------------------------- | -------------------------------------------------------------------------------------------------------------- | --- | ---------------------------------------------------------------------------------------- |
| ~~Slice C 的 composer busy 装配~~             | **已完成**（2026-08-03 补充）    | `use-composer-send-projection-ack.ts` hook + composer 接线（`isSubmitBusy = (isProcessing && !isServerAdopted) |     | isSubmitLoading`，sendError 时清除 pending）。7 个 hook 测试 + composer 集成 39 测试全过 |
| Slice F 服务端 delta 微批                     | 计划定义为可选（需性能采样证据） | 未做采样，不实施                                                                                               |
| ~~真实 Electron 验证~~                        | **已完成**（2026-08-04）         | dev 模式 Electron app 与 electron-builder 打包产物双门禁全绿（§2.2）                                           |
| web-only markdown 表现力（表格/详情/favicon） | react-markdown 降级              | 独立路线图项                                                                                                   |

## 6. 环境事故记录（2026-08-03 排查 e2e 期间）

1. **junction 实验误删 node_modules 内容**：为跑 HEAD 基线 worktree 创建 junction 链接，`rm -rf` worktree 时 junction 目标被递归删除，丢失 `@babel/` 作用域与 `node_modules/.bin`。已通过 `npm ci` 完整恢复（npm ci 前需杀掉占用 dll 的 Electron 进程）。
2. **workerd 反复占用 9229**：Cloudflare workerd（node_modules 内进程）占 inspector 端口，需每次 e2e 前清理。
3. **Windows junction 不支持 worktree 复用 node_modules**：`npx playwright` 无法从 junction 解析，worktree 基线方案不可行，改为主工作区 stash 隔离测试。
4. **Slice C 测试环境**：hook 测试需 `@vitest-environment jsdom`（renderHook 需要 DOM）。
5. **`git clean -f packages/app/e2e/` 误删未跟踪的 `turn-anchor.spec.ts`**：清理 82 个 `.js` 产物时连带删除；已按原设计重写（2 测试：上半视口锚定 + 滚轮脱离/回底恢复），lint/typecheck 全绿。
6. **e2e 中文 locale 不匹配**：本机 app locale 为中文，停止按钮文案「停止智能体」；helper 正则补 `|停止|取消` 修复（composer.ts、agent-stream.ts 共 3 处）。
7. **Windows cleanup EBUSY**：daemon git watcher 短暂持有 temp repo 目录句柄 → `removeDirectoryWithRetry`（指数退避，≤20 次）；`agent-index.sqlite` 的 EBUSY 同法修复于 `global-setup.ts`。
8. **Soft Home 重定向（提交 `2d79df991`）使经典 sidebar testid 永不出现在 DOM**：`openHomeWithProject` 类 helper 全部超时。对照 `workspace-setup-runtime.spec.ts` 同点失败证实为分支级预存故障（§2.4）。

## 7. 最终门禁结论

- ✅ App typecheck：0 错误（排除 .expo 生成物噪音；该噪音为 git-ignored 后台进程产物）
- ✅ lint：全量改动文件 0 warnings 0 errors（含 e2e spec）
- ✅ vitest：锚定 38 测试（metrics 17 + controller 21）+ 折叠 7 + reducers 60 + 高亮缓存 12 + composer（含 ack）等全绿；server mock 9 测试（含 messageId 回显 + 尾置工具模式）+ server e2e 回显门禁全绿
- ✅ Playwright `turn-anchor.spec.ts`（新增门禁）：真实 web 验证发送锚定 / 滚轮脱离 / 回底恢复 / 投影后第二轮消息可入队——服务端回显后 2 轮全绿（此前 5 轮全绿）
- ✅ Playwright `work-log-fold.spec.ts`（新增门禁）：真实 web 验证 work-log 徽章折叠「+N」/ 展开 / 再折叠——mock 尾置工具模式（server 单测覆盖），连续 3 轮全绿
- ✅ Playwright 合并回归：turn-anchor 2 + agent-stream-ui 1、2 + work-log-fold 1 = 5 通过（单次运行）
- ✅ Playwright `agent-stream-ui.spec.ts`：测试 1、2 全绿（含 cleanup，无 teardown 错误）——`?open=agent:` 路由 + 真实流式 + 停止按钮链路；teardown 进程树清理（taskkill /T /F）消除 `agent-index.sqlite` EBUSY
- ⚠️ `agent-stream-ui.spec.ts` 测试 3 及所有 `openHomeWithProject` 依赖 spec：Soft Home + SidebarV2 迁移造成的分支级预存故障（§2.4 证据闭环），非本次引入；修复为独立任务
- ⚠️ 预存失败 3 文件（Unistyles setup）+ .expo 噪音：均为 stash 验证的预存状态
- ✅ **桌面（真实 Electron）验证已完成（2026-08-04）**：
  - dev 模式：`e2e/desktop-slices.script.ts`（`_electron.launch` + Metro + 独立 daemon）——Slice B 锚定 / C busy 释放入队 / D 「+3」折叠展开 / E 流式围栏渲染，连续 3 轮全绿
  - 打包产物：electron-builder 重建 `ChisaCode-Setup-1.0.2-x64`（fresh server dist + fresh `expo export` web bundle——原 08-01 产物不含切片代码；**asar 内容需重跑 `node packages/desktop/scripts/build-x64.js` + 解压 asar 复现**，产物本身 gitignored）；`e2e/desktop-packaged-slices.script.ts` 解压并启动真实 `ChisaCode.exe`（`chisacode://app/` + `desktopManaged:true` daemon，`CHISACODE_ENABLE_DEV_PROVIDERS=1`）——同四切片断言全绿，连续 2 轮全绿
  - 新支持件：server `CHISACODE_ENABLE_DEV_PROVIDERS`（§3.6）、mock 尾置回合文本加流式代码围栏（Slice E 桌面可观察载体，server mock 测试 7/7 无回归）
  - native 的 `requestTurnAnchor` 委托 bottom-anchor `requestLocalAnchor`（sticky-bottom 语义保留，非 no-op），未声称 native turn-anchor 语义验证
