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
// ============ Helpers ============
function matcherMatches(matcher, value, ctx) {
    if (matcher === "*")
        return true;
    if (typeof matcher === "string")
        return matcher === value;
    if (matcher instanceof RegExp)
        return matcher.test(value);
    if (typeof matcher === "function")
        return matcher(ctx);
    return false;
}
function evaluateScope(policy, identifier, ctx) {
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
export function accessPolicy(policy = {}) {
    return async (ctx, next) => {
        const { kind, senderId, groupOpenid, channelId } = ctx.message;
        let result;
        if (kind === "c2c" || kind === "dm") {
            result = evaluateScope(policy.c2c, senderId, ctx);
        }
        else if (kind === "group") {
            result = evaluateScope(policy.group, groupOpenid ?? "", ctx);
        }
        else if (kind === "guild") {
            result = evaluateScope(policy.guild, channelId ?? "", ctx);
        }
        else {
            result = { allowed: true, reason: "" };
        }
        if (!result.allowed) {
            ctx.log.debug?.(`[access] blocked ${kind} message from ${senderId}: ${result.reason}`);
            policy.onBlock?.(ctx, result.reason);
            ctx.stop(`access:${result.reason}`);
            return;
        }
        await next();
    };
}
//# sourceMappingURL=access-policy.js.map