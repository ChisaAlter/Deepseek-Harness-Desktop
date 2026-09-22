/**
 * Bridge `KVStore` → `SessionPersistencePort`.
 *
 * Lets users plug any KV backend (Memory / File / Redis / ...) into the
 * gateway session persistence slot via a single line:
 *
 * ```ts
 * import { QQBot, kvSessionPersistence, FileKVStore } from "@tencent-connect/qqbot-nodejs";
 *
 * const bot = new QQBot({
 *   appId, appSecret,
 *   sessionPersistence: kvSessionPersistence({
 *     store: new FileKVStore({ dir: "./data" }),
 *     accountId: "my-bot",
 *   }),
 * });
 * ```
 */

import type {
  PersistedSession,
  SessionPersistencePort,
} from "../protocol/gateway/gateway-connection.js";
import type { KVStore } from "./kv-store.js";

export interface KVSessionPersistenceOptions {
  /** Underlying KV store. */
  store: KVStore;
  /** Stable account id used as the storage key. */
  accountId: string;
  /** Optional key prefix. Defaults to `qqbot:session:`. */
  prefix?: string;
  /** Optional TTL for the entry, ms. Defaults to 5 min (matches QQ session expiry). */
  ttlMs?: number;
}

/**
 * Build a {@link SessionPersistencePort} backed by any {@link KVStore}.
 */
export function kvSessionPersistence(opts: KVSessionPersistenceOptions): SessionPersistencePort {
  const prefix = opts.prefix ?? "qqbot:session:";
  const key = `${prefix}${opts.accountId}`;
  const ttlMs = opts.ttlMs ?? 5 * 60 * 1000;

  return {
    load() {
      const v = opts.store.get<PersistedSession>(key);
      // Note: KVStore.get may return Promise<>. The gateway port expects
      // a sync result, so callers using async stores should await
      // separately during startup (or use `awaitable` adapter, see TODO).
      if (v && typeof (v as Promise<PersistedSession>).then === "function") {
        // Async store — we can't synchronously resolve here; warn and
        // return null. Users should provide a sync store or warm-up
        // the session via `await kvWarmup(...)` before `bot.start()`.
        return null;
      }
      return (v as PersistedSession) ?? null;
    },
    save(session) {
      void opts.store.set(key, session, ttlMs);
    },
    clear() {
      void opts.store.delete(key);
    },
  };
}
