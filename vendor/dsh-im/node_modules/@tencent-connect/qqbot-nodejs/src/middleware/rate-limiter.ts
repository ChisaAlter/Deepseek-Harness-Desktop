/**
 * Rate-limiter middleware — configurable multi-tier rate limiting.
 *
 * Supports three tiers: per-sender, per-group, and global. Uses a
 * sliding-window counter algorithm. When a message exceeds the limit,
 * the chain is short-circuited; an optional `onLimit` hook lets users
 * send a friendly rejection or log the event.
 */

import type { Middleware, MiddlewareContext } from "./types.js";

export interface RateLimitTier {
  /** Max requests within the window. */
  max: number;
  /** Window duration in milliseconds. */
  windowMs: number;
}

export interface RateLimiterOptions {
  /** Per-sender limit. Keyed by `senderId`. */
  perSender?: RateLimitTier;
  /** Per-group limit. Keyed by `groupOpenid` (group only; C2C uses senderId). */
  perGroup?: RateLimitTier;
  /** Global limit across all messages. */
  global?: RateLimitTier;
  /**
   * Hook invoked when a message is rate-limited. Use to send a reply or
   * log. Return value is ignored.
   */
  onLimit?: (ctx: MiddlewareContext, tier: "perSender" | "perGroup" | "global") => void | Promise<void>;
}

// ============ Sliding window counter ============

class SlidingWindow {
  private readonly buckets = new Map<string, number[]>();
  private readonly max: number;
  private readonly windowMs: number;

  constructor(tier: RateLimitTier) {
    this.max = tier.max;
    this.windowMs = tier.windowMs;
  }

  /** Returns `true` if allowed, `false` if rate-limited. */
  check(key: string): boolean {
    const now = Date.now();
    let arr = this.buckets.get(key);
    if (!arr) {
      arr = [];
      this.buckets.set(key, arr);
    }

    // Evict expired entries
    while (arr.length > 0 && now - arr[0]! > this.windowMs) {
      arr.shift();
    }

    if (arr.length >= this.max) {
      return false;
    }

    arr.push(now);
    return true;
  }
}

/**
 * @example
 * ```ts
 * bot.use(rateLimiter({
 *   perSender: { max: 5, windowMs: 60_000 },   // 5 msg/min per user
 *   perGroup:  { max: 30, windowMs: 60_000 },  // 30 msg/min per group
 *   global:    { max: 100, windowMs: 60_000 },  // 100 msg/min total
 *   onLimit: async (ctx, tier) => {
 *     await ctx.bot.sendText(ctx.replyTarget, `请稍后再试（${tier}限流）`);
 *   },
 * }));
 * ```
 */
export function rateLimiter(options: RateLimiterOptions = {}): Middleware {
  const { onLimit } = options;
  const perSender = options.perSender ? new SlidingWindow(options.perSender) : undefined;
  const perGroup = options.perGroup ? new SlidingWindow(options.perGroup) : undefined;
  const global = options.global ? new SlidingWindow(options.global) : undefined;

  return async (ctx, next) => {
    const senderId = ctx.message.senderId;
    const groupKey = ctx.message.groupOpenid ?? senderId;

    // Check global first (cheapest to short-circuit)
    if (global && !global.check("__global__")) {
      await onLimit?.(ctx, "global");
      ctx.stop("rate-limit:global");
      return;
    }

    if (perGroup && !perGroup.check(groupKey)) {
      await onLimit?.(ctx, "perGroup");
      ctx.stop("rate-limit:perGroup");
      return;
    }

    if (perSender && !perSender.check(senderId)) {
      await onLimit?.(ctx, "perSender");
      ctx.stop("rate-limit:perSender");
      return;
    }

    await next();
  };
}
