# Agent Note: MCP Settings polls health and remounts given-up children

Status: implemented

English | [中文](2026-08-20-mcp-settings-stale-health.zh.md)

## Problem

The Settings MCP page listed servers from a one-shot `mcpServers.list` snapshot. After `dsh-mcp-client`'s reconnect supervisor exhausted its attempt budget, `connection.health` stayed `failed` until the child fiber was disposed. Refresh only listed again, so every given-up row stayed on 连接失败. The last attempt error lived only in a tooltip, so an HTTP 401 looked like a generic management failure.

## Decision

`mcpServersFile.remount(id)` disposes and remounts one managed child without rewriting `$DSH_HOME/mcp-servers.yaml`. Host Remote `mcpServers.retry` is loopback-only and refuses a composition id. The Settings page polls `list` every 2s while any row is `connecting` or `reconnecting`, shows `connection.lastError` on the row, and Refresh remounts managed rows whose health is `failed` before listing again.

## Alternatives considered

**Poll on an idle connected catalog.** Rejected: connected health is stable; a timer belongs only on in-flight rows.

**Use enablement toggle as retry.** Rejected: that rewrites `enabled` and takes two gestures; remount is the recovery the supervisor documents (disposal is the only way back from exhaustion).

**Push connection health over SSE.** Rejected: `list` is already the snapshot; a 2s poll while a row is in flight is enough.

**Keep `lastError` tooltip-only.** Rejected: a credential or spawn failure then reads as a Settings bug.

## Consequences

Refresh recovers a given-up managed child without restarting Host. An HTTP server that still returns 401 still shows 连接失败, now with the error text. Composition rows stay read-only and are not remounted. Catalog ownership stays in [MCP and Skill settings management](../feature/2026-08-14-mcp-and-skill-settings.md). HTTP OAuth sign-in is [MCP Settings signs in HTTP servers](../feature/2026-08-20-mcp-settings-oauth.md).

## Testing

`mcp-servers-file` remounts an enabled child without rewriting YAML and rejects an unknown id. The Host gateway publishes `retry`, remounts a managed id, and refuses a composition id. Client tests pin visible `lastError`, connecting→connected polling, and Refresh calling `retry` once for a failed managed row. Connection allowlists include `mcpServers/retry`.
