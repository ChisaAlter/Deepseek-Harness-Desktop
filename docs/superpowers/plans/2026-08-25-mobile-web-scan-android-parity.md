# 手机 Web 端扫码 + 与 Android 对齐 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. **Do not commit** unless the user asks.
>
> **Touching: mobile-remote**（Feature 卡：[docs/features/mobile-remote.md](../../features/mobile-remote.md)）。本计划只规划，不改产品代码；实施时先按 M0 更新 Feature 卡再动行为。

**Goal:** `mobile/web` SPA 升级到与 `mobile/android`（Kotlin Compose）**同一套页面与操作**：应用内扫码（BarcodeDetector + getUserMedia，粘贴链接兜底）、图片附件、停止运行、设置分组钻取、工作区 Git 胶囊与底部操作 sheet、文件搜索插入。配对协议、Host 线协议、shell 白名单**零改动**——差距全部在 Web 客户端侧补齐。

**Architecture:** 桌面网关 `src/main/remote.js` / `remote-shell.js` 不动（Android 已把 JSON 登录、`/__remote__/shell/*` 白名单、`rewriteProxyHeaders` 剥 auth 都做好了，Web 走同一 origin 的 cookie 通道即可复用）。`mobile/web` 内新增与 Android `:protocol` 一一镜像的纯 ESM 模块（shell 客户端、GitQuick、VcsStatus 解析、扫码），UI 仍是零依赖 vanilla DOM + `tokens.css`，不挂官方插件树，不 import `../../src/`。

**Tech Stack:** 原生 `BarcodeDetector` + `getUserMedia`（特性检测，缺失即粘贴兜底）、`fetch` + Cookie `dsh_remote`、`node:test`（`mobile/web/**/*.test.js` 已进 `npm test` glob）、`localStorage`（手机外观持久化）。

**Spec 依据:** [2026-08-20-mobile-web-client-design.md](../specs/2026-08-20-mobile-web-client-design.md)（Web v1）、[2026-08-23-mobile-android-client-design.md](../specs/2026-08-23-mobile-android-client-design.md)（Android，本轮对齐基准）、mock `2026-08-23-android-phone.html`。

---

## 0. 现状核对（2026-08-25 只读调研）

- **开关停放：** `src/main/config.js` `REMOTE_FEATURE_ENABLED = false`（`src/preload/index.js` 同步 false，`shell-api.test.js` 断言两处一致；`config.test.js` 断言「remote feature is parked and cannot be enabled」）。QA 表 TC-REM-001…003 = N/A，TC-NEG-001（默认不监听）= P0 Pass。
- **文档矛盾：** Feature 卡 `docs/features/mobile-remote.md` 写 `status: active`，而 `docs/features/README.md` 索引行写「停放：侧栏远程入口隐藏；网关不监听」，QA 表也按停放执行。实施 M0 必须先把卡改成 `parked`（或由产品决定重新激活），消除卡/索引/QA 三方不一致。
- **网关（能力已就绪，Web 未用）：** 表单+JSON 双登录、设备令牌（cookie / Bearer）、`/__remote__/shell/<name>` 15 项白名单（git 10 项 + `listDir` / `openSettings` / `openGallery` / `getConfig` / `saveConfig`）、`/__remote__/logout`、`unbindDevice`（桌面 IPC 侧）。shell 请求体上限 262144 字节；图片走 `/api/session.prompt` 反代不受此限。
- **Android 客户端（对齐基准）：** `MainActivity` + `DshViewModel`（582 行状态机）+ `DshScreens.kt`（1638 行 Compose）+ `ScanScreen.kt`（CameraX + MLKit + 手电筒）+ `:protocol`（Offer/Login/Rpc/Handshake/Frames/Prompt/Fold/Live/Title/GitQuick/VcsParse/RemoteShell）。
- **Web SPA（v1 范围）：** 连接（hash 自动登录 + 粘贴）、对话（文本气泡 + 工具行）、审批 composer takeover、抽屉（搜索/新会话/会话行/设置）、平铺设置 tabs + `settings.describe` 只读行、内存态外观。**没有** shell 客户端模块、没有扫码、没有图片、没有 Git/文件、没有断开设备。

## 1. 差异矩阵（逐项）

图例：✅ 已对齐 · 🔴 Web 缺 · 🟡 Android 缺 · ⚪ 有意差异（保留）

### 1.1 配对与连接

| # | 项 | Android | Web | 判定 |
|---|---|---|---|---|
| C1 | `#offer=` v1 编解码（hash / 粘贴 / URL） | `pair/Offer.kt` | `host/offer.js` | ✅ 字段与容错完全一致 |
| C2 | 登录通道 | JSON `POST /__remote__/login` → Bearer 设备令牌（Keystore） | 表单/JSON → Cookie `dsh_remote` | ⚪ 有意差异：同一网关双通道，保持 |
| C3 | 连接页（说明 + 等待配对点 + 错误行 + 粘贴兜底） | `ConnectScreen` | `#screen-connect` | ✅ 布局与文案基本一致 |
| C4 | **「扫描二维码」主按钮** | `ConnectScreen` → `requestScan()` | 无（只有「进入会话」读当前 hash） | 🔴 |
| C5 | **应用内扫码屏**（取景框四角、提示、取消） | `ScanScreen.kt`（CameraX+MLKit） | 无 | 🔴 |
| C6 | 手电筒 | `enableTorch` | 无 | 🔴（Web 上 `MediaStreamTrack` torch 仅部分安卓 Chrome 支持，做成能力探测可选项） |
| C7 | **相机权限说明屏**（去系统设置 / 改用粘贴） | `PermissionScreen` | 无 | 🔴（Web 版为「浏览器权限被拒」说明 + 粘贴兜底，无法拉起系统设置） |
| C8 | 扫到异 origin 的处理 | `originOf()` 换 origin 重新 login | 无 | 🔴（Web：同 origin 直接 `loginWithOffer`；异 origin `location.replace(扫到的 URL)`，token 留 hash） |
| C9 | 令牌持久化 / 断线恢复（`resume()`） | EncryptedSharedPreferences + 启动自动握手 | Cookie 由浏览器持久化，刷新后需点「进入会话」；无自动握手 | 🔴（加：加载时若无 `#offer=` 先试探性握手，401 落回连接页） |
| C10 | 登录失效（401）回连接页并清态 | `UnauthorizedException` → unbind | 仅报错文本 | 🔴 |

### 1.2 对话页

| # | 项 | Android | Web | 判定 |
|---|---|---|---|---|
| T1 | unary 信封 / rpcId 回显 / `session.*` 方法 | `Rpc.kt` | `host/rpc.js` | ✅ |
| T2 | 握手顺序（describe → list → WS） | `Handshake.kt` | `host/handshake.js` | ✅ |
| T3 | WS `events.mux` / `events.host` + fold/live/title | `Fold/Live/Title/Frames` | `conversation/` + `host/frames.js` | ✅ |
| T4 | 审批 composer takeover（允许一次 / 拒绝） | `ComposerBar` pending 分支 | `#approval` | ✅ |
| T5 | 顶栏：标题 + 主机名 + **Git 胶囊**（`refName · ahead`，点开工作区）+ 运行中 | `ChatScreen` 顶栏 | 只有标题 + 固定副标 + 运行中 | 🔴（胶囊受「标题栏 Git 操作」开关控制） |
| T6 | 错误 banner（可与 error 区分） | `vm.banner` | 复用 connect error，对话页无 banner | 🔴 |
| T7 | **图片附件**：加号 → 附件 sheet（拍照/相册/工作区选文件） | `AttachSheet` + camera/gallery launcher | 无 | 🔴（Web 用 `<input type="file" accept="image/*" capture="environment">` 与不带 capture 两个入口对应拍照/相册） |
| T8 | 附件缩略图 rail + 删除 + lightbox 预览 | `ComposerBar` + lightbox overlay | 无 | 🔴 |
| T9 | 发送含 image block（png/jpeg/webp/gif → base64） | `Prompt.kt` | `sendPrompt` 只发 text | 🔴 |
| T10 | 气泡内图片渲染（用户消息图片、单图 180 / 多图 64） | `MessageBubble` | 无 | 🔴 |
| T11 | **停止运行**（运行中发送键变 Stop → `session.cancel`） | `cancelRun()` | 无 | 🔴 |
| T12 | 发送键空态禁用（无文本且无附件） | `canSend` alpha 0.45 | 无 | 🔴 |
| T13 | Composer 权限芯片（只读/完全访问）+ 模型芯片（跳设置 pane） | `ModeChip` ×2 | 无 | 🔴 |
| T14 | Markdown 渲染 | 无（纯文本） | 无 | ✅ 两端一致（都不做，非本轮目标） |

### 1.3 抽屉与会话

| # | 项 | Android | Web | 判定 |
|---|---|---|---|---|
| D1 | 搜索 / 新会话 / 会话行（标题、运行中）/ 遮罩关闭 | `Drawer` | `#drawer` | ✅ |
| D2 | 抽屉显示主机名行 | `vm.hostName` | `#workspace-line` | ✅ |
| D3 | 抽屉底栏 **工作区** 入口 | `DrawerFoot(Branch, "工作区")` | 只有「设置」 | 🔴 |
| D4 | 新会话后清空事件与审批 | `newSession()` | `createSession()` | ✅ |

### 1.4 设置

| # | 项 | Android | Web | 判定 |
|---|---|---|---|---|
| S1 | 信息架构：**分组钻取 Hub**（这次连接 / 对话 / 工作区 / 这台手机 / 电脑与界面 / Host / 关于）+ 返回键 | `SettingsHub` + `settingsPane` | 平铺横向 tabs（通用设置…关于） | 🔴（Web 改为 Hub 钻取，废弃平铺 tabs） |
| S2 | 「远程更改只留本次连接」notice | `Notice` | notice | ✅ 文案对齐即可 |
| S3 | 连接详情（主机 / 通道 LAN vs HTTPS 中继） | `ConnectDetail` | 无 | 🔴 |
| S4 | **断开这台设备**（危险行） | `unbind()` 清本地 store | 无 | 🔴（Web：`GET /__remote__/logout` 清 cookie + 回连接页；服务端设备记录仍由桌面侧解绑，两端一致） |
| S5 | 手机外观：浅/深/**跟随系统** 三态 + 玻璃滑条 + 界面字体，**持久化** | `store.scheme/glass/uiFont` | 仅浅/深 + 滑条，内存态 | 🔴（Web 用 `localStorage`，跟随系统用 `matchMedia`） |
| S6 | 权限 pane（默认访问模式芯片） | `AccessPane` | 无 | 🔴 |
| S7 | 电脑外观（`openGallery` / `openSettings(appearance)` 请求） | `HostAppearance` | 无 | 🔴 |
| S8 | 界面设置（标题栏 Git 开关 + `openSettings` 请求） | `HostChrome` | 无 | 🔴 |
| S9 | Host 分区（MCP/技能/插件/市场 →「在电脑上打开」，不画假清单） | `HostRequestPane` | 渲染 `settings.describe` 命名空间只读行 | ⚪→🔴 有意演进：Android IA 是新基准，Web 改为请求打开；`settings.describe` 只读行下线（v1 遗留） |
| S10 | 桌面专用行不出现（关闭窗口时 / 自动恢复 / 打开配置文件） | 天然没有 | `DESKTOP_ONLY_ROWS` 过滤 | ✅ 语义保留 |

### 1.5 工作区 / Git / 文件

| # | 项 | Android | Web | 判定 |
|---|---|---|---|---|
| G1 | shell 客户端（`POST /__remote__/shell/<name>`） | `RemoteShell.kt` | **完全没有** | 🔴（新建 `mobile/web/shell/remote-shell.js`，cookie 通道） |
| G2 | `VcsStatus` / 分支列表 JSON 解析 | `VcsParse.kt` | 无 | 🔴 |
| G3 | GitQuick 主操作解析（英文标签 Commit / Commit & push / Pull / Push & create PR / Publish repository / View PR / Sync branch） | `GitQuick.kt` | 无 | 🔴（逐行移植 + 同表测试；action 标签保持英文） |
| G4 | 工作区 pane：32px 分段 Git 胶囊（分支/主操作/菜单）+ 更改/文件 tabs | `WorkspacePane` + `GitCapsule` | 无 | 🔴 |
| G5 | Git 底部操作 sheet（Fetch / Pull / Commit / Push / Create·View PR，含禁用 hint） | `GitLayers` menu | 无 | 🔴 |
| G6 | 分支 sheet（搜索 / 远程标记 / 当前禁用 / 创建并检出） | `GitLayers` branch | 无 | 🔴 |
| G7 | 提交对话框（分支行 + 默认分支警告 + 可选 message + 「在新建分支上提交」） | `GitDialog "commit"` | 无 | 🔴 |
| G8 | 创建分支对话框 / 默认分支 push·PR 确认对话框 | `"create-branch"` / `"confirm"` | 无 | 🔴 |
| G9 | Git busy 态 + toast（成功✓ / 失败!，自动 2.4s 消隐） | `GitToast` | 无 | 🔴 |
| G10 | 文件 pane：`listDir` + 搜索 + 点击 `@path` 插入 composer | `FilesPane` + `insertMention` | 无 | 🔴 |
| G11 | 附件 sheet 第三项「从工作区选文件」跳文件 pane | `AttachSheet` | 无 | 🔴（随 T7 一起） |

### 1.6 Android 缺（Web 有）

| # | 项 | 判定 |
|---|---|---|
| A1 | `settings.describe` 命名空间只读行 | 🟡 但按 S9 决策：这是 Web v1 遗留，本轮从 Web 移除而不是补进 Android |
| A2 | 无其他 Web 独有能力 | — |

> 结论：协议层与对话主循环两端已对齐；差距集中在 Web 客户端 UI/交互层（扫码、附件、设置 IA、工作区 Git、文件），全部可以在 `mobile/web` 内闭环，不需要动网关白名单。

## 2. 「扫码」在 Web 端的实现路径

1. **QR 内容与配对协议不变。** 二维码永远是 `pairingUrl()` 产物：`http://<lan>:3180/#offer=<base64url>` 或 `https://<relay>/#offer=…`；token 只在 hash（`src/shared/lan.js`）。Web 扫码只是把「系统相机扫码打开 URL」这步搬进 SPA，不新增任何服务端接口。
2. **解码器：`BarcodeDetector`（特性检测）。** `'BarcodeDetector' in window && (await BarcodeDetector.getSupportedFormats()).includes('qr_code')`。Chrome/Edge/Android WebView 支持；iOS Safari / Firefox 不支持 → 隐藏扫码按钮，连接页只呈现粘贴兜底（与 Android 权限被拒路径同一 UX）。**不 vendor 第三方 JS 解码库**（`mobile/web` 保持零依赖；如产品后续要求 iOS Safari 应用内扫码，再单独立项评估 vendored 解码器）。
3. **取流：`getUserMedia({ video: { facingMode: 'environment' } })`，仅 secure context 可用。**
   - HTTPS 中继 origin：完整可用（这是主场景——扫码通常发生在还没连上时，用户先手动打开中继域名）。
   - LAN `http://192.168.x.x:3180`：**不是 secure context**，`navigator.mediaDevices` 为 `undefined` → 扫码按钮不渲染，粘贴兜底 + 文案说明「局域网明文页无法调用相机，请用系统相机扫码或粘贴链接」。这是平台硬约束，计划内不做 self-signed HTTPS（会引入证书信任噩梦，超出 Allowed touch）。
   - `localhost` 调试例外天然可用。
4. **权限：** `getUserMedia` 拒绝（`NotAllowedError`）→ 权限说明屏（对应 Android `PermissionScreen`）：说明浏览器权限被拒、指引到站点设置、按钮「改用粘贴链接」。Web 无法像 Android 那样拉起系统设置，文案如实。
5. **扫描循环：** `requestAnimationFrame`（或 500ms `setInterval`）对 `<video>` 帧跑 `detector.detect(video)`；命中第一个 QR 后停流（`track.stop()`）。取景框四角用 canvas/CSS 复刻 `ScanScreen` 的角标样式。手电筒：`track.getCapabilities().torch` 为 true 时渲染「手电筒」按钮（`applyConstraints({ advanced: [{ torch }] })`），否则不渲染——不做假按钮。
6. **扫描结果分派**（新模块 `mobile/web/pair/scan.js`，纯函数可测）：
   - 解析出 offer（复用 `offerFromPaste`）失败 → 提示「二维码里没有配对密钥」继续扫。
   - offer 有效且扫到的 URL origin === `location.origin` → 直接 `loginWithOffer` → `connect()`。
   - origin 不同（例如用户在中继页扫了 LAN 码，或反之）→ `location.replace(扫到的完整 URL)`，token 留在 hash 由目标页自动登录。禁止把 token 挪进 query 或用 `fetch` 跨 origin 登录（CORS + token 泄漏面）。
7. **回归保护：** `#offer=` 直开自动登录、粘贴登录、`loginPage()` 表单三条既有路径不动。

## 3. 目标与非目标

**目标**

1. Web SPA 页面清单与 Android 一一对应：连接（含扫码按钮）、扫码屏、权限说明屏、对话（附件/停止/胶囊/banner）、抽屉（+工作区）、附件 sheet、设置 Hub 钻取（含连接详情/断开/权限/电脑外观/界面设置/Host 请求）、工作区 pane（Git 胶囊 + 更改/文件）、Git sheets/对话框/toast、文件 pane、lightbox。
2. 协议共享面镜像 Android `:protocol`：shell 客户端、VcsParse、GitQuick、prompt image block，全部带 `node:test`。
3. 扫码按 §2 路径实现，含 HTTPS/secure-context 与 BarcodeDetector 特性检测的如实降级。

**非目标（本计划不做）**

- 翻转 `REMOTE_FEATURE_ENABLED`、恢复 TC-REM P0、发版解禁——那是独立的产品停放决策（见 §7）。
- 改配对协议、offer 版本、shell 白名单、`rewriteProxyHeaders`、中继。
- Markdown 渲染（两端都没有，另立项）。
- iOS Safari 应用内扫码的 vendored 解码器；WebView 套壳；PWA/Service Worker。
- 给手机暴露 PTY / Browser / `writeFile`；Appearance 图源 CRUD。
- 动 Android 端（A1 的 `settings.describe` 行不反向移植）。

## 4. 信息架构 / 页面清单（Web ⇄ Android 对照）

| Web 屏/层 | Android 对应 | 备注 |
|---|---|---|
| `screen-connect`（+「扫描二维码」主按钮、错误行、粘贴） | `ConnectScreen` | 无相机能力时按钮不渲染 |
| `screen-scan`（video + 角标取景框 + 取消 + 条件手电筒） | `ScanScreen` | 新增 |
| `screen-permission`（权限被拒说明 + 改用粘贴） | `PermissionScreen` | 新增 |
| `screen-chat`（顶栏胶囊/运行中、banner、气泡含图、composer：附件 rail + 加号 + 权限/模型芯片 + 发送/停止） | `ChatScreen` + `ComposerBar` | 扩展 |
| drawer（搜索/新会话/主机名/会话行/**工作区**/设置） | `Drawer` | 补工作区脚 |
| attach sheet（拍照 capture / 相册 / 从工作区选文件） | `AttachSheet` | 新增 |
| settings overlay：Hub 分组钻取 + 返回 | `SettingsOverlay` + `SettingsHub` | 重构（废平铺 tabs） |
| panes：外观(持久化)/工作区/文件/电脑外观/界面设置/连接详情/权限/模型(Host 请求)/MCP·技能·插件·市场(Host 请求)/关于 | 同名 pane | 新增/重构 |
| git sheets（menu/branch）+ dialogs（commit/create-branch/confirm）+ toast | `GitLayers` + `GitToast` | 新增 |
| lightbox | lightbox overlay | 新增 |

## 5. 协议与共享逻辑（新模块，全部带测试 + import fence）

| 新文件 | 镜像自 | 职责 |
|---|---|---|
| `mobile/web/shell/remote-shell.js` | `shell/RemoteShell.kt` | `POST /__remote__/shell/<name>`，`credentials:'include'`，`{ok,result}/{ok:false,error}` 解包 |
| `mobile/web/git/vcs-parse.js` | `git/VcsParse.kt` | `VcsStatus` / 分支列表解析（`isRepo/refName/ahead/behind/isDefaultRef/pr…`） |
| `mobile/web/git/quick.js` | `git/GitQuick.kt` | GitQuickResolver 逐行移植；标签英文，与 Kotlin 测试同一用例表 |
| `mobile/web/host/prompt.js` | `host/Prompt.kt` | text/image block（png/jpeg/webp/gif 白名单 → base64）、`mode:'queue'` payload |
| `mobile/web/pair/scan.js` | `ScanScreen` 分派逻辑 | `classifyScan(raw, currentOrigin)` → `{kind:'login',offer}` / `{kind:'navigate',url}` / `{kind:'invalid'}`；detector/stream 注入可测 |
| `mobile/web/ui/settings-hub.js` | `SettingsHub` 分组表 | Hub 分组数据 + pane 路由纯函数（替换 `ui/chrome.js` 的 `SETTINGS_TABS`） |

不变式：`fence.test.js` 扩展覆盖新目录（禁 `../../src/`、`@deepseek-ai/dsh-client-`）；cwd 取自 `host.describe` 的 `host.cwd`（同 Android `resume()`）；shell 体 ≤ 256KiB（提交 message 等远小于此）。

## 6. 里程碑与任务拆解

### M0 — Feature Spine / 文档一致性（先行，不改行为）

- [x] `docs/features/mobile-remote.md`：`status` 改 `parked`（与 README 索引、QA N/A 一致），User paths 标注「停放期间入口隐藏」；Allowed touch 已含 `mobile/web/`，无需扩权
- [x] 卡内 Gates 增补本计划新增测试文件名；Sources 补本计划链接
- [x] `docs/handbook/modules/mobile-remote.md` 延伸阅读补本计划

### M1 — 协议层补齐（纯逻辑 + 测试，不动 UI）

- [x] `shell/remote-shell.js` + 测试（fetch 注入；401 抛 unauthorized；非 2xx/`ok:false` 归一错误）
- [x] `git/vcs-parse.js` + 测试（用 `src/main/git.js` 真实输出形状做夹具，与 `VcsParse.kt` 用例同表）
- [x] `git/quick.js` + 测试（与 `GitQuickShellTest.kt` 同一决策表：busy/无分支/有改动×PR/upstream/diverged/behind/ahead/clean）
- [x] `host/prompt.js` + 测试（image 类型白名单、base64、`mode:'queue'`）
- [x] `fence.test.js` 扩展到新目录

### M2 — 扫码（本需求核心）

- [x] `pair/scan.js` + 测试：offer 解析复用、同/异 origin 分派、无效码
- [x] 连接页「扫描二维码」按钮：`isSecureContext && mediaDevices && BarcodeDetector(qr_code)` 三重探测，任一缺失不渲染并给出对应文案（LAN 明文 / 浏览器不支持）
- [x] 扫码屏：getUserMedia 后置摄像头、rAF 检测循环、命中即停流、角标取景框、取消；`NotAllowedError` → 权限说明屏
- [x] 手电筒按钮（`track.getCapabilities().torch` 才渲染）
- [x] 权限说明屏（指引站点设置 + 「改用粘贴链接」）
- [x] 加载时无 `#offer=` 先试探握手（cookie 复用），401 静默落回连接页（C9/C10）

### M3 — 对话增强

- [x] 附件 sheet + 两个 file input（capture / 相册）+ 「从工作区选文件」跳文件 pane
- [x] 附件 rail（缩略图、删除、点开 lightbox）+ lightbox overlay
- [x] `sendPrompt` 走 `host/prompt.js`，text+images；发送键空态禁用
- [x] 气泡图片渲染（单图 180 / 多图 64，base64 `data:` URL）
- [x] 运行中：发送键变 Stop → `session.cancel`；顶栏「运行中」保持
- [x] 对话页 banner（与 connect error 分离）
- [x] composer 权限芯片 + 模型芯片（跳对应设置 pane）

### M4 — 设置 IA 重构

- [x] Hub 分组钻取（`ui/settings-hub.js` 驱动）+ pane 返回键；移除平铺 tabs 与 `settings.describe` 只读行（S9 决策）
- [x] 连接详情（主机 / 通道 label 复用 Android `channelLabel` 逻辑）+ 「断开这台设备」→ `/__remote__/logout` + 清态回连接页
- [x] 手机外观：浅/深/跟随系统（`matchMedia('(prefers-color-scheme: dark)')`）+ 玻璃 + 字体，`localStorage` 持久化
- [x] 权限 pane（accessMode 芯片，会话内存态，同 Android）
- [x] 电脑外观（`openGallery`/`openSettings(appearance)`）、界面设置（gitTitle 开关本地持久化 + `openSettings`）、MCP/技能/插件/市场/模型 =「在电脑上打开」请求，不画假清单

### M5 — 工作区 + Git + 文件

- [x] 抽屉底栏「工作区」入口；顶栏 Git 胶囊（gitTitle 开）
- [x] 工作区 pane：32px 分段 Git 胶囊（分支 sheet / GitQuick 主操作 / 菜单 sheet）+ 更改/文件 tabs + 状态行（`gitStatusLine` 移植）
- [x] Git menu sheet（Fetch/Pull/Commit/Push/PR，禁用条件与 hint 照抄 Android）
- [x] 分支 sheet（搜索/远程标记/创建并检出）
- [x] commit / create-branch / 默认分支 confirm 三个对话框（含默认分支警告与「在新建分支上提交」）
- [x] Git busy + toast（✓/!、2.4s 自动消隐）
- [x] 文件 pane（`listDir` + 搜索 + `@path` 插入 composer 并关 overlay）

### M6 — 收尾与门禁

- [x] `npm test` 全绿（`src/**` + `mobile/web/**`，922/922）；`node --test src/main/remote.test.js src/main/remote-shell.test.js` 回归 29/29
- [x] `mobile/README.md` Web 段补扫码路径与降级说明；`docs/design-language.md` 手机例外段无需扩（仍是抄 token）
- [x] Feature 卡 `last verified` + Gates 更新；`docs/qa/production-acceptance-test-cases.md` TC-REM-002 步骤扩写（扫码/附件/Git），**保持 N/A 停放标记**
- [ ] 手工冒烟（本地 `RemoteGateway` 直连，不翻产品开关）：扫码→登录→列会话→发文本+图→审批→停止→Git commit 对话框→文件插入
  - 2026-08-25 已完成服务器契约冒烟（直接构造 `RemoteGateway` + 真 git/listDir：匿名 401 → 表单登录 cookie → 认证后返回含扫码/权限/附件/工作区节点的 SPA → `/api/*` 反代 → `gitStatus`/`listDir` → `writeFile` 404 → logout 后 401，8/8 通过）；浏览器内扫码→发图→审批→Git 对话框的真机走查留到解禁轮，按 TC-REM-002 扩写步骤执行
  - 2026-08-25 第二轮云端复盘：上一轮「`#offer=` 停在等待配对」定性为**测试侧错误**（网关 serve 的是 main 的 v1 SPA 而非本分支树；`#offer=` 编码未按 `src/shared/offer.js` base64url `v/token/mode/relay` 合谱时被静默吞）。本分支真链路在 `remote.test.js` 新增 e2e 钉死（encodeOffer → 登录页内联脚本解码 → 表单登录 → parity SPA 标记 `pair/scan.js`/settings-hub → SPA `offer.js`/`login.js` 模块 → `/api` 反代）；产品侧加固三处静默失败（登录页 `login-error` 文案、SPA `hashHasOffer` 区分「无效 offer」并报错、Cookie 试探仅 401 静默）

## 7. 与 Feature Spine / 开关停放的关系

- 本计划全部工作在 `mobile-remote` 卡的 **Allowed touch** 内（`mobile/web/`、卡与 handbook、QA 远程条）。不碰 `config.js` 开关、preload、`ui-settings-remote`。
- **停放不阻塞开发**：`mobile/web` 测试是纯 `node:test`；网关集成测试直接构造 `RemoteGateway`（`remote.test.js` 现有做法），与 `REMOTE_FEATURE_ENABLED` 无关；TC-NEG-001（默认不监听）不受影响。
- **解禁是独立决策**：若产品决定重新上架，才走 2026-08-20 计划遗留的翻转步骤（`REMOTE_FEATURE_ENABLED = true` 双处、`config.test.js`/`shell-api.test.js` 改断言、TC-REM-001…003 恢复 P0、卡回 `active`）。本计划交付后那次翻转的 QA 面就是「Web ≈ Android」的完整矩阵。
- M0 先修卡（`active` → `parked`）是 Feature Spine 规则要求的第一步，避免继续带着卡/索引/QA 三方矛盾开发。

## 8. 依赖与风险

| 风险 | 影响 | 缓解 |
|---|---|---|
| LAN `http://` 非 secure context，无相机 | LAN 场景应用内扫码不可用 | 如实降级：按钮不渲染 + 文案指引系统相机/粘贴；主扫码场景在 HTTPS 中继 |
| iOS Safari / Firefox 无 `BarcodeDetector` | 这些浏览器无应用内扫码 | 特性检测降级为粘贴；不 vendor 解码器（零依赖不变式）；需要时另立项 |
| 手电筒 torch 能力碎片化 | 按钮时有时无 | `getCapabilities().torch` 探测，不渲染假按钮 |
| 图片 base64 经 `/api/session.prompt` 反代，大图慢 | 弱网中继下发送卡顿 | 与 Android 同现状（Android 88% JPEG 压缩）；Web 端 canvas 压缩到同量级；shell 256KiB 限制不涉及此路径 |
| Cookie `SameSite=Lax; HttpOnly` | 同 origin fetch/WS 均带 cookie，无影响；但异 origin 扫码必须整页跳转 | §2.6 已按 `location.replace` 设计 |
| `settings.describe` 行下线属可见回退 | 有用户可能依赖该只读清单 | 停放期间无真实用户；在卡的 User paths 中记录 IA 变更 |
| GitQuick/VcsParse 双端漂移 | 同一状态两端主操作不一致 | 决策表用例两端同表维护（M1 测试注明对应 Kotlin 用例名） |
| `app.js` 单文件膨胀（现 408 行 → 预计 3×） | 可维护性 | 逻辑全部下沉到可测模块，`app.js` 只做接线；不引框架 |

## 9. 验收标准

1. **差异矩阵清零**：§1 所有 🔴 项在 Web 复现（C6 手电筒与扫码按钮按能力探测呈现视为达标）；⚪ 项保持不变；A1 从 Web 移除。
2. **扫码**：Android Chrome + HTTPS 中继下，SPA 内点「扫描二维码」→ 扫桌面二维码 → 自动登录进对话；LAN 明文页正确降级；权限拒绝出说明屏；异 origin 码整页跳转后自动登录。
3. **操作一致**：同一 Host 状态下，Web 与 Android 的 GitQuick 主按钮标签、Git sheet 禁用项与 hint、审批、附件、停止行为一致（人工对照真机走查一轮）。
4. **门禁**：`npm test` 全绿；fence 测试覆盖新目录；`node --test src/main/remote.test.js src/main/remote-shell.test.js` 无回归；TC-NEG-001 语义不变（开关仍 false、默认不监听）。
5. **文档**：Feature 卡 status/gates/last-verified 与 README 索引、QA 表三方一致；`mobile/README.md` 更新。

## 10. 任务映射（差异项 → 里程碑）

| 差异项 | 里程碑 |
|---|---|
| C4–C10 扫码/权限/恢复 | M2 |
| T5–T13 对话增强 | M3（T5 胶囊在 M5 接真数据） |
| D3 抽屉工作区 | M5 |
| S1–S9 设置 IA | M4 |
| G1–G11 工作区/Git/文件 | M1（逻辑）+ M5（UI） |
| A1 下线 | M4 |
| 卡/QA/文档 | M0 + M6 |
