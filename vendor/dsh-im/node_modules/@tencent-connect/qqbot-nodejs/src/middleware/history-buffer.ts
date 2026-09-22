/**
 * History-buffer middleware — keep recent group messages around.
 *
 * Many bots want to feed the LLM a few rounds of recent context, even for
 * messages that did not directly @-mention the bot. This middleware
 * silently records every group message into a per-group ring buffer, then
 * exposes the buffered list via `ctx.state.history`.
 *
 * **Pluggable storage** — the actual store is whatever object the user
 * passes in. The SDK ships an in-memory implementation; users can drop in
 * Redis / SQL / file-backed stores via the `HistoryStore` interface.
 */

import type { Middleware, MiddlewareContext } from "./types.js";
import { resolvePolicy } from "./types.js";

// ============ Types ============

/** One buffered message. */
export interface HistoryEntry {
  senderId: string;
  senderName?: string;
  content: string;
  timestamp: number;
  /** Original message id (for de-duplication). */
  messageId: string;
}

/** Pluggable storage backend. */
export interface HistoryStore {
  /** Append one entry into a group's buffer. Caller-provided ordering. */
  append(groupKey: string, entry: HistoryEntry, limit: number): void | Promise<void>;
  /** Return the most-recent entries for a group (oldest → newest). */
  list(groupKey: string, limit: number): HistoryEntry[] | Promise<HistoryEntry[]>;
  /** Optional: clear a group's buffer. */
  clear?(groupKey: string): void | Promise<void>;
}

export interface HistoryBufferOptions {
  /** Max entries kept per group. Defaults to 50. */
  limit?: number;
  /** Storage backend. Defaults to {@link MemoryHistoryStore}. */
  store?: HistoryStore;
  /**
   * Whether to record the message even when an upstream middleware called
   * `ctx.stop()` (e.g. mention-gate skipped a no-mention group message).
   * Defaults to `true` — history exists precisely to capture the chatter
   * we did not respond to.
   */
  recordOnSkip?: boolean;
  /** Group-key derivation. Defaults to `groupOpenid`. */
  groupKey?: (ctx: MiddlewareContext) => string | undefined;
}

// ============ In-memory store ============

/**
 * Default in-memory history store. Keeps a ring buffer per group key.
 *
 * Suitable for single-process bots; for multi-instance deployments use
 * a Redis / SQL backed implementation.
 */
export class MemoryHistoryStore implements HistoryStore {
  private readonly buffers = new Map<string, HistoryEntry[]>();

  append(groupKey: string, entry: HistoryEntry, limit: number): void {
    let buf = this.buffers.get(groupKey);
    if (!buf) {
      buf = [];
      this.buffers.set(groupKey, buf);
    }
    // De-dup by messageId.
    if (buf.some((e) => e.messageId === entry.messageId)) {
      return;
    }
    buf.push(entry);
    if (buf.length > limit) {
      buf.splice(0, buf.length - limit);
    }
  }

  list(groupKey: string, limit: number): HistoryEntry[] {
    const buf = this.buffers.get(groupKey);
    if (!buf) return [];
    return buf.slice(-limit);
  }

  clear(groupKey: string): void {
    this.buffers.delete(groupKey);
  }

  /** Diagnostic: number of groups with buffered history. */
  size(): number {
    return this.buffers.size;
  }
}

// ============ Middleware ============

/**
 * Build a history-buffer middleware.
 *
 * The middleware:
 *   1. Records the current group message into the store (before downstream).
 *   2. Exposes `ctx.state.history: HistoryEntry[]` to downstream middleware
 *      and to the final `bot.on("message")` listener (oldest → newest,
 *      excluding the current message).
 *
 * @example
 * ```ts
 * const history = historyBuffer({ limit: 5 });
 * bot.use(mentionGate({ passthrough: true }));   // record even on no-mention
 * bot.use(history);
 *
 * bot.on("message", async (msg) => {
 *   const buf = msg.history ?? [];
 *   const prompt = buf.map(h => `${h.senderName}: ${h.content}`).join("\n");
 *   // ...
 * });
 * ```
 */
export function historyBuffer(options: HistoryBufferOptions = {}): Middleware {
  const limit = options.limit ?? 50;
  const store = options.store ?? new MemoryHistoryStore();
  const recordOnSkip = options.recordOnSkip ?? true;
  const getKey =
    options.groupKey ??
    ((ctx) => (ctx.message.kind === "group" ? ctx.message.groupOpenid : undefined));

  const m: Middleware = async (ctx, next) => {
    const key = getKey(ctx);
    if (!key) {
      await next();
      return;
    }

    // Effective limit — priority: static option > ctx.state.policy > default 50
    const effectiveLimit = resolvePolicy(ctx, "group.historyLimit", limit, 50);

    // 1. List buffered (excluding current message)
    const buffered = await store.list(key, effectiveLimit);
    ctx.state.history = buffered;

    // 2. Record the current message (after exposing previous buffer)
    const entry: HistoryEntry = {
      senderId: ctx.message.senderId,
      senderName: ctx.message.senderName,
      content: ctx.message.content,
      timestamp: Date.parse(ctx.message.timestamp) || Date.now(),
      messageId: ctx.message.messageId,
    };

    try {
      await store.append(key, entry, effectiveLimit);
    } catch (err) {
      ctx.log.error?.(
        `[history-buffer] append failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    if (ctx.stopped && !recordOnSkip) {
      return;
    }

    await next();
  };

  return m;
}
