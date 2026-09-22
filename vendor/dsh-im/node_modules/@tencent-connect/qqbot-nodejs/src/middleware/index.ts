/**
 * Middleware module barrel.
 *
 * Provides a Koa-style middleware chain plus a curated set of built-in
 * middleware that cover the most common QQ Bot needs:
 *
 * **Core pipeline (dataflow stages):**
 * - {@link selfEchoFilter}    — drop bot's own echo messages
 * - {@link deduplication}     — drop duplicate messages (QQ retry overlap)
 * - {@link contentSanitizer}  — strip @markers, face tags, whitespace
 * - {@link accessPolicy}      — gate by allow / deny lists
 * - {@link mentionGate}       — only respond to @mentions in groups
 * - {@link refIndexRecorder}  — record messages for quote resolution
 * - {@link quoteResolver}     — resolve quoted/referenced messages
 * - {@link slashCommand}      — `/cmd` style command dispatch
 * - {@link historyBuffer}     — buffer recent group messages
 * - {@link envelopeFormatter} — assemble LLM prompt context
 * - {@link typingIndicator}   — auto-show typing for C2C
 * - {@link errorHandler}      — catch errors and reply
 *
 * **Policy / protection:**
 * - {@link rateLimiter}       — multi-tier sliding-window rate limiting
 *
 * Compose them or replace them — `bot.use(...)` accepts any
 * {@link Middleware} function.
 */

// Core types
export type { Middleware, MiddlewareContext } from "./types.js";
export { runMiddlewareChain, createMiddlewareContext, resolvePolicy } from "./types.js";

// ── P0: Filters & protection ──

export { messageFilter } from "./message-filter.js";
export type { MessageFilterOptions } from "./message-filter.js";

export { contentSanitizer } from "./content-sanitizer.js";
export type { ContentSanitizerOptions } from "./content-sanitizer.js";

export { rateLimiter } from "./rate-limiter.js";
export type { RateLimiterOptions, RateLimitTier } from "./rate-limiter.js";

export { concurrencyGuard } from "./concurrency-guard.js";
export type { ConcurrencyGuardOptions, ConcurrencyStrategy } from "./concurrency-guard.js";

// ── Access & gating ──

export { accessPolicy } from "./access-policy.js";
export type {
  AccessMatcher,
  AccessPolicy,
  ScopePolicy,
} from "./access-policy.js";

export { mentionGate } from "./mention-gate.js";
export type { MentionDecision, MentionGateOptions } from "./mention-gate.js";

// ── Protocol (dataflow stages) ──

// ── Quote & ref-index (combined) ──

export { quoteRef, MemoryRefIndexStore } from "./quote-ref.js";
export type {
  QuoteRefOptions,
  RefEntry,
  RefIndexStore,
  ResolvedQuote,
  QuotedAttachment,
} from "./quote-ref.js";

export { envelopeFormatter } from "./envelope-formatter.js";
export type { EnvelopeFormatterOptions } from "./envelope-formatter.js";

// ── Commands ──

export { slashCommand } from "./slash-command.js";
export type {
  ParsedCommand,
  SlashCommand,
  SlashCommandHandlerContext,
  SlashCommandOptions,
  SlashCommandResult,
} from "./slash-command.js";

// ── History ──

export {
  historyBuffer,
  MemoryHistoryStore,
} from "./history-buffer.js";
export type {
  HistoryBufferOptions,
  HistoryEntry,
  HistoryStore,
} from "./history-buffer.js";

// ── UX ──

export { typingIndicator } from "./typing-indicator.js";
export type { TypingIndicatorOptions } from "./typing-indicator.js";

// ── Error handling ──

export { errorHandler } from "./error-handler.js";
export type { ErrorHandlerOptions } from "./error-handler.js";

// ============ State augmentation ============
// Declared here so IDE autocomplete surfaces the well-known keys filled
// by built-in middleware.

import type { MentionDecision } from "./mention-gate.js";
import type { ParsedCommand } from "./slash-command.js";
import type { HistoryEntry } from "./history-buffer.js";
import type { ResolvedQuote } from "./quote-ref.js";

declare module "./types.js" {
  interface MiddlewareState {
    /** Set by {@link mentionGate} middleware. */
    mention?: MentionDecision;
    /** Set by {@link slashCommand} middleware when a command matches. */
    command?: ParsedCommand;
    /** Set by {@link historyBuffer} middleware. */
    history?: HistoryEntry[];
    /** Set by {@link quoteResolver} middleware. */
    quote?: ResolvedQuote;
    /** Set by {@link envelopeFormatter} middleware. Formatted LLM context string. */
    envelope?: string;
  }
}
