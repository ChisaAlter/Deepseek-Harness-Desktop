# Agent Note: MCP Settings signs in HTTP servers

Status: implemented

English | [中文](2026-08-20-mcp-settings-oauth.zh.md)

## Problem

A managed Streamable HTTP MCP server that requires OAuth (Ardot, and any 401 `resource_metadata` challenge) could be added in Settings, but DSH never opened a login. The Host mounted a naked URL, health stayed `failed`, and chat never received that server's tools. Copying a token from another client is not a product path.

## Decision

`mcpServersFile.authorize(id)` discovers protected-resource and authorization-server metadata, registers a public PKCE client, opens the system browser, exchanges the code, writes `Authorization: Bearer …` on that managed HTTP record, and remounts the mcp-client child so `ctx.tools` carries the server's tools for every session. Host Remote `mcpServers.authorize` is loopback-only and refuses a composition id. Settings shows **登录** only when an enabled writable HTTP row's `connection.lastError` matches a bounded auth challenge (word-boundary HTTP 401/403, Unauthorized, Forbidden, invalid_token, missing bearer), not a hostname substring `oauth` or a port like `:4010`; other HTTP failures keep the error text and omit the control ([auth-error Sign in](../bug-fix/2026-08-23-mcp-settings-signin-auth-errors.md)). A connected row shows the registered tool count, not the public `mcp__<serverName>__…` names from `connection.tools`. Windows `openBrowser` launches `cmd /c start "" "<url>"` with `windowsVerbatimArguments` so authorize query `&` stays in the URL. Authorization-server metadata uses RFC 8414 insertion of `/.well-known/oauth-authorization-server` between origin and issuer path, then the issuer-suffix URL if that GET returns 404.

## Alternatives considered

**Store only a Cursor-copied access token in yaml.** Rejected: the user never sees a DSH login, Host may not remount, and the token expires with no way back inside the product.

**Automatic OAuth inside `dsh-mcp-client` on the first 401.** Rejected: opening a browser is a Settings/Host user gesture, not a silent reconnect side effect.

**Persist refresh tokens in a sidecar and renew without the browser.** Deferred: v1 writes the access token as a header; expiry shows 连接失败 and 登录 again.

## Consequences

The user adds `https://ardot.tencent.com/mcp` (or any OAuth HTTP MCP), clicks 登录, finishes the browser prompt, and Settings shows the registered tool count on that row. The next chat turn can call `mcp__<serverName>__…` tools. stdio rows have no 登录. Composition rows stay read-only. Catalog ownership stays in [MCP and Skill settings management](2026-08-14-mcp-and-skill-settings.md).

## Testing

`authorizeMcpHttp` runs PKCE against mocked discovery/token endpoints, discovers a path-bearing issuer via RFC 8414 insertion, falls back when that URL 404s, and refuses a server that does not challenge. `windowsBrowserLaunchArgs` quotes the authorize URL. `mcpServersFile.authorize` writes the bearer and remounts an HTTP row, and refuses stdio or an unknown id. The Host gateway publishes `authorize` and refuses a composition id. A connected `list` row carries `connection.tools`. Client tests show 登录 only when `lastError` is a bounded auth challenge, call `authorize` with that id, and render a tool count on a connected row without listing names. Connection allowlists include `mcpServers/authorize`.

## Related

[MCP and Skill settings management](2026-08-14-mcp-and-skill-settings.md).
[MCP Settings polls health and remounts given-up children](../bug-fix/2026-08-20-mcp-settings-stale-health.md).
[MCP Settings Sign in only on auth errors](../bug-fix/2026-08-23-mcp-settings-signin-auth-errors.md).
