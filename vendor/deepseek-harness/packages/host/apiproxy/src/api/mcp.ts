/**
 * mcp domain contract: the MCP server management surface over the host
 * mcp-manager service — describe (live statuses) and probe (a one-shot draft
 * connection that mounts nothing). The settings seam owns persistence; this
 * domain only reads live state and answers draft interrogations.
 */

import type { RpcRequest, RpcResponse } from './rpc.ts'

/** One managed server's status row for the management surface. */
export interface McpServerStatusView {
  /** The server's namespace, the settings dict key. */
  readonly serverName: string
  /** Transport family of the mounted profile. */
  readonly transport: 'stdio' | 'streamable-http'
  /** Latest supervised connection state. */
  readonly status: {
    readonly phase: 'connecting' | 'connected' | 'reconnecting' | 'error' | 'disposed'
    readonly error?: string
  }
}

/** One advertised tool from a probe. */
export interface McpProbeToolView {
  /** Tool name as the server advertises it. */
  readonly name: string
  /** Short tool description when the server supplies one. */
  readonly description?: string
}

/** Probe outcome: the tool listing, or a refusal message. */
export type McpProbeResultView =
  | { ok: true; tools: readonly McpProbeToolView[] }
  | { ok: false; message: string }

/** Probe request: a draft server profile plus the namespace it would occupy. */
export type McpProbeRequestView =
  | {
    serverName: string
    transport: 'stdio'
    command: string
    args?: string[]
    env?: Record<string, string>
    cwd?: string
  }
  | {
    serverName: string
    transport: 'streamable-http'
    url: string
    headers?: Record<string, string>
  }

/**
 * MCP-domain unary methods (the map key mcp.* of RpcMethodMap). Both are
 * answered by the host `mcpManager` service; its absence is reported as
 * `mcp-manager-absent`, never 500.
 */
export interface McpApi {
  /** Snapshot every live managed server's status. */
  describe(request: RpcRequest<{}>): Promise<RpcResponse<{ servers: readonly McpServerStatusView[] }>>
  /** Probe one draft server profile; nothing is mounted. */
  probe(request: RpcRequest<McpProbeRequestView>): Promise<RpcResponse<McpProbeResultView>>
}
