import { EventEmitter } from 'eventemitter3';
import type { WSClientOptions, WSClientEventMap, WsFrame, WsFrameHeaders, StreamReplyBody, ReplyMsgItem, ReplyFeedback, WelcomeTextReplyBody, WelcomeTemplateCardReplyBody, TemplateCard, SendMsgBody, WeComMediaType, UploadMediaOptions, UploadMediaFinishResult } from './types';
import { WeComApiClient } from './api';
export declare class WSClient extends EventEmitter<WSClientEventMap> {
    private options;
    private apiClient;
    private wsManager;
    private messageHandler;
    private logger;
    private started;
    constructor(options: WSClientOptions);
    /**
     * 设置 WebSocket 事件处理
     */
    private setupWsEvents;
    /**
     * 建立 WebSocket 长连接
     * SDK 使用内置默认地址建立连接，连接成功后自动发送认证帧（botId + secret）。
     * 支持链式调用：wsClient.connect().on('message', handler)
     *
     * @returns 返回 this，支持链式调用
     */
    connect(): this;
    /**
     * 断开 WebSocket 连接
     */
    disconnect(): void;
    /**
     * 通过 WebSocket 通道发送回复消息（通用方法）
     *
     * @param frame - 收到的原始 WebSocket 帧，透传 headers.req_id
     * @param body - 回复消息体
     * @param cmd
     */
    reply(frame: WsFrameHeaders, body: StreamReplyBody | Record<string, any>, cmd?: string): Promise<WsFrame>;
    /**
     * 发送流式文本回复（便捷方法）
     *
     * @param frame - 收到的原始 WebSocket 帧，透传 headers.req_id
     * @param streamId - 流式消息 ID
     * @param content - 回复内容（支持 Markdown）
     * @param finish - 是否结束流式消息，默认 false
     * @param msgItem - 图文混排项（仅在 finish=true 时有效），用于在结束时附带图片内容
     * @param feedback - 反馈信息（仅在首次回复时设置）
     */
    replyStream(frame: WsFrameHeaders, streamId: string, content: string, finish?: boolean, msgItem?: ReplyMsgItem[], feedback?: ReplyFeedback): Promise<WsFrame>;
    /**
     * 发送欢迎语回复
     *
     * 注意：此方法需要使用对应事件（如 enter_chat）的 req_id 才能调用，
     * 即 frame 参数应来自触发欢迎语的事件帧。
     * 收到事件回调后需在 5 秒内发送回复，超时将无法发送欢迎语。
     *
     * @param frame - 对应事件的 WebSocket 帧（需包含该事件的 req_id）
     * @param body - 欢迎语消息体（支持文本或模板卡片格式）
     */
    replyWelcome(frame: WsFrameHeaders, body: WelcomeTextReplyBody | WelcomeTemplateCardReplyBody): Promise<WsFrame>;
    /**
     * 回复模板卡片消息
     *
     * 收到消息回调或进入会话事件后，可使用此方法回复模板卡片消息。
     *
     * @param frame - 收到的原始 WebSocket 帧，透传 headers.req_id
     * @param templateCard - 模板卡片内容
     * @param feedback - 反馈信息
     */
    replyTemplateCard(frame: WsFrameHeaders, templateCard: TemplateCard, feedback?: ReplyFeedback): Promise<WsFrame>;
    /**
     * 发送流式消息 + 模板卡片组合回复
     *
     * 首次回复时必须返回 stream 的 id。
     * template_card 可首次回复，也可在后续回复中发送，但同一个消息只能回复一次。
     *
     * @param frame - 收到的原始 WebSocket 帧，透传 headers.req_id
     * @param streamId - 流式消息 ID
     * @param content - 回复内容（支持 Markdown）
     * @param finish - 是否结束流式消息，默认 false
     * @param options - 可选项
     * @param options.msgItem - 图文混排项（仅在 finish=true 时有效）
     * @param options.streamFeedback - 流式消息反馈信息（首次回复时设置）
     * @param options.templateCard - 模板卡片内容（同一消息只能回复一次）
     * @param options.cardFeedback - 模板卡片反馈信息
     */
    replyStreamWithCard(frame: WsFrameHeaders, streamId: string, content: string, finish?: boolean, options?: {
        msgItem?: ReplyMsgItem[];
        streamFeedback?: ReplyFeedback;
        templateCard?: TemplateCard;
        cardFeedback?: ReplyFeedback;
    }): Promise<WsFrame>;
    /**
     * 更新模板卡片
     *
     * 注意：此方法需要使用对应事件（template_card_event）的 req_id 才能调用，
     * 即 frame 参数应来自触发更新的事件帧。
     * 收到事件回调后需在 5 秒内发送回复，超时将无法更新卡片。
     *
     * @param frame - 对应事件的 WebSocket 帧（需包含该事件的 req_id）
     * @param templateCard - 模板卡片内容（task_id 需跟回调收到的 task_id 一致）
     * @param userids - 要替换模版卡片消息的 userid 列表，若不填则替换所有用户
     */
    updateTemplateCard(frame: WsFrameHeaders, templateCard: TemplateCard, userids?: string[]): Promise<WsFrame>;
    /**
     * 主动发送消息
     *
     * 向指定会话（单聊或群聊）主动推送消息，无需依赖收到的回调帧。
     *
     * @param chatid - 会话 ID，单聊填用户的 userid，群聊填对应群聊的 chatid
     * @param body - 消息体（支持 markdown 或 template_card 格式）
     * @returns Promise，收到回执时 resolve(回执帧)
     *
     * @example
     * ```ts
     * // 发送 markdown 消息
     * await wsClient.sendMessage('CHATID', {
     *   msgtype: 'markdown',
     *   markdown: { content: '这是一条**主动推送**的消息' },
     * });
     *
     * // 发送模板卡片消息
     * await wsClient.sendMessage('CHATID', {
     *   msgtype: 'template_card',
     *   template_card: { card_type: 'text_notice', ... },
     * });
     * ```
     */
    sendMessage(chatid: string, body: SendMsgBody): Promise<WsFrame>;
    /**
     * 上传临时素材（三步分片上传）
     *
     * 通过 WebSocket 长连接执行分片上传：init → chunk × N → finish
     * 单个分片不超过 512KB（Base64 编码前），最多 100 个分片。
     *
     * @param fileBuffer - 文件 Buffer
     * @param options - 上传选项（类型、文件名）
     * @returns 上传结果，包含 media_id
     */
    uploadMedia(fileBuffer: Buffer, options: UploadMediaOptions): Promise<UploadMediaFinishResult>;
    /**
     * 被动回复媒体消息（便捷方法）
     *
     * 通过 aibot_respond_msg 被动回复通道发送媒体消息（file/image/voice/video）
     *
     * @param frame - 收到的原始 WebSocket 帧，透传 headers.req_id
     * @param mediaType - 媒体类型
     * @param mediaId - 临时素材 media_id
     * @param videoOptions - 视频消息可选参数（仅 mediaType='video' 时生效）
     */
    replyMedia(frame: WsFrameHeaders, mediaType: WeComMediaType, mediaId: string, videoOptions?: {
        title?: string;
        description?: string;
    }): Promise<WsFrame>;
    /**
     * 主动发送媒体消息（便捷方法）
     *
     * 通过 aibot_send_msg 主动推送通道发送媒体消息
     *
     * @param chatid - 会话 ID
     * @param mediaType - 媒体类型
     * @param mediaId - 临时素材 media_id
     * @param videoOptions - 视频消息可选参数（仅 mediaType='video' 时生效）
     */
    sendMediaMessage(chatid: string, mediaType: WeComMediaType, mediaId: string, videoOptions?: {
        title?: string;
        description?: string;
    }): Promise<WsFrame>;
    /**
     * 下载文件并使用 AES 密钥解密
     *
     * @param url - 文件下载地址
     * @param aesKey - AES 解密密钥（Base64 编码），取自消息中 image.aeskey 或 file.aeskey 字段
     * @returns 解密后的文件 Buffer 及文件名
     *
     * @example
     * ```ts
     * // aesKey 来自消息体中的 image.aeskey 或 file.aeskey
     * const { buffer, filename } = await wsClient.downloadFile(imageUrl, body.image?.aeskey);
     * ```
     */
    downloadFile(url: string, aesKey?: string): Promise<{
        buffer: Buffer;
        filename?: string;
    }>;
    /**
     * 检查指定消息帧是否有未完成的 ack（即上一条消息还未收到回执）
     *
     * 用于流式场景：调用方可据此决定是否跳过当前中间帧，避免排队积压。
     *
     * @param frame - 收到的原始 WebSocket 帧
     * @returns true 表示有消息正在等待 ack
     */
    hasPendingReplyAck(frame: WsFrameHeaders): boolean;
    /**
     * 非阻塞流式文本回复
     *
     * 如果上一条同 reqId 的消息尚未收到 ack，则跳过本次发送（返回 'skipped'），
     * 避免流式中间帧排队积压导致延迟。
     *
     * 注意：finish=true 的最终帧不受此限制，始终保证发送（走正常队列）。
     *
     * @param frame - 收到的原始 WebSocket 帧
     * @param streamId - 流式消息 ID
     * @param content - 回复内容
     * @param finish - 是否结束流式消息
     * @param msgItem - 图文混排项（仅在 finish=true 时有效），用于在结束时附带图片内容
     * @param feedback - 反馈信息（仅在首次回复时设置）
     * @returns Promise<WsFrame> 正常发送时返回回执帧，跳过时返回 'skipped'
     */
    replyStreamNonBlocking(frame: WsFrameHeaders, streamId: string, content: string, finish?: boolean, msgItem?: ReplyMsgItem[], feedback?: ReplyFeedback): Promise<WsFrame | 'skipped'>;
    /**
     * 获取当前连接状态
     */
    get isConnected(): boolean;
    /**
     * 获取 API 客户端实例（供高级用途使用，如文件下载）
     */
    get api(): WeComApiClient;
}
