/**
 * Generic key-value store interface — used by built-in pluggable backends.
 *
 * The SDK ships:
 *   - {@link MemoryKVStore}: in-memory (default for tests / simple deployments)
 *   - {@link FileKVStore}:   JSON-file backed (single-process, simple deployments)
 *
 * Users can plug in Redis / SQL / cloud KV by implementing this same
 * interface. See `examples/storage-redis/` for a Redis adapter sketch.
 */

import fs from "node:fs";
import path from "node:path";

// ============ Interface ============

/**
 * Generic async KV store with optional TTL support.
 *
 * All methods may be sync or async; callers always `await` them.
 */
export interface KVStore {
  /** Get a value. Returns `undefined` if missing or expired. */
  get<T = unknown>(key: string): Promise<T | undefined> | T | undefined;
  /** Set a value with optional TTL (milliseconds). */
  set<T = unknown>(key: string, value: T, ttlMs?: number): Promise<void> | void;
  /** Delete a value. Returns true if it existed. */
  delete(key: string): Promise<boolean> | boolean;
  /** Check key existence (cheaper than `get` on some backends). */
  has?(key: string): Promise<boolean> | boolean;
  /** Iterate keys matching a prefix. Optional. */
  keys?(prefix?: string): Promise<string[]> | string[];
  /** Clear all keys (or those matching a prefix). Optional. */
  clear?(prefix?: string): Promise<void> | void;
}

// ============ Memory ============

interface MemoryEntry {
  value: unknown;
  expireAt?: number;
}

/**
 * In-memory KV store. Suitable for single-process deployments and tests.
 */
export class MemoryKVStore implements KVStore {
  private readonly map = new Map<string, MemoryEntry>();

  get<T = unknown>(key: string): T | undefined {
    const entry = this.map.get(key);
    if (!entry) return undefined;
    if (entry.expireAt && entry.expireAt <= Date.now()) {
      this.map.delete(key);
      return undefined;
    }
    return entry.value as T;
  }

  set<T = unknown>(key: string, value: T, ttlMs?: number): void {
    this.map.set(key, {
      value,
      expireAt: ttlMs && ttlMs > 0 ? Date.now() + ttlMs : undefined,
    });
  }

  delete(key: string): boolean {
    return this.map.delete(key);
  }

  has(key: string): boolean {
    const entry = this.map.get(key);
    if (!entry) return false;
    if (entry.expireAt && entry.expireAt <= Date.now()) {
      this.map.delete(key);
      return false;
    }
    return true;
  }

  keys(prefix?: string): string[] {
    const all = [...this.map.keys()];
    return prefix ? all.filter((k) => k.startsWith(prefix)) : all;
  }

  clear(prefix?: string): void {
    if (!prefix) {
      this.map.clear();
      return;
    }
    for (const k of this.map.keys()) {
      if (k.startsWith(prefix)) this.map.delete(k);
    }
  }

  /** Diagnostic: number of keys (incl. expired-but-not-yet-cleaned). */
  size(): number {
    return this.map.size;
  }
}

// ============ File-backed ============

export interface FileKVStoreOptions {
  /** Directory holding the JSON file. */
  dir: string;
  /** File name. Defaults to `kv-store.json`. */
  fileName?: string;
  /** Save throttle window, ms. Defaults to 1000. */
  saveThrottleMs?: number;
  /** Optional logger. */
  logger?: { error?: (msg: string) => void };
}

interface FileEntry {
  value: unknown;
  expireAt?: number;
}

/**
 * JSON-file backed KV store.
 *
 * Loads on construct, throttles writes. Suitable for single-process bots
 * with light persistence needs (e.g. session id, refIdx).
 *
 * Not safe for multi-process / multi-instance use — use a real KV
 * (Redis, SQLite, ...) for that.
 */
export class FileKVStore implements KVStore {
  private readonly map = new Map<string, FileEntry>();
  private readonly filePath: string;
  private readonly saveThrottleMs: number;
  private saveTimer: ReturnType<typeof setTimeout> | null = null;
  private dirty = false;
  private readonly logger: NonNullable<FileKVStoreOptions["logger"]>;

  constructor(opts: FileKVStoreOptions) {
    this.filePath = path.join(opts.dir, opts.fileName ?? "kv-store.json");
    this.saveThrottleMs = opts.saveThrottleMs ?? 1000;
    this.logger = opts.logger ?? {};
    this.load();
  }

  get<T = unknown>(key: string): T | undefined {
    const entry = this.map.get(key);
    if (!entry) return undefined;
    if (entry.expireAt && entry.expireAt <= Date.now()) {
      this.map.delete(key);
      this.scheduleSave();
      return undefined;
    }
    return entry.value as T;
  }

  set<T = unknown>(key: string, value: T, ttlMs?: number): void {
    this.map.set(key, {
      value,
      expireAt: ttlMs && ttlMs > 0 ? Date.now() + ttlMs : undefined,
    });
    this.scheduleSave();
  }

  delete(key: string): boolean {
    const removed = this.map.delete(key);
    if (removed) this.scheduleSave();
    return removed;
  }

  has(key: string): boolean {
    return this.get(key) !== undefined;
  }

  keys(prefix?: string): string[] {
    const all = [...this.map.keys()];
    return prefix ? all.filter((k) => k.startsWith(prefix)) : all;
  }

  clear(prefix?: string): void {
    if (!prefix) {
      this.map.clear();
    } else {
      for (const k of this.map.keys()) {
        if (k.startsWith(prefix)) this.map.delete(k);
      }
    }
    this.scheduleSave();
  }

  /** Force flush pending writes. Call before process exit. */
  flush(): void {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }
    if (this.dirty) {
      this.doSave();
    }
  }

  // ============ Internal ============

  private load(): void {
    try {
      if (!fs.existsSync(this.filePath)) return;
      const raw = fs.readFileSync(this.filePath, "utf-8");
      const data = JSON.parse(raw) as Record<string, FileEntry>;
      const now = Date.now();
      for (const [k, e] of Object.entries(data)) {
        if (e.expireAt && e.expireAt <= now) continue;
        this.map.set(k, e);
      }
    } catch (err) {
      this.logger.error?.(
        `[file-kv-store] load failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  private scheduleSave(): void {
    this.dirty = true;
    if (this.saveTimer) return;
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      this.doSave();
    }, this.saveThrottleMs);
  }

  private doSave(): void {
    try {
      fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
      const obj: Record<string, FileEntry> = {};
      for (const [k, e] of this.map) obj[k] = e;
      const tmp = this.filePath + ".tmp";
      fs.writeFileSync(tmp, JSON.stringify(obj, null, 2), "utf-8");
      fs.renameSync(tmp, this.filePath);
      this.dirty = false;
    } catch (err) {
      this.logger.error?.(
        `[file-kv-store] save failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
}
