# Decision: 上游桌面能力桥（update modal / webview browser / welcome / platform embed）

Status: implemented

中文 | [English](2026-09-26-upstream-desktop-bridges.en.md)

## Problem

上游 `apps/desktop` 把若干桌面能力绑在它的 Desktop Host（`profiles/desktop` + 专属进程通道）里：确认对话框壳层、webview 浏览器 guest、Welcome 登录窗、Platform 文档内嵌（usage/充值）。鲸屿走 `profiles/web` + overlay，直接挂上游 desktop app 会换掉整套壳。需要的形态是：能力采纳、外壳自留、桥面收窄。

## Decision

每个能力各移植最小主进程件 + 收窄 preload 面，官方 client 代码零改动消费：

1. **确认对话框壳层**（`update-dialog.js`/`update-overlay.js`/`update-attention.js`/`update-presentation.js` 移植）：透明子窗 modal 复用上游几何/焦点契约，样式换我们的深色设计语言；`dshDesktop.updates = {status, open, subscribe}` 窄桥喂我们自己的 GitHub Releases 状态机——上游 `ui-updates` 与 update-attention 直接消费，更新后端仍是我们 launcher/delta。

2. **webview 浏览器 guest**（`src/main/browser-guests.js` + `dshDesktop.browser`）：workspace 作用域 lease + 进程级 partition；主进程在 `will-attach-webview` 校验 lease 归属才放行并覆写全量 webPreferences；宿主导航拒绝、外部 https 放行、嵌套 webview/下载/凭据提示全拒。`dshDesktop.browser` 存在即让上游 `ui-sidebar-browser` 自动选 `createElectronPage`，右栏外壳/布局不变，入口内容=官方实现。

3. **Welcome 登录窗**（`welcome-backend.js`/`account-backend.js`/`welcome-window.js` + `dshWelcome` preload + vendored 渲染资产）：Authenticated Web RPC（session cookie）拿账号状态；登录/取消/复制授权链接/API key 保存/稍后设置全走主进程。`showHarness` 依赖注入点做闸——无账号登录且无 provider key 时欢迎窗持有入口，workspace 加载推迟到 `enterWorkspace`；API key 存在则直进。登出/会话过期 → 重开欢迎窗。

4. **Platform 文档内嵌**（`platform-view.js` + `dshPlatform` + `vendor/dsh-platform-session` Host 插件）：上游 desktop-host 用进程 IPC 推 PlatformSession——`dsh web` 没有该通道，换成 dsh-task-control 同款 Bearer-gated loopback 路由（`GET /dshd-platform/session`，per-boot token 走 env）。overlay 同时把 `deepseek-account` 行的 `desktopPlatform` 从 web 的 `null` 覆写为 `'win32'`。WebContentsView 按 userId 分区 + 凭据头注入 + 源锁定导航。

5. **小件**：`update-journal`（崩溃/失败后首启挂载 launch 诊断 banner）、`crash-report`（render-process-gone→`logs/crash/*.json`）、console tail（harness 视图 console 消息镜像进 app 日志，view-only 对象序列化被压掉防 GPU 帧噪声刷屏）、media-permissions（getUserMedia→notAllowed→camera+microphone only）、tray-hide notice（首次隐藏一次性 toast，marker 存 userData；2026-09-27 起见 [tray-close-once-toast](../product/2026-09-27-tray-close-once-toast.md)）。

6. **`__DSH_HOST_PATHS__`**：`webUtils.getPathForFile` 窄桥使 composer 拖文件得真实路径，`ui-file-reference-local` 的 `@path` 引用激活（不传字节、内容最新）。

Platform 会话路由在每次请求时从 Cordis 读取当前 `deepseekAccount`，不缓存路由安装时的服务引用。账户服务可晚于 WebServer 就绪，也可被替换或移除；捕获初始引用会让已登录用户的「查询用量」持续报 `Platform account unavailable`。回归测试覆盖晚启动、服务替换和移除，保留原 Bearer 鉴权与凭据边界。

## Alternatives considered

- **整挂上游 apps/desktop**：换掉我们 Electron 壳/launcher/profile——与既定架构决策冲突，拒。
- **IPC 走 process.send 复刻 desktop-host 通道**：`dsh web` 子进程无 IPC 管道，硬接要 fork 上游启动路径；loopback Bearer 路由复用已验证的 task-control 模式。
- **平台文档用普通 BrowserWindow**：拿不到分区凭证注入与源锁定；WebContentsView 子视图才能 bounds 跟宿主窗口走，采官方方案。
- **对话框继续用原生 dialog.showMessageBox**：上游 client（更新横幅/更新页）期望 `dshDesktop.updates` 语义层；壳层 modal 让确认/进度/恢复同一张皮，采。

## Consequences

- 官方 client 的 desktop 分支（webview/page/desktop-only surfaces）在 web profile 上激活，不需要 profiles/desktop。
- 新增 Host 插件 `vendor/dsh-platform-session` 与 overlay `desktop-platform-session.patch.yml`（每启全量+skip 都挂，log-only 失败不阻断 boot）。
- 凭据/令牌不出主进程与 loopback 边界；preload 面全只读/窄命令。
