# @deepseek-ai/dsh-host-mcp-servers

English | [中文](README.zh.md)

Host Remote `mcpServers` for the Settings MCP page. `list` unions records from [`dsh-mcp-servers-file`](../../mcp/mcp-servers-file/README.md) with live Loader rows whose module name is an mcp-client instance. Managed rows are writable; composition rows are read-only. `upsert`, `delete`, and `setEnabled` write only the managed document and refuse a composition id. `retry` remounts one managed child without rewriting the file and also refuses a composition id. `authorize` runs HTTP OAuth for one managed id, persists the bearer token, remounts, and refuses a composition id. A connected row's `connection.tools` lists the public `mcp__<serverName>__…` names registered on `ctx.tools`. Secret values stay masked on `list` because the file service already masks them.

`test` accepts an existing managed or composition id and performs one isolated MCP `initialize` plus paginated `tools/list`, returning the transport, server name, raw tool names, count, and elapsed time. It never writes the managed document, remounts a child, reserves a live `serverName`, or registers tools; bounded cancellation and timeout paths close the temporary stdio or HTTP transport.

The service is Remote-only and declares no same-process Cordis `Context` merge. Client packages consume it through [`api-remotes`](../../api/remotes/README.md).

## Model Experience

None, as this Host Remote registers no prompt, tool, message, or provider request.

#### KV Cache effect

None; this package never assembles model input.

## Known Limitations and Deferred Work

- **No Cursor/Claude config import** — Settings writes only `$DSH_HOME/mcp-servers.yaml`.

No runtime invariant companion is published; this package owns no independent durable event relationship, and focused package tests cover its UI or service behavior.
