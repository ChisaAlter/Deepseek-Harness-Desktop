/**
 * Quote & Ref-Index middleware — record messages + resolve quoted references.
 *
 * A single middleware that does two things in one pass:
 *   1. **Record** — captures a compact summary of the current message into
 *      a pluggable store (default: in-memory LRU), keyed by `msgIdx` or `messageId`.
 *   2. **Resolve** — if the current message quotes/replies to a previous one
 *      (`refMsgIdx` set), looks it up from the store or falls back to QQ's
 *      `msg_elements[0]` push data.
 *
 * The resolved quote is attached to `ctx.state.quote`.
 *
 * @example
 * ```ts
 * import { quoteRef } from "@tencent-connect/qqbot-nodejs";
 *
 * bot.use(quoteRef());                          // zero-config
 * bot.use(quoteRef({ maxSize: 1000 }));         // custom LRU size
 * bot.use(quoteRef({ store: myRedisStore }));   // custom backend
 * ```
 */

import type { Middleware, MiddlewareContext } from "./types.js";

// ============ Types ============

/** Compact summary stored per message. */
export interface RefEntry {
  messageId: string;
  senderId: string;
  senderName?: string;
  content: string;
  timestamp: string;
  /** Extensible: stores may accept extra keys for domain-specific metadata. */
  [key: string]: unknown;
}

/** Pluggable store interface for ref-index. */
export interface RefIndexStore {
  get(key: string): RefEntry | undefined | Promise<RefEntry | undefined>;
  set(key: string, entry: RefEntry): void | Promise<void>;
}

/** Attachment summary from the quoted message (from msg_elements). */
export interface QuotedAttachment {
  contentType: string;
  url: string;
  filename?: string;
  /** ASR text for voice messages (QQ built-in speech recognition). */
  asrText?: string;
}

/** Resolved quote attached to `ctx.state.quote`. */
export interface ResolvedQuote {
  /** The ref key that was looked up. */
  refKey: string;
  /** Source of the resolution. */
  source: "store" | "msg_elements" | "none";
  /** The resolved entry from store (cache hit). */
  entry?: RefEntry;
  /** Raw content from msg_elements[0] (cache miss fallback). */
  rawContent?: string;
  /** Attachments from the quoted message (from msg_elements[0]). */
  attachments?: QuotedAttachment[];
  /**
   * Combined text representation of the quoted message.
   * Prefers store entry content; falls back to msg_elements content.
   */
  text: string;
}

export interface QuoteRefOptions {
  /** Backing store. Defaults to an in-memory LRU. */
  store?: RefIndexStore;
  /** Max entries in the default in-memory LRU. Defaults to 500. */
  maxSize?: number;
  /** Max content chars stored per entry. Defaults to 200. */
  contentLimit?: number;
  /** Enrich the stored entry with extra fields before writing. */
  enrichEntry?: (entry: RefEntry, ctx: MiddlewareContext) => RefEntry;
  /** When true, prefer msg_elements data over stored entry for richer content. */
  preferMsgElements?: boolean;
}

// ============ Default in-memory LRU ============

/**
 * Default in-memory ref-index store (LRU eviction).
 *
 * Suitable for single-process bots. For multi-instance deployments,
 * implement `RefIndexStore` with Redis / SQL / etc.
 */
export class MemoryRefIndexStore implements RefIndexStore {
  private readonly map = new Map<string, RefEntry>();
  private readonly maxSize: number;

  constructor(maxSize = 500) {
    this.maxSize = maxSize;
  }

  get(key: string): RefEntry | undefined {
    return this.map.get(key);
  }

  set(key: string, entry: RefEntry): void {
    if (this.map.size >= this.maxSize) {
      const first = this.map.keys().next().value;
      if (first !== undefined) this.map.delete(first);
    }
    this.map.set(key, entry);
  }
}

// ============ Middleware ============

/**
 * Combined quote & ref-index middleware.
 *
 * One middleware does both: records the current message into the store
 * **and** resolves any quoted message reference.
 *
 * @example
 * ```ts
 * bot.use(quoteRef());   // that's it — zero config
 *
 * bot.on("message", (msg) => {
 *   // Access resolved quote via middleware state
 *   // (ctx.state.quote is typed as ResolvedQuote)
 * });
 * ```
 */
export function quoteRef(options: QuoteRefOptions = {}): Middleware {
  const contentLimit = options.contentLimit ?? 200;
  const store = options.store ?? new MemoryRefIndexStore(options.maxSize ?? 500);

  return async (ctx, next) => {
    const msg = ctx.message;

    // ── 1. Record current message ──
    const key = msg.msgIdx ?? msg.messageId;
    if (key) {
      let entry: RefEntry = {
        messageId: msg.messageId,
        senderId: msg.senderId,
        senderName: msg.senderName,
        content: (msg.content ?? "").slice(0, contentLimit),
        timestamp: msg.timestamp,
        isBot: msg.senderIsBot,
        scope: msg.kind,
      };
      if (options.enrichEntry) {
        entry = options.enrichEntry(entry, ctx);
      }
      await store.set(key, entry);
    }

    // ── 2. Resolve quoted message (if any) ──
    const refKey = msg.refMsgIdx;
    if (refKey) {
      const entry = await store.get(refKey);

      // 尝试从 msg_elements 解析引用内容（优先于 store entry 时使用）
      const resolveFromElements = () => {
        const el = msg.msgElements?.[0];
        if (!el || (!el.content && !el.attachments?.length)) return null;
        const rawContent = el.content ?? "";
        const attachments = parseAttachments(el.attachments);
        return { rawContent, attachments, text: buildText(rawContent, attachments) };
      };

      if (entry) {
        const elementsQuote = options.preferMsgElements !== false ? resolveFromElements() : null;
        if (elementsQuote) {
          ctx.state.quote = {
            refKey, source: "msg_elements",
            rawContent: elementsQuote.rawContent,
            attachments: elementsQuote.attachments,
            text: elementsQuote.text,
          };
        } else {
          ctx.state.quote = {
            refKey, source: "store", entry,
            text: entry.content || "[empty message]",
          };
        }
        ctx.log.debug?.(`[quote-ref] hit refKey=${refKey} sender=${entry.senderId}`);
      } else {
        const elementsQuote = resolveFromElements();
        if (elementsQuote) {
          ctx.state.quote = {
            refKey, source: "msg_elements",
            rawContent: elementsQuote.rawContent,
            attachments: elementsQuote.attachments,
            text: elementsQuote.text,
          };
        } else {
          ctx.state.quote = { refKey, source: "none", text: "" };
        }
        ctx.log.debug?.(`[quote-ref] ${elementsQuote ? 'fallback' : 'miss'} refKey=${refKey}`);
      }
    }

    await next();
  };
}

// ============ Helpers ============

function parseAttachments(
  raw: Array<{ content_type: string; url: string; filename?: string; asr_refer_text?: string }> | undefined,
): QuotedAttachment[] {
  if (!raw || raw.length === 0) return [];
  return raw.map((a) => ({
    contentType: a.content_type,
    url: a.url,
    filename: a.filename,
    asrText: a.asr_refer_text,
  }));
}

function buildText(content: string, attachments: QuotedAttachment[]): string {
  const parts: string[] = [];
  if (content.trim()) parts.push(content.trim());
  for (const att of attachments) {
    const t = att.contentType.toLowerCase();
    if (t.startsWith("audio/")) {
      parts.push(att.asrText ? `[voice: ${att.asrText}]` : "[voice]");
    } else if (t.startsWith("image/")) {
      parts.push(att.filename ? `[image: ${att.filename}]` : "[image]");
    } else if (t.startsWith("video/")) {
      parts.push(att.filename ? `[video: ${att.filename}]` : "[video]");
    } else {
      parts.push(`[file: ${att.filename ?? "untitled"}]`);
    }
  }
  return parts.join("\n") || "[empty message]";
}
