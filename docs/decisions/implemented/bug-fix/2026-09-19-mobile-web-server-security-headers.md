# Decision: mobile-web-server 纵深防御安全响应头

Status: implemented

中文 | [English](2026-09-19-mobile-web-server-security-headers.en.md)

## Problem

全代码库安全审查把 LAN 配对页服务器（`src/main/mobile-web-server.js`，`:3180`）标为「明文 HTTP + 无鉴权 + 无 CSP」的高危暴露面。但深入核实后，该判断被**降级**：这个服务器是 LAN 模式下纯静态 SPA 托管，**不代理 `/api`、不发 cookie、不跑 mux**；聊天/会话/git 全部走 ChisaCode E2EE 隧道（DaemonClient），配对密语走 `#offer=` fragment（永不上网络）。它只在 `remoteEnabled` 且非 Away 模式时监听。真实暴露面远小于初审判断。

## Decision

给静态响应加**普遍安全**的响应头（纯增益、行为兼容、不改协议）：

- `X-Content-Type-Options: nosniff`
- `Referrer-Policy: no-referrer`
- `X-Frame-Options: DENY`（拒绝被 iframe 嵌套）

配套新增 `src/main/mobile-web-server.test.js` 钉住这些头，并显式断言**不设 CSP**。

**不加 `Content-Security-Policy`**：对抗审查发现 SPA 会主动向**不同源的中继主机**（ChisaCode daemon relay，如 `ws://<relay-ip>:8411`）开 WebSocket。LAN 配对页是 `http://<lan-ip>:3180` 的非安全上下文，此时 `connect-src 'self'` 只匹配 `:3180` 自身，而 `ws:` scheme-source 的浏览器支持不一致——CSP 极可能阻断中继 WebSocket、直接打断手机配对。在无法实机回归 CSP 矩阵的前提下，加 CSP 是「引入功能回归换防御」，故放弃。

## Alternatives considered

- **加 CSP** — rejected：会阻断到不同源中继的 WebSocket，在非安全 LAN 上下文破坏配对（见 Decision）。需要 CSP 时必须先实机验证 relay WS 矩阵。
- **加 TLS / 鉴权** — rejected：传输内容只是公开静态资源，配对密语走 fragment 且走 E2EE 隧道；强加 TLS 会触碰 `_kill-http-remote` 负契约并需全量实机矩阵重验，收益不抵成本。
- **删除 `:3180`** — rejected：它是 LAN 配对路径的现役着陆页（`dshd-remote.js` 在非 Away 模式构造），不是 kill 卡残留。
- **按初审结论升级为 P0** — rejected：初审夸大了风险（误以为 cookie/`/api` 经 `:3180` 明文传输），实际该服务器无任何敏感面。

## Consequences

LAN 配对页获得廉价的纵深防御，无需触碰 kill 卡或协议。初审的「P0 唯一无纵深防御入口」结论被修正为「P2 低成本加固」。残留的明文 HTTP 仅承载非敏感静态资源，是可接受的已知权衡。
