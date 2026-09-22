# 手机 Web 客户端（先做 Web）

手机是电脑上 Harness Host 的伴侣，不是另一套带自己 API Key 的 Agent。系统相机 / 浏览器扫桌面「远程」弹窗里的**同一条**二维码，打开的是 `mobile/web` 这套独立 SPA，不是官方四栏 `dsh web`，也不是 Electron `src/renderer` 的套皮。

本规格只覆盖 **Web v1**。Android 应用内扫码、原生页、iOS 另开计划。

视觉以已认可的稿为准：`docs/superpowers/mocks/2026-08-20-mobile-phone.html`。不要把 Markdown 链接丢给用户当预览；本地预览用：

`Start-Process "C:\Ai\Deepseek-Harness-Desktop\docs\superpowers\mocks\2026-08-20-mobile-phone.html"`

## 目标

扫码（或粘贴配对 URL）后，手机浏览器能连上本机 Host：列会话、看对话、发消息、处理审批、改**本次连接**的设置。桌面远程弹窗、局域网 / 中继开关、`#offer=` 配对继续用现有实现。

## 非目标（本规格不做）

- 复用 `src/main` / `src/renderer` / `src/preload` 的 UI 代码
- 用 WebView 套官方 `dsh web` 插件树
- `import` `@deepseek-ai/dsh-client-*`、Cordis slot、CSS Modules `ui-primitives`
- `import` `../../src/` 桌面壳（协议在 `mobile/` 内自写一份）
- Git / Files / Browser / 终端 surface、斜杠命令 UI、附件、iOS
- Android 应用内扫码（同一 URL，以后原生页消化，不进 SPA WebView）
- 把图库源管理堆到外观页（图库设置只在图库窗口）
- 明文中继默认地址、把 token 放进 query

## 代码位置

| 路径 | 职责 |
|---|---|
| `mobile/web/` | 静态 SPA：HTML / CSS / ESM。网关认证后的文档根 |
| `mobile/web/host/` | Host 协议（offer、unary、WS、handshake），浏览器与 `node:test` 共用 |
| `mobile/web/conversation/` | 会话列表行、history/mux 折叠成气泡 |
| `mobile/App.js` | 本规格不改成可用 Android 客户端；可留提示「请用浏览器打开配对链接」 |
| `src/main/remote.js` | 认证后 HTML 改送 `mobile/web`；`/api/*` 与 WS 仍反代 `127.0.0.1:3080` |
| `src/main/config.js` | `REMOTE_FEATURE_ENABLED = true`（局域网 + HTTPS 中继一起开） |

打包：electron-builder `files` 增加 `mobile/web/**/*`，排除 `*.test.js`。运行时根目录：开发 `repo/mobile/web`，打包后 `app.asar/mobile/web`。

## 配对与可达

- 二维码仍是 `pairingUrl()`：中继 `https://<relay>/#offer=...`，局域网 `http://<lan>:3180/#offer=...`。token **只在 hash**。
- `#offer=` → `POST /__remote__/login`（现有 `loginPage()` 脚本可保留；SPA 也必须能自己 POST，避免只开 `/` 时卡住）。
- Cookie `dsh_remote`，`credentials: 'include'`。
- `dsh web` 仍只听 `127.0.0.1:3080`。手机只打 3180 / 中继。
- 中继只允许 `normalizeRelayOrigin` 后的 HTTPS。流量经过中继运营方；HTTPS 是跳加密，不是会话内容 E2E。v1 接受。
- 不要写死中继 IP。Host 已占用 `/__dsh__/host` 时 409。

## Host 协议（与官方客户端同线）

对照：`vendor/deepseek-harness/packages/host/apiproxy/src/fetch/client.ts`、`packages/client/connection/src/client/web-api-client.ts`。

Unary：

- `POST /api/<method>`，`Content-Type: application/json`
- 体：`{ type: "client-request", rpcId, method, payload }`
- `rpcId` 必须回显。用 `crypto.getRandomValues` 铸 UUID（明文 HTTP 不是 secure context，不用 `randomUUID`）
- 非 2xx 当传输失败。业务失败在 `result.ok === false`

v1 方法（点号名为线上真名）：

1. `host.describe` `{}`
2. `session.list` `{}` 与 `workspace.list` `{}`（可并行）
3. 再连 WS（禁止在 unary 完成前占槽）
4. `session.create`、`session.history`、`session.prompt`（`mode: "queue"`，`content: [{ type: "text", text }]`）、`session.cancel`
5. 审批：`POST /api/respond`，`{ type: "client-response", rpcId, result: { ok: true, value: { sessionId, approvalId, outcome } } }`，`outcome` 为 `allowed-once` 或 `rejected`

下行：`WebSocket` `/api/events.mux` 与 `/api/events.host`（`ws:` / `wss:`）。不要用 SSE：手机 HTTP/1.1 槽会被饿死。帧是 `server-request` JSON 文本，`payload` 为 mux/host frame。

握手失败、cookie 失效：回到连接页并说明原因，不要转圈死锁。

## 屏幕（对照稿）

390 逻辑宽、官方 `--dsw-alias-*` 色板、中文文案。没有 56px 桌面轨。

1. **连接** — 配对说明、主机名/中继状态（有则显示）、粘贴 URL、「进入会话」。已有有效 cookie 可跳过登录直握手。
2. **对话** — 顶栏汉堡 + 标题 + 运行态；消息流；底栏胶囊输入 + info 蓝发送。汉堡打开抽屉：搜索、新会话、会话行（标题、时间、running）、底栏 **设置**。
3. **审批** — 接管输入区：等待审批 / 拒绝 / 允许一次。不要另开桌面式模态盖住整页（稿是 composer takeover）。
4. **设置** — 全屏 overlay，横向导航：通用设置、外观、界面设置、权限、模型、MCP、技能、插件、关于。顶部说明：**远程更改只留在这次连接**。不要出现桌面专用行：关闭窗口时、Harness 自动恢复、打开配置文件。外观可有色制 / DeepSeek 主题 / 玻璃滑条；「浏览图库」若 Host 本连接做不到就隐藏或禁用，不要假按钮。图库源增删不在本页。

空会话：稿里的「新会话」空态，不是桌面卡片宫格。

## 对话折叠（v1）

`session.history` 的 `events[].event` 加上 mux `session/event`：

| 事件 | 气泡 |
|---|---|
| `user/message` 且 `data.source.kind === 'user'` | 用户 |
| `assistant/chunk` | 追加到当前助手气泡 |
| `assistant/message` | 助手定稿 |
| `tool/call` | 工具卡；有 `view.card` 用它 |
| 其他 | 忽略或一行次要文本，不要崩 |

会话标题：`blank === true` →「新会话」；否则 `projections.values` 里已有标题字段，再退回 `session/title`，再退回缩短的 `sessionId`。

## 设计语言例外

手机 Web **不能**挂官方 CSS Modules `ui-primitives`。允许把 `--dsw-alias-*` 抄进 `mobile/web/tokens.css`（可从 `src/shared/dsh-webui-tokens.css` 抄值，不要 import 桌面渲染进程）。禁止 Pierre / lucide / Tailwind / marketplace 色值。产品文案中文。启动页仪器画布不得扩散到本 SPA。

在 `docs/design-language.md` 增加这一条例外，与启动页并列。

## 测试义务

- `mobile/web/**/*.test.js`：offer、unary 信封、握手顺序、WS 帧、折叠、import fence（源码不得出现 `from '../../src/`、`require('../../src/`、`@deepseek-ai/dsh-client-`）
- `src/main/remote.test.js`：登录后 `GET /` 是手机 SPA，不是官方 boot HTML；`POST /api/session.list` 仍进上游
- `src/main/config.test.js`：`REMOTE_FEATURE_ENABLED === true`；非 HTTPS 中继 origin 仍被丢掉

## 成功标准

浏览器打开二维码 URL，登录后看到稿上的连接/对话壳，能列出 Host 会话并发送一条文本 prompt；审批帧出现时输入区变成允许/拒绝。`npm test`（脚本需纳入 `mobile/web/**/*.test.js`）覆盖上述测例。Android 仍不能当客户端，这是下一份计划。
