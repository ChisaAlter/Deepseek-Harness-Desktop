// dsh-usage-panel · host-side structural types for services the plugin uses
// at runtime but whose host-side type packages are not public: the Cordis
// `connection` service (RPC) and the `llm` service (provider directory).
// The runtime shapes below are exactly what v0.1.0 already exercised.

// `ctx.interval` comes from @deepseek-ai/cordis-plugin-timer at runtime.
// The augmentation is declared locally so the built bundle has NO runtime
// import of that devDependency (consumers never install devDeps).
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import type { SessionRecord } from '@deepseek-ai/dsh-session-query'

declare module '@deepseek-ai/cordis' {
  interface Context {
    interval(callback: () => void, delay: number): () => void
  }
}

export interface HostRpcResult<T> {
  ok: boolean
  value?: T
  error?: { code: string; message: string; details: Record<string, unknown> }
}

export interface HostRpcHandle {
  handle(
    path: string,
    handler: (endpoint: string, payload: unknown) => Promise<HostRpcResult<unknown>>,
    options: { authority: 'loopback' },
  ): () => void
}

export interface HostConnection {
  rpc: HostRpcHandle
}

export interface LlmProviderInfoLike {
  id: string
  name: string
}

export interface LlmModelInfoLike {
  id: string
}

export interface HostLlm {
  listProviders(): Promise<LlmProviderInfoLike[]> | LlmProviderInfoLike[]
  /** Adapter-known models for one provider (may be unavailable on some adapters). */
  listModels?(provider: string): Promise<LlmModelInfoLike[]>
}

// --- Vendored harness read faces (dsh-v0.1.2-rc.1) ---
//
// The npm rc.6 devDependency types predate the vendored harness:
// `sessionProjectionCache.coldSnapshot` went from `async coldSnapshot(id,
// signal)` to a sync `coldSnapshot(meta, inheritedEventCount, events)` whose
// caller supplies the complete replay-validated log, `cachedSnapshot` gained
// the inheritedEventCount parameter, and `SessionLogSnapshot` gained the
// `inheritedEventCount` field. These structural faces mirror the vendored
// runtime shapes (same precedent as the connection/llm faces above); the npm
// type packages must not be trusted for these calls.

/** Header subset the projection-cache identity binds (createdAt / cwd / lineage). */
export interface HostSessionHeader {
  id: string
  createdAt: number
  cwd?: string | null
  isSeeded?: boolean
}

/** `sessionQuery.readSession` — complete replay-validated raw log (vendored shape). */
export interface HostSessionLogSnapshot {
  session: HostSessionHeader
  /** Exact fork-inherited prefix length paired with {@link session}. */
  inheritedEventCount: number
  events: SessionEvent[]
}

/** Projection cut: whole values as of `asOfSeq` (-1 for an empty log). */
export interface HostProjectionSnapshot {
  asOfSeq: number
  values: Record<string, unknown>
}

/** `ctx.sessionProjectionCache` — vendored rc.1 face; the id-only rc.6 calls are gone. */
export interface HostProjectionCache {
  coldSnapshot(meta: HostSessionHeader, inheritedEventCount: number, events: readonly SessionEvent[]): HostProjectionSnapshot
  cachedSnapshot(meta: HostSessionHeader, inheritedEventCount: number, keys?: readonly string[]): HostProjectionSnapshot | undefined
}

/** `ctx.sessionQuery` — the read face the panel exercises. */
export interface HostSessionQuery {
  listSessions(signal?: AbortSignal): Promise<SessionRecord[]>
  readSession(sessionId: string): Promise<HostSessionLogSnapshot>
  /** Vendored `SessionTitleSnapshot` cut down to the field the panel reads (`title` is non-empty). */
  readTitle(sessionId: string, signal?: AbortSignal): Promise<{ title: string } | undefined>
}
