/**
 * Decode one parsed JSONL line value into the session event(s) it stores.
 * Chunk-row-tagged values validate and expand (a malformed row throws — it is
 * corrupt storage, and treating it as an event would silently drop a whole
 * run); every other value passes through as a single event, unvalidated.
 * An unrecognised `-chunks` tag means a newer packing generation: throw so the
 * repair aborts instead of rewriting a row it cannot expand.
 */
export declare function decodeStorageRecord(value: unknown): unknown[];
