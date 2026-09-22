/**
 * Message filter middleware — drop invalid/duplicate/self-echo messages.
 *
 * Combines two common filtering needs into a single middleware:
 *   1. **Self-echo**: QQ may deliver the bot's own outbound messages back
 *      as inbound events (especially in group chats).
 *   2. **Deduplication**: QQ occasionally pushes the same event more than
 *      once (network retries, reconnect overlap, etc.).
 *
 * Both are enabled by default. Disable either via options.
 *
 * @example
 * ```ts
 * bot.use(messageFilter());                              // both enabled
 * bot.use(messageFilter({ skipSelfEcho: false }));       // only dedup
 * bot.use(messageFilter({ dedup: { windowMs: 10_000 }})); // custom window
 * ```
 */

import type { Middleware } from "./types.js";

export interface MessageFilterOptions {
  /**
   * Drop messages where `senderIsBot === true`.
   * Defaults to `true`.
   */
  skipSelfEcho?: boolean;
  /**
   * Deduplication settings. Set to `false` to disable entirely.
   * Defaults to `{ windowMs: 5000, maxSize: 1000 }`.
   */
  dedup?: false | {
    /** Time window (ms) to keep messageIds. Defaults to `5000`. */
    windowMs?: number;
    /** Max tracked ids. Defaults to `1000`. */
    maxSize?: number;
  };
}

export function messageFilter(options: MessageFilterOptions = {}): Middleware {
  const skipSelfEcho = options.skipSelfEcho ?? true;
  const dedupOpts = options.dedup !== false
    ? { windowMs: 5000, maxSize: 1000, ...(options.dedup ?? {}) }
    : null;

  const seen = dedupOpts ? new Map<string, number>() : null;

  function evict(now: number): void {
    if (!seen || !dedupOpts) return;
    if (seen.size <= dedupOpts.maxSize) return;
    for (const [key, ts] of seen) {
      if (now - ts > dedupOpts.windowMs || seen.size > dedupOpts.maxSize) {
        seen.delete(key);
      } else {
        break;
      }
    }
  }

  return async (ctx, next) => {
    // 1. Self-echo check
    if (skipSelfEcho && ctx.message.senderIsBot) {
      ctx.stop("self-echo");
      return;
    }

    // 2. Deduplication check
    if (seen && dedupOpts) {
      const id = ctx.message.messageId;
      const now = Date.now();
      if (seen.has(id)) {
        ctx.log.debug?.(`[message-filter] dropping duplicate messageId=${id}`);
        ctx.stop("deduplication");
        return;
      }
      seen.set(id, now);
      evict(now);
    }

    await next();
  };
}
