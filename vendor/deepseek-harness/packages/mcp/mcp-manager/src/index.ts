/**
 * Settings-driven MCP server manager: owns the `mcp` settings namespace and
 * keeps one live supervised connection per configured server. The settings
 * section is the sole source of truth; every commit reconciles the live
 * mount set — added or changed servers mount (after the old instance is
 * disposed), removed servers unmount — without a restart. A broken server
 * never fails the app: its connection settles into an `error` status that
 * the management surface renders. Probes are one-shot and never mount.
 *
 * The manager mounts connections directly through `mcp-client`'s exported
 * `startConnection` rather than through `ctx.plugin`: the plugin form cannot
 * receive the status observer this service feeds its status registry, and
 * the duplicate-name guard the plugin's `serverName` reservation provides is
 * already guaranteed by this service's own dict-keyed mount map.
 *
 * @module @deepseek-ai/dsh-mcp-manager
 */

import { Context, Service } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type Schema from '@deepseek-ai/schemastery'
import {
  probeMcpServer,
  resolveReconnectPolicy,
  startConnection,
  stdioTransportFields,
  streamableHttpTransportFields,
} from '@deepseek-ai/dsh-mcp-client'
import type { Config as ClientConfig, McpConnectionState, ProbeResult } from '@deepseek-ai/dsh-mcp-client'
import { deepEqualJson, installSettingsSection, settingsNamespace } from '@deepseek-ai/dsh-settings'
import type { McpProbeRequest, McpServerProfile, McpServerStatusView } from './types.ts'

export type { McpProbeRequest, McpServerProfile, McpServerStatusView } from './types.ts'

/** The settings namespace this service owns. */
export const NS = settingsNamespace('mcp')

/** The mcp-client serverName grammar, enforced on dict keys at write time. */
const SERVER_NAME_PATTERN = /^[A-Za-z0-9_-]{1,32}$/

/** Default per-tool-call timeout for a managed server that omits one. */
const DEFAULT_TOOL_CALL_TIMEOUT_MS = 60_000

/** One transport profile, sharing mcp-client's field grammar. */
const serverProfile = z.union([
  z.object({ ...stdioTransportFields }),
  z.object({ ...streamableHttpTransportFields }),
]) as unknown as z<McpServerProfile>

/** Configuration of the mcp-manager service. */
export interface Config {
  /** Server profiles keyed by serverName; an empty dict is the dormant posture. */
  readonly servers?: Record<string, McpServerProfile>
}

/** Runtime schema for {@link Config}; also resolves the `mcp` settings section. */
export const Config: Schema<Config> = z.object({
  servers: z.dict(serverProfile).default({}),
})

declare module '@deepseek-ai/cordis' {
  interface Context {
    mcpManager: McpManagerService
  }
}

/** One live mount with the profile it was mounted from and its latest status. */
interface MountedServer {
  readonly profile: McpServerProfile
  status: McpConnectionState
  dispose: () => void
}

/**
 * Manage live MCP connections from the `mcp` settings section.
 * @param ctx - Cordis context; the `tools` registry receives the mounted servers' tools.
 * @param config - service configuration (also the settings section's composition base).
 */
export class McpManagerService extends Service {
  static Config: Schema<Config> = Config

  private readonly mounts = new Map<string, MountedServer>()
  /** The app root: supervised connections register tools into the global layer. */
  private readonly root: Context
  private source: () => Config = () => ({ servers: {} })

  constructor(ctx: Context, config: Config = {}) {
    super(ctx, 'mcpManager')
    this.root = ctx.root
    installSettingsSection(ctx, NS, Config, config, {
      // Refuse an unserviceable section where it is written: an invalid
      // serverName would otherwise be stored and silently never mount.
      validate: assertServiceable,
      setSource: (source) => { this.source = source },
      onChange: () => { this.reconcile() },
    })
    // The connections this service owns end with its fiber.
    ctx.effect(() => () => {
      for (const mounted of this.mounts.values()) mounted.dispose()
      this.mounts.clear()
    }, 'mcp-manager: connections')
  }

  /**
   * Snapshot every live server's status.
   * @returns status rows in settings order.
   */
  describe(): McpServerStatusView[] {
    return [...this.mounts.entries()].map(([serverName, mounted]) => ({
      serverName,
      transport: mounted.profile.transport,
      status: mounted.status,
    }))
  }

  /**
   * Probe one draft server profile without mounting anything.
   * @param input - the namespace plus the draft transport profile.
   * @returns the tool listing, or a refusal message.
   */
  async probe(input: McpProbeRequest): Promise<ProbeResult> {
    const { serverName, ...profile } = input
    return probeMcpServer({ serverName, ...profile })
  }

  /** Converge the live mount set with the current settings section. */
  private reconcile(): void {
    const servers = this.source().servers ?? {}
    const wanted = new Set(Object.keys(servers))
    // Dispose removed or changed instances first: the mcp-client namespace
    // reservation requires the old instance gone before a new one mounts.
    for (const [name, mounted] of this.mounts) {
      if (!wanted.has(name) || !deepEqualJson(servers[name], mounted.profile)) {
        mounted.dispose()
        this.mounts.delete(name)
      }
    }
    for (const [name, profile] of Object.entries(servers)) {
      if (this.mounts.has(name)) continue
      this.mounts.set(name, this.mount(name, profile))
    }
  }

  /** Start one supervised connection and track its status. */
  private mount(name: string, profile: McpServerProfile): MountedServer {
    const mounted: MountedServer = {
      profile,
      status: { phase: 'connecting' },
      dispose: () => {},
    }
    // The entry exists before the connection starts so the first synchronous
    // observer call lands on a tracked mount. Connections run on the app
    // root: a scoped plugin context would file their tool registrations into
    // the manager's own scope layer, invisible to every session.
    const handle = startConnection(
      this.root,
      fullClientConfig(name, profile),
      resolveReconnectPolicy(profile.reconnect, `mcp-manager(${name}): reconnect`),
      (state) => { mounted.status = state },
    )
    mounted.dispose = () => { void handle.dispose() }
    void handle.ready.then((outcome) => {
      // The observer carries the state machine; the ready outcome only adds
      // the startup-await diagnostic when nothing else did.
      if (outcome.error !== undefined && mounted.status.phase !== 'error' && mounted.status.phase !== 'disposed') {
        const detail = outcome.error instanceof Error ? outcome.error.message : JSON.stringify(outcome.error)
        this.ctx.logger.warn(`mcp-manager(${name}): initial connection failed: ${detail}`)
      }
    })
    return mounted
  }
}

export default McpManagerService

/** Reject a section this manager could not serve. */
function assertServiceable(config: Config): void {
  for (const name of Object.keys(config.servers ?? {})) {
    if (!SERVER_NAME_PATTERN.test(name)) {
      throw new Error(`mcp-manager: serverName "${name}" must match [A-Za-z0-9_-]{1,32}`)
    }
  }
}

/**
 * Materialize the mcp-client Config a managed profile mounts with: the loose
 * profile's optional fields get the same defaults the mcp-client schema would
 * have supplied, and `failOnStartupError` stays false — a broken server is
 * reported as status, never allowed to fail the app.
 */
function fullClientConfig(name: string, profile: McpServerProfile): ClientConfig {
  const base = {
    serverName: name,
    toolCallTimeoutMs: profile.toolCallTimeoutMs ?? DEFAULT_TOOL_CALL_TIMEOUT_MS,
    failOnStartupError: false,
    ...profile.reconnect === undefined ? {} : { reconnect: profile.reconnect },
  }
  if (profile.transport === 'stdio') {
    return {
      ...base,
      transport: 'stdio',
      command: profile.command,
      args: profile.args ?? [],
      env: profile.env ?? {},
      cwd: profile.cwd ?? '',
    }
  }
  return {
    ...base,
    transport: 'streamable-http',
    url: profile.url,
    headers: profile.headers ?? {},
  }
}
