# @deepseek-ai/dsh-mcp-manager

English | [中文](README.zh.md)

Settings-driven MCP server manager: keeps one live [`@deepseek-ai/dsh-mcp-client`](../mcp-client) connection per server configured in the `mcp` settings namespace, exposes per-server connection status, and answers one-shot probes.

The `mcp` settings section is the sole source of truth. Every committed change reconciles the live mount set without a restart: added or changed servers connect (the old instance is disposed first), removed servers disconnect and unregister their tools. A server that cannot start never fails the app — its supervised connection settles into an `error` status the management surface renders.

## Service: `McpManagerService` (ctx key: `mcpManager`)

### Public API

- `ctx.mcpManager.describe()` Returns one status row per live server (`serverName`, `transport`, and the latest supervised connection state: `connecting`, `connected`, `reconnecting`, `error`, or `disposed`).
- `ctx.mcpManager.probe(input)` Connects to a draft server profile once, lists its tools, and closes — nothing is mounted, no tools are registered, and no `serverName` namespace is reserved.

### Settings namespace: `mcp`

| Field | Default | Meaning |
|---|---|---|
| `servers` | `{}` | Server profiles keyed by `serverName` (`[A-Za-z0-9_-]{1,32}`); each profile is a stdio (`command`/`args`/`env`/`cwd`) or Streamable HTTP (`url`/`headers`) transport plus `toolCallTimeoutMs` and `reconnect`. |

The schema reuses `mcp-client`'s transport field grammar, so a server managed here behaves exactly like a statically configured `mcp-client` instance. Invalid `serverName` keys are refused where the section is written.

## Model Experience

Managed servers register their tools on the global tools registry under the same `mcp__<serverName>__<rawName>` names a static `mcp-client` instance uses, so sessions serve them through the ordinary tool catalog; status and probes are configuration-plane operations that never reach the model.

## Known Limitations and Deferred Work

- Managed servers live on the host plane (global tools layer), not per session or per agent preset.
- `failOnStartupError` is not configurable per managed server: a failed server is always reported as `error` status rather than failing startup.
