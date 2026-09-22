import type { SessionEvent } from '@deepseek-ai/dsh-session';
import type { SessionRecord } from '@deepseek-ai/dsh-session-query';
declare module '@deepseek-ai/cordis' {
    interface Context {
        interval(callback: () => void, delay: number): () => void;
    }
}
export interface HostRpcResult<T> {
    ok: boolean;
    value?: T;
    error?: {
        code: string;
        message: string;
        details: Record<string, unknown>;
    };
}
export interface HostRpcHandle {
    handle(path: string, handler: (endpoint: string, payload: unknown) => Promise<HostRpcResult<unknown>>, options: {
        authority: 'loopback';
    }): () => void;
}
export interface HostConnection {
    rpc: HostRpcHandle;
}
export interface LlmProviderInfoLike {
    id: string;
    name: string;
}
export interface LlmModelInfoLike {
    id: string;
}
export interface HostLlm {
    listProviders(): Promise<LlmProviderInfoLike[]> | LlmProviderInfoLike[];
    /** Adapter-known models for one provider (may be unavailable on some adapters). */
    listModels?(provider: string): Promise<LlmModelInfoLike[]>;
}
/** `ctx.settings` — one registered namespace's resolved value plus its write path. */
export interface HostSettings {
    /**
     * Resolved value of a registered namespace (composition base → user layer →
     * schema defaults), or `undefined` while that namespace is unregistered.
     */
    get(ns: string): unknown;
    /**
     * Merge a patch into one namespace's user section. REJECTS (it does not
     * no-op) while the namespace is unregistered — callers must treat
     * "registered" as a precondition, never as a guarantee.
     */
    update(ns: string, patch: object): Promise<void>;
}
/**
 * `ctx.on('settings/updated', …)` — the settings service's commit event.
 * The listener signature is declared locally because merging this event into
 * the global cordis `Events` map would collide with the harness's own
 * declaration of the same event inside one program; the call site casts the
 * context once instead.
 */
export interface HostSettingsEventSource {
    on(event: 'settings/updated', listener: (ns: unknown, next: unknown, prev: unknown, source: unknown) => void): () => void;
}
/** Header subset the projection-cache identity binds (createdAt / cwd / lineage). */
export interface HostSessionHeader {
    id: string;
    createdAt: number;
    cwd?: string | null;
    isSeeded?: boolean;
}
/** `sessionQuery.readSession` — complete replay-validated raw log (vendored shape). */
export interface HostSessionLogSnapshot {
    session: HostSessionHeader;
    /** Exact fork-inherited prefix length paired with {@link session}. */
    inheritedEventCount: number;
    events: SessionEvent[];
}
/** Projection cut: whole values as of `asOfSeq` (-1 for an empty log). */
export interface HostProjectionSnapshot {
    asOfSeq: number;
    values: Record<string, unknown>;
}
/** `ctx.sessionProjectionCache` — vendored rc.1 face; the id-only rc.6 calls are gone. */
export interface HostProjectionCache {
    coldSnapshot(meta: HostSessionHeader, inheritedEventCount: number, events: readonly SessionEvent[]): HostProjectionSnapshot;
    cachedSnapshot(meta: HostSessionHeader, inheritedEventCount: number, keys?: readonly string[]): HostProjectionSnapshot | undefined;
}
/** `ctx.sessionQuery` — the read face the panel exercises. */
export interface HostSessionQuery {
    listSessions(signal?: AbortSignal): Promise<SessionRecord[]>;
    readSession(sessionId: string): Promise<HostSessionLogSnapshot>;
    /** Vendored `SessionTitleSnapshot` cut down to the field the panel reads (`title` is non-empty). */
    readTitle(sessionId: string, signal?: AbortSignal): Promise<{
        title: string;
    } | undefined>;
}
