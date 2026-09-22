# Agent Note: MCP Settings signs in HTTP servers

Status: implemented

[English](2026-08-20-mcp-settings-oauth.md) | 中文

## Problem

需要 OAuth 的受管 Streamable HTTP MCP（Ardot，以及任何带 `resource_metadata` 的 401）可以在 Settings 里添加，但 DSH 从不打开登录。Host 挂的是裸 URL，健康停在 `failed`，对话拿不到该服务器的工具。从别的客户端拷 token 不是产品路径。

## Decision

`mcpServersFile.authorize(id)` 发现受保护资源与授权服务器元数据，注册公钥 PKCE 客户端，打开系统浏览器，交换 code，把 `Authorization: Bearer …` 写进该受管 HTTP 记录，并重新挂载 mcp-client 子实例，使每个会话的 `ctx.tools` 带上该服务器的工具。Host Remote `mcpServers.authorize` 仅限 loopback，并拒绝组成配置 id。Settings 仅在已启用可写 HTTP 行的 `connection.lastError` 匹配有边界的鉴权挑战（词边界 HTTP 401/403、Unauthorized、Forbidden、invalid_token、missing bearer）时显示 **登录**，主机名里的 `oauth` 或端口 `:4010` 不算；其他 HTTP 失败只保留错误文本、不显示该控件（[鉴权错误才显示登录](../bug-fix/2026-08-23-mcp-settings-signin-auth-errors.zh.md)）。已连接行只显示已注册工具数量，不列出 `connection.tools` 里的公开 `mcp__<serverName>__…` 名称。Windows 上 `openBrowser` 以 `cmd /c start "" "<url>"` 并带 `windowsVerbatimArguments` 启动，避免 authorize 查询串里的 `&` 被拆开。授权服务器元数据按 RFC 8414 在 origin 与 issuer path 之间插入 `/.well-known/oauth-authorization-server`，该 GET 返回 404 时再试 issuer 后缀 URL。

## Alternatives considered

**只把从 Cursor 拷来的 access token 写进 yaml。** 否决：用户在 DSH 里看不到登录，Host 可能不 remount，token 过期后产品内没有回来的路。

**在 `dsh-mcp-client` 第一次 401 时自动跑 OAuth。** 否决：打开浏览器是 Settings/Host 的用户手势，不是静默重连的副作用。

**把 refresh token 存进旁路文件并无浏览器续期。** 暂缓：v1 把 access token 写成请求头；过期后显示连接失败，再点登录。

## Consequences

用户添加 `https://ardot.tencent.com/mcp`（或任何 OAuth HTTP MCP），点登录，完成浏览器授权，Settings 在该行显示已注册工具数量。下一轮对话即可调用 `mcp__<serverName>__…` 工具。stdio 行没有登录。组成配置行仍只读。目录归属仍在 [MCP 与 Skill 设置管理](2026-08-14-mcp-and-skill-settings.zh.md)。

## Testing

`authorizeMcpHttp` 对着模拟的发现/token 端点跑 PKCE，按 RFC 8414 插入发现带 path 的 issuer，该 URL 404 时回退，并拒绝不发起挑战的服务器。`windowsBrowserLaunchArgs` 给 authorize URL 加引号。`mcpServersFile.authorize` 为 HTTP 行写入 Bearer 并 remount，拒绝 stdio 或未知 id。Host gateway 发布 `authorize` 并拒绝组成配置 id。已连接的 `list` 行带 `connection.tools`。Client 测试只在 `lastError` 为有边界的鉴权挑战时显示登录，并按该 id 调用 `authorize`，已连接行渲染工具计数而不列出名称。Connection 允许列表包含 `mcpServers/authorize`。

## Related

[MCP 与 Skill 设置管理](2026-08-14-mcp-and-skill-settings.zh.md)。
[MCP Settings 轮询健康并重新挂载已放弃的子实例](../bug-fix/2026-08-20-mcp-settings-stale-health.zh.md)。
[MCP Settings 仅在鉴权错误时显示登录](../bug-fix/2026-08-23-mcp-settings-signin-auth-errors.zh.md)。
