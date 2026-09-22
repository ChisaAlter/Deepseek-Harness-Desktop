/**
 * File-backed managed MCP server catalog and child mcp-client reconciler.
 * @module @deepseek-ai/dsh-mcp-servers-file/service
 */

import { mkdir, readFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { watch as chokidarWatch, type FSWatcher } from 'chokidar'
import { Context, Service } from '@deepseek-ai/cordis'
import { withFileLock, writeFileAtomic } from '@deepseek-ai/dsh-atomic-write'
import { canonicalizeWatchPath, resolveDshHome } from '@deepseek-ai/dsh-home-paths'
import * as mcpClient from '@deepseek-ai/dsh-mcp-client'
import { mcpClientStatus, type McpClientStatus } from '@deepseek-ai/dsh-mcp-client'
import type { Config as McpClientConfig } from '@deepseek-ai/dsh-mcp-client'
import {
  EMPTY_DOCUMENT,
  maskRecordSecrets,
  parseDocument,
  removeRecord,
  serializeDocument,
  setRecordEnabled,
  toClientConfig,
  upsertRecord,
} from './document.ts'
import { authorizeMcpHttp, defaultOAuthRuntime, type McpOAuthTokens } from './oauth.ts'
import type { ChildFiberPhase, McpServerRecord, McpServersDocument, McpServerUpsert } from './types.ts'

/** Plugin configuration fields used by the file service. */
export interface McpServersFileOptions {
  /** Absolute or home-relative document path. Defaults to `$DSH_HOME/mcp-servers.yaml`. */
  path?: string
  /** Harness home used when `path` is omitted. */
  dshHome?: string
  /** Watch the document and remount children after an external write. */
  watch?: boolean
  /** Chokidar stability window in milliseconds. */
  debounceMs?: number
}

/** Resolved document location and watch policy. */
export interface ResolvedSpec {
  readonly filename: string
  readonly watch: boolean
  readonly debounceMs: number
}

/** Test-replaceable child mount. */
export type McpClientMounter = (ctx: Context, config: McpClientConfig) => ChildHandle

/** Disposable child mcp-client handle. */
export interface ChildHandle {
  readonly dispose: () => Promise<void> | void
  readonly phase: () => ChildFiberPhase
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    mcpServersFile: McpServersFile
  }
}

/**
 * Resolve the on-disk document path.
 * @param config - plugin config.
 * @returns the resolved filename, watch flag, and debounce.
 */
export function resolveSpec(config: McpServersFileOptions = {}): ResolvedSpec {
  const filename = resolve(config.path ?? join(resolveDshHome(config.dshHome), 'mcp-servers.yaml'))
  return {
    filename,
    watch: config.watch ?? true,
    debounceMs: config.debounceMs ?? 100,
  }
}

const FIBER_PHASE = {
  0: 'pending',
  1: 'loading',
  2: 'active',
  3: 'failed',
  4: null,
  5: 'unloading',
} as const

/**
 * Default mounter: load one mcp-client instance as a child plugin.
 * Activation failures stay on the child fiber and are logged; they must not
 * reject the parent Host startup.
 * @param ctx - parent context.
 * @param config - mcp-client config.
 * @returns a handle that disposes the child fiber and reports its phase.
 */
export function defaultMounter(ctx: Context, config: McpClientConfig): ChildHandle {
  const fork = ctx.plugin(mcpClient, config)
  void Promise.resolve(fork.await()).catch((error: unknown) => {
    ctx.logger.error(error)
  })
  return {
    dispose: () => fork.dispose(),
    phase: () => {
      const state = fork.state
      return state in FIBER_PHASE ? FIBER_PHASE[state as keyof typeof FIBER_PHASE] : null
    },
  }
}

/** Owns `$DSH_HOME/mcp-servers.yaml` and the live mcp-client children it describes. */
export class McpServersFile extends Service {
  private document: McpServersDocument = EMPTY_DOCUMENT
  private readonly children = new Map<string, { fingerprint: string; handle: ChildHandle }>()
  private operations: Promise<void> = Promise.resolve()
  private mounter: McpClientMounter = defaultMounter
  private authorizeHttp: (url: string) => Promise<McpOAuthTokens> = (url) => authorizeMcpHttp(url, defaultOAuthRuntime())
  private watcher: FSWatcher | undefined
  private closed = false
  private selfWrite: string | undefined
  private ready: Promise<void> = Promise.resolve()
  /** Resolved document path and watch policy for this instance. */
  readonly spec: ResolvedSpec

  /**
   * @param ctx - owning context.
   * @param config - document path and watch policy.
   */
  constructor(ctx: Context, config: McpServersFileOptions = {}) {
    super(ctx, 'mcpServersFile')
    this.spec = resolveSpec(config)
  }

  /**
   * Replace the child mounter. Tests call this before {@link start}.
   * @param mounter - child factory.
   */
  useMounter(mounter: McpClientMounter): void {
    this.mounter = mounter
  }

  /**
   * Replace HTTP OAuth. Tests call this before {@link authorize}.
   * @param authorizeHttp - returns tokens for one MCP endpoint URL.
   */
  useAuthorizeHttp(authorizeHttp: (url: string) => Promise<McpOAuthTokens>): void {
    this.authorizeHttp = authorizeHttp
  }

  /**
   * Load the document, mount enabled servers, and optionally watch.
   * @returns disposer that closes the watcher and child fibers.
   */
  start(): () => void {
    this.ready = this.boot()
    return () => {
      this.closed = true
      void this.watcher?.close()
      void this.disposeChildren()
    }
  }

  /**
   * Current managed records with secrets masked.
   * @returns the managed records, secret fields masked.
   */
  listManaged(): readonly McpServerRecord[] {
    return this.document.servers.map(maskRecordSecrets)
  }

  /**
   * Current managed records including secret values. Host mutation uses this.
   * @returns the managed records with secret values intact.
   */
  listManagedRaw(): readonly McpServerRecord[] {
    return this.document.servers
  }

  /**
   * Live child fiber phase for one managed id, or `null` when unmounted.
   * @param id - managed record id.
   * @returns the child's current fiber phase, or `null` when unmounted.
   */
  childPhase(id: string): ChildFiberPhase {
    return this.children.get(id)?.handle.phase() ?? null
  }

  /**
   * Live connection health for one managed id's mounted child, when the child
   * reports through the mcp-client status registry.
   * @param id - managed record id.
   * @returns the child's connection status, or `undefined` for an unknown record.
   */
  childHealth(id: string): McpClientStatus | undefined {
    const record = this.document.servers.find(server => server.id === id)
    return record === undefined ? undefined : this.connectionStatus(record.serverName)
  }

  /**
   * Live connection health for any mcp-client server mounted in this runtime —
   * managed or hand-composed — keyed by `serverName`.
   * @param serverName - the configured server identity.
   * @returns the server's connection status, or `undefined` when it is not mounted.
   */
  connectionStatus(serverName: string): McpClientStatus | undefined {
    return mcpClientStatus(this.ctx, serverName)
  }

  /**
   * Insert or replace one managed record and remount.
   * @param upsert - complete record.
   */
  upsert(upsert: McpServerUpsert): Promise<void> {
    return this.mutate(document => upsertRecord(document, upsert))
  }

  /**
   * Delete one managed record and unmount its child.
   * @param id - record id.
   */
  remove(id: string): Promise<void> {
    return this.mutate(document => removeRecord(document, id))
  }

  /**
   * Enable or disable one managed record.
   * @param id - record id.
   * @param enabled - next enablement.
   */
  setEnabled(id: string, enabled: boolean): Promise<void> {
    return this.mutate(document => setRecordEnabled(document, id, enabled))
  }

  /**
   * Dispose and remount one managed child without rewriting the document.
   * Settings Refresh uses this after the connection supervisor has given up.
   * @param id - record id.
   */
  remount(id: string): Promise<void> {
    return this.enqueue(async () => {
      await this.ready
      const record = this.document.servers.find(server => server.id === id)
      if (record === undefined) {
        throw new Error(`mcp-servers-file: server "${id}" is not in the managed document`)
      }
      const child = this.children.get(id)
      if (child !== undefined) {
        await child.handle.dispose()
        this.children.delete(id)
      }
      if (!record.enabled) return
      const handle = this.mounter(this.ctx, toClientConfig(record))
      this.children.set(id, { fingerprint: fingerprintOf(record), handle })
    })
  }

  /**
   * Run HTTP OAuth for one managed server, persist `Authorization`, and remount.
   * @param id - record id.
   * @returns after the bearer is stored and the child is remounted.
   */
  async authorize(id: string): Promise<void> {
    await this.ready
    const record = this.document.servers.find(server => server.id === id)
    if (record === undefined) {
      throw new Error(`mcp-servers-file: server "${id}" is not in the managed document`)
    }
    if (record.transport !== 'streamable-http') {
      throw new Error('mcp-servers-file: OAuth login is only for HTTP servers')
    }
    const tokens = await this.authorizeHttp(record.url)
    const current = this.document.servers.find(server => server.id === id)
    if (current === undefined || current.transport !== 'streamable-http') {
      throw new Error(`mcp-servers-file: server "${id}" is not in the managed document`)
    }
    await this.upsert({
      ...current,
      headers: { ...current.headers, Authorization: `Bearer ${tokens.access_token}` },
    })
  }

  private async boot(): Promise<void> {
    this.document = await this.readDocument()
    await this.reconcile()
    if (!this.spec.watch || this.closed) return
    const target = await canonicalizeWatchPath(this.spec.filename)
    this.watcher = chokidarWatch(target, {
      ignoreInitial: true,
      awaitWriteFinish: {
        stabilityThreshold: this.spec.debounceMs,
        pollInterval: Math.max(1, Math.min(this.spec.debounceMs, 10)),
      },
    })
    this.watcher.on('all', () => {
      if (!this.closed) void this.enqueue(() => this.refreshFromDisk())
    })
  }

  private mutate(next: (document: McpServersDocument) => McpServersDocument): Promise<void> {
    return this.enqueue(async () => {
      await this.ready
      await mkdir(dirname(this.spec.filename), { recursive: true, mode: 0o700 })
      await withFileLock(this.spec.filename, async () => {
        const current = await this.readDocument()
        const document = next(current)
        const output = serializeDocument(document)
        await writeFileAtomic(this.spec.filename, output, { mode: 0o600, dirMode: 0o700 })
        this.selfWrite = output
        this.document = document
      })
      await this.reconcile()
    })
  }

  private async refreshFromDisk(): Promise<void> {
    const document = await this.readDocument()
    const serialized = serializeDocument(document)
    if (serialized === this.selfWrite) return
    this.document = document
    await this.reconcile()
  }

  private async readDocument(): Promise<McpServersDocument> {
    try {
      const text = await readFile(this.spec.filename, 'utf8')
      return parseDocument(text)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return EMPTY_DOCUMENT
      this.ctx.logger.warn(`mcp-servers-file: keeping the last good document: ${errorMessage(error)}`)
      return this.document
    }
  }

  private async reconcile(): Promise<void> {
    const wanted = new Map<string, McpServerRecord>()
    for (const record of this.document.servers) {
      if (record.enabled) wanted.set(record.id, record)
    }
    for (const [id, child] of [...this.children]) {
      const record = wanted.get(id)
      const fingerprint = record === undefined ? undefined : fingerprintOf(record)
      if (fingerprint === child.fingerprint) continue
      await child.handle.dispose()
      this.children.delete(id)
    }
    for (const [id, record] of wanted) {
      if (this.children.has(id)) continue
      const handle = this.mounter(this.ctx, toClientConfig(record))
      this.children.set(id, { fingerprint: fingerprintOf(record), handle })
    }
  }

  private async disposeChildren(): Promise<void> {
    await Promise.all([...this.children.values()].map(async child => child.handle.dispose()))
    this.children.clear()
  }

  private enqueue(operation: () => Promise<void>): Promise<void> {
    const task = this.operations.then(operation, operation)
    this.operations = task.then(() => undefined, () => undefined)
    return task
  }
}

function fingerprintOf(record: McpServerRecord): string {
  return JSON.stringify(toClientConfig(record))
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
