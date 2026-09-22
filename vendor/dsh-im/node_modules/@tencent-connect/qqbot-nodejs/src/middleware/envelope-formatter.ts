/**
 * Envelope-formatter middleware — assemble LLM prompt context.
 *
 * Gathers information from upstream middleware (history, quote, mention
 * state, sender info) and formats it into a structured context string
 * attached to `ctx.state.envelope`. This is the "last mile" before the
 * user's LLM call — providing a ready-to-use prompt prefix.
 *
 * This middleware is **optional** — users who prefer to build their own
 * prompt can skip it and read `ctx.state.history` / `ctx.state.quote`
 * directly.
 */

import type { Middleware, MiddlewareContext } from "./types.js";
import type { HistoryEntry } from "./history-buffer.js";
import type { ResolvedQuote } from "./quote-ref.js";

export interface EnvelopeFormatterOptions {
  /**
   * Maximum number of history entries to include.
   * Defaults to `5`.
   */
  historyLimit?: number;
  /**
   * Whether to include the resolved quote in the envelope.
   * Defaults to `true`.
   */
  includeQuote?: boolean;
  /**
   * Whether to include sender name / id as context.
   * Defaults to `true`.
   */
  includeSender?: boolean;
  /**
   * Custom formatter override. If provided, replaces the default logic
   * entirely. Receives the same ctx and should return the formatted string.
   */
  format?: (ctx: MiddlewareContext) => string;
}

/**
 * @example
 * ```ts
 * bot.use(historyBuffer({ limit: 10 }));
 * bot.use(quoteResolver({ store: refStore }));
 * bot.use(envelopeFormatter({ historyLimit: 5 }));
 *
 * bot.on("message", async (msg) => {
 *   const envelope = msg._ctx?.state.envelope as string;
 *   const response = await llm.chat(envelope + "\n" + msg.content);
 *   await bot.sendText(msg.replyTarget, response);
 * });
 * ```
 */
export function envelopeFormatter(options: EnvelopeFormatterOptions = {}): Middleware {
  const {
    historyLimit = 5,
    includeQuote = true,
    includeSender = true,
    format,
  } = options;

  return async (ctx, next) => {
    if (format) {
      ctx.state.envelope = format(ctx);
    } else {
      ctx.state.envelope = buildEnvelope(ctx, { historyLimit, includeQuote, includeSender });
    }

    ctx.log.debug?.(
      `[envelope] built ${(ctx.state.envelope as string).length} chars` +
      ` (sender=${includeSender}, quote=${includeQuote}, history=${(ctx.state.history as unknown[] | undefined)?.length ?? 0}/${historyLimit})`,
    );

    await next();
  };
}

function buildEnvelope(
  ctx: MiddlewareContext,
  opts: { historyLimit: number; includeQuote: boolean; includeSender: boolean },
): string {
  const sections: string[] = [];

  // ── Context meta ──
  if (opts.includeSender) {
    const name = ctx.message.senderName || ctx.message.senderId;
    const scope = ctx.message.kind === "group"
      ? `group(${ctx.message.groupOpenid ?? "unknown"})`
      : ctx.message.kind;
    sections.push(`<from>\nuser: ${name}\nscope: ${scope}\n</from>`);
  }

  // ── Quoted message (reply-to) ──
  if (opts.includeQuote) {
    const quote = ctx.state.quote as ResolvedQuote | undefined;
    if (quote && quote.text) {
      const sender = quote.entry?.senderName || quote.entry?.senderId;
      const line = sender ? `${sender}: ${quote.text}` : quote.text;
      sections.push(`<reply_to>\n${line}\n</reply_to>`);
    }
  }

  // ── Conversation history ──
  const history = ctx.state.history as HistoryEntry[] | undefined;
  if (history && history.length > 0) {
    const recent = history.slice(-opts.historyLimit);
    const lines = recent.map((h) => {
      const name = h.senderName || h.senderId;
      return `${name}: ${h.content.slice(0, 200)}`;
    });
    sections.push(`<history>\n${lines.join("\n")}\n</history>`);
  }

  // ── Current message ──
  const content = (ctx.message.content ?? "").trim();
  const attachments = ctx.message.attachments;
  const hasAttachments = attachments && attachments.length > 0;

  if (content || hasAttachments) {
    const parts: string[] = [];
    if (content) {
      parts.push(content);
    }
    if (hasAttachments) {
      for (const att of attachments) {
        const t = att.content_type.toLowerCase();
        if (t.startsWith("image/")) parts.push(`[image: ${att.filename ?? "image"}]`);
        else if (t.startsWith("audio/") || t === "voice") {
          parts.push(att.asr_refer_text ? `[voice: ${att.asr_refer_text}]` : "[voice]");
        }
        else if (t.startsWith("video/")) parts.push("[video]");
        else parts.push(`[file: ${att.filename ?? "file"}]`);
      }
    }
    sections.push(`<message>\n${parts.join("\n")}\n</message>`);
  }

  return sections.join("\n\n");
}
