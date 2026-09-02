export type StorageRowDecoder = (value: unknown) => SessionEventLike[];
interface SessionEventLike {
    type: string;
    [key: string]: unknown;
}
/** Where this build keeps the harness home (desktop sets DSH_HOME explicitly). */
export declare function resolveDshHome(): string;
/**
 * Locate a session's artifact beneath `<home>/sessions`: dirs are
 * `<project>/<encoded-session-id>` and the file is `session.jsonl.zstd`
 * (or an uncompressed `session.jsonl`). The id may arrive either as the
 * full `session-<uuid>` (coverage failed-ids) or the bare uuid.
 */
export declare function locateSessionArtifact(home: string, sessionId: string): Promise<string | null>;
export interface RebuildResult {
    events: number;
    rebuilt: Buffer;
    header: string;
}
/**
 * Decode a full artifact into a rebuilt plaintext+buffer pair: every line is
 * decoded through `decode` (packed rows expand), seqs renumber 0-based
 * continuously, and the body is written as ONE PLAIN EVENT PER LINE. The
 * backend reads layout-blind (packed / unpacked / mixed load identically), so
 * plain rows remove any packer-version compatibility risk for the reader.
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
/** Production codec: the harness's own lossless storage-row decoder. */
export declare function runtimeCodec(): Promise<{
    decode: (value: unknown) => unknown[];
}>;
export {};
