/**
 * Live connection health for mounted mcp-client instances, keyed by
 * `serverName` on the runtime's root context. The connection supervisor is the
 * only writer; Settings and other host surfaces read through
 * {@link mcpClientStatus} to report what the connection — not the plugin
 * fiber — is doing. A fiber stays active while the supervisor retries or has
 * given up, so fiber state alone cannot answer "is this server connected".
 * @module
 */

import type { Context } from '@deepseek-ai/cordis'

/** Connection phases a supervised mcp-client instance moves through. */
export type McpConnectionHealth = 'connecting' | 'connected' | 'reconnecting' | 'failed'

/** One server's live connection health, plus the error that ended the last attempt. */
export interface McpClientStatus {
  readonly health: McpConnectionHealth
  readonly lastError?: string
  /**
   * Public `mcp__<serverName>__…` names registered on `ctx.tools` for this
   * generation. Present only while `health` is `connected` and at least one
   * tool is registered.
   */
  readonly tools?: readonly string[]
}

const statuses = new WeakMap<Context, Map<string, McpClientStatus>>()

/**
 * Publish or clear one server's health. Only the connection supervisor (and
 * assembled tests seeding a runtime) call this.
 * @param root - the runtime root context.
 * @param serverName - the configured server identity.
 * @param status - the new status, or undefined to remove the entry (disposal).
 */
export function reportMcpClientStatus(root: Context, serverName: string, status: McpClientStatus | undefined): void {
  let byName = statuses.get(root)
  if (byName === undefined) {
    if (status === undefined) return
    byName = new Map()
    statuses.set(root, byName)
  }
  if (status === undefined) byName.delete(serverName)
  else byName.set(serverName, status)
}

/**
 * Read one server's live connection health in this runtime.
 * @param ctx - any context of the runtime.
 * @param serverName - the configured server identity.
 * @returns the current status, or undefined when no mcp-client instance for
 *   that server is mounted.
 */
export function mcpClientStatus(ctx: Context, serverName: string): McpClientStatus | undefined {
  return statuses.get(ctx.root)?.get(serverName)
}
