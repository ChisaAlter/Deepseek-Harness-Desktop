/**
 * Slash-command middleware — register `/cmd` style commands.
 *
 * Pattern: any message whose content starts with a configured prefix
 * (default `/`) is intercepted; the matched command's `handler` runs, and
 * the chain is short-circuited so the `bot.on("message")` listener does
 * not fire.
 *
 * Commands are **explicitly registered** on the middleware instance so the
 * SDK does not enforce any specific business commands — users define what
 * makes sense for their bot.
 */

import type { ReplyTarget } from "../QQBot.js";
import type { Middleware, MiddlewareContext } from "./types.js";

// ============ Types ============

/** Parsed command struct exposed via `ctx.state.command`. */
export interface ParsedCommand {
  /** The command name (without leading prefix). */
  name: string;
  /** Whitespace-separated arguments after the command name. */
  args: string[];
  /** Raw arguments string (everything after the command name). */
  raw: string;
}

/** Result returned by a slash-command handler. */
export type SlashCommandResult =
  | string                                                // Text reply
  | { kind: "text"; content: string }                     // Explicit text
  | { kind: "noop" }                                      // Silently consume
  | void;                                                 // = noop

export interface SlashCommandHandlerContext extends MiddlewareContext {
  /** Parsed command struct. */
  command: ParsedCommand;
}

/** Spec for one registered command. */
export interface SlashCommand {
  /** Command name(s). The first is canonical; the rest are aliases. */
  name: string | string[];
  /** Brief description (used by `/help`). */
  description?: string;
  /** Optional usage hint (used by `/help`). */
  usage?: string;
  /** Whether this command is hidden from `/help`. Defaults to false. */
  hidden?: boolean;
  /** Scope restriction: "c2c" = only private chat, "group" = only group, "all" = both (default). */
  scope?: "c2c" | "group" | "all";
  /**
   * Handler. Return a string to send a text reply, or `{ kind: "noop" }`
   * to silently consume.
   */
  handler: (ctx: SlashCommandHandlerContext) => Promise<SlashCommandResult> | SlashCommandResult;
  /**
   * Optional authorization check executed before the handler.
   * - Return `true` to allow execution.
   * - Return `false` or a string to block; the string is sent as an error
   *   reply (e.g. `"⚠️ 无权限"`). Default blocked message: `"⚠️ 无权限执行此命令"`.
   */
  authorized?: (ctx: SlashCommandHandlerContext) => boolean | string;
}

export interface SlashCommandOptions {
  /** Command prefix(es). Defaults to `["/"]`. */
  prefixes?: string[];
  /** Pre-registered commands. */
  commands?: SlashCommand[];
  /**
   * If `true`, when a command throws, the error is caught and
   * `{ kind: "text", content: errorMessage }` is sent as a reply.
   * Defaults to `true`.
   */
  catchErrors?: boolean;
  /**
   * Auto-register a `/help` command listing all visible commands.
   * Defaults to `true`.
   */
  autoHelp?: boolean;
  /**
   * Global allowlist of user OpenIDs permitted to use slash commands.
   * If empty or not set, all users can use commands.
   * Non-allowlisted users' command-like messages pass through to `next()`
   * as regular messages.
   */
  allowFrom?: string[];
}

// ============ Implementation ============

/**
 * Slash-command middleware factory.
 *
 * Returns a middleware **and** a registry — the registry lets you keep
 * adding commands after the middleware is registered with the bot.
 *
 * @example
 * ```ts
 * const slash = slashCommand({ prefixes: ["/", "!"] });
 * slash.register({
 *   name: "ping",
 *   description: "Reply with pong",
 *   handler: () => "pong",
 * });
 *
 * slash.register({
 *   name: ["whoami", "me"],
 *   handler: (ctx) => `You are ${ctx.message.senderId}`,
 * });
 *
 * bot.use(slash.middleware);
 * ```
 */
export function slashCommand(options: SlashCommandOptions = {}): {
  middleware: Middleware;
  register: (cmd: SlashCommand) => void;
  unregister: (name: string) => void;
  list: () => SlashCommand[];
} {
  const prefixes = options.prefixes ?? ["/"];
  const catchErrors = options.catchErrors ?? true;
  const autoHelp = options.autoHelp ?? true;
  const allowFrom = options.allowFrom ?? [];

  const registry = new Map<string, SlashCommand>();

  const register = (cmd: SlashCommand): void => {
    const names = Array.isArray(cmd.name) ? cmd.name : [cmd.name];
    if (names.length === 0) {
      throw new Error("slash-command: name must not be empty");
    }
    for (const n of names) {
      const key = n.toLowerCase();
      if (registry.has(key)) {
        throw new Error(`slash-command: duplicate name "${n}"`);
      }
      registry.set(key, cmd);
    }
  };

  const unregister = (name: string): void => {
    registry.delete(name.toLowerCase());
  };

  const list = (): SlashCommand[] => {
    const seen = new Set<SlashCommand>();
    const out: SlashCommand[] = [];
    for (const cmd of registry.values()) {
      if (!seen.has(cmd)) {
        seen.add(cmd);
        out.push(cmd);
      }
    }
    return out;
  };

  // Pre-register commands
  for (const cmd of options.commands ?? []) {
    register(cmd);
  }

  // Auto /help
  if (autoHelp && !registry.has("help")) {
    register({
      name: "help",
      description: "List all available commands",
      handler: () => {
        const lines: string[] = ["Available commands:"];
        for (const cmd of list()) {
          if (cmd.hidden) continue;
          const names = Array.isArray(cmd.name) ? cmd.name.join(", ") : cmd.name;
          const desc = cmd.description ?? "";
          const usage = cmd.usage ? ` — ${cmd.usage}` : "";
          lines.push(`/${names}${usage}${desc ? ` — ${desc}` : ""}`);
        }
        return lines.join("\n");
      },
    });
  }

  const middleware: Middleware = async (ctx, next) => {
    const content = (ctx.message.content ?? "").trim();
    if (!content) {
      await next();
      return;
    }

    // Strip server-side `<@bot>` mention markers from content for matching.
    const cleaned = content.replace(/<@!?[^>]+>\s*/g, "").trim();

    // 群聊场景：必须 @bot 才触发命令
    if (ctx.message.kind === 'group') {
      const msg = ctx.message as { mentions?: Array<{ is_you?: boolean }>; rawEventType?: string };
      const wasMentioned =
        msg.rawEventType === 'GROUP_AT_MESSAGE_CREATE' ||
        msg.mentions?.some((m) => m.is_you);
      if (!wasMentioned) {
        await next();
        return;
      }
    }

    // Find matching prefix
    const prefix = prefixes.find((p) => cleaned.startsWith(p));
    if (!prefix) {
      await next();
      return;
    }

    const body = cleaned.slice(prefix.length);
    const match = /^(\S+)(?:\s+(.*))?$/.exec(body);
    if (!match) {
      await next();
      return;
    }

    const [, name, rest = ""] = match;
    const cmd = registry.get(name!.toLowerCase());
    if (!cmd) {
      await next();
      return;
    }

    // AllowFrom check: non-allowlisted users bypass commands as regular messages
    const isAllowed = allowFrom.length === 0
      || allowFrom.includes('*')
      || allowFrom.includes(ctx.message.senderId);
    if (!isAllowed) {
      await next();
      return;
    }

    const parsed: ParsedCommand = {
      name: name!.toLowerCase(),
      args: rest ? rest.split(/\s+/) : [],
      raw: rest,
    };
    ctx.state.command = parsed;

    // Scope check: reject if command is restricted to a different scope
    const cmdScope = cmd.scope ?? "all";
    if (cmdScope !== "all") {
      const msgKind = ctx.message.kind;
      const isC2C = msgKind === "c2c" || msgKind === "dm";
      const isGroup = msgKind === "group";
      if ((cmdScope === "c2c" && !isC2C) || (cmdScope === "group" && !isGroup)) {
        const hint = cmdScope === "c2c" ? "该指令仅限私聊使用" : "该指令仅限群聊使用";
        await sendCommandResult(ctx, hint);
        ctx.stop(`command:scope-denied:${parsed.name}`);
        return;
      }
    }

    const handlerCtx = ctx as SlashCommandHandlerContext;
    handlerCtx.command = parsed;

    // Per-command authorization check
    if (cmd.authorized) {
      const auth = cmd.authorized(handlerCtx);
      if (auth !== true) {
        const authMsg = typeof auth === 'string' ? auth : '⚠️ 无权限执行此命令';
        await sendCommandResult(ctx, { kind: 'text', content: authMsg });
        ctx.stop(`command:unauthorized:${parsed.name}`);
        return;
      }
    }

    try {
      const result = await cmd.handler(handlerCtx);
      await sendCommandResult(ctx, result);
    } catch (err) {
      if (catchErrors) {
        const msg = err instanceof Error ? err.message : String(err);
        ctx.log.error?.(`[slash-command] handler "${parsed.name}" threw: ${msg}`);
        await sendCommandResult(ctx, { kind: "text", content: `Error: ${msg}` });
      } else {
        ctx.stop(`command:error:${parsed.name}`);
        throw err;
      }
    }

    // Commands always short-circuit the chain.
    ctx.stop(`command:matched:${parsed.name}`);
  };

  return { middleware, register, unregister, list };
}

async function sendCommandResult(
  ctx: MiddlewareContext,
  result: SlashCommandResult,
): Promise<void> {
  if (result === undefined || result === null) return;
  if (typeof result === "string") {
    if (result) await ctx.bot.sendText(ctx.replyTarget as ReplyTarget, result);
    return;
  }
  if (typeof result === "object") {
    if (result.kind === "text" && result.content) {
      await ctx.bot.sendText(ctx.replyTarget as ReplyTarget, result.content);
    }
    // kind === "noop" → no-op
  }
}
