/**
 * @tencent-connect/qqbot-nodejs
 *
 * Node.js SDK for the QQ Open Platform.
 *
 * The high-level entry is the {@link QQBot} class:
 *
 * ```ts
 * import { QQBot, MediaFileType } from "@tencent-connect/qqbot-nodejs";
 *
 * const bot = new QQBot({
 *   appId: process.env.QQBOT_APP_ID!,
 *   appSecret: process.env.QQBOT_APP_SECRET!,
 *   logger: console,
 * });
 *
 * bot.on("message", async (ctx, msg) => {
 *   if (msg.replyTarget.scope === "c2c") {
 *     await bot.sendText(msg.replyTarget, `Echo: ${msg.content}`);
 *   }
 * });
 *
 * await bot.start();
 * ```
 *
 * For lower-level access to the protocol primitives (HTTP client, gateway
 * connection, retry policies, etc.) see the `protocol/` sub-export:
 *
 * ```ts
 * import { ApiClient, GatewayConnection } from "@tencent-connect/qqbot-nodejs/protocol";
 * ```
 */

export { QQBot } from "./QQBot.js";
export { MsgType } from "./QQBot.js";
export type {
  QQBotOptions,
  QQBotEventMap,
  QQBotInboundMessage,
  ReplyTarget,
  SendMessageOptions,
  ApiGateway,
  InteractionContext,
  RawEventContext,
} from "./QQBot.js";

export { StreamSession } from "./streaming.js";
export type { StreamSessionOptions } from "./streaming.js";

// ============ Middleware ============
export {
  // Core
  runMiddlewareChain,
  // P0: Filters & protection
  messageFilter,
  contentSanitizer,
  rateLimiter,
  concurrencyGuard,
  // Access & gating
  accessPolicy,
  mentionGate,
  // Protocol (dataflow stages)
  quoteRef,
  MemoryRefIndexStore,
  envelopeFormatter,
  // Commands
  slashCommand,
  // History
  historyBuffer,
  MemoryHistoryStore,
  // UX
  typingIndicator,
  // Error handling
  errorHandler,
} from "./middleware/index.js";
export type {
  Middleware,
  MiddlewareContext,
  // Message filter
  MessageFilterOptions,
  // Content sanitizer
  ContentSanitizerOptions,
  // Rate limiter
  RateLimiterOptions,
  RateLimitTier,
  // Concurrency guard
  ConcurrencyGuardOptions,
  ConcurrencyStrategy,
  // Access policy
  AccessMatcher,
  AccessPolicy,
  ScopePolicy,
  // Mention gate
  MentionDecision,
  MentionGateOptions,
  // Quote ref
  QuoteRefOptions,
  RefEntry,
  RefIndexStore,
  ResolvedQuote,
  QuotedAttachment,
  // Envelope formatter
  EnvelopeFormatterOptions,
  // Slash command
  ParsedCommand,
  SlashCommand,
  SlashCommandHandlerContext,
  SlashCommandOptions,
  SlashCommandResult,
  // History buffer
  HistoryBufferOptions,
  HistoryEntry,
  HistoryStore,
  // Typing indicator
  TypingIndicatorOptions,
  // Error handler
  ErrorHandlerOptions,
} from "./middleware/index.js";

// ============ Pluggable Storage ============
export {
  MemoryKVStore,
  FileKVStore,
  kvSessionPersistence,
} from "./storage/index.js";
export type {
  KVStore,
  FileKVStoreOptions,
  KVSessionPersistenceOptions,
} from "./storage/index.js";

// ============ Re-exports from protocol ============
// Re-export the public types from the protocol layer that users routinely
// need at the high level. This avoids forcing users to import from two
// places for common cases.
export {
  ApiError,
  MediaFileType,
  StreamContentType,
  StreamInputMode,
  StreamInputState,
  type ChatScope,
  type Credentials,
  type GatewayAccount,
  type InlineKeyboard,
  type InteractionEvent,
  type Logger,
  type MessageResponse,
  type OutboundMeta,
  type UploadMediaResponse,
} from "./protocol/types.js";

export type { InboundMessage } from "./protocol/gateway/event-dispatcher.js";

export type {
  WebhookRequest,
  WebhookResponse,
  WebhookRequestHandler,
  WebhookServerAdapter,
} from "./protocol/transport/types.js";

// Useful runtime helpers + constants.
export {
  CHUNKED_UPLOAD_MAX_SIZE,
  LARGE_FILE_THRESHOLD,
  MAX_UPLOAD_SIZE,
  getFileTypeName,
  getMaxUploadSize,
  sanitizeFileName,
} from "./protocol/utils/file-utils.js";

export { UploadCache } from "./protocol/utils/upload-cache.js";
export { formatErrorMessage, formatFileSize } from "./protocol/utils/format.js";

export { UploadDailyLimitExceededError } from "./protocol/api/media-chunked.js";
