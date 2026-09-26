export { decodeStorageRecord } from './storage-rows.ts';
export type StorageRowDecoder = (value: unknown) => SessionEventLike[];
interface SessionEventLike {
    type: string;
    [key: string]: unknown;
}
/** Where this build keeps the harness home (desktop sets DSH_HOME explicitly). */
export declare function resolveDshHome(): string;
/** Repair is limited to ids reported by this scan, never arbitrary RPC input. */
export declare function isRepairableSessionId(sessionId: unknown, failedSessionIds: readonly string[]): sessionId is string;
/**
 * Locate a session's artifact beneath `<home>/sessions`: dirs are
 * `<project>/<encoded-session-id>` and the file is the HIGHEST canonical
 * generation the backend would read (`session.vN.jsonl.zstd`, with v0's
 * `session.jsonl.zstd` as the unversioned name) — never an obsolete earlier
 * generation left behind by a format migration. Compressed candidates win
 * over uncompressed ones; the uncompressed set is only a graceful fallback
 * (the rebuild rejects it later). The exact persisted id is preferred; old
 * callers that supply a bare UUID may still resolve a `session-` directory.
 */
export declare function locateSessionArtifact(home: string, sessionId: string): Promise<string | null>;
export interface RebuildResult {
    events: number;
    rebuilt: Buffer;
    header: string;
}
/**
 * Rebuild a full artifact into a plaintext+buffer pair. A v3 artifact takes
 * the admission rewrite in {@link admitV3Lines}; anything else the
 * backend reads natively decodes every line through `decode` (packed rows
 * expand),
 * renumbers seqs 0-based continuously, and writes ONE PLAIN EVENT PER LINE.
 * The header line is preserved verbatim (format version + identity).
 */
export declare function rebuildSessionLog(bytes: Buffer, decode: (value: unknown) => unknown[]): Promise<RebuildResult>;
export interface RepairOutcome {
    repaired: number;
    backup: string;
    bytesBefore: number;
    bytesAfter: number;
}
/**
 * Repair one damaged session artifact: read → decode all rows → renumber →
 * plain-event rewrite → backup (timestamped copy) → atomic temp+rename
 * replace. Aborts without writing on ANY decode/serialize failure.
 */
export declare function repairSessionLog(home: string, sessionId: string, decode: (value: unknown) => unknown[]): Promise<RepairOutcome>;
