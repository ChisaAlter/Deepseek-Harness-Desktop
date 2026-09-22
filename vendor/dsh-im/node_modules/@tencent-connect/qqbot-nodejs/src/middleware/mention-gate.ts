/**
 * Mention-gate middleware — decide whether a group message should be answered.
 *
 * QQ Bot group messages may or may not contain an `@bot` mention. Many
 * production bots want to **only respond to mentions** in group chats while
 * still listening to all C2C messages. This middleware encapsulates that
 * common decision.
 *
 * The decision is exposed in `ctx.state.mention` for downstream middleware
 * to inspect (e.g. a history-buffer middleware may still record non-mention
 * messages without triggering a reply).
 */

import type { Middleware, MiddlewareContext } from "./types.js";
import { resolvePolicy } from "./types.js";

// ============ Types ============

export interface MentionDecision {
  /** True if the bot was explicitly @-mentioned. */
  wasMentioned: boolean;
  /**
   * True if the message satisfies an *implicit* mention rule (e.g. it is a
   * reply to a previous bot message).
   */
  implicit: boolean;
  /** Effective answer: whether the bot should respond. */
  shouldAnswer: boolean;
  /** When `shouldAnswer === false`, the gate's reason for skipping. */
  reason: "no_mention" | "other_mention" | "passthrough";
}

export interface MentionGateOptions {
  /**
   * Require an `@bot` mention in group messages. Defaults to `true`.
   * When `false`, every group message is treated as addressed to the bot.
   */
  requireMentionInGroup?: boolean;

  /**
   * Treat C2C messages as always addressed to the bot. Defaults to `true`.
   */
  alwaysAnswerC2C?: boolean;

  /**
   * Optional implicit-mention probe — return true to bypass the
   * `requireMentionInGroup` check (e.g. when the message is a reply to a
   * prior bot message). This is a per-message signal, orthogonal to
   * `resolveConfig` which is a per-group policy.
   */
  isImplicitMention?: (ctx: MiddlewareContext) => boolean;

  /**
   * Hook invoked when the gate skips a message. Use for telemetry or to
   * record the message into a history buffer despite skipping.
   */
  onSkip?: (ctx: MiddlewareContext, decision: MentionDecision) => void;

  /**
   * If `true`, skip group messages that mention other users/bots but do
   * **not** mention this bot. This prevents the bot from responding to
   * conversations directed at other participants.
   *
   * Defaults to `false`.
   */
  ignoreOtherMentions?: boolean;

  /**
   * If `true`, do **not** stop the middleware chain when the message should
   * not be answered — only annotate `ctx.state.mention`. Useful when other
   * middleware (e.g. history buffering) still needs to run.
   *
   * Defaults to `false` (stop the chain on skip).
   */
  passthrough?: boolean;

  /**
   * Dynamic config resolver — called for each message before the gate logic
   * runs. The returned values override the static defaults
   * (`requireMentionInGroup`, `ignoreOtherMentions`).
   *
   * Use this when different groups / contexts need different mention policies
   * without registering separate `mentionGate` instances.
   */
  resolveConfig?: (ctx: MiddlewareContext) => {
    requireMentionInGroup?: boolean;
    ignoreOtherMentions?: boolean;
  };
}

// ============ Helpers ============

/** Heuristic: detect `<@!{appId}>` or `<@{appId}>` mention markers in content. */
function detectMentionInContent(content: string, appId: string): boolean {
  if (!content || !appId) return false;
  const re = new RegExp(`<@!?${appId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}>`);
  return re.test(content);
}

// ============ Middleware ============

/**
 * Build a mention-gate middleware.
 *
 * @example
 * ```ts
 * // Static config
 * bot.use(mentionGate({ requireMentionInGroup: true }));
 *
 * // Dynamic per-group config
 * bot.use(mentionGate({
 *   resolveConfig: (ctx) => {
 *     const cfg = resolveGroupConfig(ctx.message.groupId);
 *     return {
 *       requireMentionInGroup: cfg.requireMention,
 *       ignoreOtherMentions: cfg.ignoreOtherMentions,
 *     };
 *   },
 * }));
 * ```
 */
export function mentionGate(options: MentionGateOptions = {}): Middleware {
  const {
    requireMentionInGroup = true,
    alwaysAnswerC2C = true,
    isImplicitMention,
    onSkip,
    ignoreOtherMentions = false,
    passthrough = false,
    resolveConfig,
  } = options;

  return async (ctx, next) => {
    const msg = ctx.message;
    const appId = ctx.bot.appId;

    // Only group messages need gating
    if (msg.kind !== "group") {
      const decision: MentionDecision = {
        wasMentioned: true,
        implicit: false,
        shouldAnswer: alwaysAnswerC2C || (msg.kind !== "c2c" && msg.kind !== "dm"),
        reason: "passthrough",
      };
      ctx.state.mention = decision;
      await next();
      return;
    }

    // Dynamic config resolution — priority:
    //   1. resolveConfig callback (explicit per-middleware override)
    //   2. ctx.state.policy (injected by upstream policy injector)
    //   3. static option defaults
    const dynamic = resolveConfig?.(ctx);
    const effectiveRequireMention = resolvePolicy(
      ctx, "group.requireMention",
      dynamic?.requireMentionInGroup,
      requireMentionInGroup,
    );
    const effectiveIgnoreOther = resolvePolicy(
      ctx, "group.ignoreOtherMentions",
      dynamic?.ignoreOtherMentions,
      ignoreOtherMentions,
    );

    // ---- Group: decide ----
    //
    // Priority order for "was mentioned":
    //   1. rawEventType === GROUP_AT_MESSAGE_CREATE
    //      The event itself is QQ's authoritative signal — the Open Platform
    //      only delivers this event when the user actually @-ed the bot.
    //   2. mentions[].is_you === true
    //      Server-marked structured mention list (present on some payloads).
    //   3. Content contains `<@!{appId}>` or `<@{appId}>`
    //      Fallback scan for self-hosted / private-domain bots that also
    //      receive GROUP_MESSAGE_CREATE (every group message, not just @).
    const wasMentioned =
      msg.rawEventType === "GROUP_AT_MESSAGE_CREATE" ||
      (Array.isArray(msg.mentions) && msg.mentions.some((m) => m?.is_you === true)) ||
      detectMentionInContent(msg.content, appId);

    const implicit = isImplicitMention?.(ctx) ?? false;

    // ---- Determine shouldAnswer & reason ----
    let shouldAnswer = !effectiveRequireMention || wasMentioned || implicit;
    let reason: MentionDecision["reason"] = shouldAnswer ? "passthrough" : "no_mention";

    // ignoreOtherMentions: when requireMention is true and the message
    // @-ed someone else but NOT this bot, override to skip.
    // When requireMention is false the user explicitly wants all group
    // messages answered, so ignoreOtherMentions does not apply.
    if (
      effectiveIgnoreOther &&
      effectiveRequireMention &&
      !wasMentioned &&
      !implicit
    ) {
      const mentions = msg.mentions as Array<{ is_you?: boolean; bot?: boolean }> | undefined;
      if (Array.isArray(mentions) && mentions.length > 0) {
        shouldAnswer = false;
        reason = "other_mention";
      }
    }

    const decision: MentionDecision = {
      wasMentioned,
      implicit,
      shouldAnswer,
      reason,
    };

    ctx.state.mention = decision;

    if (!shouldAnswer) {
      onSkip?.(ctx, decision);
      ctx.log.debug?.(
        `[mention-gate] skip group message (${reason}): wasMentioned=${wasMentioned}, implicit=${implicit}`,
      );
      if (!passthrough) {
        ctx.stop(`mention-gate:${reason}`);
        return;
      }
    }

    await next();
  };
}
