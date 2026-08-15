# MCP

[English](mcp.md) | 中文

[MCP（Model Context Protocol）能力族](../../packages/mcp) 将外部 MCP 服务器桥接进 harness 工具注册表。[mcp-client](../../packages/mcp/mcp-client) 插件每个实例连接一台 stdio 或 Streamable HTTP 服务器，并以其工具注册为 `mcp__<serverName>__<rawName>`；[mcp-manager](../../packages/mcp/mcp-manager) 服务（`ctx.mcpManager`）为 `mcp` 设置命名空间中配置的每台服务器保持一条实时受管连接，暴露每台服务器的连接状态，并应答一次性探测。受管服务器无需重启即可连接与断开；无法启动的服务器收敛到 `error` 状态，而不是让应用失败。

源码：[`packages/mcp/mcp-client/src/index.ts`](../../packages/mcp/mcp-client/src/index.ts) 与 [`packages/mcp/mcp-manager/src/index.ts`](../../packages/mcp/mcp-manager/src/index.ts)。

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
