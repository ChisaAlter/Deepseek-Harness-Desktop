/**
 * Wire types for the MCP server Settings Remote.
 * @module @deepseek-ai/dsh-host-mcp-servers/types
 */

import type { McpServerRecord } from '@deepseek-ai/dsh-mcp-servers-file'

export type { McpServerRecord } from '@deepseek-ai/dsh-mcp-servers-file'

/** Fiber phase mirrored from the live child mcp-client plugin. */
export type ChildFiberPhase = 'pending' | 'loading' | 'active' | 'failed' | 'unloading' | null

/** Whether the row comes from the managed file or a composition plugin. */
export type McpServerOrigin = 'managed' | 'composition'

/** Live connection health reported by the mounted mcp-client instance. */
export interface McpServerConnection {
  readonly health: 'connecting' | 'connected' | 'reconnecting' | 'failed'
  readonly lastError?: string
  /** Public `mcp__<serverName>__…` names registered for the current generation. */
  readonly tools?: readonly string[]
}

/** One MCP server as Settings lists it. */
export interface McpServerEntry {
  readonly id: string
  readonly origin: McpServerOrigin
  readonly writable: boolean
  readonly enabled: boolean
  readonly fiberPhase: ChildFiberPhase
  /** Present when a live mcp-client instance for this row reports connection health. */
  readonly connection?: McpServerConnection
  readonly spec: McpServerRecord
}

/** Point-in-time Settings snapshot. */
export interface McpServerSnapshot {
  readonly servers: readonly McpServerEntry[]
}

/** Upsert request body. */
export interface McpServerUpsertRequest {
  readonly spec: McpServerRecord
}

/** Id-addressed mutation. */
export interface McpServerIdRequest {
  readonly id: string
}

/** Enablement mutation. */
export interface McpServerEnableRequest {
  readonly id: string
  readonly enabled: boolean
}
