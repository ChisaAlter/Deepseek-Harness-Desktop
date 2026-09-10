/**
 * Host Remote for listing and mutating the managed MCP server document.
 * @module @deepseek-ai/dsh-host-mcp-servers
 */

import type { Context, FiberState } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/cordis-plugin-loader'
import { TypertRemoteService, Remote } from '@deepseek-ai/dsh-typert-protocol'
import type {} from 'zod'
import type { McpServerRecord } from '@deepseek-ai/dsh-mcp-servers-file'
import { maskRecordSecrets } from '@deepseek-ai/dsh-mcp-servers-file'
import { testMcpServer } from './test-connection.ts'
import type {
  McpServerEnableRequest,
  McpServerEntry,
  McpServerIdRequest,
  McpServerSnapshot,
  McpServerTestResult,
  McpServerUpsertRequest,
} from './types.ts'

export type * from './types.ts'

const MCP_MODULE = '@deepseek-ai/dsh-mcp-client'
const MCP_SHORT = 'mcp-client'

const FIBER_STATE = {
  PENDING: 0 as FiberState.PENDING,
  LOADING: 1 as FiberState.LOADING,
  ACTIVE: 2 as FiberState.ACTIVE,
  FAILED: 3 as FiberState.FAILED,
  DISPOSED: 4 as FiberState.DISPOSED,
  UNLOADING: 5 as FiberState.UNLOADING,
} as const

const FIBER_PHASE = {
  [FIBER_STATE.PENDING]: 'pending',
  [FIBER_STATE.LOADING]: 'loading',
  [FIBER_STATE.ACTIVE]: 'active',
  [FIBER_STATE.FAILED]: 'failed',
  [FIBER_STATE.DISPOSED]: null,
  [FIBER_STATE.UNLOADING]: 'unloading',
} as const

/** Remote-only projection and mutation face for MCP servers. */
export class McpServersGateway extends TypertRemoteService {
  static inject = ['mcpServersFile', 'loader']

  /**
   * @param ctx - host context carrying the file service and Loader.
   */
  constructor(ctx: Context) {
    super(ctx, 'mcpServers')
  }

  /**
   * List managed file records plus composition-owned mcp-client rows.
   * @returns current snapshot; secret env and header values are masked on every row.
   */
  @Remote('list')
  list(): McpServerSnapshot {
    const managed = this.ctx.mcpServersFile.listManaged().map((spec): McpServerEntry => {
      const connection = this.ctx.mcpServersFile.childHealth(spec.id)
      return {
        id: spec.id,
        origin: 'managed',
        writable: true,
        enabled: spec.enabled,
        fiberPhase: this.ctx.mcpServersFile.childPhase(spec.id),
        ...connection === undefined ? {} : { connection },
        spec,
      }
    })
    const managedNames = new Set(managed.map(entry => entry.spec.serverName))
    const composition: McpServerEntry[] = []
    for (const entry of this.ctx.loader.entries()) {
      if (entry.options.group) continue
      const moduleName = entry.options.name
      if (!isMcpClientName(moduleName)) continue
      const spec = compositionSpec(entry.id, entry.options.config)
      if (spec === undefined || managedNames.has(spec.serverName)) continue
      const connection = this.ctx.mcpServersFile.connectionStatus(spec.serverName)
      composition.push({
        id: entry.id,
        origin: 'composition',
        writable: false,
        enabled: !entry.disabled,
        fiberPhase: entry.fiber === undefined ? null : FIBER_PHASE[entry.fiber.state],
        ...connection === undefined ? {} : { connection },
        spec: maskRecordSecrets(spec),
      })
    }
    return { servers: [...managed, ...composition] }
  }

  /**
   * Insert or replace one managed record.
   * @param request - complete spec.
   */
  @Remote('upsert')
  async upsert(request: McpServerUpsertRequest): Promise<void> {
    this.assertManaged(request.spec.id)
    await this.ctx.mcpServersFile.upsert(request.spec)
  }

  /**
   * Delete one managed record.
   * @param request - record id.
   */
  @Remote('delete')
  async delete(request: McpServerIdRequest): Promise<void> {
    this.assertManaged(request.id)
    await this.ctx.mcpServersFile.remove(request.id)
  }

  /**
   * Enable or disable one managed record.
   * @param request - id and next enablement.
   */
  @Remote('setEnabled')
  async setEnabled(request: McpServerEnableRequest): Promise<void> {
    this.assertManaged(request.id)
    await this.ctx.mcpServersFile.setEnabled(request.id, request.enabled)
  }

  /**
   * Remount one managed mcp-client child.
   * @param request - record id.
   */
  @Remote('retry')
  async retry(request: McpServerIdRequest): Promise<void> {
    this.assertManaged(request.id)
    await this.ctx.mcpServersFile.remount(request.id)
  }

  /**
   * Make one isolated MCP connection and discover its tools without changing
   * the managed document or the live Loader child.
   * @param request - record id from the managed or composition catalog.
   * @param signal - Remote invocation cancellation signal.
   * @returns the one-shot connection result.
   */
  @Remote('test')
  async test(request: McpServerIdRequest, signal: AbortSignal): Promise<McpServerTestResult> {
    const record = this.recordForTest(request.id)
    return testMcpServer(record, signal)
  }

  /**
   * Open a browser OAuth login for one managed HTTP server, persist the bearer
   * token, and remount the child so its tools are live.
   * @param request - record id.
   */
  @Remote('authorize')
  async authorize(request: McpServerIdRequest): Promise<void> {
    this.assertManaged(request.id)
    await this.ctx.mcpServersFile.authorize(request.id)
  }

  private assertManaged(id: string): void {
    const snapshot = this.list()
    const match = snapshot.servers.find(entry => entry.id === id)
    if (match !== undefined && match.origin === 'composition') {
      throw new Error(`mcpServers: server "${id}" comes from composition and is read-only`)
    }
  }

  private recordForTest(id: string): McpServerRecord {
    const managed = this.ctx.mcpServersFile.listManagedRaw().find(entry => entry.id === id)
    if (managed !== undefined) return managed
    const composition = [...this.ctx.loader.entries()].find(entry => {
      if (entry.options.group || !isMcpClientName(entry.options.name)) return false
      return entry.id === id
    })
    const record = composition === undefined ? undefined : compositionSpec(composition.id, composition.options.config)
    if (record === undefined) {
      throw new Error(`mcpServers: server "${id}" is not present in the managed or composition catalog`)
    }
    return record
  }
}

export default McpServersGateway

function isMcpClientName(moduleName: string): boolean {
  return moduleName === MCP_MODULE || moduleName === MCP_SHORT || moduleName.endsWith('mcp-client')
}

function compositionSpec(id: string, config: unknown): McpServerRecord | undefined {
  if (config === null || typeof config !== 'object' || Array.isArray(config)) return undefined
  const raw = config as Record<string, unknown>
  const serverName = typeof raw.serverName === 'string' ? raw.serverName : undefined
  if (serverName === undefined) return undefined
  const transport = raw.transport === 'streamable-http' ? 'streamable-http' : 'stdio'
  if (transport === 'stdio') {
    if (typeof raw.command !== 'string') return undefined
    return {
      id,
      enabled: true,
      transport: 'stdio',
      serverName,
      command: raw.command,
      ...Array.isArray(raw.args) ? { args: raw.args.filter((item): item is string => typeof item === 'string') } : {},
      ...isStringMap(raw.env) ? { env: raw.env } : {},
      ...typeof raw.cwd === 'string' ? { cwd: raw.cwd } : {},
    }
  }
  if (typeof raw.url !== 'string') return undefined
  return {
    id,
    enabled: true,
    transport: 'streamable-http',
    serverName,
    url: raw.url,
    ...isStringMap(raw.headers) ? { headers: raw.headers } : {},
  }
}

function isStringMap(value: unknown): value is Record<string, string> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false
  return Object.values(value).every(entry => typeof entry === 'string')
}
