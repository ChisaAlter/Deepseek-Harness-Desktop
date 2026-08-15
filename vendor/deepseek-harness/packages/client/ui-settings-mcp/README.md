# @deepseek-ai/dsh-client-ui-settings-mcp

English | [中文](README.zh.md)

MCP servers settings section: browse every managed server with its live connection status, and add, edit, or remove servers without restarting anything.

The section renders the `mcp` settings namespace through the settings seam and the live statuses from the host [`@deepseek-ai/dsh-mcp-manager`](../../mcp/mcp-manager) service (`mcp.describe` / `mcp.probe`). Each row shows the transport family and the latest supervised phase; a saved server connects immediately and its tools appear in every session. "Test connection" probes a draft (or stored) profile once — nothing is mounted.

## Model Experience

The page itself never reaches the model. Managed servers expose their tools to sessions as ordinary `mcp__<serverName>__*` tool catalog entries, exactly like statically configured `mcp-client` instances.

## Known Limitations and Deferred Work

- The reconnect policy of a managed server is not editable from this page (host defaults apply).
- Status polling refreshes every 3 seconds while the page is open; there is no push channel yet.
