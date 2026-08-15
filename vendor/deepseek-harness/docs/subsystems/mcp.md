# MCP

English | [中文](mcp.zh.md)

The [MCP (Model Context Protocol) capability family](../../packages/mcp) bridges external MCP servers into the harness tool registry. The [mcp-client](../../packages/mcp/mcp-client) plugin connects one stdio or Streamable HTTP server per instance and registers its tools as `mcp__<serverName>__<rawName>`; the [mcp-manager](../../packages/mcp/mcp-manager) service (`ctx.mcpManager`) keeps one live supervised connection per server configured in the `mcp` settings namespace, exposes per-server connection status, and answers one-shot probes. A managed server connects and disconnects without a restart; a server that cannot start settles into an `error` status instead of failing the app.

Source: [`packages/mcp/mcp-client/src/index.ts`](../../packages/mcp/mcp-client/src/index.ts) and [`packages/mcp/mcp-manager/src/index.ts`](../../packages/mcp/mcp-manager/src/index.ts).

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — this section is byte-identical in both language sides of the page. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

<a id="ctxmcpmanager--mcpmanagerservice"></a>

### `ctx.mcpManager` — `McpManagerService`

Manage live MCP connections from the `mcp` settings section.

```ts cordis-catalog
/**
 * Snapshot every live server's status.
 * @returns status rows in settings order.
 */
describe(): McpServerStatusView[]

/**
 * Probe one draft server profile without mounting anything.
 * @param input - the namespace plus the draft transport profile.
 * @returns the tool listing, or a refusal message.
 */
async probe(input: McpProbeRequest): Promise<ProbeResult>
```

Source: [`packages/mcp/mcp-manager/src/index.ts:79`](../../packages/mcp/mcp-manager/src/index.ts)
<!-- END GENERATED cordis-surface -->
