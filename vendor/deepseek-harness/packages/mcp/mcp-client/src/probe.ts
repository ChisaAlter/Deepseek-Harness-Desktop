/**
 * One-shot MCP probe: connect to a server with the given config, list its
 * tools, and close. Nothing is registered: no tools land on `ctx.tools`, no
 * `serverName` namespace is reserved, and the child process (stdio) or HTTP
 * connection is torn down before the result settles. This is the management
 * surface's "test connection" — a live-server check that never changes the
 * running composition.
 *
 * @module
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { MAX_TIMER_DELAY_MS } from '@deepseek-ai/dsh-timeout'
import { createTransport } from './transport.ts'
import type { Config } from './index.ts'

/** One tool advertised by the probed server. */
export interface McpToolInfo {
  /** Tool name as the server advertises it. */
  name: string
  /** Short tool description when the server supplies one. */
  description?: string
}

/** Probe outcome: the tool listing, or a refusal message. */
export type ProbeResult =
  | { ok: true; tools: McpToolInfo[] }
  | { ok: false; message: string }

/** Default probe deadline in milliseconds. */
export const DEFAULT_PROBE_TIMEOUT_MS = 10_000

/**
 * A probe target: the transport fields a draft server profile may carry. The
 * fields the plugin Config defaults (`args`, `env`, `cwd`, timeouts,
 * `failOnStartupError`) are optional here — the probe normalizes them itself.
 */
export type ProbeConfig =
  | {
    transport: 'stdio'
    serverName: string
    command: string
    args?: string[]
    env?: Record<string, string>
    cwd?: string
  }
  | {
    transport: 'streamable-http'
    serverName: string
    url: string
    headers?: Record<string, string>
  }

/**
 * Probe one MCP server and list its tools.
 * @param config - probe target (transport + server identity); the
 *   `serverName` is used only as transport context and is never registered.
 * @param timeoutMs - deadline for the whole probe, bounded by
 *   `MAX_TIMER_DELAY_MS`; an invalid value refuses the probe up front.
 * @returns the tool listing, or a refusal message.
 */
export async function probeMcpServer(config: ProbeConfig, timeoutMs: number = DEFAULT_PROBE_TIMEOUT_MS): Promise<ProbeResult> {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0 || timeoutMs > MAX_TIMER_DELAY_MS) {
    return { ok: false, message: `probe timeout must be a positive number no greater than ${MAX_TIMER_DELAY_MS}` }
  }
  const fullConfig = normalizeProbeConfig(config)
  const client = new Client(
    { name: 'dsh-mcp-probe', version: '0.0.1' },
    { capabilities: {} },
  )
  let settled = false
  // The deadline closes the client; an in-flight connect or list then rejects
  // and funnels into the refusal branch below.
  const timer = setTimeout(() => {
    if (!settled) void client.close().catch(() => {})
  }, timeoutMs)
  timer.unref()
  try {
    await client.connect(createTransport(fullConfig))
    const listing = await client.listTools()
    settled = true
    clearTimeout(timer)
    return {
      ok: true,
      tools: listing.tools.map(tool => ({
        name: tool.name,
        ...tool.description === undefined ? {} : { description: tool.description },
      })),
    }
  } catch (error) {
    settled = true
    clearTimeout(timer)
    return { ok: false, message: error instanceof Error ? error.message : String(error) }
  } finally {
    try {
      await client.close()
    } catch {
      // The transport already closed (deadline or connect failure); the probe
      // outcome above already carries the reason.
    }
  }
}

/** Materialize the transport defaults the plugin Config would have supplied. */
function normalizeProbeConfig(config: ProbeConfig): Config {
  if (config.transport === 'stdio') {
    return {
      transport: 'stdio',
      serverName: config.serverName,
      command: config.command,
      args: config.args ?? [],
      env: config.env ?? {},
      cwd: config.cwd ?? '',
      toolCallTimeoutMs: 60_000,
      failOnStartupError: false,
    }
  }
  return {
    transport: 'streamable-http',
    serverName: config.serverName,
    url: config.url,
    headers: config.headers ?? {},
    toolCallTimeoutMs: 60_000,
    failOnStartupError: false,
  }
}
