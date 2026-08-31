# 模块：手机远程

## 职责与非目标

**职责：** LAN / 中继远程、ChisaCode 配对、已配对后把 `mobile/web` SPA（Web 与 Android WebView 同一份）接到正在跑的 `dsh web` 与桌面 Git 标题栏。  
**非目标：** 不把启动页仪器风或官方 CSS Modules 整树嵌进手机 SPA；不把 PTY、Browser、`writeFile`、`host.pickDirectory` 暴露给手机；不为 Git / 会话列表 / composer 写 Android Compose 平行实现。

## 用户路径

见 [../flows/remote-pair.md](../flows/remote-pair.md)。契约以 [手机远程 Feature 卡](../../features/mobile-remote.md) 的 MUST 矩阵为准。

## 架构要点

- 配对：vendored ChisaCode offer v2 / sticky / 中继 E2EE。QR 落地页局域网 `:3180`、外出 `:3389/dshd/`，传输中继 `:8411` 不当页面。
- 已配对 host：daemon 白名单 unary 转发 loopback `dsh web`（剥 Origin / sec-fetch，Host 钉 loopback）。审批走 `/api/respond`。
- 已配对 Git：daemon 回调 Electron `git.js`（`dshd-git-dispatch.js`），同一套 `workspace-authority.js`。不在 daemon 里再实现一套 git CLI。
- Web：`mobile/web` + `--dsw-alias-*` tokens。Files / Diff / MCP 本轮冻结条。
- Android：`mobile/android` 原生层只做扫码 / 粘贴 / WebView 装载 SPA。不保留 Bearer `/api/*` 原生 Chat。

## 实现入口

- `src/main/chisacode-remote.js`、`chisacode-daemon-runner.mjs`、`dshd-daemon-hooks.mjs`、`dshd-git-tunnel.js`、`mobile-web-server.js`
- `src/shared/dshd-host-tunnel.js`、`src/main/dshd-git-dispatch.js`
- `mobile/web/app.js`、`mobile/web/host/`、`mobile/web/git/`
- 全量启动内容搜索 overlay：`src/main/session-search-overlay.js`（`--patch`，产品契约见 desktop-launcher）
- [mobile/README.md](../../../mobile/README.md)

## 不变量

- 手机页是文档化例外：语义色一致，不挂官方插件树，不用 `--boot-*`。
- 配对后产品真相是桌面 `dsh web` 会话，不是 ACP `chisacode-home/agents`。
- `workspace.create` 的 id 在嵌套 `workspace` 视图里；活列表仍隐藏 blank，但当前打开的 blank 必须能当 `currentRow`，否则顶栏和抽屉会丢行。
- 不给 daemon 注入 `DSH_HOME`、不双写 `dsh-home`。
- Host / Git 白名单见 Feature 卡；白名单外拒绝转发。

## 安全边界（LAN 模式）

LAN 模式默认在 `0.0.0.0` 上监听**明文 HTTP**：令牌与会话内容对同网段的窃听者可见，仅限可信局域网（家庭 / 办公内网）使用；公共 Wi‑Fi 场景应改用 HTTPS 中继或关闭远程。可用的收窄手段（设置 → 远程 → 网关）：

- **监听范围**（`remoteBindAddress`）：全部网卡（默认）/ 仅本机 `127.0.0.1` / 指定网卡 IPv4。绑仅本机时子网不可达（真机可走 `adb reverse`），弹窗换 `bindLoopbackHint`；快照 `urls` 只列绑定可达地址。
- **自签 TLS**（`remoteLanTls`，默认关）：开启后 LAN 网关走 HTTPS——ECDSA P-256 自签证书由 `src/main/remote-tls.js` 生成并持久于 `userData/remote-tls`（指纹稳定，便于浏览器记例外与后续 Android 证书固定），配对 URL 换 `https` 且 offer 携带 `fp`（证书 SHA-256）。限制：浏览器首访出自签警示页需手动继续；Android 客户端在证书固定实现前不支持 LAN TLS；中继模式绝不套 LAN TLS（中继链路本身 HTTPS）。

警示矩阵：「已开启 + LAN + 明文 + 非仅本机」常驻 `lanPlaintextWarning`；开 TLS 换 `lanTlsHint`；绑仅本机换 `bindLoopbackHint`。

Android 证书固定跟进清单（未落地，勿假装完成）：解析 offer `fp` → 自定义 `TrustManager` 按 SHA-256 固定证书 → 登录与 WebSocket 均走固定校验 → `:protocol:test` 补配对/固定用例。

## 门槛

- 以 [手机远程 Feature 卡](../../features/mobile-remote.md) 与 [实机全量用例](../../qa/mobile-remote-live-acceptance.md) 为准；改 UI 遵守 design-language 手机 / Android 例外段。

## 延伸阅读

- [../superpowers/specs/2026-08-20-mobile-web-client-design.md](../../superpowers/specs/2026-08-20-mobile-web-client-design.md)
- [../superpowers/specs/2026-08-23-mobile-android-client-design.md](../../superpowers/specs/2026-08-23-mobile-android-client-design.md)
- [../superpowers/plans/2026-08-25-mobile-web-scan-android-parity.md](../../superpowers/plans/2026-08-25-mobile-web-scan-android-parity.md)（Web 扫码 + 与 Android 对齐）
