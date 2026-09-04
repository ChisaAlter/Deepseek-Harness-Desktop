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
