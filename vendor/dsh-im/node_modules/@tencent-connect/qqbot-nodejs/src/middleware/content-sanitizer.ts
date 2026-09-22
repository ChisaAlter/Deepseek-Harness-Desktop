/**
 * Content-sanitizer middleware — clean up raw message text.
 *
 * QQ delivers messages with `<@!{appId}>` mention markers, extra whitespace,
 * and sometimes face-tag markup. This middleware strips those artifacts so
 * downstream middleware (and the user's `onMessage` handler) receives clean
 * human-readable text.
 *
 * Operates on `ctx.message.content` in-place — downstream sees the
 * sanitized version.
 */

import type { Middleware, MiddlewareContext } from "./types.js";

export interface ContentSanitizerOptions {
  /**
   * Whether to strip `<@!{appId}>` / `<@{appId}>` mention markers.
   * Defaults to `true`.
   */
  stripBotMention?: boolean;
  /**
   * Whether to strip all `<@!{id}>` markers (not just the bot's).
   * Defaults to `false`.
   */
  stripAllMentions?: boolean;
  /**
   * Whether to collapse multiple consecutive whitespace / newlines into
   * a single space. Defaults to `false`.
   */
  collapseWhitespace?: boolean;
  /**
   * Whether to parse QQ face tags `[<face,id=xx/>]` into emoji text.
   * Defaults to `false` (just strip them).
   */
  parseFaceTags?: boolean;
  /**
   * Custom transform applied after all built-in sanitization.
   */
  transform?: (content: string, ctx: MiddlewareContext) => string;
}

/**
 * @example
 * ```ts
 * bot.use(contentSanitizer()); // Default: strip bot mention + trim
 * bot.use(contentSanitizer({ stripAllMentions: true, collapseWhitespace: true }));
 * ```
 */
export function contentSanitizer(options: ContentSanitizerOptions = {}): Middleware {
  const {
    stripBotMention = true,
    stripAllMentions = false,
    collapseWhitespace = false,
    parseFaceTags = false,
    transform,
  } = options;

  return async (ctx, next) => {
    let content = ctx.message.content ?? "";

    // Strip mention markers
    if (stripAllMentions) {
      content = content.replace(/<@!?\d+>\s*/g, "");
    } else if (stripBotMention) {
      const appId = ctx.bot.appId;
      if (appId) {
        const re = new RegExp(`<@!?${appId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}>\\s*`, "g");
        content = re[Symbol.replace](content, "");
      }
    }

    // Face tags: old format [<face,id=xx/>] + new format <faceType=xx,faceId="xx",ext="base64">
    if (parseFaceTags) {
      // Old format: map face ids to emoji
      content = content.replace(/\[<face,id=(\d+)\/?>]/g, (_m, id) => faceToEmoji(id) ?? "");
      // New format: decode base64 ext to get face name
      content = content.replace(/<faceType=\d+,faceId="[^"]*",ext="([^"]*)">/g, (_m, ext) => {
        try {
          const decoded = Buffer.from(ext, 'base64').toString('utf-8');
          const parsed = JSON.parse(decoded);
          return `【表情: ${parsed.text || '未知表情'}】`;
        } catch {
          return _m;
        }
      });
    } else {
      // Strip both formats
      content = content.replace(/\[<face,id=\d+\/?>]/g, "");
      content = content.replace(/<faceType=\d+,faceId="[^"]*",ext="[^"]*">/g, "");
    }

    // Collapse whitespace
    if (collapseWhitespace) {
      content = content.replace(/\s+/g, " ");
    }

    // Trim
    content = content.trim();

    // Custom transform
    if (transform) {
      content = transform(content, ctx);
    }

    ctx.message.content = content;
    await next();
  };
}

/** Simplified face-id → emoji mapping (QQ common faces). */
function faceToEmoji(id: string): string | undefined {
  const map: Record<string, string> = {
    "0": "😊", "1": "😣", "2": "😍", "4": "😎", "5": "😭",
    "6": "😳", "7": "🤐", "8": "😴", "9": "😢", "10": "😰",
    "11": "😡", "12": "🤗", "13": "⭐", "14": "🌟", "15": "🌙",
    "16": "👍", "18": "✊", "21": "😊", "23": "😢", "25": "🤔",
    "26": "😱", "27": "😅", "28": "😁", "29": "🤮", "30": "💪",
    "32": "🎉", "33": "😤", "34": "😏", "35": "🥺", "49": "🐷",
    "53": "🎂", "60": "☕", "63": "🌹", "66": "❤️", "74": "🌞",
    "75": "🌛", "76": "👏", "78": "🤝", "79": "✌️", "85": "🎅",
    "89": "🍉", "96": "😓", "97": "😲", "100": "😂", "101": "😊",
    "104": "😭", "106": "😱", "109": "😘", "111": "🥰",
  };
  return map[id];
}
