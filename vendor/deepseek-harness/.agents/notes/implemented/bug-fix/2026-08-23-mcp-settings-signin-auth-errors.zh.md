# Agent Note: MCP Settings 仅在鉴权错误时显示登录

Status: implemented

[English](2026-08-23-mcp-settings-signin-auth-errors.md) | 中文

## Problem

Settings 对每个未处于连接中、重连中或已连接的已启用受管 Streamable HTTP MCP 都显示 **登录**。DNS 失败、连接拒绝或重连预算耗尽也会把 OAuth 当作恢复手段。用户会为从未发出鉴权挑战的服务器打开浏览器登录。

## Decision

`needsSignIn` 仅在可写、已启用的 `streamable-http` 行、且 `connection.lastError` 为匹配词边界 HTTP 401/403、Unauthorized、Forbidden、invalid_token / invalid_grant / insufficient_scope，或 missing bearer token 的字符串时为真。主机名里的 `oauth`、端口 `:4010`、缺少 `lastError` 以及其他失败只保留行上的错误文本，不显示登录。mcp-client 通过 `formatMcpClientError` 写入 lastError：SDK 把状态放在 `.code` 而 `String(error)` 不含该数字时，前缀为 `HTTP <code>:`。GET SSE 鉴权失败经 transport `onerror` 写入该 lastError，不启动重连。`mcpServers.authorize` 仍是 [MCP Settings 为 HTTP 服务器登录](../feature/2026-08-20-mcp-settings-oauth.zh.md) 中的 Host OAuth 路径。

## Alternatives considered

**每个未连接的 HTTP 行都显示登录。** 否决：网络失败或类似 spawn 的 HTTP 失败不是 OAuth 挑战。

**从缺少 `Authorization` 头推断 OAuth。** 否决：没有该头的公开 HTTP MCP 不是鉴权失败。

## Consequences

Host 在该行记录鉴权挑战后才出现登录。被拒绝或未知的 HTTP 端点仍显示 `lastError`，没有登录控件。stdio 与组成配置行仍然没有登录。

## Testing

`mcp-section.client.spec.tsx` 在失败的受管 HTTP 行、且 `lastError` 为 `HTTP 401 Unauthorized`、SDK POST 的 `HTTP 401: StreamableHTTPError…` 或 `missing bearer token` 时显示登录，按该 id 调用 `authorize`；在 `fetch failed`、`:4010`、`foo.oauth.example.com` 以及没有 `lastError` 的失败 HTTP 行上隐藏登录；stdio 与组成配置行仍不显示登录。`last-error.spec.ts` 锁定格式化后的 StreamableHTTPError 状态以及同样的误报字符串。

## Related

[MCP Settings 为 HTTP 服务器登录](../feature/2026-08-20-mcp-settings-oauth.zh.md)。
[MCP Settings 轮询健康并重新挂载已放弃的子实例](2026-08-20-mcp-settings-stale-health.zh.md)。
