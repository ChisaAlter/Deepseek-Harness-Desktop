/**
 * Message-sending API for the QQ Open Platform.
 */

import type {
  ChatScope,
  Credentials,
  InlineKeyboard,
  Logger,
  MessageResponse,
  OutboundMeta,
  StreamMessageRequest,
} from "../types.js";
import { formatErrorMessage } from "../utils/format.js";
import { ApiClient } from "./api-client.js";
import {
  channelMessagePath,
  dmMessagePath,
  gatewayPath,
  getNextMsgSeq,
  interactionPath,
  messagePath,
  streamMessagePath,
} from "./routes.js";
import { TokenManager } from "./token.js";

export interface MessageApiConfig {
  /** Whether the QQ Bot has markdown permission. */
  markdownSupport: boolean;
  logger?: Logger;
}

type OnMessageSentCallback = (refIdx: string, meta: OutboundMeta) => void;

export class MessageApi {
  private readonly client: ApiClient;
  private readonly tokenManager: TokenManager;
  private readonly markdownSupport: boolean;
  private readonly logger?: Logger;
  private messageSentHook: OnMessageSentCallback | null = null;

  constructor(client: ApiClient, tokenManager: TokenManager, config: MessageApiConfig) {
    this.client = client;
    this.tokenManager = tokenManager;
    this.markdownSupport = config.markdownSupport;
    this.logger = config.logger;
  }

  onMessageSent(callback: OnMessageSentCallback): void {
    this.messageSentHook = callback;
  }

  notifyMessageSent(refIdx: string, meta: OutboundMeta): void {
    if (this.messageSentHook) {
      try {
        this.messageSentHook(refIdx, meta);
      } catch (err) {
        this.logger?.error?.(
          `[qqbot:messages] onMessageSent hook error: ${formatErrorMessage(err)}`,
        );
      }
    }
  }

  async sendMessage(
    scope: ChatScope,
    targetId: string,
    content: string,
    creds: Credentials,
    opts?: {
      msgId?: string;
      messageReference?: string;
      inlineKeyboard?: InlineKeyboard;
    },
  ): Promise<MessageResponse> {
    const token = await this.tokenManager.getAccessToken(creds.appId, creds.clientSecret);
    const msgSeq = opts?.msgId ? getNextMsgSeq(opts.msgId) : 1;
    const body = this.buildMessageBody(
      content,
      opts?.msgId,
      msgSeq,
      opts?.messageReference,
      opts?.inlineKeyboard,
    );
    const path = messagePath(scope, targetId);
    return this.sendAndNotify(creds.appId, token, "POST", path, body, { text: content });
  }

  async sendProactiveMessage(
    scope: ChatScope,
    targetId: string,
    content: string,
    creds: Credentials,
  ): Promise<MessageResponse> {
    if (!content?.trim()) {
      throw new Error("Proactive message content must not be empty");
    }
    const token = await this.tokenManager.getAccessToken(creds.appId, creds.clientSecret);
    const body = this.buildProactiveBody(content);
    const path = messagePath(scope, targetId);
    return this.sendAndNotify(creds.appId, token, "POST", path, body, { text: content });
  }

  async sendChannelMessage(opts: {
    channelId: string;
    content: string;
    creds: Credentials;
    msgId?: string;
  }): Promise<MessageResponse> {
    const token = await this.tokenManager.getAccessToken(opts.creds.appId, opts.creds.clientSecret);
    return this.client.request<MessageResponse>(token, "POST", channelMessagePath(opts.channelId), {
      content: opts.content,
      ...(opts.msgId ? { msg_id: opts.msgId } : {}),
    });
  }

  async sendDmMessage(opts: {
    guildId: string;
    content: string;
    creds: Credentials;
    msgId?: string;
  }): Promise<MessageResponse> {
    const token = await this.tokenManager.getAccessToken(opts.creds.appId, opts.creds.clientSecret);
    return this.client.request<MessageResponse>(token, "POST", dmMessagePath(opts.guildId), {
      content: opts.content,
      ...(opts.msgId ? { msg_id: opts.msgId } : {}),
    });
  }

  /** Send a typing indicator to a C2C user. */
  async sendInputNotify(opts: {
    openid: string;
    creds: Credentials;
    msgId?: string;
    inputSecond?: number;
  }): Promise<{ refIdx?: string }> {
    const inputSecond = opts.inputSecond ?? 60;
    const token = await this.tokenManager.getAccessToken(opts.creds.appId, opts.creds.clientSecret);
    const msgSeq = opts.msgId ? getNextMsgSeq(opts.msgId) : 1;
    const response = await this.client.request<{ ext_info?: { ref_idx?: string } }>(
      token,
      "POST",
      messagePath("c2c", opts.openid),
      {
        msg_type: 6,
        input_notify: { input_type: 1, input_second: inputSecond },
        msg_seq: msgSeq,
        ...(opts.msgId ? { msg_id: opts.msgId } : {}),
      },
    );
    return { refIdx: response.ext_info?.ref_idx };
  }

  async acknowledgeInteraction(
    interactionId: string,
    creds: Credentials,
    code = 0,
    data?: Record<string, unknown>,
  ): Promise<void> {
    const token = await this.tokenManager.getAccessToken(creds.appId, creds.clientSecret);
    const body: Record<string, unknown> = { code };
    if (data) body.data = data;
    await this.client.request(token, "PUT", interactionPath(interactionId), body);
  }

  /** Get the WebSocket gateway URL for the bot. */
  async getGatewayUrl(creds: Credentials): Promise<string> {
    const token = await this.tokenManager.getAccessToken(creds.appId, creds.clientSecret);
    const data = await this.client.request<{ url: string }>(token, "GET", gatewayPath());
    return data.url;
  }

  /**
   * Send a C2C stream message chunk (`/v2/users/{openid}/stream_messages`).
   * Only supported for one-to-one chats.
   */
  async sendC2CStreamMessage(
    creds: Credentials,
    openid: string,
    req: StreamMessageRequest,
  ): Promise<MessageResponse> {
    const token = await this.tokenManager.getAccessToken(creds.appId, creds.clientSecret);
    const path = streamMessagePath(openid);
    const body: Record<string, unknown> = {
      input_mode: req.input_mode,
      input_state: req.input_state,
      content_type: req.content_type,
      content_raw: req.content_raw,
      event_id: req.event_id,
      msg_id: req.msg_id,
      msg_seq: req.msg_seq,
      index: req.index,
    };
    if (req.stream_msg_id) {
      body.stream_msg_id = req.stream_msg_id;
    }
    return this.client.request<MessageResponse>(token, "POST", path, body);
  }

  /**
   * Raw message send — transparently forwards all fields to the QQ Open Platform API.
   *
   * This is the "escape hatch" for any message type not covered by the
   * higher-level helpers. Fields like `msg_type`, `markdown`, `ark`, `embed`,
   * `keyboard`, `media`, `message_reference`, `is_wakeup` etc. are passed through
   * as-is to `/v2/users/{openid}/messages` or `/v2/groups/{group_openid}/messages`.
   *
   * Auto-injects `msg_seq` if not provided.
   */
  async sendRaw(
    scope: ChatScope,
    targetId: string,
    creds: Credentials,
    body: Record<string, unknown>,
  ): Promise<MessageResponse> {
    const token = await this.tokenManager.getAccessToken(creds.appId, creds.clientSecret);
    const path = messagePath(scope, targetId);

    // Auto-inject msg_seq if missing
    if (body.msg_seq === undefined) {
      body.msg_seq = body.msg_id ? getNextMsgSeq(body.msg_id as string) : 1;
    }
    // Auto-detect msg_type if missing
    if (body.msg_type === undefined) {
      if (body.markdown) body.msg_type = 2;
      else if (body.ark) body.msg_type = 3;
      else if (body.embed) body.msg_type = 4;
      else if (body.media) body.msg_type = 7;
      else body.msg_type = 0;
    }

    // Remove undefined values
    const cleaned = Object.fromEntries(
      Object.entries(body).filter(([, v]) => v !== undefined),
    );

    return this.sendAndNotify(
      creds.appId,
      token,
      "POST",
      path,
      cleaned,
      { text: (cleaned.content as string) ?? (cleaned.markdown as { content?: string } | undefined)?.content },
    );
  }

  /**
   * Send a message to a guild text channel.
   * Supports content, keyboard, message_reference, and arbitrary extra fields.
   */
  async sendChannelMessageRaw(
    channelId: string,
    creds: Credentials,
    body: Record<string, unknown>,
  ): Promise<MessageResponse> {
    const token = await this.tokenManager.getAccessToken(creds.appId, creds.clientSecret);
    const cleaned = Object.fromEntries(
      Object.entries(body).filter(([, v]) => v !== undefined),
    );
    return this.client.request<MessageResponse>(
      token, "POST", channelMessagePath(channelId), cleaned,
    );
  }

  /**
   * Send a DM (direct message) in a guild.
   */
  async sendDmMessageRaw(
    guildId: string,
    creds: Credentials,
    body: Record<string, unknown>,
  ): Promise<MessageResponse> {
    const token = await this.tokenManager.getAccessToken(creds.appId, creds.clientSecret);
    const cleaned = Object.fromEntries(
      Object.entries(body).filter(([, v]) => v !== undefined),
    );
    return this.client.request<MessageResponse>(
      token, "POST", dmMessagePath(guildId), cleaned,
    );
  }

  /**
   * Recall (delete) a message.
   */
  async recallMessage(
    scope: ChatScope,
    targetId: string,
    messageId: string,
    creds: Credentials,
  ): Promise<void> {
    const token = await this.tokenManager.getAccessToken(creds.appId, creds.clientSecret);
    const path = `${messagePath(scope, targetId)}/${messageId}`;
    await this.client.request(token, "DELETE", path);
  }

  private async sendAndNotify(
    _appId: string,
    accessToken: string,
    method: string,
    path: string,
    body: unknown,
    meta: OutboundMeta,
  ): Promise<MessageResponse> {
    const result = await this.client.request<MessageResponse>(accessToken, method, path, body);
    if (result.ext_info?.ref_idx && this.messageSentHook) {
      try {
        this.messageSentHook(result.ext_info.ref_idx, meta);
      } catch (err) {
        this.logger?.error?.(
          `[qqbot:messages] onMessageSent hook error: ${formatErrorMessage(err)}`,
        );
      }
    }
    return result;
  }

  private buildMessageBody(
    content: string,
    msgId: string | undefined,
    msgSeq: number,
    messageReference?: string,
    inlineKeyboard?: InlineKeyboard,
  ): Record<string, unknown> {
    const body: Record<string, unknown> = this.markdownSupport
      ? { markdown: { content }, msg_type: 2, msg_seq: msgSeq }
      : { content, msg_type: 0, msg_seq: msgSeq };

    if (msgId) {
      body.msg_id = msgId;
    }
    if (messageReference && !this.markdownSupport) {
      body.message_reference = { message_id: messageReference };
    }
    if (inlineKeyboard) {
      body.keyboard = inlineKeyboard;
    }
    return body;
  }

  private buildProactiveBody(content: string): Record<string, unknown> {
    return this.markdownSupport ? { markdown: { content }, msg_type: 2 } : { content, msg_type: 0 };
  }
}

export { getNextMsgSeq } from "./routes.js";
