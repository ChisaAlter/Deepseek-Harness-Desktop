# Feature: 手机远程

| Field | Value |
| --- | --- |
| **id** | `mobile-remote` |
| **status** | `active` |
| **last verified** | 2026-08-29 — 审查缺陷弥补（QR 只认 data-dsh-remote-qr、第二冷 boot、prestart 校验 copyLink）。报告：[remote-popover-ux.md](../qa/results/2026-08-29/remote-popover-ux.md)。 |

## User paths

1. 桌面开启配对且中继已连接 → 侧栏扫码（`http://<LAN>:3180/#offer=` v2）→ 手机系统相机打开 SPA → `DaemonClient` 经中继 E2EE 握手 → `deviceSecret` 落盘（sticky）→ 已配对态。
2. 再次打开手机 SPA（无 hash）：自动用最近一台的已存 `deviceSecret` sticky 重连，无需再扫，直至桌面 **解除配对**。连接页列出「已保存的电脑」（完整 sticky 记录，最近保存优先，显示中继 endpoint 与保存日期）：点选任一台走 `reconnectSticky` 手动重连（自动重连未定盘前行禁用），「忘记」清除该台的本机 secret。
3. Android：原生扫码或粘贴完整配对 URL → 提取 offer 后由应用内 WebView 打开 APK 内置的同一 SPA → 后续启动直接从安全 asset origin 触发 SPA sticky 重连，不必重新访问 LAN `:3180` 页面。
4. 设置 → 远程 → 网关：局域网 | 外出（文案区分）；传输始终走中继主机。
5. 手机「新会话」→ chooser sheet：`fetchWorkspaces` 列工作区（名称 · 项目 · 分支 · cwd）→ `getProvidersSnapshot(cwd)` 列 ready 提供方 → 可选权限模式（snapshot `modes`/`defaultModeId`）→ 把选中的 `workspaceId/cwd/provider(/modeId)` 显式传给 `DaemonClient.createAgent` → 打开新会话。
6. 手机工作区 → daemon checkout/file RPC 提供 Git 状态、提交、拉取、推送、创建 PR、切换已有分支；普通分支创建与电脑窗口操作禁用并提示在电脑端完成。
7. 会话权限模式：composer chip 与设置「权限」pane 显示 agent snapshot 的当前 mode；切换调用 `setAgentMode`，daemon 拒绝时回滚并显示错误原文；`mode_changed` 流事件写回 UI。
8. 断线：chat 顶部连接条显示「连接已断开 / 正在重新连接」，发送被拒绝且草稿保留（按 serverId+sessionId 存 localStorage；附件仅内存跨会话切换，不跨刷新）；client 自动重连成功后自动重拉 agent 目录与当前会话 timeline 并提示「已重新连接并同步」。
9. 会话抽屉：`fetchAgents` 游标分页（「加载更多会话」）；子智能体（snapshot `relation.parentAgentId/kind`）折叠在父会话下、父未加载时顶层标注「子智能体」，打开为只读（composer 换成只读说明）。行尾 ⋯ 菜单：重命名 / 重新生成标题（`updateAgent`）、归档（`archiveAgent`）、删除（`deleteAgent`），均确认对话框 + daemon 错误可见；「已归档会话」sheet 走 `fetchAgentHistory(includeArchived, updated_at desc)` 分页，「取消归档」调用 `refreshAgent` 并明示不会恢复运行中任务。
10. 时间线：tail 200 起步，顶部「加载更早消息」向上分页（`direction:'before'` 游标，seq 去重，滚动锚点保持，`reset/staleCursor` 时整页重置）；打开会话先清空上一会话内容，timeline 拉取失败渲染错误占位（daemon 原文 + 重试）而不是残留旧日志；流事件仅在视口贴底时自动跟底，阅读历史时保持位置；助手消息经 `conversation/markdown.js` 结构化解析 + createElement 渲染（原始 HTML 保持字面文本，链接仅 http/https）；工具卡显示状态 + detail 摘要/可展开正文；reasoning/todo/压缩/turn_changes/generative_ui/未知类型都有可见 fallback 行。
11. 审批：daemon `permission_requested` 的 `actions` 列表按 label/variant/顺序原样渲染，回传 `selectedActionId`；无 actions 才显示通用「允许一次/拒绝」；`permission_resolved`（含跨端解决）清除 pending 并恢复 composer。
12. 模型：composer 模型 chip 显示 snapshot `model`（空 = 提供方默认）；设置「模型」pane 用 `listProviderModels` 列清单、`setAgentModel` 切换，失败回滚 + banner；新会话 chooser 模式步之后可选模型并透传 `createAgent`。输入框以 `/` 开头触发 `listCommands` 斜杠命令弹层（前缀优先过滤，点击插入 `/name `）。
13. 文件（工作区「文件」tab 与「文件」pane 同一实现）：`listDirectory` 目录下钻，目录行点击 = 导航（不插入 mention），breadcrumb 回任意上层且每层滚动位置恢复；文件行点击 = 只读预览（`readFile`：text `<pre>`（>200KB 截断明示）/ image blob URL / binary 明确状态 / >2MB 不发 readFile 直接标「文件过大」/ error 显示 daemon 原文可重试）；「插入 @路径 到输入框」与行尾「@」是显式插入动作；搜索框走 `getDirectorySuggestions` 路径模糊匹配（UI 明示不是内容全文搜索），结果目录 → 定位进浏览器、文件 → 预览、「@」→ 插入。
14. 更改（Diff）：`getCheckoutDiff` 只读视图，scope 切换「未提交 / 对比主干」（`mode:'uncommitted'|'base'`）；文件行显示 `+a −d` 与 新增/已删除/二进制/文件过大 badge，点击展开 hunk（`@@` header + add/remove/context 行级着色，纯文本不伪造语法高亮）；non-git（按 `error.code==='NOT_GIT_REPO'`）/ 空 diff / 加载失败（可重试）各有明确状态；提交、暂存等操作提示走顶部 Git 胶囊或电脑端。
15. MCP / 技能 pane：chisacode 传输下渲染只读清单（hub desc 标注「只读清单 · 电脑端管理」）——MCP 显示 transport/来源（系统/用户）、全局启用状态、按提供方/会话覆盖计数、server 级错误；技能显示描述、来源 scope（项目 / AGENTS / Codex / Claude 主目录 / 内置）与状态；payload 级 errors 进提示条；管理动作一律指向电脑端。

## Invariants

- 手机 = **同协议客户端**（`mobile/web/chisacode/` + `@chisacode/client` bundle），不是旧 HTTP Host SPA。
- SPA 不得从 `host/offer.js` / `host/login.js` 进入 v1 Cookie 登录；扫描结果保留完整 `#offer=` URL 后交给 `parseConnectionOfferFromUrl`。
- QR **落地页** = 本机 `mobile/web` on `:3180`（`preferredLanIp`），**永不**把中继 origin 当 SPA。
- **一码两入口**（对齐上游，不出第二张码/第二套协议）：同一张 QR——Android App 内扫码＝链接设备（WebView SPA sticky）；相机 / 浏览器扫码＝打开 `:3180` 自动连入 **web 端**（不得改成「仅设备配对」或加二次确认门）。桌面弹窗（`scanSplitHint`）与落地页（`#entry-split-hint`）必须向用户说明该分流。
- 系统相机 handoff：manifest 认领 `http://<any host>:3180` 的 `VIEW`（宽 host 匹配是唯一解，**禁止** `android:autoVerify`——系统选择器「用 App 打开＝链接设备 / 用浏览器打开＝web 端」就是产品行为）；安全闸门在 App 内——`PairingIntent.fromViewIntent` 必须用与扫码/粘贴同一套 `parsePairingLink` 语法全量重校验，intent data 只解析**永不加载**；垃圾 `:3180` 链接只在 Connect 屏提示，不得把已连接的 Web 会话踢回 Connect；非 VIEW 启动零副作用；`singleTask` + `onNewIntent` 复用实例，不堆叠 Activity。不自造 scheme，上游若引入正式移动 deep link 则跟随。
- Offer 内 `relay.endpoint` = 传输中继；WS 必须 `role=client`；`useTls` 读写一致（`=== true`）。
- Offer v1 / `POST /__remote__/login` / RemoteGateway 配对 **退役**。
- 桌面 `relayConnected` 反映真实 control socket；未连接时 UI 明示，扫码无法完成绑定。
- 侧栏弹窗：打开即 `getRemote`；`enabled && (!listening || !pairingUrl)` 至多一次 `saveRemote({remoteEnabled:true})` 自愈；弹窗 DOM **禁止** raw `relay_control_*` / 裸 `#offer=` 文本；有码时提供复制链接与刷新配对码；启动中用 `startingHint`，持久失败用人话 error，On 可重试。QR 闸门只认 `[data-dsh-remote-qr]`，禁止文案/`svg` 兜底。`qa:remote` 含 `DSH_QA_REMOTE=cold` 第二 boot；`prestart-ensure` 校验 `lib/client.js` 含 `copyLink`。
- Android Compose 扫码框为正方形；会话走 APK 构建时纳入的同一 Web SPA（`WebViewAssetLoader` HTTPS origin），不另写一套 DaemonClient，也不依赖冷启动时仍能访问 LAN 落地页。
- Android 升级后一次性清除旧 HTTP `deviceToken`/`origin`；不保留 `LoginClient`、Bearer `/api/*`、`/__remote__/shell/*` 原生 Chat 死路径。
- Android 原生层只保存内置 SPA 已启用标记，不保存 offer；`deviceSecret` 由 SPA 保存在稳定 WebView asset origin 的 localStorage，直到桌面撤销或 SPA 断开设备。
- ChisaCode 会话创建、Git 与文件不得回退到 `callUnary` / `callShell`；daemon 返回的结构化错误必须进入可见 banner/toast。
- 权限模式唯一来源是 agent snapshot；UI 不得持有本地假 mode 状态，`setAgentMode` 失败必须回滚并显示 daemon 错误。
- 新会话必须经 workspace/provider chooser 显式选择；不得复用“第一条 agent”的 `provider/cwd` 猜测目标。
- 重连（`subscribeConnectionStatus` 回到 connected）后必须权威重同步（`fetchAgents` + 当前 timeline）；断线时发送必须被可见拒绝，不得假装在线；未发送草稿不得丢失。
- 普通分支创建和打开电脑设置/图库没有 daemon RPC：控件必须禁用并写明电脑端操作，不得抛旧 Host RPC 错误或伪报成功。
- 删除/归档不得乐观移除：只有 daemon 确认后行才离开列表，失败必须在确认对话框里可见。
- 「取消归档」= `refreshAgent`（清 archivedAt + 重载会话），**不是** dsh unarchive 也不是 `resumeAgent(handle)`；UI 不得写成「恢复」或暗示恢复运行状态。
- 审批 UI 不得改写 daemon `actions`（label/variant/顺序原样，回传 `selectedActionId`）；通用允许/拒绝仅在 actions 为空时出现。
- 助手 Markdown 渲染禁止 `innerHTML` 注入路径：结构化 block/span → createElement/textContent，链接 href 仅 http/https；未知时间线类型必须有可见 fallback，不得静默丢行。
- 时间线向上分页必须按 seq 去重并保持滚动锚点；`.phone` 保持固定 app-shell 高度（内部面板各自滚动），否则时间线锚定失效。
- 打开会话的 timeline 拉取失败必须清掉上一会话的 rows 并显示错误占位（daemon 原文 + 重试）；不得把旧会话内容留在新会话标题下。流事件到达时只有视口已贴底（小阈值松弛）才允许滚到底部，用户在读历史时必须保持 scrollTop。
- 「已保存的电脑」chooser 是纯本地状态（localStorage sticky 记录），不引入任何设备管理 RPC；「忘记」只清本机 secret，不得暗示桌面端撤销；无 hash 自动重连仍指向最近一台。
- 文件与 Diff 是**只读工作环**：不得出现保存/写入/Stage/Unstage/Discard/暂存/放弃类控件，不得调用 `writeFile`/`saveFile` 或任何 stage RPC；目录行点击必须是导航，插入 @路径 只能是显式用户动作。
- 文件搜索只做路径匹配（`getDirectorySuggestions`），UI 必须明示不是内容全文搜索；不得借 terminal/agent 模拟内容搜索。
- 预览大小上限：目录条目 `size > 2MB` 不发起 `readFile`；文本渲染 >200KB 截断并明示；图片 blob URL 离开预览时 revoke；非 git 判别用 `CheckoutError.code`，不匹配 message 字符串。
- MCP / Skills 本阶段纯只读：不得调用 upsert/patch/install/uninstall/delete 类扩展 RPC；空清单是合法状态不是错误；payload 级 errors 必须可见。
- **非 secure context 兼容**：配对页真实运行在 `http://<LAN-IP>:3180`（非 secure context）——`mobile/web/` 与 vendored client 浏览器路径**禁止**裸用 secure-context-only API（`crypto.randomUUID`、`crypto.subtle` 等）；uuid 一律走 `getRandomValues` fallback（`session.js#randomIdHex` / vendor `safeRandomId()`），E2EE 保持 tweetnacl 纯 JS。`session.test.js` 锁无 `randomUUID` 环境配对；`tools/remote-web-qa/run-e2e.mjs` 在真浏览器（LAN-IP origin）全链路验证。
- 设计语言仍抄 `--dsw-alias-*`。

## Allowed touch

- `mobile/web/`（含 `chisacode/`、`conversation/`）、`scripts/bundle-chisacode-mobile-client.mjs`、`scripts/prepare-chisacode-remote.mjs`
- `src/main/chisacode-remote.js`、`src/main/mobile-web-server.js`、`src/shared/lan.js`
- `vendor/chisacode-remote/`、`ui-settings-remote`、本卡、QA 远程条
- `tools/mobile-web-qa/`（fake-daemon 浏览器集成 harness，不打包）
- `tools/remote-web-qa/`（真 daemon + 真浏览器全链路 E2E harness，不打包）
- `mobile/android/`（扫码 handoff）

## Do not touch

- 恢复 HTTP Bearer Host SPA 为主路径
- 指着 `app.chisacode.sh` / `relay.chisacode.sh` 冒充完成
- 把中继 IP 当作 QR `appBaseUrl`

## Gates

| Kind | What |
| --- | --- |
| Automated | `mobile/web/**/*.test.js`（含 `chisacode/{session,parity,controller,directory,timeline,approvals,commands,files,diff,extensions}.test.js`、`conversation/{fold,markdown}.test.js`、`pair/scan.test.js`、`landing.test.js` 入口分流 + Android manifest VIEW/:3180/无 autoVerify tripwire）；Android JVM tests（`:protocol:test` 含 `PairingIntentTest`；`:app:testDebugUnitTest` 含 VIEW handoff）；`src/shared/lan.test.js`；`chisacode-remote.test.js` |
| Browser | `node tools/mobile-web-qa/run-qa.mjs`（fake DaemonClient + 真实 SPA 栈；需 `puppeteer-core` 与 Chrome；48 检查）；`node tools/remote-web-qa/run-e2e.mjs --relay <endpoint>`（真 daemon + 真 offer + **pairingUrl host 非 loopback** + 真浏览器 E2EE；含垃圾 offer / stopDaemon）；`npm run qa:remote`（含 `cold.openShowsQr` / `cold.noBareOfferText` / `cold.copyAndRotateControls`） |
| Manual | 真机系统相机扫码 → 选择器（App＝链接设备 / 浏览器＝web 端），冷/热启动都能配对且不堆叠 Activity，垃圾 `:3180` 链接不踢 Web 会话（BLOCKED：无真机）→ 中继已连接 → 扫码配对 → chooser 新建会话（多 workspace，含模型步）→ 切换权限模式/模型 → 会话重命名/归档/历史/删除 → >100 会话分页 + >200 时间线向上分页（阅读中流事件不拉底）→ 审批 actions → Git → 文件下钻/预览/搜索/插入 → Diff 两 scope → MCP/技能清单 → 断网重连 resync + 草稿保留 → sticky 重连 → 多台已保存电脑点选/忘记 → 解除 |

## Sources

- Vendored ChisaCode client/app pairing runtime
- Kill list：[_kill-http-remote](_kill-http-remote.md)
- Gap analysis：[2026-08-27-mobile-web-desktop-gap-analysis](../superpowers/plans/2026-08-27-mobile-web-desktop-gap-analysis.md)
- Phase 0 执行：[2026-08-27-mobile-web-phase0-execution](../superpowers/plans/2026-08-27-mobile-web-phase0-execution.md)
- Phase 1 执行：[2026-08-27-mobile-web-phase1-execution](../superpowers/plans/2026-08-27-mobile-web-phase1-execution.md)
- Phase 2 执行：[2026-08-27-mobile-web-phase2-execution](../superpowers/plans/2026-08-27-mobile-web-phase2-execution.md)
