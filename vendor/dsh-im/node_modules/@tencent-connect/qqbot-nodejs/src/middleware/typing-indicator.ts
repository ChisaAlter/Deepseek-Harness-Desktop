/**
 * Typing-indicator middleware — auto-send a `typing` notification for C2C
 * messages so the user sees a visual hint while the bot is processing.
 *
 * Supports keepalive mode: periodically re-send typing every `intervalSec`
 * to cover long-running AI inference (QQ platform typing window is ~60s).
 *
 * QQ Open Platform restriction: `sendInputNotify` only works for C2C
 * (private chat) targets. Group / Guild messages are silently skipped.
 */

import type { Middleware } from "./types.js";

// ============ Options ============

export interface TypingIndicatorOptions {
  /** Indicator duration per send, in seconds. Defaults to 60. */
  durationSec?: number;
  /**
   * Only send typing for messages that pass `predicate(ctx)`. Defaults to
   * always (returns true).
   */
  predicate?: (ctx: import("./types.js").MiddlewareContext) => boolean;
  /**
   * If `true`, the typing call is awaited before continuing the chain.
   * Defaults to `false` (fire-and-forget).
   */
  awaitTyping?: boolean;
  /**
   * Enable keepalive: re-send typing every `keepAliveIntervalMs` until
   * the downstream middleware chain completes. Defaults to `true`.
   */
  keepAlive?: boolean;
  /**
   * Keepalive interval in milliseconds. Defaults to 50_000 (50s).
   * Should be less than the platform's typing window (~60s).
   */
  keepAliveIntervalMs?: number;
}

// ============ Constants ============

const DEFAULT_DURATION_SEC = 60;
const DEFAULT_KEEPALIVE_INTERVAL_MS = 50_000;

// ============ Middleware ============

/**
 * Auto-send `typing` notification for inbound C2C messages.
 *
 * With keepalive enabled (default), typing is refreshed periodically
 * throughout the entire middleware chain + message handler execution,
 * covering long-running AI inference that may take 30s+.
 *
 * @example
 * ```ts
 * bot.use(typingIndicator()); // keepalive enabled by default
 * bot.on("message", async (msg) => {
 *   // User sees "typing…" continuously while the LLM is generating
 *   const reply = await llm.chat(msg.content);
 *   await bot.sendText(msg.replyTarget, reply);
 * });
 * ```
 */
export function typingIndicator(options: TypingIndicatorOptions = {}): Middleware {
  const durationSec = options.durationSec ?? DEFAULT_DURATION_SEC;
  const predicate = options.predicate ?? (() => true);
  const awaitTyping = options.awaitTyping ?? false;
  const keepAlive = options.keepAlive ?? true;
  const keepAliveIntervalMs = options.keepAliveIntervalMs ?? DEFAULT_KEEPALIVE_INTERVAL_MS;

  return async (ctx, next) => {
    if (ctx.message.kind !== "c2c" || !predicate(ctx)) {
      await next();
      return;
    }

    const sendTyping = () =>
      ctx.bot.sendTyping(ctx.replyTarget, durationSec).catch((err) => {
        ctx.log.debug?.(
          `[typing] failed: ${err instanceof Error ? err.message : String(err)}`,
        );
      });

    // Send initial typing
    const promise = sendTyping();
    if (awaitTyping) {
      await promise;
    }

    // Setup keepalive timer
    let timer: ReturnType<typeof setInterval> | null = null;
    if (keepAlive) {
      timer = setInterval(() => {
        sendTyping();
      }, keepAliveIntervalMs);
    }

    try {
      await next();
    } finally {
      if (timer) {
        clearInterval(timer);
      }
    }
  };
}
