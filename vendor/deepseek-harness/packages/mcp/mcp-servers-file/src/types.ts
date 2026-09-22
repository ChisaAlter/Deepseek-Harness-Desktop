/**
 * On-disk and in-memory records for the managed MCP server document.
 * @module @deepseek-ai/dsh-mcp-servers-file/types
 */

/** Automatic reconnect policy stored beside one managed server. */
export interface McpReconnectRecord {
  readonly enabled?: boolean
  readonly initialDelayMs?: number
  readonly maxDelayMs?: number
  readonly maxAttempts?: number
}

/** Shared fields for every managed MCP server record. */
export interface McpServerRecordBase {
  /** Stable document id; unique in the file. */
  readonly id: string
  /** Whether the file plugin mounts an mcp-client instance for this record. */
  readonly enabled: boolean
  /** Public tool-name namespace (`mcp__<serverName>__…`). */
  readonly serverName: string
  readonly toolCallTimeoutMs?: number
  readonly failOnStartupError?: boolean
  readonly reconnect?: McpReconnectRecord
}

/** Stdio transport record. */
export interface McpStdioServerRecord extends McpServerRecordBase {
  readonly transport: 'stdio'
  readonly command: string
  readonly args?: readonly string[]
  readonly env?: Readonly<Record<string, string>>
  readonly cwd?: string
}

/** Streamable HTTP transport record. */
export interface McpHttpServerRecord extends McpServerRecordBase {
  readonly transport: 'streamable-http'
  readonly url: string
  readonly headers?: Readonly<Record<string, string>>
}

/** One managed MCP server persisted in `$DSH_HOME/mcp-servers.yaml`. */
export type McpServerRecord = McpStdioServerRecord | McpHttpServerRecord

/** Fiber phase mirrored from a live child mcp-client plugin. */
export type ChildFiberPhase = 'pending' | 'loading' | 'active' | 'failed' | 'unloading' | null

/** Parsed managed-server document. */
export interface McpServersDocument {
  readonly servers: readonly McpServerRecord[]
}

/** Upsert payload accepted by the file service. */
export type McpServerUpsert = McpServerRecord
