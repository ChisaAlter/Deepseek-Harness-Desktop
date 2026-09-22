/**
 * Access policy middleware — gate inbound messages by sender / group allow-list.
 *
 * QQ Bot has no native concept of "allow-list"; this is a SDK-side mechanism
 * commonly required by production deployments (allow only specific group ids,
 * specific QQ openids, etc).
 *
 * The middleware is **purely declarative** — it simply evaluates the policy
 * against `ctx.message` and short-circuits the chain when blocked.
 */

import type { Middleware, MiddlewareContext } from "./types.js";

// ============ Policy Types ============

/** Match rules for `allowFrom` / `denyFrom`. */
export type AccessMatcher =
  | "*"                             // Match anything
  | string                           // Exact id (groupId / senderId)
  | RegExp                           // Regex match
  | ((ctx: MiddlewareContext) => boolean);

/** Policy applied to one chat scope. */
export interface ScopePolicy {
  /** "open": allow all; "allowlist": only allow listed; "disabled": block all. */
  mode?: "open" | "allowlist" | "disabled";
  /** Patterns whose match → allow. Used with mode=allowlist. */
  allow?: AccessMatcher[];
  /** Patterns whose match → block. Evaluated before allow. */
  deny?: AccessMatcher[];
}

/** Full access policy. */
export interface AccessPolicy {
  /** Default policy for direct messages (C2C / DM). Defaults to `open`. */
  c2c?: ScopePolicy;
  /** Policy for group messages. Defaults to `open`. */
  group?: ScopePolicy;
  /** Policy for guild channel messages. Defaults to `open`. */
  guild?: ScopePolicy;
  /**
   * Optional callback when a message is blocked. Use for telemetry.
   */
  onBlock?: (ctx: MiddlewareContext, reason: string) => void;
}

// ============ Helpers ============

function matcherMatches(matcher: AccessMatcher, value: string, ctx: MiddlewareContext): boolean {
  if (matcher === "*") return true;
  if (typeof matcher === "string") return matcher === value;
  if (matcher instanceof RegExp) return matcher.test(value);
  if (typeof matcher === "function") return matcher(ctx);
  return false;
}

function evaluateScope(
  policy: ScopePolicy | undefined,
  identifier: string,
  ctx: MiddlewareContext,
): { allowed: boolean; reason: string } {
  const mode = policy?.mode ?? "open";

  // Deny list always evaluated first
  if (policy?.deny) {
    for (const m of policy.deny) {
      if (matcherMatches(m, identifier, ctx)) {
        return { allowed: false, reason: `denied by deny-list (${identifier})` };
      }
    }
  }

  if (mode === "disabled") {
    return { allowed: false, reason: "scope disabled by policy" };
  }

  if (mode === "open") {
    return { allowed: true, reason: "" };
  }

  // mode === "allowlist"
  if (!policy?.allow || policy.allow.length === 0) {
    return { allowed: false, reason: "allowlist is empty" };
  }
  for (const m of policy.allow) {
    if (matcherMatches(m, identifier, ctx)) {
      return { allowed: true, reason: "" };
    }
  }
  return { allowed: false, reason: `not in allowlist (${identifier})` };
}

// ============ Middleware ============

/**
 * Build an access-policy middleware.
 *
 * Identifier used for matching:
 * - `c2c` / `dm` → senderId (user openid)
 * - `group`     → groupOpenid
 * - `guild`     → channelId
 *
 * @example
 * ```ts
 * bot.use(accessPolicy({
 *   c2c:   { mode: "open" },
 *   group: { mode: "allowlist", allow: ["group-openid-1", "group-openid-2"] },
 *   onBlock: (ctx, reason) => console.warn("blocked", reason),
 * }));
 * ```
 */
export function accessPolicy(policy: AccessPolicy = {}): Middleware {
  return async (ctx, next) => {
    const { kind, senderId, groupOpenid, channelId } = ctx.message;

    let result: { allowed: boolean; reason: string };

    if (kind === "c2c" || kind === "dm") {
      result = evaluateScope(policy.c2c, senderId, ctx);
    } else if (kind === "group") {
      result = evaluateScope(policy.group, groupOpenid ?? "", ctx);
    } else if (kind === "guild") {
      result = evaluateScope(policy.guild, channelId ?? "", ctx);
    } else {
      result = { allowed: true, reason: "" };
    }

    if (!result.allowed) {
      ctx.log.debug?.(
        `[access] blocked ${kind} message from ${senderId}: ${result.reason}`,
      );
      policy.onBlock?.(ctx, result.reason);
      ctx.stop(`access:${result.reason}`);
      return;
    }

    await next();
  };
}
