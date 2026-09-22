# 手机 Android 客户端

手机是电脑上 Harness Host 的伴侣，不是另一套带自己 API Key 的 Agent。系统相机扫桌面「远程」弹窗里的**同一条**二维码；Android 安装包用 Kotlin Jetpack Compose 原生页消化 `#offer=`，不是官方四栏 `dsh web`，不是 Electron `src/renderer` 的套皮，也不是用 WebView 加载 `docs/superpowers/mocks/2026-08-23-android-phone.html`。

本规格覆盖 **Android v1**。iOS、Expo/RN 客户端不在范围。浏览器 SPA（`mobile/web/`）本规格不重画：同一 QR；Web 继续 cookie 登录。

视觉以已锁定的稿为准：`docs/superpowers/mocks/2026-08-23-android-phone.html`。不要把 Markdown 链接丢给用户当预览；本地预览用：

`http://127.0.0.1:8770/2026-08-23-android-phone.html`（从 `docs/superpowers/mocks` 起 HTTP，避开 8765/8766）

## 目标

扫码（或粘贴配对 URL）后，Android 应用能连上本机 Host：列会话、看对话、发文本与图片、处理审批、改**这台手机**的外观、请电脑打开设置/图库、在工作区顶栏对桌面 Git IPC 做 Commit / Push / Pull / 切分支。桌面远程弹窗、局域网 / 中继开关、`#offer=` 配对继续用现有实现。

## 非目标（本规格不做）

- 复用 `src/main` / `src/renderer` / `src/preload` 的 UI 代码
- 用 WebView 套官方 `dsh web` 插件树，或套本 HTML 原型
- `import` `@deepseek-ai/dsh-client-*`、Cordis slot、CSS Modules `ui-primitives`
- iOS；把 `mobile/App.js` 做成可用 Expo 客户端（冻结为「请用原生包 / 浏览器」）
- 斜杠命令 UI；手机里假「浏览图库」网格
- 把 Browser / 终端 / PTY / `writeFile` 搬进手机
- 改官方 `~/.dsh`；桌面 `$DSH_HOME` 仍只是 `userData/dsh-home`
- 框外审查芯片（模拟扫码/故障）进入安装包
- 把 token 放进 query 作为产品路径

## 代码位置

| 路径 | 职责 |
|---|---|
| `mobile/android/` | Gradle 应用：`applicationId` `ai.deepseek.harness.mobile`，包名同路径。Compose 画面、CameraX、Keystore、Host 客户端、Git/文件远程调用 |
| `src/main/remote.js` | JSON 登录；`rewriteProxyHeaders` 去掉 `cookie` / `authorization`；白名单 `POST /__remote__/shell/<name>` |
| `src/main/remote-shell.js` | 壳名 → 已有 git / `listDir` / `openSettings` 映射；禁止 PTY / `writeFile` / Browser preview |
| `src/main/index.js` | 构造 `RemoteGateway` 时注入 `invokeShell` |
| `src/main/remote.test.js` | JSON 登录、错误体、剥头、未登录 401、非白名单 404 |
| `mobile/App.js` | 冻结 stub：请用原生包或浏览器；不删 Expo 目录 |
| `mobile/web/` | 本规格不改画面；同一 `#offer=`；cookie 登录保留 |

运行时网关仍听 3180 / 中继。Android 只打网关，不直连 `127.0.0.1:3080`。

## 配对与可达

- 二维码仍是 `pairingUrl()`：中继 `https://<relay>/#offer=...`，局域网 `http://<lan>:3180/#offer=...`。token **只在 hash**。
- CameraX 扫码解析 `#offer=`（及完整 URL 的 hash）。拒绝相机权限走稿里的系统设置说明 + 粘贴链接。
- Android 登录：`POST /__remote__/login`，`Content-Type: application/json`，`Accept: application/json`，体 `{ "token": "<pairing>" }`。
  - 成功：`200` `{ "ok": true, "deviceToken": "<device>" }`。仍可 `Set-Cookie` 以便 Web 并存。
  - 失败：`401` `{ "ok": false, "error": "配对密钥无效" }`，不要 HTML 登录页。
- form + 302 路径保留给浏览器。
- Kotlin 之后用 `Authorization: Bearer <deviceToken>`。设备令牌进 EncryptedSharedPreferences / Keystore，不进 log、不进 query。
- `dsh web` 仍只听 `127.0.0.1:3080`。手机只打 3180 / 中继。
- 中继只允许 `normalizeRelayOrigin` 后的 HTTPS。流量经过中继运营方；HTTPS 是跳加密，不是会话内容 E2E。v1 接受。

## 代理安全

`rewriteProxyHeaders`（HTTP 与 WS upgrade）删除 `cookie`、`authorization`，避免设备令牌进 loopback harness。继续改写 `Host` / `Origin` / `Referer`，去掉 hop-by-hop 与 `sec-fetch-*`。

## Host 协议（Kotlin 再写一份，与 Web 同线）

对照：`mobile/web/host/`、`vendor/deepseek-harness/packages/host/apiproxy/src/fetch/client.ts`。

Unary：

- `POST /api/<method>`，`Content-Type: application/json`
- 体：`{ type: "client-request", rpcId, method, payload }`
- `rpcId` 必须回显。用安全随机铸 UUID（不要依赖 `randomUUID` 在非 secure context 的语义）
- 非 2xx 当传输失败。业务失败在 `result.ok === false`
- 请求带 `Authorization: Bearer <deviceToken>`

v1 方法（点号名为线上真名）：

1. `host.describe` `{}`
2. `session.list` `{}` 与 `workspace.list` `{}`（可并行）
3. 再连 WS（禁止在 unary 完成前占槽；禁止 SSE）
4. `session.create`、`session.history`、`session.prompt`（`mode: "queue"`）、`session.cancel`
5. 审批：`POST /api/respond`，`{ type: "client-response", rpcId, result: { ok: true, value: { sessionId, approvalId, outcome } } }`，`outcome` 为 `allowed-once` 或 `rejected`

`session.prompt` 的 `content` 为块数组：

- `{ type: "text", text }`
- `{ type: "image", mediaType, data }` — `data` 为无 data-URL 前缀的 base64；`mediaType` 仅 `image/png`、`image/jpeg`、`image/webp`、`image/gif`（与 `ui-conversation` encodeImage 同线）

下行：OkHttp WebSocket `/api/events.mux` 与 `/api/events.host`（`ws:` / `wss:`）。帧是 `server-request` JSON 文本，`payload` 为 mux/host frame。握手失败、401：回到连接页并说明原因，不要转圈死锁。

对话折叠沿用 [2026-08-20 Web 规格](2026-08-20-mobile-web-client-design.md) 的事件表；用户气泡额外收图块。

## Shell 白名单

已登录后 `POST /__remote__/shell/<name>`，JSON 体。只映射 preload 已有频道。Git / 文件 `cwd` 必须是 Host 报告的工作区根（走桌面 `workspace-authority`）。禁止 PTY、`writeFile`、`readFile`、Browser preview、`gitInit`、`gitPublishRepository`。

| name | 映射 | 体 |
|---|---|---|
| `gitStatus` | `gitStatus(cwd)` | `{ cwd }` |
| `gitFetchForStatus` | `gitFetchForStatus(cwd)` | `{ cwd }` |
| `gitDiff` | `gitDiff(cwd, options)` | `{ cwd, options? }` |
| `gitCommit` | `gitCommit(cwd, message, filePaths, undefined, options)` | `{ cwd, message, filePaths?, options? }` |
| `gitPush` | `gitPush(cwd)` | `{ cwd }` |
| `gitPull` | `gitPull(cwd)` | `{ cwd }` |
| `gitBranchList` | `gitBranchList(cwd)` | `{ cwd }` |
| `gitSwitchBranch` | `gitSwitchBranch(cwd, ref)` | `{ cwd, ref }` |
| `gitCreateBranch` | `gitCreateBranch(cwd, name)` | `{ cwd, name }` |
| `gitCreateChangeRequest` | `gitCreateChangeRequest(cwd, input)` | `{ cwd, input? }` |
| `listDir` | `listDir(cwd, relativePath)` | `{ cwd, relativePath? }` |
| `openSettings` | `openHarnessSettings(sectionId)` | `{ sectionId? }` |
| `openGallery` | 打开电脑外观设置（图库是 Appearance 内模态，无独立 IPC） | `{}` |
| `getConfig` | `publicConfig(loadConfig())` | `{}` |
| `saveConfig` | `saveConfig(normalizeRendererConfigPatch(patch))` | `{ patch }` |

成功：`200` `{ "ok": true, "result": <value> }`。失败：`400`/`500` `{ "ok": false, "error": "<message>" }`。未登录 `401`。未知 name `404`。v1 Git 进度用 unary 结果 + 手机 toast，不做 SSE。

`openGallery` 不得在手机画假网格。成功只表示电脑侧收到打开外观的请求；失败给 banner。电脑毛玻璃 / 壁纸 frost·pixelate 写在 Host `settings.yaml`，本规格不经远程伪造；滑条若 Host 无对应 shell 则只发 `openSettings('appearance')` 或 banner。Electron 可写项（关闭窗口时、Harness 自动恢复）走 `saveConfig`。

## 屏幕（对照稿）

390 逻辑宽、官方 `--dsw-alias-*` 抄进 Compose `DshTokens`，中文产品文案。没有 56px 桌面轨。深色只打在 Activity / `#phone` 等价物，不要 Material3 默认动态色或默认紫。Git **action 标签保持英文**（`Commit`、`Push`、`Pull`、`Commit & push` 等）。

安全区：稿 `--safe-top: 72px` / `--safe-bottom: 28px` 用 `WindowInsets`（statusBars + navigationBars + 稿内边距）对齐，刘海不盖顶栏。

1. **连接** — 配对说明、主机名/中继状态（有则显示）、粘贴 URL、「进入会话」。已有有效设备令牌可跳过登录直握手。
2. **相机权限** — 拒绝后说明去系统设置，并仍可粘贴链接。
3. **扫码** — CameraX 找 `#offer=`。
4. **对话** — 顶栏汉堡 + 标题 + 运行态 + 可选 Git 芯片（`标题栏 Git` 关则隐藏）；消息流；底栏胶囊输入 + info 蓝发送。汉堡打开抽屉：搜索、新会话、会话行、底栏 **工作区** 与 **设置**。汉堡在抽屉打开时隐藏。
5. **审批** — 接管输入区：等待审批 / 拒绝 / 允许一次。不要另开桌面式模态盖住整页。
6. **作曲器附件** — `+` → 拍照 / 从相册选择 / 从工作区选文件。图进缩略图轨与灯箱；发送时进 `session.prompt` 图块。工作区文件插入 `@path`。
7. **设置** — 全屏 overlay，分组钻取（不是 9 个横向页签）。组：这次连接、对话、工作区、这台手机 → 外观、电脑与界面 → 电脑外观 + 界面设置、Host（MCP/技能/插件/市场）、关于。外观只改手机（色制/主题/玻璃/字体），立刻写本机 DataStore。电脑项走 shell / Host 请求。顶部说明：远程更改只留在这次连接；标了「电脑」的项改 Host 窗口。
8. **工作区** — 顶部桌面胶囊（分支 \| 主按钮英文 \| ▾），32px 高、发丝边、圆角 18。更改 / 文件 Tab。Commit 审阅对话框、默认分支确认、toast。数据来自 `/__remote__/shell/git*`，不是假数据。危险 git/bash 仍可走对话审批卡；胶囊操作走桌面 git IPC，不让模型代点。

空会话：稿里的「新会话」空态，不是桌面卡片宫格。

## 设计语言例外

Android **不能**挂官方 CSS Modules `ui-primitives`。允许把 `--dsw-alias-*` 抄进 Compose `Color` / `DshTokens`（可从 `mobile/web/tokens.css` 或 `src/shared/dsh-webui-tokens.css` 抄值）。禁止 Pierre / lucide / Tailwind / marketplace 色值 / Material 默认紫 / 动态取色覆盖语义表。产品文案中文。启动页仪器画布不得扩散。动效只动 opacity / transform，时长对齐 `--ds-transition-duration*`。

在 `docs/design-language.md` 增加这一条例外，与手机 Web、启动页并列。

## 测试义务

- `src/main/remote.test.js`：JSON 登录成功与 401 JSON 体；form+302 仍在；剥 `cookie`/`authorization`；shell 未登录 401、非白名单 404、白名单调用 `invokeShell`
- `src/main/remote-shell.test.js`：未知名拒绝；`writeFile` / PTY 不在表
- `mobile/android`：`./gradlew test` — Offer 解析、unary 信封与握手顺序、rpcId、401 回连接、Git JSON 编解码、gitQuick 英文标签
- 真机/模拟器对照稿：扫码 → 列表 → 发文本 → 审批 → 传一张图 → 切分支 / Commit 对话框
- 不在本 worktree `npm start` / 打安装包去抢 `3080`/`3180` 或 `%APPDATA%\Deepseek-Harness-Desktop`

## 成功标准

Android 安装包扫同一 `#offer=` 二维码，登录后看到稿上的连接/对话壳，能列出 Host 会话并发送一条文本 prompt；审批帧出现时输入区变成允许/拒绝；能传一张图；工作区胶囊对真实 git IPC 显示分支并打开 Commit 对话框。浏览器 SPA 行为不回退。
