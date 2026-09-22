/**
 * Middleware chain — pluggable inbound message processing pipeline.
 *
 * Inspired by Koa / Express middleware: each middleware receives a context
 * object and a `next()` function, and may run arbitrary logic before / after
 * downstream middleware. Calling `ctx.stop()` (or simply not calling `next()`)
 * short-circuits the chain.
 *
 * The SDK ships several **built-in middleware** in `./middleware/*` that cover
 * common needs (access policy, mention gating, command dispatch). Users can
 * compose them, replace them, or add their own.
 *
 * @example
 * ```ts
 * import { QQBot, accessPolicy, mentionGate } from "@tencent-connect/qqbot-nodejs";
 *
 * const bot = new QQBot({ appId, appSecret });
 *
 * bot.use(accessPolicy({ allowFrom: ["*"] }));
 * bot.use(mentionGate({ requireMentionInGroup: true }));
 * bot.use(async (ctx, next) => {
 *   // Custom logic before
 *   await next();
 *   // Custom logic after
 * });
 *
 * bot.on("message", async (msg) => {
 *   await bot.sendText(msg.replyTarget, `Echo: ${msg.content}`);
 * });
 * ```
 */

import type { QQBot, QQBotInboundMessage, ReplyTarget } from "../QQBot.js";
import type { Logger } from "../protocol/types.js";

// ============ Types ============

/**
 * Free-form per-request state slot, augmentable via TS module augmentation.
 * Built-in middleware fills well-known keys (see `middleware/index.ts`).
 */
export interface MiddlewareState {
  [key: string]: unknown;

  /**
   * Dynamic policy injection — set by an upstream "policy injector" middleware.
   *
   * Built-in middlewares read well-known keys from here as a fallback:
   *
   * **Group policy** (`state.policy.group`):
   * - `requireMention` — `mentionGate` fallback
   * - `ignoreOtherMentions` — `mentionGate` fallback
   * - `historyLimit` — `historyBuffer` fallback
   *
   * **Session scope** (`state.policy.scope`): `"c2c" | "group" | "dm" | "channel"`
   *
   * **Extensibility** — users can add any keys for custom middlewares:
   * ```
   * ctx.state.policy.customToolPolicy = "full";
   * ```
   */
  policy?: {
    group?: {
      requireMention?: boolean;
      ignoreOtherMentions?: boolean;
      historyLimit?: number;
      [key: string]: unknown;
    };
    scope?: "c2c" | "group" | "dm" | "channel";
    [key: string]: unknown;
  };
}

/**
 * Context passed to each middleware.
 *
 * Mutating `ctx.message` or `ctx.replyTarget` propagates to downstream
 * middleware and to the final `bot.on("message")` listener.
 */
export interface MiddlewareContext {
  /** The QQBot instance — middlewares can call `bot.sendText` etc. */
  readonly bot: QQBot;
  /** The inbound message being processed. Mutable — middlewares can rewrite. */
  message: QQBotInboundMessage;
  /** The derived reply target. Same object reference as `message.replyTarget`. */
  readonly replyTarget: ReplyTarget;
  /**
   * Free-form per-request state slot. Use this to share data between
   * middlewares (e.g. a parsed command struct, an authentication result).
   *
   * Built-in middleware writes well-known keys here:
   * - `command`: parsed slash-command (set by `slashCommand` middleware)
   * - `mention`: mention-gate decision (set by `mentionGate` middleware)
   * - `history`: buffered history entries (set by `historyBuffer` middleware)
   *
   * Users may also add arbitrary keys.
   */
  state: MiddlewareState;
  /** Logger. */
  readonly log: Logger;
  /**
   * Stop the chain immediately. Equivalent to not calling `next()` and
   * preventing any downstream middleware (or the `message` event listener)
   * from running.
   */
  stop(reason?: string): void;
  /** Whether `stop()` has been called (or some upstream short-circuited). */
  readonly stopped: boolean;
  /** Reason passed to `stop()`, if any. */
  readonly stopReason: string | undefined;
  /**
   * AbortSignal for this request. Aborted when `ctx.abort()` is called.
   *
   * Use this to cancel in-flight async work (e.g. streaming, LLM calls)
   * when a middleware (like `concurrencyGuard`) decides to interrupt
   * the current processing.
   *
   * @example
   * ```ts
   * bot.on("message", async (ctx, msg) => {
   *   for await (const chunk of llmStream) {
   *     if (ctx.signal.aborted) break;
   *     await stream.update(chunk);
   *   }
   * });
   * ```
   */
  readonly signal: AbortSignal;
  /**
   * Abort the current request processing. Triggers `signal` and calls
   * `stop()`. Use from middleware to interrupt an in-flight handler.
   */
  abort(reason?: string): void;
  /** Whether `abort()` has been called. */
  readonly aborted: boolean;
  /**
   * Timestamp (`Date.now()`) when the SDK created this context.
   * Use to measure end-to-end latency from event arrival to handler completion.
   */
  readonly receivedAt: number;
}

/** Middleware function — `next` advances the chain. */
export type Middleware = (
  ctx: MiddlewareContext,
  next: () => Promise<void>,
) => void | Promise<void>;

// ============ Policy Resolution Helper ============

/**
 * Resolve an option with the standard 3-tier priority chain:
 *
 *   1. `explicit` — the value passed directly to the middleware Options
 *   2. `ctx.state.policy.<path>` — injected by an upstream policy injector
 *   3. `defaultValue` — hardcoded fallback
 *
 * `path` uses dot notation to navigate nested policy keys, e.g.
 * `"group.requireMention"`, `"group.historyLimit"`, `"myFeature.threshold"`.
 *
 * @example
 * ```ts
 * const limit = resolvePolicy(ctx, "group.historyLimit", options.limit, 10);
 * const reqMention = resolvePolicy(ctx, "group.requireMention", options.requireMentionInGroup, true);
 * ```
 */
export function resolvePolicy<T>(
  ctx: MiddlewareContext,
  path: string,
  explicit: T | undefined,
  defaultValue: T,
): T {
  if (explicit !== undefined && explicit !== null) {
    return explicit;
  }
  const keys = path.split(".");
  let value: unknown = ctx.state.policy;
  for (const key of keys) {
    if (value === null || value === undefined) break;
    value = (value as Record<string, unknown>)[key];
  }
  if (value !== undefined && value !== null) {
    return value as T;
  }
  return defaultValue;
}

// ============ Implementation ============

/**
 * Run a middleware chain.
 *
 * Returns `true` if the chain ran to completion (no `stop()`); `false` if
 * any middleware short-circuited.
 *
 * Errors thrown by middleware propagate up — the caller decides whether to
 * surface them via `bot.emit("error")` or swallow them.
 */
export async function runMiddlewareChain(
  middlewares: Middleware[],
  ctx: MiddlewareContext,
): Promise<boolean> {
  let index = -1;

  const dispatch = async (i: number): Promise<void> => {
    if (i <= index) {
      throw new Error("next() called multiple times");
    }
    index = i;
    if (ctx.stopped) {
      return;
    }
    if (i >= middlewares.length) {
      return;
    }
    const fn = middlewares[i];
    if (!fn) {
      return;
    }
    await fn(ctx, () => dispatch(i + 1));
  };

  await dispatch(0);
  return !ctx.stopped;
}

/**
 * Build a fresh middleware context for one inbound message.
 *
 * Internal helper — used by {@link QQBot} when dispatching inbound events.
 */
export function createMiddlewareContext(params: {
  bot: QQBot;
  message: QQBotInboundMessage;
  log: Logger;
}): MiddlewareContext {
  const receivedAt = Date.now();
  let stopped = false;
  let stopReason: string | undefined;
  const ac = new AbortController();

  const ctx: MiddlewareContext = {
    bot: params.bot,
    message: params.message,
    replyTarget: params.message.replyTarget,
    state: {},
    log: params.log,
    stop(reason?: string) {
      stopped = true;
      stopReason = reason;
    },
    get stopped() {
      return stopped;
    },
    get stopReason() {
      return stopReason;
    },
    get signal() {
      return ac.signal;
    },
    abort(reason?: string) {
      ac.abort(reason);
      stopped = true;
      stopReason = reason ?? "aborted";
    },
    get aborted() {
      return ac.signal.aborted;
    },
    receivedAt,
  };

  return ctx;
}
