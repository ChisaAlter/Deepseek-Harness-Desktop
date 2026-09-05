# Feature: 手机远程

| Field | Value |
| --- | --- |
| **id** | `mobile-remote` |
| **status** | `active` |
| **last verified** | 2026-09-05 — 本地 Web + host tunnel/mux 304/304；假 host 浏览器 30/30；Android JVM 测试和 Debug APK 构建此前通过。用户授权后仅启用本机目录模块并重启远程：217 条会话约 62.6KB，公网直连及系统代理各新配对 + 5 次重连，共 12 次目录加载成功，4955–13476ms，无目录超时。公网页面另有一次导航超时，不能宣称任意弱网稳定。无正式发布、无公网前端追加部署、无 APK 安装；ADB 无设备，Android 实机 Blocked。入口已开放但最终 CI 安装包全量验收待完成，**不得写「实机全量通过」**。 |

## User paths

**入口已开放，默认关闭配对：** `REMOTE_FEATURE_ENABLED=true`；远程服务只在用户开启后启动，未配置时默认服务器模式。以下路径仍须针对最终 CI 安装包验收，不能继承历史停放期的 N/A。

1. 桌面开启配对且中继已连接 → 侧栏 `#offer=` v2 二维码（局域网 `http://<LAN>:3180/` 本机 `mobile/web` SPA；外出 `DEFAULT_PUBLIC_APP_BASE_URL` 公网 nginx `http://125.124.85.212:3389/dshd/`）。系统相机打开浏览器公网页；App 内扫走 APK 内置 SPA（`appassets.androidplatform.net`），不加载公网 origin。`DaemonClient` 经中继 E2EE 握手 → `deviceSecret` 落盘（sticky）→ 已配对态。中继未连接时弹窗只显示状态，不展示二维码 / 复制链接 / 刷新配对码。
2. 再次打开手机 SPA（无 hash）：用最近一台已存 `deviceSecret` sticky 重连。「已保存的电脑」点选 / 忘记。跨 origin（公网 `/dshd`、LAN `:3180`、APK asset）不互通 sticky。
3. Android：原生扫码或粘贴完整配对 URL → 应用内 WebView 打开 **同一份** SPA。聊天 / 会话列表 / Git / composer **不得**再做一套 Compose。
4. 配对之后 SPA 是正在跑的 `dsh web` 第二客户端（与桌面 BrowserView 同一进程）。LAN 与外出都走隧道（公网页碰不到 loopback）。Harness 未就绪：抽屉明示「桌面端未启动」，禁止画空的「新会话」假装已对齐。
5. 抽屉对齐桌面侧栏：`session.list` + `workspace.list`；按工作区分组 / 一个列表；搜索 `session.search`（snippet）；行 ⋯ 重命名 / Fork / 上移下移 / 归档；活会话 **没有删除**；已归档取消归档或删除；子智能体只读。
6. 新会话：已有工作区、无工作区文件夹、浏览本机目录（`host.listDirectory` / `host.createDirectory` / `workspace.create` / `session.create`）。禁止 `host.pickDirectory`、禁止 `createAgent`。
7. Composer：模型 + 思考 `session.models` / `session.selectModel`；权限与 Plan / 斜杠走 Typert `commands/execute`（`/permission <id>`、`/plan off`）；发送 `session.prompt`、停止 `session.cancel`；附件进 host；审批 `POST /api/respond`（线协议 `respond`）。
8. 顶栏 Git 对齐桌面 titlebar：Init、分支搜索/切换/跟踪远端/**创建并检出**、stacked Commit/Push/PR、Publish、View PR。执行走隧道 `shell:git-*`，不是 ACP checkout。
9. 时间线：`session.history`（`beforeSeq` 向上分页）+ mux 或 1.5s 轮询（running / pending 时）。断线横幅 + 草稿；重连后 `session.list` + 当前 `history`。
10. Files / Diff / MCP / 技能：**冻结条**（「下一轮接 host/gitDiff；请暂时用电脑端」），禁止空列表装做成功能。

## MUST 矩阵（本轮交付物；缺一行不算完成）

对照源：桌面 BrowserView / `ui-workspace` / `ModelSelect` / `PermissionSelect` / `git-titlebar` + `GitActionsControl`。不是旧 ACP。

### A. 对话列表

- 同一批活会话：`session.list`。隐藏 `origin:'dshbot'`。`blank: true` **不出现在列表**（桌面复用 blank 作 New Session）。
- 按工作区分组 + 平铺：`workspace.list`。无用户自建「文件夹」。
- 工作区行：展开；`+` = `session.create({ workspaceId })`；⋯ 重命名 / 删除工作区 = `workspace.rename` / `workspace.delete`（unlist，不删磁盘）。
- 无目录：`session.create` 不带 workspaceId/cwd。
- 搜索：`session.search`（最多 20，有 snippet）。不得把「仅过滤已加载标题」写成与桌面同等。全文索引由桌面全量启动 overlay 打开（`openAt: first-search`），skip 恢复不传该 overlay。
- 行 ⋯：重命名 `session.rename`；Fork `session.fork`；归档 `workspace.archiveSession`。活会话 **没有删除**。
- 已归档：默认折叠、点行不打开；⋯ 取消归档 `workspace.unarchiveSession` 或删除 `session.delete`（仅已归档）。
- 子智能体：`parentSessionId` 折到父下；打开只读 composer。
- 状态点：至少 `running`。审批/计划等待用 mux 或 history 轮询补。
- 手动排序：`workspace.insertSessionBefore`（手机行菜单上移/下移）。
- **禁止：** `fetchAgents` / `createAgent` 当目录或新会话。Host `session.list` v1 一次返回全部：SPA 无假分页。

### B. 新工作目录

- 已有工作区点选 → 该 workspace 新会话或复用 blank。
- 无工作区文件夹。
- 添加本机目录：禁止 `host.pickDirectory`。用 `host.listDirectory` 浏览 + 可选 `host.createDirectory` + `workspace.create({ path })` + `session.create`。
- 浏览根：从已登记工作区路径的父级起步；创建后必须出现在 `workspace.list` 与桌面侧栏。
- 空白会话 hero：发出第一条消息前可改工作区；发出后不再用 chip 改 cwd。
- 可选：`agentPreset.list` + `session.create({ agentPreset })`；没有预设则隐藏，不得假控件。

### C. Composer

- 模型 + 思考：`session.models` + `session.selectModel({ provider, model, reasoningEffort })`。触发器文案 `模型 · effort`。无 reasoning 的模型隐藏思考档。
- 权限：切换 = Typert `commands/execute` 行 `/permission <id>`。失败回滚 + 可见错误。禁止本地假 `accessMode`，禁止把斜杠当 `session.prompt` 聊天。
- Plan：开启时显示 chip；点击 `commands/execute` `/plan off`。未开启则隐藏。
- 斜杠：`/` 拉取 `commands/list`；以 `/` 开头由 `commands/execute` 执行。禁止再打 daemon `listCommands` 当真相。
- 发送 / 停止：`session.prompt`（queue）+ `session.cancel`。
- 附件：image parts 进 host。
- Queue：history/projections 有队列才接 `session.updateQueue`；没有则不画假 dock。
- 只读子智能体 / 审批接管：替换输入区，不得在只读会话仍显示 Send。

### D. 顶栏 Git

对照 `git-titlebar.md` 与 `resolveGitQuick`。SPA `git/quick.js` 标签表保留；执行层走隧道 `shell:git-*`。

- 非仓库：**Initialize Git** → `gitInit`。
- 分支 pill：当前 ref；菜单 `gitBranchList`（搜索本地/远端）。
- 行点击切换；远端无本地跟踪 → `gitSwitchBranch` 的 track 语义；`switchable:false` 列出但禁用。
- **创建并检出** → `gitCreateBranch`。禁止「创建新分支请在电脑端」。
- 主按钮 stacked 一次做完：Commit；Commit & push；Commit, push & PR；Push；Push & create PR；Pull；View PR；Publish。禁止把 `commit_push` 做成只开 commit 对话框。
- Commit 对话框：可选说明、路径包含/排除、**Commit on new branch**。
- 无 origin：**Publish repository** → `gitPublishRepository`。禁止「请在电脑上发布仓库」。
- 分叉：Sync branch 禁用 + rebase/merge hint。
- 默认分支确认：Continue / Abort / Checkout feature branch & continue。
- 进度与失败：错误可复制；不得永久 loading。
- cwd 必须是已登记工作区（或子目录）；授权失败不得画成「没有分支」。

本轮 Git 顶栏不做：stash / merge / rebase / 改名删分支 / Fetch 按钮。Stage / Unstage / Discard 属已签字 DEFER（右栏 Diff）。

### E. 会话能用

- 打开：`session.history` 折成 `conversation/fold.js`；向上分页 `beforeSeq`；失败清旧行 + 重试。
- 直播：mux 经 E2EE（daemon 不转发 `assistant/chunk`；正文靠 `assistant/message` + history 轮询），或 history 短轮询（1.5s；仅 `running` 或有 pending 时）。禁止 `openEventSockets({ origin: location.origin })`。
- 审批：pending 来自 mux 或轮询；回答 `respond` → `POST /api/respond`。跨端解决后清 pending。
- 断线横幅 + 草稿 + 重连后 `session.list` + 当前 `history`。

## 已签字 DEFER（允许冻结，不允许装做成功能）

「请在电脑端操作」**只允许**出现在本段或 NEVER。

- 工作区「文件」「更改」tab 与设置里 MCP/技能：冻结条「下一轮接 host/gitDiff；请暂时用电脑端」。禁止转圈后空列表、禁止残留 ACP 错误当「没有文件」。
- 只读 Files/Diff 的旧契约（不写盘、不 Stage）下一轮仍有效；本轮不转发 `git-stage` / `unstage` / `discard`。
- MCP/技能写操作仍 NEVER（privileged）。
- 消息编辑/rewind、Trajectory、Context meter、Session log 下载、标题栏终端/表面开关、Generative UI：本轮不声称对齐。

## NEVER

- `host.pickDirectory`、`host.openPath`、全部 `PRIVILEGED_METHODS`（settings / credentials / `llm.discoverModels` / MCP 写 / skillInventory）
- 任意 `shell:*`：`pty*`、`writeFile`、打开本机路径（Git 对话框「在资源管理器打开」远程不做，用禁用 + 电脑端）
- 开放 `/api/*` 代理、恢复 HTTP offer v1、把 `:8411` 当 SPA、官方 `dsh web` 整页当手机 UI
- 给 daemon 注入 `DSH_HOME`、双写 `dsh-home`
- PTY 终端、Browser 预览、壁纸图库、市场安装、窗口外观、关闭窗口策略
- Android 原生 Chat / Bearer `/api`；为 Git/模型/会话列表写 Compose 平行实现
- 把 `fetchAgents` / `createAgent` 当产品目录或新会话

## Invariants

- 手机 = **同协议客户端**（`mobile/web/chisacode/` + `@chisacode/client` bundle）。用户可见名称是 **dshd daemon / dshd offer / dshd 远程**；协议实现仍是 vendored ChisaCode offer v2，不改 pairing wire、包名或 sticky localStorage 键。配对之后两条已配对通道：host RPC（白名单 unary + `respond`）进 loopback `dsh web`；Git 进 Electron `git.js`（host **没有** Git API）。
- 白名单 unary：`host.describe` / `host.listDirectory` / `host.createDirectory`；`session.list|search|create|history|models|selectModel|rename|fork|prompt|attachment|updateQueue|cancel|delete`；`subagent.list|history|prompt|interrupt`；`workspace.list|create|rename|delete|insertBefore|insertSessionBefore|archiveSession|unarchiveSession`；`skill.list`、`agentPreset.list`、`llm.models` / `llm.providers`；Typert `commands/list`、`commands/execute`。外加 `/api/respond`。
- Git 白名单（进 main）：`git-status`、`git-fetch-status`、`git-pull-request`、`git-init`、`git-diff`、`git-commit`、`git-push`、`git-pull`、`git-create-change-request`、`git-publish`、`git-status-entries`、`git-branch-list`、`git-switch-branch`、`git-create-branch`。本轮不转发 stage/unstage/discard。
- 转发剥 Origin / Referer / 手机 Cookie / sec-fetch-*；Host = `127.0.0.1:<port>`；JSON 不 gzip；URL 必须仍是该 harness loopback。0.1.2 Host API：daemon 带桌面兑到的 `dsh.sessionCookie`（stdin `harness-cookie`），不得把手机 Cookie 转给 loopback；SPA 点名 `session.list` 落到 `/api/session/list`，payload 为 `{ args: { _request } }`。`workspace.list` 在 unary 404 时从 `/api/remote.mux` 的 `workspace/follow` 首帧 baseline 合成 `{ items, archivedSessionIds }`，禁止空目录冒充「没有工作区」。未配对拒绝。`getHarnessOrigin()` 随端口热更新。
- SPA 不得从 `host/offer.js` / `host/login.js` 进入 v1 Cookie 登录；扫描结果保留完整 `#offer=` URL。
- QR **落地页**：局域网 = `preferredLanIp():3180`；外出 = `DEFAULT_PUBLIC_APP_BASE_URL`（`:3389/dshd/`），**不是**中继 `:8411`。
- **sticky 三 origin 不互通**。配对链接为 HTTP 明文；MITM 可读 `#offer=` hash。
- **一码两入口**：同一张 QR——Android App 内扫＝链接设备；相机 / 浏览器扫＝打开落地页自动连入 web 端。
- Offer v1 / `POST /__remote__/login` / RemoteGateway 配对 **退役**。
- 侧栏弹窗 QR 闸门只认 `[data-dsh-remote-qr]`；仅 `enabled && relayConnected && pairingUrl` 时提供二维码、复制与刷新。
- Android Compose 只负责扫码/粘贴；会话走 APK 内置同一 Web SPA。
- 助手 Markdown 禁止 `innerHTML` 注入：结构化 block → createElement；链接仅 http/https。
- 时间线向上分页按 seq 去重并保持滚动锚点。打开会话失败必须清掉上一会话 rows。
- 「已保存的电脑」是纯本地 sticky；「忘记」只清本机 secret。
- 保存设备自动 / 手动重连与 offer 首连共用互斥连接入口；连接中显示状态，首次握手失败 / 超时关闭客户端并恢复按钮，不清 sticky。只有成功建立连接后才启用后台自动重连，避免初次失败永久占用选择器。
- 新 offer 取消未完成的旧连接，旧连接结果不得覆盖新连接。配对认证成功后，当前客户端立即改用 deviceSecret，自动重连不得复用一次性 pairingToken；消费后的 offer 从页面 fragment 清除。认证失败停止后台重试但不静默删除保存凭据。
- Android WebView 用显式请求序号识别新扫码或重试，不因重组重新插入已消费的 offer；返回前台触发共享 SPA 的连接探测与目录同步。内置资源缺失或主页面加载失败必须可见，不能回落公网下载同名资源。
- 手机目录转发保留全部 `session.list` 行和原始会话字段，投影只传 `title` / `sessionListMetadata`。模型、权限、计划与用量详情通过打开会话时的 history 按需获取，不能为每次首屏同步重复传输所有会话的详情；history、创建与搜索响应不受目录裁剪影响。目录失败必须可重试，不能假空列表。
- **非 secure context 兼容**：`http://<LAN-IP>:3180` 禁止裸用 `crypto.randomUUID` / `crypto.subtle`；uuid 走 `getRandomValues` fallback；E2EE 保持 tweetnacl。
- 设计语言仍抄 `--dsw-alias-*`。
- 全量启动才启用内容搜索：`--patch` `desktop-session-search.patch.yml` 覆写 `session-query-sqlite` 为 `openAt: first-search` 与 `dsh-home/session-query.sqlite`。禁止把这次 opt-in 写进用户 `cordis.patch.yml`。skip 启动保持发版 `openAt: never`。

## Allowed touch

- `mobile/web/`（含 `host/`、`chisacode/`、`conversation/`、`git/`）、`scripts/bundle-chisacode-mobile-client.mjs`、`scripts/prepare-chisacode-remote.mjs`
- `src/main/chisacode-remote.js`、`src/main/chisacode-daemon-runner.mjs`、`src/main/dshd-daemon-hooks.mjs`、`src/main/dshd-git-dispatch.js`、`src/main/dshd-git-tunnel.js`、`src/main/mobile-web-server.js`、`src/shared/dshd-host-tunnel.js`、`src/shared/dshd-mux-sse.js`、`src/shared/lan.js`
- `vendor/chisacode-remote/`（线协议 `dshd.host.rpc.*` / `dshd.git.rpc.*` / `dshd.host.mux.*`）、`ui-settings-remote`、本卡、QA 远程条
- `tools/mobile-web-qa/`、`tools/remote-web-qa/`
- `mobile/android/`（扫码 handoff、同源 WebView 生命周期、内置 SPA 打包与回归；2026-09-05 用户明确要求同步 Android 修复）

## Do not touch

- 恢复 HTTP Bearer Host SPA 为主路径
- 指着 `app.chisacode.sh` / `relay.chisacode.sh` 冒充完成
- 把中继 IP 当作 QR `appBaseUrl`
- 把「创建分支 / Publish / 思考强度 / 新目录浏览」再写成电脑端（那是需求降级）
- 给 daemon 注入 `DSH_HOME`

## Gates

| Kind | What |
| --- | --- |
| Automated | `mobile/web/**/*.test.js`（含 `app-cutover.test.js` 零 `fetchAgents`/`createAgent`；`host/*.test.js`；`git/stack.test.js` 的 `commit_push` 顺序；`git/bridge.test.js` 的 `gitCreateBranch`）；`src/shared/dshd-host-tunnel.test.js`（白名单外 403、非 loopback 拒转发）；`src/main/dshd-git-dispatch.test.js`（不转发 stage/pty/writeFile）；`src/main/chisacode-remote.test.js`（`DSHD_HARNESS_ORIGIN`、不设 `DSH_HOME`）；Android JVM tests（`:protocol:test` PairingIntent；`:app:testDebugUnitTest` VIEW handoff） |
| Browser | `node tools/mobile-web-qa/run-qa.mjs`（fake **host** 会话，不单靠 fake ACP agents）；`node tools/remote-web-qa/run-e2e.mjs --relay <endpoint>`；`npm run qa:remote` |
| Manual | **全功能执行表：** [docs/qa/mobile-remote-full-web-cases.md](../qa/mobile-remote-full-web-cases.md)（P0 缺一行未填 = 未测完）。细则：[docs/qa/mobile-remote-live-acceptance.md](../qa/mobile-remote-live-acceptance.md) **§S + §0.10（T1，T3 Deferred）**。Android App 本轮不签。 |

## Sources

- 首连失败回归：`mobile/web/chisacode/connect-lifecycle.test.js`（真实 bundle + 不响应 transport）；`node tools/mobile-web-qa/run-connect-qa.mjs`（受控连接失败与点选重试，390px / 1280px）。
- 公网定向验收：`node tools/mobile-web-qa/run-connect-public-qa.mjs`（使用正在运行的桌面，创建并在 finally 撤销专用 QA 设备）；[部署与现场证据](../../tools/mobile-web-qa/results/2026-09-05-connect.md)。
- 追加修复与未发布边界：[本地恢复回归](../../tools/mobile-web-qa/results/2026-09-05-recovery-local.md)。
- 后续公网复测（两轮超时，非实机 Pass）：[公网性能与实机状态](../../tools/mobile-web-qa/results/2026-09-05-public-retest.md)。
- 本机修复启用后双路径复测：[目录瘦身启用记录](../../tools/mobile-web-qa/results/2026-09-05-catalog-activation.md)。

- Vendored ChisaCode client/app pairing runtime
- Host RPC map：`vendor/deepseek-harness/packages/host/apiproxy/src/api/rpc-map.ts`；斜杠命令：Typert `POST /api/commands/list` · `POST /api/commands/execute`
- Git 标题栏：[git-titlebar.md](git-titlebar.md)
- 归档：[session-archive.md](session-archive.md)
- Kill list：[_kill-http-remote](_kill-http-remote.md)
- Web 全功能执行表：[../qa/mobile-remote-full-web-cases.md](../qa/mobile-remote-full-web-cases.md)
- 缺陷修复计划：[2026-09-02-mobile-remote-defect-remediation.md](../superpowers/plans/2026-09-02-mobile-remote-defect-remediation.md)
