# 手机远程 Web T1 执行记录 · 2026-08-30

轨：T1 外出公网 `http://125.124.85.212:3389/dshd/`（Cursor 浏览器 + 手机视口仿真，系统相机真机未跑）。T2 N/A（桌面 `remoteMode=relay`，`:3180` 未听）。T3 Deferred。

桌面：本机 Electron `npm start`，Harness `:3080`，daemon `:6767`。未 bounce daemon。

对话模型已跑附录 A（M4 旧仓 + M6 S09 临时目录）。M5 S07 权限切换 Pass（Rehearsal）。S08：手机允许一次、手机拒绝、**桌面决（官方 3080 ApprovalPanel 点拒绝）** 均在 host 落地。公网页 `app.js?v=20260830-asked`（history 收 `approval/asked`）。本记录全是 **T1 Rehearsal**（Cursor 390×844）。执行人跳过系统相机真机。未写「实机全量」。

## M0 配对与切面

| 用例 | 结果 | 说明 |
| --- | --- | --- |
| 101 | Pass | 配对 origin = `http://125.124.85.212:3389/dshd`；公网 `app.js` 无 `fetchAgents`，有 `hostCall(client, 'session.list'`。链接不含 `:3180` / `:8411` 当页面。 |
| 102 | N/A | 外出模式，3180 未听。 |
| 103 | Pass* | `#offer=` 自动进入对话壳，`#device-line` 为已配对。*非系统相机，是浏览器打开完整 URL。 |
| 104 | Pass | 无 hash 打开同 origin，sticky「已重连」。 |
| 105 | Deferred | Android。 |
| 106 | Pass | 运行中脚本现为 `app.js?v=20260830-held`；无 `fetchAgents` / `createAgent`；无「创建新分支请在电脑端」「请在电脑上发布仓库」。 |

## M1 布局

Fail → 修 → 复测：

- `.composer-side` / `.session-row` `gap: 2px` 违反 4 的倍数。已改为 8px / 4px。标题栏不再显示 `srv_*`，改为工作区名。
- 公网已部署 `app.css?v=20260830-layout`。

复测盒模型（CSS px）：

| 视口 | attach↔权限 中心距 / 重叠 | 模型↔发送 中心距 / 重叠 | 标签 |
| --- | --- | --- | --- |
| 360 | 51 / 否 | 54 / 否 | 权限、模型全文 |
| 390 | 51 / 否 | 54 / 否 | 同上 |
| 430 | 51 / 否 | 54 / 否 | 权限、模型全文 |

发送 34×34，附件 28×28。S01：审批条已在 S08 桌面决同场拍到（390，拒绝/允许一次、composer 隐藏）；Git 胶囊 `dshd-qa-s09 · 0` 在 S09 会话顶栏可见（先 `git-status`）。连接页 360 / 390 / 430 已拍真实 `#screen-connect` DOM（sticky 仍已重连，未卸配对；连接页与对话壳互斥显示）。

## M2 列表 `D = P`

Fail：相对 `session.list` 活会话缺 2 条（及一条同名父层）：`最少取糖保证苹果桃子`、`水杯配对游戏最优策略`。根因：`groupSessionRows` 只把直接子智能体挂到顶层父下，孙代丢了。

修：`sessionRowForest` 递归展开；公网 `app.js?v=20260830-tree`。

复测：SPA 抽屉 33 条标题 **multiset 等于** loopback `session.list` 活会话 33 条。原先缺的两条 `b` 宽 230px，前 8 字可见。桌面侧栏目视展开对照仍待补一张截图（本记录用同一进程 `session.list` 作 D 的代理）。

## M3 切会话 / 时间线

Fail → 修 → 复测（桌面已重启加载 `slimHostRpcValue`；公网页 `app.js?v=20260830-run`）：

| 用例 | 结果 | 说明 |
| --- | --- | --- |
| 701 | Pass | 「长颈鹿打螺丝SVG动画」时间线秒开，折页可见用户句与助手长回复；不再 30s 超时。 |
| S03 | Pass | A=`pong` 发标记句得 `ACK-A`；B=`终端工具一次调用 pwd` 无 A 标记、得 `ACK-B`；切回 A 仍有 `ACK-A` 无 `ACK-B`。loopback history 同步。 |
| 703 | Pass* | 轮询路径：`LIVE-703` 用户句 ~0.75s 出现且 Stop 可见，~8.7s 助手落地后 composer 回到发送。\*daemon mux 仍走 WebSocket 对 SSE `/api/events.mux`，增量主要靠 1.5s history 轮询（表允许 mux **或** 轮询）。 |
| 702 | 未签 | P1。 |
| S10 | 未签 | P1。 |

顺带修：`sendPrompt` 把 `running=true` 之后，轮询/打开 history 从不根据 `turn/end` 清 idle，Stop 会卡住。`runningFromHistoryEvents` + `host/session-status` 识别已部署。

## M4 对话与模型

工作区 `C:\\Ai\\Deepseek-Harness-Desktop` 新建会话，模型 **Ayase `grok-4.6 · high`**（后 S06 改为 `low`）。附录 A 五轮：

| 轮 | 结果 | 说明 |
| --- | --- | --- |
| 1 | Pass | `你已连通，验证码为 456。` |
| 2 | Pass | 助手只回 `456`。 |
| 3 | Pass | glob/read 工具卡；三句摘要对上 DeepSeek Harness 桌面客户端。未弹审批（权限已是工作区写入）。 |
| 4 | Pass | `pwsh` 输出 `C:\\Ai\\Deepseek-Harness-Desktop`。未弹审批。S08 允许/拒绝改到 M5 造一次审批。 |
| 5 | Pass | 三行：`456` / 产品一句话 / 目录路径。 |

S05：chip `glm-5.3-flash` 后助手含 `当前模型切换验证-M2`；切回 `grok-4.6 · high` 后助手 `切换验证-M1`。S06：chip `grok-4.6 · low`，助手回了思考档验证句（一字笔误「释」）。

手机顶栏在空白新建会话上仍显示「新会话」，host `session.list` 标题已是「验证连接并生成验证码」（mux 标题帧未跟上，不挡五轮正文）。

## M5 权限 / 审批

| 用例 | 结果 | 说明 |
| --- | --- | --- |
| S07 | Pass* | Rehearsal（Cursor 390 视口）。权限 sheet 三项可见；切到工作区写入后 chip 不回滚；loopback `permissions.currentValue=workspace-write`；再聊 `权限已切换为工作区写入`。走 `commands/execute`，不是 `session.prompt`。未测只读后再写。 |
| S08 允许一次 | Pass* | Rehearsal。工作区写入下让 glm 对 `C:\Ai\dshd-qa-ask-probe.txt` 做 pwsh 写入；第一次沙箱拒绝后带 `sandbox_permissions=danger-full-access` 弹出审批条（工具名 pwsh、理由含工作区外路径、允许一次/拒绝）。手机点允许一次后 host `approval/decided=allowed-once`，文件写出 `qa` 后已删。\*E2EE `respond` 仍可能 30s 超时，条曾卡住；已改成交后先收条。桌面当时焦点在另一会话，未截到官方审批窗。 |
| S08 桌面决 | Pass* | Rehearsal。`session-bc2cb146-…` glm `danger-full-access` 写 `C:\\Ai\\dshd-qa-ask-probe.txt`。官方 `127.0.0.1:3080` ApprovalPanel 与公网 SPA 条同时可见（工具 pwsh、理由含工作区外路径、拒绝/允许一次）。在 **3080 点拒绝**。host `approval/decided=rejected`；探测文件不存在；SPA 条收起、composer 恢复。证据用 loopback dsh web，不用 Electron HWND。\*非真机。手机条靠 history `approval/asked` 水合（mux 长连接错过 pending 时不再空白）。 |
| S08 手机拒绝 | Pass* | Rehearsal。`session-0dd740e8-e6db-4bfa-abc7-c27f8e1fcd62` glm 同路径 pwsh；条可见后点拒绝。host `approval/decided=rejected`；探测文件不存在。composer 在条出现时隐藏。 |
| 502 / 704 / 507 | Pass* | 并入 S08（审批时无 Send）与 207（子智能体只读条替换输入区）。 |

## M6 新目录五轮（S09）

Fail → 修 → 复测：

- `workspace.create` 返回 `{ workspace: { workspaceId } }`，SPA 读了顶层 `workspaceId` → `session.create` 未挂上目录。已加 `workspaceIdFromCreate`。
- 空白新会话被 `liveSessionRows` 丢掉后 `currentRow()` 为空：顶栏停在「新会话」、第一条发出后抽屉不出现该行。已加 `heldSessionRow` / `withHeldLiveRow`。公网 `app.js?v=20260830-held`。

| 用例 | 结果 | 说明 |
| --- | --- | --- |
| S09 | Pass* | Rehearsal。空目录 `C:\Ai\dshd-qa-ws-2026-08-30` + README。浏览 `host.listDirectory`（禁止 `pickDirectory`）→ 确认工作区 → `session-3d63ab30-8d9f-4235-86fa-ecda81a86edd`。Ayase `grok-4.6`、工作区写入。附录 A：验证码 **456**；README 经 glob/read；`pwsh` 输出 `C:\Ai\dshd-qa-ws-2026-08-30`；汇总三行对得上。抽屉该工作区下标题「连接完成并给出验证码」。D=P 该组 1 条。\*不是真机。 |
| 401 | Pass* | 工作区头 `+` 在该 path 上 `session.create`（`session-dec075d6-…` blank，205 不进活列表）。 |
| 402 | Pass* | Rehearsal。新会话 sheet 点「无工作区文件夹」→ `session.create` 无 `workspaceId`。新 id `session-5f3cdb52-…`，`blank: true`，`workspace.list` 未挂该 id。Host 仍填了默认 `cwd` `C:\\Ai\\Deepseek-Harness-Desktop`（不是我们传的）。SPA 顶栏「新会话」。 |
| 403–406 | Pass* | 并入 S09 浏览 + 五轮。 |

## M7 列表操作

| 用例 | 结果 | 说明 |
| --- | --- | --- |
| 301 | Pass* | Rehearsal。发版 `dsh web` 默认 `openAt: never`。产品路径改为全量启动 `--patch` overlay（`desktop-session-search.patch.yml`，耐久 `dsh-home/session-query.sqlite` / `openAt: first-search`），不再依赖用户层 `cordis.patch.yml`。loopback `session.search` 返回正文 snippet。SPA 搜「长颈鹿」1 条「长颈鹿打螺丝SVG动画」，行上 snippet 为 SVG 正文而非标题过滤。≤20。\*不是真机。 |
| 302 | Pass | 手机把 S09 改名为 `S09-rename-qa`，loopback `session.list` 标题全等；再改回「连接完成并给出验证码」。 |
| 209 | Pass | 活会话 ⋯：重命名 / Fork / 上移下移 / 归档；**没有**删除。 |
| 304 | Pass | Fork 出的子行归档后活列表只剩父行；`archivedSessionIds` 含该 id。 |
| 305 | Pass | 已归档「点按取消归档」回到活列表；顶栏仍停在当时打开的子智能体，不自动打开。 |
| 306 | Pass | 再归档后删除，确认文案含「不可恢复」；host 上该 `sessionId` 消失。 |
| 309 | Pass | 见 401。 |
| 205 | Pass | 活抽屉 37 条 = loopback 非 blank / 非 dshbot / 非归档 37；blank 7 + dshbot 3 不出现。 |
| 206 | Pass | 活列表无「加载更多」。 |
| 207 | Pass | 「水杯配对游戏最优策略证明」子智能体：composer 隐藏，只读条「由父会话驱动，不能直接发消息」。 |
| 303 / 307 / 308 | 未签 | P1。Fork 本场只作归档耗材。 |

## M8 Composer

| 用例 | 结果 | 说明 |
| --- | --- | --- |
| 504 | Pass | `/` 弹出 host 列表（`/permission` `/plan` `/compact` `/export` `/goal` `/feedback`）。执行 `/permission workspace-write`，chip 仍为工作区写入。 |
| 507 | Pass | 审批条出现时 composer 隐藏（S08）；子智能体只读（207）。 |
| 501 / 505 / 506 | 未签 / 并入 | 501 已由 S05/S06 覆盖。505 以 S04/S09 为准。506 P1。 |

## M9 Git（临时仓，非产品脏树）

仓：`C:\Ai\dshd-qa-ws-2026-08-30`。608：产品仓脏，写路径只在此临时仓。

| 用例 | 结果 | 说明 |
| --- | --- | --- |
| 601 | Pass | Initialize Git → 胶囊 `main`，无「请在电脑上初始化」。 |
| 602 | Pass | 提交后列出本地分支；从 `dshd-qa-s09b` 切回 `dshd-qa-s09`，pill 一致。无 commit 时 `for-each-ref` 为空属 git 未出生分支，不是 SPA 假列表。 |
| 603 | Pass | 创建并检出 `dshd-qa-s09`（及 `dshd-qa-s09b`）。无「创建新分支请在电脑端」。 |
| 604 | Pass | Commit 说明 `dshd-qa: initial readme`；`git log` `d9807dd`；胶囊改为 Publish repository（无 origin）。 |
| 605 | Pass* | Rehearsal。临时仓 `C:\\Ai\\dshd-qa-ws-2026-08-30`。新建私人测试仓 `ChisaAlter/dshd-qa-605-20260831` 作 origin（未推产品仓）。工作区 Git 胶囊主按钮 **Commit & push**；说明 `dshd-qa-605: commit and push`；一次 stacked `git-commit`+`git-push`。远端 `origin/dshd-qa-s09` 与本地同为 `2796109`，GitHub 有 `dshd-qa-605.txt`。产品路径：`gitPush` 会补 `origin/HEAD`，首发非 main 不再误走 Commit, push & PR。随后去掉 origin。\*GitHub 仓由执行人自行删除。 |
| 606 | 未签 | P1。胶囊已是 Publish repository，未点下去。 |
| 607 | Pass* | 创建/提交有「完成」toast，无永久 loading。\*未造授权失败。 |
| 608 | Pass | 写路径未走产品仓。 |

## M10 断线 / 冻结 / NEVER

| 用例 | 结果 | 说明 |
| --- | --- | --- |
| 705 | Pass* | Rehearsal。未卸配对、未停 VPS 中继、未杀 Harness。关掉手机→`:8411` 的 E2EE WebSocket（并短暂拦住新的 `:8411` 套接字）后 `#conn-banner` 为 offline「连接已断开…正在等待重连」；composer 草稿 `dshd-qa-705-draft` 仍在。恢复套接字后 sticky 重连，横幅收起，S09 标题「连接完成并给出验证码」，时间线仍有验证码 **456** 与附录 A 各轮，草稿仍在。\*不是真机断网，是 Cursor 浏览器里断中继通道。 |
| 801 | Pass | 工作区 → 文件：`下一轮接 host/gitDiff；请暂时用电脑端。` |
| 802 | Pass | 更改 tab 同一冻结句。无 Stage/Unstage/Discard。 |
| 803 | Pass | MCP / 技能：`下一轮只读清单；启用、停用、安装请在电脑端操作。` |
| 804 | Pass | `app.js` 无 `host.pickDirectory`；dshd hooks 无 `DSH_HOME`；配对路径无 `fetchAgents`/`createAgent(`。 |

## M11 签字

| 用例 | 结果 | 说明 |
| --- | --- | --- |
| 901 | Fail | **只签 T1 Rehearsal**。T3 Deferred。执行人跳过系统相机，不得写「Web UI 实机全量」。301 / 605 已在 Rehearsal 补齐。 |
| 902 | Pass | 无 API 密钥、无完整 `#offer=`、无 SSH 密码写入本报告。Rehearsal 未填成真机 Pass。 |

## 本场代码修（已部署公网）

- `workspaceIdFromCreate`：嵌套 `workspace.create` 视图。
- `heldSessionRow` / `withHeldLiveRow`：打开中的 blank 会话可当 `currentRow`，第一条消息后进活列表。
- `pendingFromHistoryEvents` / `mergeApprovalPending`：打开会话与 history 轮询把未决 `approval/asked` 收成审批条（公网 `app.js?v=20260830-asked`）。
- `openSession` 末尾 `refreshGit()`：顶栏 Git 胶囊不必先点「工作区」。

