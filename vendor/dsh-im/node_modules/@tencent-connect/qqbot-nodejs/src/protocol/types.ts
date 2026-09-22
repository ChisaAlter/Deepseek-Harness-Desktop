/**
 * Protocol-level public types for the QQ Open Platform.
 *
 * 这一层只关心与 QQ 官方 API 协议相关的数据结构（HTTP 请求/响应、
 * WebSocket Gateway 事件、消息体、媒体类型等），不包含任何上层框架
 * 业务概念（路由、ACP、access policy 等）。
 *
 * 上层应用通过 `QQBot` facade 与这些类型交互；高级用户也可以从
 * `@tencent-connect/qqbot-nodejs/protocol` 直接消费这些低层类型。
 */

// ============ Structured API Error ============

/**
 * QQ 开放平台 HTTP 调用失败时抛出的结构化错误。
 *
 * 携带 HTTP 状态码、API 路径以及业务错误码，供上层重试/降级判断使用。
 */
export class ApiError extends Error {
  override readonly name = "ApiError";

  constructor(
    message: string,
    /** HTTP status code returned by the QQ Open Platform. */
    public readonly httpStatus: number,
    /** API path that produced the error (e.g. `/v2/users/{id}/messages`). */
    public readonly path: string,
    /** Business error code from the response body (`code` or `err_code`). */
    public readonly bizCode?: number,
    /** Original error message from the response body. */
    public readonly bizMessage?: string,
  ) {
    super(message);
  }
}

// ============ Logger ============

/**
 * Logger interface used across all protocol modules.
 *
 * `info` and `error` are required; `warn` and `debug` are optional.
 */
export interface Logger {
  info: (msg: string, meta?: Record<string, unknown>) => void;
  error: (msg: string, meta?: Record<string, unknown>) => void;
  warn?: (msg: string, meta?: Record<string, unknown>) => void;
  debug?: (msg: string, meta?: Record<string, unknown>) => void;
}

/** @deprecated Use {@link Logger}. */
export type EngineLogger = Logger;

// ============ Chat Scope ============

/** Chat scope used to unify C2C/Group path construction. */
export type ChatScope = "c2c" | "group";

// ============ Credentials ============

/** Credentials needed to authenticate API requests. */
export interface Credentials {
  appId: string;
  clientSecret: string;
}

// ============ Message Response ============

/** Standard message send response from the QQ Open Platform. */
export interface MessageResponse {
  id: string;
  timestamp: number | string;
  /** Reference index for future quoting. */
  ext_info?: {
    ref_idx?: string;
  };
}

// ============ Media Types ============

/** QQ Open Platform media file type codes. */
export enum MediaFileType {
  IMAGE = 1,
  VIDEO = 2,
  VOICE = 3,
  FILE = 4,
}

/** Media upload response from the QQ Open Platform. */
export interface UploadMediaResponse {
  file_uuid: string;
  file_info: string;
  ttl: number;
  id?: string;
}

/** Structured metadata recorded for outbound messages. */
export interface OutboundMeta {
  text?: string;
  mediaType?: "image" | "voice" | "video" | "file";
  mediaUrl?: string;
  mediaLocalPath?: string;
  ttsText?: string;
}

// ============ API Client Config ============

/** Configuration for the core HTTP client. */
export interface ApiClientConfig {
  baseUrl?: string;
  defaultTimeoutMs?: number;
  fileUploadTimeoutMs?: number;
  logger?: Logger;
  userAgent?: string | (() => string);
}

// ============ Chunked Upload Types ============

export interface UploadPart {
  index: number;
  presigned_url: string;
}

export interface UploadPrepareResponse {
  upload_id: string;
  block_size: number;
  parts: UploadPart[];
  concurrency?: number;
  retry_timeout?: number;
}

export interface UploadPrepareHashes {
  md5: string;
  sha1: string;
  md5_10m: string;
}

// ============ Stream Message Types ============

export const StreamInputMode = {
  REPLACE: "replace",
} as const;
export type StreamInputMode = (typeof StreamInputMode)[keyof typeof StreamInputMode];

export const StreamInputState = {
  GENERATING: 1,
  DONE: 10,
} as const;
export type StreamInputState = (typeof StreamInputState)[keyof typeof StreamInputState];

export const StreamContentType = {
  MARKDOWN: "markdown",
} as const;
export type StreamContentType = (typeof StreamContentType)[keyof typeof StreamContentType];

export interface StreamMessageRequest {
  input_mode: StreamInputMode;
  input_state: StreamInputState;
  content_type: StreamContentType;
  content_raw: string;
  event_id: string;
  msg_id: string;
  stream_msg_id?: string;
  msg_seq: number;
  index: number;
}

// ============ Inline Keyboard ============

export interface KeyboardButton {
  id: string;
  render_data: {
    label: string;
    visited_label: string;
    style: number;
  };
  action: {
    type: number;
    permission: { type: number };
    data: string;
    click_limit?: number;
  };
  group_id?: string;
}

export interface InlineKeyboard {
  content: {
    rows: Array<{ buttons: KeyboardButton[] }>;
  };
}

// ============ Interaction Event ============

export interface InteractionEvent {
  id: string;
  type: number;
  scene?: string;
  chat_type?: number;
  timestamp?: string;
  guild_id?: string;
  channel_id?: string;
  user_openid?: string;
  group_openid?: string;
  group_member_openid?: string;
  version: number;
  data: {
    type: number;
    resolved: {
      button_data?: string;
      button_id?: string;
      user_id?: string;
      feature_id?: string;
      message_id?: string;
    };
  };
}

// ============ Gateway WebSocket Types ============

export interface WSPayload {
  op: number;
  d: unknown;
  s?: number;
  t?: string;
}

export interface RawMessageAttachment {
  content_type: string;
  url: string;
  filename?: string;
  voice_wav_url?: string;
  asr_refer_text?: string;
}

export interface RawMsgElement {
  msg_idx?: string;
  content?: string;
  attachments?: Array<
    RawMessageAttachment & {
      height?: number;
      width?: number;
      size?: number;
    }
  >;
}

export interface C2CMessageEvent {
  id: string;
  content: string;
  timestamp: string;
  author: { user_openid: string };
  attachments?: RawMessageAttachment[];
  message_scene?: { ext?: string[] };
  message_type?: number;
  msg_elements?: RawMsgElement[];
}

export interface GuildMessageEvent {
  id: string;
  content: string;
  timestamp: string;
  author: { id: string; username?: string };
  channel_id: string;
  guild_id: string;
  attachments?: RawMessageAttachment[];
  message_scene?: { ext?: string[] };
}

export interface GroupMessageEvent {
  id: string;
  content: string;
  timestamp: string;
  author: {
    member_openid: string;
    username?: string;
    bot?: boolean;
  };
  group_openid: string;
  attachments?: RawMessageAttachment[];
  mentions?: Array<{
    scope?: "all" | "single";
    id?: string;
    user_openid?: string;
    member_openid?: string;
    nickname?: string;
    username?: string;
    bot?: boolean;
    is_you?: boolean;
  }>;
  message_scene?: { source?: string; ext?: string[] };
  message_type?: number;
  msg_elements?: RawMsgElement[];
}

// ============ Account ============

/** Lightweight account record consumed by GatewayConnection. */
export interface GatewayAccount {
  /** Stable account identifier (used for logging / session persistence). */
  accountId: string;
  appId: string;
  clientSecret: string;
  /** Whether this bot has markdown permission. */
  markdownSupport?: boolean;
}
