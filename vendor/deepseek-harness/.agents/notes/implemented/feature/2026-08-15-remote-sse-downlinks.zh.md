# Agent Note: 手机远程在启动完成后再灌入列表，下行用 WebSocket

Status: implemented

[English](2026-08-15-remote-sse-downlinks.md) | 中文

## 问题

手机远程经桌面 HTTP 反向代理加载官方网页。`WorkspaceRuntime` 只在 `ConnectionController` 标为已连接之后才拉 `session.list`。控制器原先在 `host.describe` 之前就打开 `events.mux` 与 `events.host`。两条长连接 HTTP 下行会占满手机浏览器每个来源的 HTTP/1.1 连接槽，`host.describe` 因此无法发出，`onConnected` 从不触发，侧栏保持空白，即使同一源上的 unary POST 已经能返回 Host 上的对话。会话历史也是 unary（`session.history`）；列表握手没完成时它也不会跑。Host 存储并不是空的：对回环和对带设备 cookie 的中继直接调 `session.list` 都能返回在线行。公网 HTTP 上的已结算远程页不是安全上下文：没有 `crypto.randomUUID`，`AbstractApiClient.mintRpcId` 在 `fetch` 之前抛错，`host.describe` 发不出去。`WebApiClient` 用 `randomUuid()`（`crypto.getRandomValues`）铸造 rpcId。`stop()` 之后的 `connection.start` 会新建循环。`client-hmr` 只在回环上打开 `GET /plugins/events`。

## 决策

`ConnectionController` 在 `window.__DSH_BOOT_GATE__` 兑现之前不会发起 `host.describe` 或任一条 WebSocket。外壳在任何插件 `apply` 之前创建该 Promise，并只在 `loader.await()` 之后兑现——每个 `/plugins/*/client.js` 脚本都已加载且每条 fiber 都为 ACTIVE。若在下载这些脚本期间就发起 describe 或两条 CONNECTING 的 WebSocket，会占满手机浏览器每个来源的 HTTP/1.1 连接槽，剩余插件脚本永远完不成，`loader.await()` 不返回，启动转圈一直停在页面上。运行时插件只在同一 Promise 兑现之后才调用 `connection.start`（页面没有门禁时立即调用）。`stop()` 之后的 `start` 会新建循环；循环仍在跑时再次 `start` 会替换它。`client-hmr` 只在回环上打开 `EventSource('/plugins/events')`。门禁之后，控制器完成 `host.describe`，等待 `onConnected`（运行时等待 `session.list` 与 `workspace.list`），再打开 socket。`WebApiClient` 用 `randomUuid()` 铸造 unary `rpcId`，公网 HTTP（没有 `crypto.randomUUID`）也能发出 `host.describe`。`WebApiClient` 在每个源上（包括经中继的手机）都用 WebSocket。手机载体不是两条 HTTP SSE GET。未带 `Accept: text/event-stream` 的普通网络 GET 仍返回 426。

## 考虑过的替代

**把手机空白当成当前会话恢复失败。** 否决：Host 列表根本没到达。`session.list` 没跑时，打开最近一行也没用。

**非回环改开两条 SSE GET 而不用 WebSocket。** 否决：对中继的实测表明已认证 WebSocket upgrade 能成功。SSE 与 `host.describe`／`session.list`／`session.history` 争用同一 HTTP/1.1 连接池；连接槽少的手机浏览器就会看不到对话。

**等两条流的 onOpen 之后才 onConnected。** 否决：卡住的下行会把 unary 存储藏起来。连接之后的实时帧仍需要下行流；列表和历史不需要。

**保持 `connection.start` 一次性，并继续在中继源上开 HMR SSE。** 否决：fiber 重挂在 `stop()` 之后会抛错，已结算页面从此不再 describe；EventSource 还在单条中继 TCP 上占一条长连接 HTTP GET。

## 后果

桌面 Electron 除了在启动门禁、describe 与 `onConnected` 之后才打开下行外不变。手机远程先完成插件启动，再灌入 Host 列表，再 upgrade 两条 WebSocket。测试钉住启动门禁、可重启的 `start`、仅回环的 HMR EventSource、先 describe 再打开下行、`onConnected` Promise 完成后再打开下行，以及非回环 `ws://` URL。
