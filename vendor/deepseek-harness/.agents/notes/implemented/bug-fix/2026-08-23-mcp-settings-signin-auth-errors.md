# Agent Note: MCP Settings Sign in only on auth errors

Status: implemented

English | [中文](2026-08-23-mcp-settings-signin-auth-errors.zh.md)

## Problem

Settings showed **登录** on every enabled managed Streamable HTTP MCP that was not connecting, reconnecting, or connected. A DNS failure, refused connection, or exhausted reconnect budget presented OAuth as the recovery. Users opened a browser login for servers that never issued an auth challenge.

## Decision

`needsSignIn` is true only for a writable, enabled `streamable-http` row whose `connection.lastError` is a string matching word-boundary HTTP 401/403, Unauthorized, Forbidden, invalid_token / invalid_grant / insufficient_scope, or missing bearer token. A hostname containing `oauth`, a port like `:4010`, a missing `lastError`, and any other failure keep the row error text and omit Sign in. mcp-client stores lastError through `formatMcpClientError`, which prefixes `HTTP <code>:` when the SDK puts status on `.code` and omits it from `String(error)`. GET SSE auth failures set that lastError via transport `onerror` without starting reconnect. `mcpServers.authorize` stays the Host OAuth path from [MCP Settings signs in HTTP servers](../feature/2026-08-20-mcp-settings-oauth.md).

## Alternatives considered

**Keep Sign in on every disconnected HTTP row.** Rejected: a network or spawn-style HTTP failure is not an OAuth challenge.

**Infer OAuth from a missing `Authorization` header.** Rejected: a public HTTP MCP with no header is not an auth failure.

## Consequences

Sign in appears after the Host records an auth challenge on that row. A refused or unknown HTTP endpoint still shows `lastError` without a login control. stdio and composition rows stay without Sign in.

## Testing

`mcp-section.client.spec.tsx` shows Sign in on a failed managed HTTP row whose `lastError` is `HTTP 401 Unauthorized`, an SDK POST `HTTP 401: StreamableHTTPError…` string, or `missing bearer token`; calls `authorize` with that id; hides Sign in on `fetch failed`, `:4010`, `foo.oauth.example.com`, and a failed HTTP row with no `lastError`; and still omits it on stdio and composition rows. `last-error.spec.ts` locks formatted StreamableHTTPError status and the same false-positive strings.

## Related

[MCP Settings signs in HTTP servers](../feature/2026-08-20-mcp-settings-oauth.md).
[MCP Settings polls health and remounts given-up children](2026-08-20-mcp-settings-stale-health.md).
