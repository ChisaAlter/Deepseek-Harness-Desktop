/**
 * Types of the mcp-manager service, split from the runtime module so a
 * configuration client names them without importing host code.
 * @module @deepseek-ai/dsh-mcp-manager/types
 */

import type { McpConnectionState, ReconnectConfig } from '@deepseek-ai/dsh-mcp-client'

/** One managed MCP server's transport profile, as the settings section stores it. */
export type McpServerProfile =
  | {
    transport: 'stdio'
    /** Executable used to start the server. */
    command: string
    /** Arguments passed directly, without shell interpolation. */
    args?: string[]
    /** Extra env vars merged on top of scrubbed ambient env. */
    env?: Record<string, string>
    /** Working directory for the child process. */
    cwd?: string
    /** Per-tool-call timeout in milliseconds. */
    toolCallTimeoutMs?: number
    /** Automatic reconnect policy; omission uses the mcp-client defaults. */
    reconnect?: ReconnectConfig
  }
  | {
    transport: 'streamable-http'
    /** MCP endpoint URL. */
    url: string
    /** Additional headers attached to MCP requests. */
    headers?: Record<string, string>
    /** Per-tool-call timeout in milliseconds. */
    toolCallTimeoutMs?: number
    /** Automatic reconnect policy; omission uses the mcp-client defaults. */
    reconnect?: ReconnectConfig
  }

/** One managed server's status row for the management surface. */
export interface McpServerStatusView {
  /** The server's namespace, the settings dict key. */
  readonly serverName: string
  /** Transport family of the mounted profile. */
  readonly transport: 'stdio' | 'streamable-http'
  /** Latest supervised connection state. */
  readonly status: McpConnectionState
}

/** Probe request: a draft server profile plus the namespace it would occupy. */
export type McpProbeRequest = { serverName: string } & McpServerProfile
