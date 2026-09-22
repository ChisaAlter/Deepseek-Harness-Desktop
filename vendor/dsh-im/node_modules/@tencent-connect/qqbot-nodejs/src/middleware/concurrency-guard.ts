/**
 * Concurrency-guard middleware — per-target serial message processing.
 *
 * Ensures only one message is being processed at a time for each
 * target (user or group). Prevents concurrent stream_messages calls
 * to the same QQ user/group which causes platform 500 errors.
 *
 * Strategy:
 *   - "queue":  New messages wait until the current one finishes.
 *   - "drop":   New messages are silently dropped while busy.
 *   - "abort":  Cancel the current processing, start the new one.
 *   - "merge":  Buffer new messages while the active one is being
 *               processed. When the active message finishes, all
 *               buffered messages are merged via `onMerge` into one
 *               survivor ctx. The survivor proceeds through the rest
 *               of the chain via its own `next()`. Non-survivors
 *               return silently (chain stops).
 *
 * The concurrency key is `${scope}:${targetId}` (e.g. "c2c:OPENID"
 * or "group:GROUPID").
 *
 * Implementation note on "merge" — the "queue + batch" model:
 *
 *   The active message (A) runs through the full chain normally via
 *   `next()`. Incoming messages (B, C, D) pause on a promise without
 *   calling `ctx.stop()` — they do not advance the chain. When A
 *   finishes, all buffered ctxs are merged. One survivor is chosen;
 *   its waiter is marked and proceeds to call `next()`. All other
 *   waiters return silently.
 *
 *   This guarantees:
 *     1. A runs immediately with zero delay and its content stays
 *        untouched.
 *     2. Buffered messages are merged and processed exactly once per
 *        batch via the survivor's own `next()`.
 *     3. Non-survivors' chains stop naturally (no upstream `next()`
 *        call), no `ctx.stop()` needed.
 *     4. No suspended-promise complexity, no framework coupling.
 *
 * @example
 * ```ts
 * bot.use(concurrencyGuard({ strategy: "queue", maxQueue: 3 }));
 * bot.use(concurrencyGuard({
 *   strategy: "merge",
 *   maxQueue: 50,
 *   onMerge: (buffered) => mergeContexts(buffered),
 *   onDispatch: (merged) => bot.sendText(...), // legacy
 * }));
 * ```
 */

import type { Middleware, MiddlewareContext } from "./types.js";

export type ConcurrencyStrategy = "queue" | "drop" | "abort" | "merge";

export interface ConcurrencyGuardOptions {
  /**
   * How to handle a new message when the target is busy.
   * - "queue":  Wait for the current message to finish (default).
   * - "drop":   Silently skip the new message.
   * - "abort":  Abort current processing via AbortController, then process new.
   * - "merge":  Buffer new messages while busy; when the active message
   *             finishes, merge & dispatch the batch.
   */
  strategy?: ConcurrencyStrategy;
  /**
   * Maximum processing time (ms) for a single active message. When the
   * active chain exceeds this duration, the guard **aborts** the chain
   * via `ctx.abort()`, releases the lock, and drains any buffered
   * messages.
   *
   * Aborting propagates the `AbortSignal` through the remaining middleware
   * chain and downstream agent pipeline, canceling in-flight LLM calls,
   * tool executions, and streaming.
   *
   * Set to `0` to disable the timeout (no limit). Default: `0` (disabled).
   */
  maxProcessingMs?: number;
  /** Max queued messages per target (for "queue") or max buffered messages (for "merge"). Default: 3. */
  maxQueue?: number;
  /** Called when a message is dropped (strategy=drop or queue/buffer overflow). */
  onDrop?: (ctx: MiddlewareContext) => void | Promise<void>;
  /**
   * Merge function for "merge" strategy. Receives the array of buffered
   * contexts in arrival order and must return one of them (the "survivor"),
   * mutated in place to represent the merged result.
   *
   * If not provided, {@link defaultMerge} is used: the first context is
   * kept and all message contents are concatenated with newline separators.
   */
  onMerge?: (buffered: MiddlewareContext[]) => MiddlewareContext;
  /**
   * @deprecated Legacy merge-dispatch callback. When set, merged batches
   * are dispatched via `onDispatch(mergedCtx)` instead of flowing through
   * the survivor's own `next()`. Prefer the default chain-based mechanism.
   */
  onDispatch?: (ctx: MiddlewareContext) => void | Promise<void>;
  /**
   * Predicate signaling an urgent message that should skip the queue.
   * When true (e.g. `/stop`), all buffered/waiting messages for the
   * same target are silently dropped and the ctx proceeds through the
   * remaining middleware chain immediately (parallel to active owner).
   * Only meaningful with "merge" strategy.
   */
  urgentPredicate?: (ctx: MiddlewareContext) => boolean;
}

interface QueueEntry {
  run: () => void;
  ctx?: MiddlewareContext;
}

/** A buffered ctx waiting for the current batch to finish. */
interface MergeWaiter {
  ctx: MiddlewareContext;
  resolve: () => void;
  /** Set when this waiter's ctx is chosen as the survivor. */
  markSurvivor: () => void;
}

interface TargetState {
  busy: boolean;
  queue: QueueEntry[];
  activeCtx?: MiddlewareContext;
  mergeBuffer?: MiddlewareContext[];
  mergeWaiters?: MergeWaiter[];
}

export function concurrencyGuard(options: ConcurrencyGuardOptions = {}): Middleware {
  const strategy = options.strategy ?? "queue";
  const maxQueue = options.maxQueue ?? 3;
  const { onDrop, onMerge, onDispatch, urgentPredicate, maxProcessingMs } = options;

  const locks = new Map<string, TargetState>();

  function getState(key: string): TargetState {
    let s = locks.get(key);
    if (!s) {
      s = { busy: false, queue: [] };
      locks.set(key, s);
    }
    return s;
  }

  function cleanupState(key: string): void {
    const s = locks.get(key);
    if (
      s &&
      !s.busy &&
      s.queue.length === 0 &&
      (!s.mergeBuffer || s.mergeBuffer.length === 0)
    ) {
      locks.delete(key);
    }
  }

  function targetKey(ctx: MiddlewareContext): string {
    const t = ctx.message.replyTarget;
    return `${t.scope}:${t.targetId}`;
  }

  const guard: Middleware = async (ctx, next) => {
    const key = targetKey(ctx);
    const state = getState(key);

    if (!state.busy) {
      // No active processing — proceed immediately.
      state.busy = true;
      state.activeCtx = ctx;

      if (strategy === "merge") {
        state.mergeBuffer = [];
        state.mergeWaiters = [];
      }

      // Timeout watchdog: abort the active chain after maxProcessingMs.
      // ctx.abort() propagates AbortSignal through the remaining middleware
      // chain and downstream agent pipeline, canceling in-flight LLM calls,
      // tool executions, and streaming.
      let timedOut = false;
      let timeoutId: ReturnType<typeof setTimeout> | undefined;
      if (maxProcessingMs && maxProcessingMs > 0) {
        timeoutId = setTimeout(() => {
          timedOut = true;
          ctx.log.warn?.(
            `[concurrency] aborting active chain ${key} after ${maxProcessingMs}ms`,
          );
          ctx.abort('concurrency:processing-timeout');
          // Release lock BEFORE draining — the next message in queue will
          // set busy=true, which would be overwritten if we did it after.
          state.busy = false;
          state.activeCtx = undefined;
          if (strategy === 'merge') {
            drainMergeBuffer(key, state, ctx).catch(() => {});
          } else {
            drainQueue(key);
          }
          cleanupState(key);
        }, maxProcessingMs);
      }

      try {
        await next();
      } finally {
        if (timeoutId) clearTimeout(timeoutId);

        if (!timedOut) {
          // timeout not triggered, release lock normally
          state.activeCtx = undefined;

          if (strategy === "merge") {
            await drainMergeBuffer(key, state, ctx);
            state.busy = false;
          } else {
            state.busy = false;
            if (strategy === "queue" || strategy === "abort") {
              drainQueue(key);
            }
          }

          cleanupState(key);
        }
      }
      return;
    }

    // Target is busy — apply strategy
    switch (strategy) {
      case "merge": {
        if (!state.mergeBuffer || !state.mergeWaiters) {
          state.mergeBuffer = [];
          state.mergeWaiters = [];
        }

        // Urgent message: flush buffered waiters, continue remaining chain
        // immediately via next() in parallel to active owner.
        if (urgentPredicate?.(ctx)) {
          ctx.log.debug?.(`[concurrency:merge] urgent for ${key}`);
          for (const w of state.mergeWaiters) w.resolve();
          state.mergeBuffer.length = 0;
          state.mergeWaiters.length = 0;
          await next();
          return;
        }

        if (state.mergeBuffer.length >= maxQueue) {
          ctx.log.debug?.(`[concurrency:merge] buffer full (${maxQueue}), drop for ${key}`);
          await onDrop?.(ctx);
          ctx.stop("concurrency:merge-full");
          return;
        }

        ctx.log.debug?.(
          `[concurrency:merge] buffered: ${key} (msgId=${ctx.message.messageId} ` +
          `pos=${state.mergeBuffer.length + 1})`,
        );

        // Buffer the ctx and pause — do NOT stop the chain.
        state.mergeBuffer.push(ctx);

        // Wait until the batch is processed. If we are the survivor,
        // proceed to next(); otherwise return silently.
        let isSurvivor = false;
        await new Promise<void>((resolve) => {
          state.mergeWaiters!.push({
            ctx,
            resolve,
            markSurvivor: () => {
              isSurvivor = true;
            },
          });
        });

        if (isSurvivor) {
          await next();
        }
        return;
      }

      case "drop": {
        ctx.log.debug?.(`[concurrency] drop message for busy target ${key}`);
        await onDrop?.(ctx);
        ctx.stop("concurrency:drop");
        return;
      }

      case "abort": {
        ctx.log.debug?.(`[concurrency] abort previous for ${key}`);

        state.activeCtx?.abort("concurrency:abort");

        for (const entry of state.queue) {
          entry.ctx?.abort("concurrency:superseded");
          entry.run();
        }
        state.queue.length = 0;

        await waitForRelease(state, ctx);

        if (ctx.signal.aborted) {
          ctx.log.debug?.(`[concurrency] superseded while waiting for ${key}`);
          return;
        }

        state.busy = true;
        state.activeCtx = ctx;
        try {
          await next();
        } finally {
          state.busy = false;
          state.activeCtx = undefined;
          drainQueue(key);
        }
        return;
      }

      case "queue":
      default: {
        if (state.queue.length >= maxQueue) {
          ctx.log.debug?.(`[concurrency] queue full (${maxQueue}), drop for ${key}`);
          await onDrop?.(ctx);
          ctx.stop("concurrency:queue-full");
          return;
        }

        ctx.log.debug?.(`[concurrency] queued message for ${key} (pos=${state.queue.length + 1})`);
        await new Promise<void>((resolve) => {
          state.queue.push({ run: resolve });
        });

        state.busy = true;
        state.activeCtx = ctx;
        try {
          await next();
        } finally {
          state.busy = false;
          state.activeCtx = undefined;
          drainQueue(key);
        }
        return;
      }
    }
  };

  /**
   * Drain the merge buffer: merge buffered ctxs into one survivor,
   * mark it, and resolve all waiters. The survivor then proceeds
   * through its own `next()`. If `onDispatch` is set (legacy),
   * dispatch via callback instead.
   */
  async function drainMergeBuffer(
    key: string,
    state: TargetState,
    ownerCtx: MiddlewareContext,
  ): Promise<void> {
    while (state.mergeBuffer && state.mergeBuffer.length > 0) {
      const buffered = state.mergeBuffer.splice(0);
      const waiters = state.mergeWaiters?.splice(0) ?? [];

      // Merge the buffered ctxs.
      const survivor = onMerge ? onMerge(buffered) : defaultMerge(buffered);
      const validSurvivor = buffered.includes(survivor) ? survivor : buffered[0]!;

      ownerCtx.log.debug?.(
        `[concurrency:merge] flushing batch: ${key} (count=${buffered.length})`,
      );

      // Dispatch: onDispatch (legacy) or survivor self-proceeds via next().
      if (onDispatch) {
        state.activeCtx = validSurvivor;
        try {
          await onDispatch(validSurvivor);
        } catch (err) {
          validSurvivor.log.error?.(
            `[concurrency:merge] onDispatch error: ${err instanceof Error ? err.message : String(err)}`,
          );
        } finally {
          state.activeCtx = undefined;
        }
        // All waiters resolve — none are survivors.
        for (const w of waiters) w.resolve();
      } else {
        // Mark the survivor's waiter; resolve all.
        for (const w of waiters) {
          if (w.ctx === validSurvivor) w.markSurvivor();
          w.resolve();
        }
      }
    }

    state.mergeBuffer = undefined;
    state.mergeWaiters = undefined;
  }

  function drainQueue(key: string) {
    const state = locks.get(key);
    if (!state) return;
    const entry = state.queue.shift();
    if (entry) {
      entry.run();
    } else if (!state.busy) {
      locks.delete(key);
    }
  }

  function waitForRelease(
    state: { busy: boolean; queue: QueueEntry[] },
    ctx?: MiddlewareContext,
  ): Promise<void> {
    if (!state.busy) return Promise.resolve();
    return new Promise<void>((resolve) => {
      state.queue.unshift({ run: resolve, ctx });
    });
  }

  /**
   * Default merge: concatenate contents with newline, keep first ctx as survivor.
   */
  function defaultMerge(buffered: MiddlewareContext[]): MiddlewareContext {
    const first = buffered[0]!;
    if (buffered.length === 1) return first;

    const contentBearingCtxs = buffered.filter(
      (ctx) => (ctx.message.content ?? "") !== "",
    );

    const contents = contentBearingCtxs.map((ctx) => ctx.message.content as string);
    if (contents.length > 0) {
      first.message.content = contents.join("\n");
    }

    const envelopes = contentBearingCtxs
      .map((ctx) => ctx.state.envelope as string | undefined)
      .filter(Boolean);
    if (envelopes.length > 0) {
      first.state.envelope = envelopes.join("\n\n");
    }

    const allAttachments = contentBearingCtxs.flatMap(
      (ctx) => ctx.message.attachments ?? [],
    );
    if (allAttachments.length > 0) {
      first.message.attachments = allAttachments;
    }

    return first;
  }

  return guard;
}
