# Mobile/Web 对照桌面端差距分析

Date: 2026-08-27

Feature: `mobile-remote`

Base: `cursor/mobile-web-full-parity-ed5c-0436`

## 执行摘要

`mobile/web` 已经是可工作的 ChisaCode v2 同协议客户端，不是等待重写的壳。配对、E2EE sticky 重连、会话列表、时间线尾页、文本与图片发送、停止、基础审批，以及 Git 状态 / fetch / pull / commit / push / PR / 已有分支切换均已接入 `DaemonClient`。新会话也能通过 daemon 原生 `createAgent` 创建。

但当前状态还不能称为“桌面完整对等”。最需要先修的不是大功能，而是三个会影响正确性或信任的 P0：

1. **权限模式是假状态。** 页面在“只读 / 完全访问”之间切换的只是 `state.accessMode`；它既没有调用 `setAgentMode`，也没有进入 `createAgent` 参数。用户看到的安全级别可能与实际 agent 不同。
2. **新会话没有工作区选择。** `createMobileAgent` 固定复用列表中第一个完整 agent 的 `provider/cwd`，只有列表为空时才取最近工作区；多项目用户无法可靠地决定新会话落在哪个仓库。
3. **断线重连没有 UI 状态与权威重同步。** client 打开了自动 reconnect，但 SPA 没订阅连接状态，也没有在重连后重新 fetch agent 目录和当前 timeline；弱网恢复后页面可能继续显示旧状态。

P1 的高价值缺口主要是：会话归档 / 重命名 / 删除与历史列表、嵌套文件浏览和只读预览、只读 Diff、真实模型与模式选择、审批动作完整呈现、时间线分页与 richer timeline、子 agent 轨道、MCP / Skills 只读清单。它们都有现成 DaemonClient RPC，不需要恢复 HTTP v1。

桌面 BrowserView、壁纸图库、桌面设置控制、插件市场、dsh-im，以及 Files 写入没有对应 daemon RPC；不得用旧 Host API 补洞。终端 RPC 虽然存在，但完整终端是高权限流式执行面，且当前 `mobile-remote` 产品契约明确不向手机暴露 PTY，本轮仍列为范围外。

## 审计口径与证据

桌面参考面来自：

- `docs/features/{surfaces-work-loops,terminal-drawer,git-titlebar,session-archive,message-edit,wallpaper-gallery,remote-settings,marketplace-settings,usage-stats}.md`
- `vendor/deepseek-harness/.agents/notes/implemented/feature/2026-08-16-surfaces-terminal-work-loops.md`
- `vendor/deepseek-harness/.agents/notes/implemented/feature/2026-08-22-desktop-phone-remote.md`
- `vendor/deepseek-harness/packages/bundle/web-app/cordis.patch.yml`

Web 当前态来自：

- `mobile/web/app.js`
- `mobile/web/chisacode/{session,parity}.js`
- `mobile/web/conversation/{fold,live,title}.js`
- `mobile/web/ui/{chrome,settings-hub}.js`

协议可行性以当前 vendored `vendor/chisacode-remote/packages/client/src/daemon-client*.ts` 和 `packages/protocol/src/**` 为准。结论只接受 ChisaCode daemon RPC；Electron preload / `shell:*`、`/__remote__/*` 和 HTTP v1 不算可行路径。

图例：

- ✅ **Parity**：当前 v2 路径已可用
- ⚠️ **Partial**：UI 或 RPC 已有，但行为、数据或恢复路径不完整
- 🚫 **Intentionally disabled**：无 daemon RPC，应诚实禁用
- ❌ **Missing**：DaemonClient 已有 RPC，Web 应补
- 🔮 **Out of scope**：技术上可能或桌面可用，但不应在本轮 / 当前手机产品契约内移植

优先级：P0 用户阻塞或安全 / 正确性；P1 高价值主工作流；P2 增强；P3 明确范围外。

## 完整差距矩阵

### 配对、连接与恢复

| 桌面能力 | mobile/web 当前态 | ChisaCode v2 可行性 | 判定 | 建议 |
| --- | --- | --- | --- | --- |
| offer v2 扫码 / 粘贴配对 | `pairFromOfferUrl`，QR 扫描与粘贴均可进入 | `parseConnectionOfferFromUrl` + relay device auth | ✅ P0 | 保持；禁止恢复 v1 登录 |
| E2EE relay 与 sticky device secret | `deviceSecret` 按 serverId 存 localStorage；无 hash 自动重连最近主机 | DaemonClient E2EE / reconnect | ✅ P0 | 保持并继续覆盖 role=`client`、`useTls === true` |
| 连接状态、断线提示、重连后恢复 | client 自动 reconnect，但页面没有状态订阅，也不重拉目录 / timeline | `subscribeConnectionStatus`、`fetchAgents`、`fetchAgentTimeline` | ⚠️ P0 | 增加离线 / 重连中 / 已恢复状态；恢复后权威重同步 |
| 手机主动断开 | 清本机 secret 并关闭 client | `close`；不需要 Host RPC | ✅ P1 | 保持 |
| 撤销其他已配对设备、修改 gateway | 只能在电脑远程设置完成 | DaemonClient 无 relay 设备管理 / 桌面设置 RPC | 🚫 P3 | 保持电脑端入口，不造远程管理 API |
| 多个已保存电脑之间切换 | 存储支持多个 serverId，但启动只选最近一个，没有 chooser | 本地状态足够；无新增 RPC 依赖 | ⚠️ P2 | 后续加“已保存电脑”选择与忘记设备 |

### 主对话与会话生命周期

| 桌面能力 | mobile/web 当前态 | ChisaCode v2 可行性 | 判定 | 建议 |
| --- | --- | --- | --- | --- |
| 会话目录、打开会话 | 拉取最多 100 个 agent，按标题本地筛选 | `fetchAgents` 支持 200 / 页、排序、元数据过滤和订阅 | ⚠️ P1 | 做 cursor 分页；搜索明确为“标题 / 已加载项” |
| 新会话 | 可创建，但总是复用第一条 agent 的 `provider/cwd`，无法选择项目 / 模型 / 模式 | `fetchWorkspaces`、`getProvidersSnapshot`、`createAgent({ workspaceId,cwd,provider,modeId,model })` | ⚠️ P0 | 新会话先选工作区和 provider；不要猜第一条会话 |
| 文本发送与运行态 | 可发送，agent update / stream 驱动运行态 | `sendAgentMessage` | ✅ P0 | 保持 |
| 运行中停止 | Stop 调 `cancelAgent` | `cancelAgent` | ✅ P0 | 保持 |
| 图片附件发送 | 相机 / 相册、压缩、发送前缩略图可用 | `sendAgentMessage(..., { images })` | ✅ P1 | 保持发送能力 |
| 已发送图片在历史时间线中恢复 | 旧 Harness event 能画 image block；ChisaCode projected `user_message` 只有 text / messageId，刷新后没有图片字节 | 当前 `AgentTimelineItemPayloadSchema.user_message` 无 images | 🚫 P2 | 标成协议缺口；不得从临时 composer 状态伪造持久历史 |
| 审批允许 / 拒绝 | 只画“允许一次 / 拒绝”，忽略 request `actions`、`selectedActionId`、更新输入和 permission update | `respondToPermission` 支持完整 `AgentPermissionResponse` | ⚠️ P1 | 按 daemon action 列表渲染；generic allow/deny 只作无 actions 时的 fallback |
| 审批由另一客户端解决 | 本机点击后会清空；没有处理 `permission_resolved`，远端解决后可能继续阻塞 composer | `agent_stream.permission_resolved` / `agent_permission_resolved` | ⚠️ P1 | 收到 resolution 后清 pending，并重新取 agent 快照 |
| 模型选择 | 模型 chip 进入电脑端请求占位；v2 下禁用 | `listProviderModels`、`setAgentModel`，snapshot 含当前 model | ❌ P1 | 做当前会话模型 picker；新会话把选择传入 create |
| 访问 / permission mode | “只读 / 完全访问”只改本地字符串，与 agent 无关 | snapshot `availableModes/currentModeId`、`listProviderModes`、`setAgentMode` | ⚠️ P0 | 删除假切换；显示真实 mode 并写 daemon |
| Slash commands | 无发现 / 补全 UI | `listCommands` | ❌ P1 | 输入 `/` 时按当前 agent 拉取并插入命令 |
| 编辑 / 重发最新用户消息 | 无 | `rewindAgent(agentId,messageId,mode)` + `sendAgentMessage`，且 snapshot 有 rewind capability flags | ❌ P2 | 只能按 ChisaCode rewind 语义设计；不得声称等同桌面 fork-beforeSeq |
| 会话草稿 | 只有一个 DOM textarea；切会话 / 刷新不按会话保存 | 本地存储即可 | ⚠️ P1 | 按 serverId + agentId 持久化文本和待发送附件元数据 |
| 归档、历史、恢复、删除 | 无操作菜单、无历史分区 | `archiveAgent`、`fetchAgentHistory`、`deleteAgent`、`resumeAgent` | ❌ P1 | 先做归档 / 历史 / 删除；“恢复”须先验证 resume 语义，不能照搬 dsh unarchive 文案 |
| 重命名 / 重新生成标题 | 无 | `updateAgent({ name/regenerateTitle })` | ❌ P1 | 会话菜单增加重命名；错误可见 |
| Rich Markdown、reasoning、工具详情 | 助手纯文本；工具只显示 name/status；todo、compaction、turn_changes、generative UI 被忽略 | timeline RPC 已给结构化 item 和 tool detail | ⚠️ P1 | 先补安全 Markdown / code 与 tool detail；未知类型保留可见 fallback |
| 历史向上分页 | 只取 tail 200，旧消息不可达 | timeline cursor、`hasOlder`、direction=`before` | ❌ P1 | 顶部加载更早；按 seq 去重并保持滚动锚点 |
| 子 agent 可见与切换 | relation 数据被保存在 `chisacodeAgent`，但列表平铺、不标父子 | snapshot `relation.parentAgentId/kind`，agent directory stream | ❌ P1 | 主会话内增加只读子 agent 轨道；支持打开、状态和归档 |

### 右栏 Surfaces 工作环

| 桌面能力 | mobile/web 当前态 | ChisaCode v2 可行性 | 判定 | 建议 |
| --- | --- | --- | --- | --- |
| Files 根目录 | 只列根目录；点击目录也会当作 `@path` 插入 | `listDirectory(cwd,path)` | ⚠️ P1 | 目录点击应下钻，文件点击才预览 / 插入 |
| Files 嵌套浏览与 breadcrumb | 无 | `listDirectory` 接受相对 path | ❌ P1 | 实现层级导航、返回与刷新 |
| Files 只读预览 | 无 | `readFile` 支持 text / image / binary 及 binary frame | ❌ P1 | 先做大小受限的文本 / 图片只读预览 |
| Files 路径搜索 | 当前只过滤已加载的根目录 | `getDirectorySuggestions({ cwd,query,includeFiles,matchMode })` | ❌ P1 | 用 daemon 模糊路径建议；明确不是内容全文检索 |
| Files 内容搜索 | 无 | 无独立 workspace 内容搜索 RPC | 🚫 P2 | 不借 terminal/agent tool 模拟搜索 |
| Files 编辑 / 保存 | 无 | file explorer 只有 `list` / `file`，没有 write RPC | 🚫 P3 | 保持只读；当前产品卡也禁止向手机暴露 writeFile |
| Diff 工作树 / base | “更改”页只有干净 / 有改动一句话 | `getCheckoutDiff` / `subscribeCheckoutDiff` 返回文件、hunk、token | ❌ P1 | 做只读 file/hunk diff，支持 uncommitted / base |
| Diff Stage / Unstage / Discard | 无 | DaemonClient 无对应 RPC | 🚫 P3 | 不用 commit `addAll` 假装逐文件操作 |
| Browser 导航 / 截图 / PiP / 录制 | 无 | DaemonClient 无桌面 BrowserView / preview RPC | 🔮 P3 | 桌面专用；网页普通 `window.open` 不能冒充 Browser surface |
| Agents 面板 | 会话列表能显示 running，但无 mode / relation / jobs 工作环 | agent snapshot 可补 mode / relation；没有 Harness jobs snapshot 对等 RPC | ⚠️ P1 | 补 agent 状态与子 agent；jobs 明确不对等 |
| 底部终端 drawer | 无 | `list/create/subscribe/input/resize/kill/captureTerminal` 均存在 | 🔮 P3 | 当前卡明确不暴露 PTY；若立项需新安全评审、终端模拟器、生命周期和移动键盘方案 |

### 标题栏 Git 与工作区

| 桌面能力 | mobile/web 当前态 | ChisaCode v2 可行性 | 判定 | 建议 |
| --- | --- | --- | --- | --- |
| 当前分支 / dirty / ahead / behind / PR | 顶栏胶囊和工作区状态可用 | `getCheckoutStatus`、`checkoutPrStatus` | ✅ P1 | 保持 |
| Fetch / Pull | 可用 | `checkoutRefresh`、`checkoutPull` | ✅ P1 | 保持 |
| Commit / Push | 可用；Commit 固定 `addAll:true` | `checkoutCommit`、`checkoutPush` | ✅ P1 | 文案明确“提交全部改动” |
| PR 创建 / 打开 | 可创建并打开已有 HTTPS URL | `checkoutPrCreate`、`checkoutPrStatus` | ✅ P1 | 后续可选 title/body，不是阻塞项 |
| 切换已有本地 / 远程分支 | 有搜索和切换 | `getBranchSuggestions`、`checkoutSwitchBranch` | ✅ P1 | 保持并补刷新 / 错误态覆盖 |
| 普通分支创建 | v2 下禁用并提示电脑端操作 | 没有 plain branch-create RPC；worktree branch-off 不是同一语义 | 🚫 P3 | 保持禁用 |
| 分支重命名、stash、merge、PR merge | UI 无 | `renameBranch`、stash / merge / PR merge RPC 存在 | ❌ P2 | 非桌面 titlebar 核心；待 P0/P1 后按风险逐项立项 |
| Git 状态实时更新 | 打开工作区或动作结束时刷新；不消费 checkout update | generic daemon event / diff subscription 可提供变化信号 | ⚠️ P2 | 工作区 pane 打开时订阅，关闭时释放 |
| 工作区目录 / 多项目 registry | 仅创建 fallback 隐式读取最近工作区，没有用户可见 registry | `fetchWorkspaces` 支持 query / paging / subscribe，`openProject` / `archiveWorkspace` | ❌ P0 | 新会话和抽屉加入 workspace chooser；归档 workspace 放 P2 |

### 设置与桌面扩展

| 桌面能力 | mobile/web 当前态 | ChisaCode v2 可行性 | 判定 | 建议 |
| --- | --- | --- | --- | --- |
| 手机本地浅 / 深 / 系统、玻璃、字体 | localStorage 可用 | 本地能力 | ✅ P2 | 保持；这不是修改电脑 Appearance |
| 桌面壁纸 / 图库 / crop / frost / pixelate | 显示电脑端不可用提示 | 无 daemon / desktop window RPC | 🚫 P3 | 保持电脑端操作 |
| General / 界面设置 | 多数只是说明或电脑端占位 | daemon config 只覆盖 ChisaCode daemon 字段，不是 dsh UI settings | 🚫 P3 | 不把 raw `patchDaemonConfig` 当桌面设置通道 |
| MCP 清单 | v2 下禁用为“电脑端打开” | `listAgentMcpServers`；另有管理 RPC | ❌ P1 | 先做只读清单和 scope / enabled 状态；写操作另做安全确认 |
| Skills 清单 | v2 下禁用为“电脑端打开” | `listAgentSkills`；另有 policy / install / uninstall RPC | ❌ P1 | 先做只读清单；安装 / 删除不与 marketplace 混为一谈 |
| 插件 inventory / 配置 | 只有电脑端占位 | 无 dsh Loader plugin inventory/config RPC | 🚫 P3 | 保持禁用 |
| Marketplace 安装 / 卸载 | 只有电脑端占位 | 市场是 Electron 主进程 curated catalog + shell IPC，无 daemon RPC | 🔮 P3 | 桌面专用 |
| Usage stats | 无 | `fetchUsageSummary` / `exportUsage` 存在，但统计的是 ChisaCode daemon 本地 agent usage，不保证等于 dsh desktop usage-panel | ⚠️ P2 | 产品确认统计口径后可做只读 7/30/180 天摘要；不得标成同一账本 |
| Remote gateway / 已配对设备管理 | 只显示本连接详情和本机断开 | 无主机 gateway 配置与设备撤销 RPC | 🚫 P3 | 管理继续留桌面 |
| dsh-im 九渠道 / AI Office | 无 | dsh-im 是桌面挂载插件，无 ChisaCode RPC | 🔮 P3 | 不移植 |
| Plugin marketplace 安装后的重启 / Recovery | 无 | 属 Electron HarnessController / launcher | 🔮 P3 | 桌面专用 |

## 协议可行性逐项结论

| 问题 | 结论 | 证据 / 限制 |
| --- | --- | --- |
| agent archive / delete / rename | **有** | `archiveAgent`、`deleteAgent`、`updateAgent({name,regenerateTitle})`；历史用 `fetchAgentHistory` |
| workspace switch / multi-workspace | **有** | `fetchWorkspaces`、`openProject`、`createAgent.workspaceId/cwd`；支持 query、cursor、subscribe |
| subdirectory browse / read / search | **部分有** | `listDirectory(cwd,path)`、`readFile`、`getDirectorySuggestions`；无内容全文搜索、无 write |
| diff view | **有只读** | `getCheckoutDiff` / `subscribeCheckoutDiff`；无 stage / unstage / discard |
| browser surface | **无** | 协议没有 BrowserView、导航、截图、PiP、录制 RPC |
| terminal | **有但范围外** | terminal list/create/stream/input/kill/capture 完整；当前 mobile-remote 契约明确不暴露 PTY |
| MCP / skills read-only | **有** | `listAgentMcpServers`、`listAgentSkills`；管理 RPC 也存在，但应后置安全 UX |
| access mode / permission level | **有** | snapshot `availableModes/currentModeId`，`listProviderModes`、`setAgentMode` |
| model selection | **有** | `listProviderModels`、`setAgentModel` |
| session search beyond title | **无全文搜索** | agent filters 只有 labels、project、status、archived、attention、thinking；可做分页和已加载标题过滤 |
| image timeline recovery | **无** | send RPC 接受 images；projected `user_message` wire item 不含 images，重载后无法还原 |
| subagent visibility | **有** | snapshot `relation.kind/parentAgentId`；当前 Web 丢失分组展示 |
| edit / resend | **有相近能力** | `rewindAgent` + capability flags + messageId，可设计 ChisaCode rewind；不等同 dsh fork-beforeSeq |

## 主要问题

1. **UI 与真实 agent 权限脱节。** 这是安全信任问题，不是单纯缺少设置页。
2. **当前“新会话”选择了一个实现偶然值。** 第一条 agent 不等于用户当前项目，也不等于最近 workspace。
3. **自动 reconnect 只恢复 socket，不保证恢复页面投影。**
4. **会话和 timeline 均截断但 UI 没有告知。** 100 agent / 200 timeline 之后的数据不可达。
5. **文件 pane 把目录当文件 mention。** 它是根目录挑选器，不是桌面 Files 工作环。
6. **设置 Hub 混有真实本地设置、假会话设置和诚实禁用项。** 应把三类视觉与文案分开。
7. **旧 HTTP v1 模块仍留在仓库。** 当前启动路径未调用它们，属于技术债而不是恢复理由；本分析不扩大范围清理。
8. **协议与桌面语义并不总是一致。** ChisaCode archive/resume、rewind、usage 都不能直接套用 dsh desktop 文案。
9. **app.js 是 1892 行单文件，且缺 DOM / browser integration test。** 下一轮功能应先抽可测 controller / adapters，再接 UI。
10. **浏览器静态冒烟不能证明 relay、重连、真 provider、Android WebView localStorage。** 这些必须在真实配对链路单列验收。

## 推荐实施阶段

### Phase 0 — P0 正确性与恢复

范围：

1. 工作区 / provider chooser 驱动新会话。
2. 真实 mode / access 读取与写入，删除本地假状态。
3. 连接状态、自动重连提示与重连后权威 resync。

验收：

- 新会话创建前能从 daemon workspace registry 选择目标；发送给 `createAgent` 的 `workspaceId/cwd/provider` 与选择一致。
- 当前会话 mode 来自 snapshot；切换调用 `setAgentMode`；失败后 UI 回滚并显示 daemon 错误。
- 断网时 composer 不假装在线；重连后重新订阅 agent 目录并刷新当前 timeline，未发送草稿不丢。
- 全路径不出现 `callUnary`、`callShell`、`/__remote__/*` fallback。

### Phase 1 — P1 会话与对话闭环

范围：

1. agent cursor 分页、timeline 向上分页。
2. 归档 / 历史 / 删除、重命名；恢复语义先做 daemon 实跑。
3. 完整 permission actions、另一客户端 resolution 清理。
4. 模型 picker、slash commands、按会话草稿。
5. 子 agent 只读轨道和结构化 timeline（Markdown / tool detail / todo / compaction / turn changes）。

验收：

- 超过 100 个 agent、超过 200 条 timeline 均能继续加载且不重复。
- destructive action 有明确确认；daemon 失败不乐观删除；archive 与 delete 文案不混。
- 每个 permission action 保留 daemon 的 label、variant、selectedActionId；远端解决后 composer 自动恢复。
- 模型 / mode 显示值与重新 fetch 的 agent snapshot 一致。
- 子 agent 按 `relation.parentAgentId` 只出现在直接父会话轨道，仍可打开查看。

### Phase 2 — P1 远程工作环

范围：

1. Files 下钻、breadcrumb、daemon 路径搜索、只读文本 / 图片预览、插入 composer。
2. Diff uncommitted / base 的只读文件与 hunk 视图。
3. MCP / Skills 只读清单。

验收：

- 目录点击只导航；文件点击预览；binary / too-large / error 都有明确状态。
- 搜索由 `getDirectorySuggestions` 提供，结果可定位并插入；不宣称内容搜索。
- Diff 正确区分 non-git、空 diff、加载失败、binary / too-large。
- 页面不出现 Save、Stage、Unstage、Discard 假按钮。
- MCP / Skills 显示 scope 与 enabled 状态；本阶段没有静默写配置。

### Phase 3 — P2 增强（产品确认后）

- 多电脑 sticky chooser。
- ChisaCode rewind 式编辑 / 重发。
- 分支 rename、stash、merge 等高级 Git。
- ChisaCode usage 只读摘要；先确认它与 desktop usage-stats 的产品命名和统计口径。
- MCP / Skills 管理操作；需要逐项确认权限与 destructive UX。

## 明确范围外

| 项 | 理由 |
| --- | --- |
| 完整终端嵌入 | 虽有 RPC，但当前 feature / handbook 明确不向手机暴露 PTY；它需要流式二进制路由、终端模拟器、resize / restore、移动键盘和高权限安全评审 |
| Browser surface | 无 daemon RPC；桌面 BrowserView、CDP、截图、PiP、录制属于 Electron |
| Files 写入 / 保存 | 无 write RPC，且手机当前安全边界明确只读 |
| Diff Stage / Unstage / Discard | 无对应 daemon RPC |
| 普通分支创建 | 无 plain branch-create RPC；worktree 创建不是等价替代 |
| 桌面 Appearance / 壁纸图库 | 属桌面窗口和主进程 catalog |
| Marketplace / plugin install | 属桌面 curated catalog、profile 写入和 HarnessController restart |
| dsh-im channels | 属桌面预置插件，没有 ChisaCode transport 投影 |
| 桌面 launcher / Recovery / window controls | 属 Electron 生命周期，不是远程 agent workflow |
| HTTP v1、Bearer `/api/*`、`/__remote__/shell/*` | 产品已退役；不是 fallback |
| `chisacode.sh` production relay | 产品约束禁止 |

## 本轮 quick wins 决定

本轮不实现 quick win。前三个 P0 都跨 `app.js` 状态机、daemon 生命周期与真实连接验收；在没有 DOM / browser integration harness 的情况下把其中任何一个压成小补丁，会留下新的假状态。会话菜单、Files、Diff 也都不是一两个 adapter 调用即可安全交付。本轮只交付可执行的阶段计划和协议证据。

## 建议下一步

1. 直接立 Phase 0 implementation PR，三个 P0 同一轮闭环；先把 v2 controller 从 `app.js` 抽成可测模块。
2. 为 mobile Web 增加最小 browser integration gate：fake DaemonClient 驱动连接状态、workspace chooser、mode 切换和 reconnect resync。
3. Phase 0 单测通过后，用真实 desktop + relay 做：多 workspace 新建、切 mode、断网重连、草稿保留四条验收。
4. Phase 1 和 Phase 2 分 PR；会话生命周期、timeline、Files/Diff 不混在一个大改动。
5. 每轮继续执行 kill-list 搜索，任何缺 RPC 的控件都保持禁用，不引入 HTTP v1。
