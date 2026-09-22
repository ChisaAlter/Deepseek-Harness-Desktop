# @deepseek-ai/dsh-client-ui-settings-mcp

English | [中文](README.zh.md)

Web Settings section `mcp` (order 18). The page presents managed MCP servers from `ctx.remote.mcpServers` plus read-only composition rows as a searchable catalog with one enablement filter and hairline rows. Host fiber phase is separate from configured enablement. Writable rows use a Switch plus edit and delete icon actions. An enabled writable HTTP row whose `lastError` matches a bounded auth challenge (HTTP 401/403, Unauthorized, Forbidden, invalid_token, missing bearer) shows Sign in, which calls `mcpServers.authorize`, opens the system browser, and re-lists when the Host has stored the bearer token and remounted. Other HTTP failures keep the error text and omit Sign in. A connected row shows the registered tool count, not the public tool names. The editor Modal switches between a form and a JSON object, preserves independent stdio and HTTP drafts, validates HTTP(S) URLs and every `KEY=value` line, and writes the managed document through `upsert` / `delete` / `setEnabled`. Refresh remounts managed rows whose connection supervisor has given up, then re-lists. While the section is ready the page polls `list` every two seconds, so servers connected outside this page (direct composition rows, a child finishing its initial tool sync) surface their health and tool count without an app restart; local mutations pause the poll. Rows show live connection health and the last attempt error. The Host Remote owns persistence.

Each managed and composition row also has a one-shot Test action. It reports the real isolated probe's discovered tool count and a short name summary, keeps the action pending-safe, and surfaces actionable Remote errors without changing Retry, OAuth, edit, delete, or enablement behavior.

## Model Experience

None, as this browser Settings page registers no prompt, tool, message, or provider request.

#### KV Cache effect

None; this package never assembles model input.

## Known Limitations and Deferred Work

- **No marketplace or `.mcp.json` import** — add is a local form or JSON object only.

No runtime invariant companion is published; this package owns no independent durable event relationship, and focused package tests cover its UI or service behavior.
