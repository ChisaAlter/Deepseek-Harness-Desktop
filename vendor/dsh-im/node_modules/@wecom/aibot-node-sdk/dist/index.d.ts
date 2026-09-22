import { EventEmitter } from 'eventemitter3';
import { ClientOptions } from 'ws';

/**
 * 通用基础类型定义
 */
/** 日志接口 */
interface Logger {
    debug(message: string, ...args: any[]): void;
    info(message: string, ...args: any[]): void;
    warn(message: string, ...args: any[]): void;
    error(message: string, ...args: any[]): void;
}
/**
 * 认证失败重试次数用尽错误
 *
 * 当 WebSocket 认证连续失败次数达到 maxAuthFailureAttempts 时抛出。
 * 通常表示 botId/secret 配置错误，重试无法恢复。
 */
declare class WSAuthFailureError extends Error {
    readonly code = "WS_AUTH_FAILURE_EXHAUSTED";
    constructor(maxAttempts: number);
}
/**
 * 连接断开重连次数用尽错误
 *
 * 当 WebSocket 连接断开后重连次数达到 maxReconnectAttempts 时抛出。
 * 通常表示网络或服务端持续不可用。
 */
declare class WSReconnectExhaustedError extends Error {
    readonly code = "WS_RECONNECT_EXHAUSTED";
    constructor(maxAttempts: number);
}

/**
 * WSClient 配置相关类型定义
 */

/** WSClient 配置选项 */
interface WSClientOptions {
    /** 机器人 ID（在企业微信后台获取） */
    botId: string;
    /** 机器人 Secret（在企业微信后台获取） */
    secret: string;
    /** 场景值（可选），由使用方传入 */
    scene?: number;
    /** 插件版本号（可选），由使用方传入 */
    plug_version?: string;
    /** WebSocket 重连基础延迟（毫秒），实际延迟按指数退避递增，默认 1000 */
    reconnectInterval?: number;
    /** 连接断开时的最大重连次数，默认 10，设为 -1 表示无限重连 */
    maxReconnectAttempts?: number;
    /** 认证失败时的最大重试次数，默认 5，设为 -1 表示无限重试 */
    maxAuthFailureAttempts?: number;
    /** 心跳间隔（毫秒），默认 30000 */
    heartbeatInterval?: number;
    /** 请求超时时间（毫秒），默认 10000 */
    requestTimeout?: number;
    /** 自定义 WebSocket 连接地址，默认 wss://openws.work.weixin.qq.com */
    wsUrl?: string;
    /** 传递给底层 WebSocket 的连接选项（如 TLS 证书配置 ca、cert、key、rejectUnauthorized 等） */
    wsOptions?: ClientOptions;
    /** 单个 req_id 的回复队列最大长度，超过后新消息将被拒绝，默认 500 */
    maxReplyQueueSize?: number;
    /** 自定义日志函数 */
    logger?: Logger;
}

/**
 * 消息相关类型定义
 * 按照企业微信智能机器人接收消息协议定义
 */
/** 消息类型枚举 */
declare enum MessageType {
    /** 文本消息 */
    Text = "text",
    /** 图片消息 */
    Image = "image",
    /** 图文混排消息 */
    Mixed = "mixed",
    /** 语音消息 */
    Voice = "voice",
    /** 文件消息 */
    File = "file",
    /** 视频消息 */
    Video = "video"
}
/** 消息发送者信息 */
interface MessageFrom {
    /** 操作者的 userid */
    userid: string;
}
/** 文本结构体 */
interface TextContent {
    /** 文本消息内容 */
    content: string;
}
/** 图片结构体 */
interface ImageContent {
    /** 图片的下载 url（五分钟内有效，已加密） */
    url: string;
    /** 解密密钥，长连接模式下返回，每个下载链接的 aeskey 唯一 */
    aeskey?: string;
}
/** 语音结构体 */
interface VoiceContent {
    /** 语音转换成文本的内容 */
    content: string;
}
/** 文件结构体 */
interface FileContent {
    /** 文件的下载 url（五分钟内有效，已加密） */
    url: string;
    /** 解密密钥，长连接模式下返回，每个下载链接的 aeskey 唯一 */
    aeskey?: string;
}
/** 视频结构体 */
interface VideoContent {
    /** 视频的下载 url（五分钟内有效，已加密） */
    url: string;
    /** 解密密钥，长连接模式下返回，每个下载链接的 aeskey 唯一 */
    aeskey?: string;
}
/** 图文混排子项 */
interface MixedMsgItem {
    /** 图文混排中的类型：text / image */
    msgtype: 'text' | 'image';
    /** 文本内容（msgtype 为 text 时存在） */
    text?: TextContent;
    /** 图片内容（msgtype 为 image 时存在） */
    image?: ImageContent;
}
/** 图文混排结构体 */
interface MixedContent {
    /** 图文混排消息项列表 */
    msg_item: MixedMsgItem[];
}
/** 引用结构体 */
interface QuoteContent {
    /** 引用的类型：text / image / mixed / voice / file */
    msgtype: 'text' | 'image' | 'mixed' | 'voice' | 'file';
    /** 引用的文本内容 */
    text?: TextContent;
    /** 引用的图片内容 */
    image?: ImageContent;
    /** 引用的图文混排内容 */
    mixed?: MixedContent;
    /** 引用的语音内容 */
    voice?: VoiceContent;
    /** 引用的文件内容 */
    file?: FileContent;
}
/** 基础消息结构 */
interface BaseMessage {
    /** 本次回调的唯一性标志，用于事件排重 */
    msgid: string;
    /** 智能机器人 id */
    aibotid: string;
    /** 会话 id，仅群聊类型时返回 */
    chatid?: string;
    /** 会话类型：single 单聊, group 群聊 */
    chattype: 'single' | 'group';
    /** 事件触发者信息 */
    from: MessageFrom;
    /** 事件产生的时间戳 */
    create_time?: number;
    /** 支持主动回复消息的临时 url */
    response_url?: string;
    /** 消息类型 */
    msgtype: MessageType | string;
    /** 引用内容（若用户引用了其他消息则有该字段） */
    quote?: QuoteContent;
    /** 原始数据 */
    [key: string]: any;
}
/** 文本消息 */
interface TextMessage extends BaseMessage {
    msgtype: MessageType.Text;
    /** 文本消息内容 */
    text: TextContent;
}
/** 图片消息 */
interface ImageMessage extends BaseMessage {
    msgtype: MessageType.Image;
    /** 图片内容 */
    image: ImageContent;
}
/** 图文混排消息 */
interface MixedMessage extends BaseMessage {
    msgtype: MessageType.Mixed;
    /** 图文混排内容 */
    mixed: MixedContent;
}
/** 语音消息 */
interface VoiceMessage extends BaseMessage {
    msgtype: MessageType.Voice;
    /** 语音内容 */
    voice: VoiceContent;
}
/** 文件消息 */
interface FileMessage extends BaseMessage {
    msgtype: MessageType.File;
    /** 文件内容 */
    file: FileContent;
}
/** 视频消息 */
interface VideoMessage extends BaseMessage {
    msgtype: MessageType.Video;
    /** 视频内容 */
    video: VideoContent;
}
/** 回复消息选项 */
interface ReplyOptions {
    /** 回复的消息 ID */
    msgid: string;
    /** 聊天 ID */
    chatid: string;
}
/** 发送文本消息参数 */
interface SendTextParams extends ReplyOptions {
    content: string;
}
/** 发送 Markdown 消息参数 */
interface SendMarkdownParams extends ReplyOptions {
    content: string;
}

/**
 * API 相关类型定义
 */
/** WebSocket 命令类型常量 */
declare const WsCmd: {
    /** 认证订阅 */
    readonly SUBSCRIBE: "aibot_subscribe";
    /** 心跳 */
    readonly HEARTBEAT: "ping";
    /** 回复消息 */
    readonly RESPONSE: "aibot_respond_msg";
    /** 回复欢迎语 */
    readonly RESPONSE_WELCOME: "aibot_respond_welcome_msg";
    /** 更新模板卡片 */
    readonly RESPONSE_UPDATE: "aibot_respond_update_msg";
    /** 主动发送消息 */
    readonly SEND_MSG: "aibot_send_msg";
    /** 上传临时素材 - 初始化 */
    readonly UPLOAD_MEDIA_INIT: "aibot_upload_media_init";
    /** 上传临时素材 - 分片上传 */
    readonly UPLOAD_MEDIA_CHUNK: "aibot_upload_media_chunk";
    /** 上传临时素材 - 完成上传 */
    readonly UPLOAD_MEDIA_FINISH: "aibot_upload_media_finish";
    /** 消息推送回调 */
    readonly CALLBACK: "aibot_msg_callback";
    /** 事件推送回调 */
    readonly EVENT_CALLBACK: "aibot_event_callback";
};
/**
 * WebSocket 帧结构
 *
 * 发送和接收统一使用 { cmd, headers, body } 格式：
 * - 认证发送：{ cmd: "aibot_subscribe", headers: { req_id }, body: { secret, bot_id } }
 * - 消息推送：{ cmd: "aibot_msg_callback", headers: { req_id }, body: { msgid, msgtype, ... } }
 * - 事件推送：{ cmd: "aibot_event_callback", headers: { req_id }, body: { event_type, ... } }
 * - 回复消息：{ cmd: "aibot_respond_msg", headers: { req_id }, body: { msgtype, stream: { ... } } }
 * - 回复欢迎语：{ cmd: "aibot_respond_welcome_msg", headers: { req_id }, body: { ... } }
 * - 更新模板卡片：{ cmd: "aibot_respond_update_msg", headers: { req_id }, body: { ... } }
 * - 心跳发送：{ cmd: "ping", headers: { req_id } }
 * - 认证/心跳响应：{ headers: { req_id }, errcode: 0, errmsg: "ok" }
 */
interface WsFrame<T = any> {
    /** 命令类型；认证/心跳响应时可能为空 */
    cmd?: string;
    /** 请求头信息 */
    headers: {
        req_id: string;
        [key: string]: any;
    };
    /** 消息体 */
    body?: T;
    /** 响应错误码，认证/心跳响应时存在 */
    errcode?: number;
    /** 响应错误信息，认证/心跳响应时存在 */
    errmsg?: string;
}
/** 仅包含 headers 的 WsFrame 子集，用于 reply / replyStream 等方法的参数类型 */
type WsFrameHeaders = Pick<WsFrame, 'headers'>;
/** 回复消息中的图文混排子项 */
interface ReplyMsgItem {
    /** 类型：image */
    msgtype: 'image';
    /** 图片内容 */
    image: {
        /** Base64 编码的图片数据，图片（base64编码前）最大不能超过10M，支持JPG、PNG格式 */
        base64: string;
        /** 图片内容（base64编码前）的 MD5 值 */
        md5: string;
    };
}
/** 回复消息中的反馈信息 */
interface ReplyFeedback {
    /** 反馈 ID，有效长度为 256 字节以内，必须是 utf-8 编码 */
    id: string;
}
/** 流式回复消息体 */
interface StreamReplyBody {
    msgtype: 'stream';
    stream: {
        /** 流式消息 ID，首次回复时设置，后续使用相同 ID 刷新内容 */
        id: string;
        /** 是否结束流式消息 */
        finish?: boolean;
        /** 回复内容（支持 Markdown），最长不超过 20480 个字节，必须是 utf8 编码 */
        content?: string;
        /** 图文混排消息列表，目前仅当 finish=true 时支持设置，最多 10 个 */
        msg_item?: ReplyMsgItem[];
        /** 反馈信息，首次回复时设置 */
        feedback?: ReplyFeedback;
    };
}
/** 欢迎语回复消息体（文本类型） */
interface WelcomeTextReplyBody {
    msgtype: 'text';
    text: {
        /** 欢迎语文本内容 */
        content: string;
    };
}
/** 欢迎语回复消息体（模板卡片类型） */
interface WelcomeTemplateCardReplyBody {
    msgtype: 'template_card';
    template_card: TemplateCard;
}
/** 欢迎语回复消息体联合类型 */
type WelcomeReplyBody = WelcomeTextReplyBody | WelcomeTemplateCardReplyBody;
/** 流式消息 + 模板卡片组合回复消息体 */
interface StreamWithTemplateCardReplyBody {
    msgtype: 'stream_with_template_card';
    stream: StreamReplyBody['stream'];
    template_card?: TemplateCard;
}
/** 卡片类型枚举 */
declare enum TemplateCardType {
    /** 文本通知模版卡片 */
    TextNotice = "text_notice",
    /** 图文展示模版卡片 */
    NewsNotice = "news_notice",
    /** 按钮交互模版卡片 */
    ButtonInteraction = "button_interaction",
    /** 投票选择模版卡片 */
    VoteInteraction = "vote_interaction",
    /** 多项选择模版卡片 */
    MultipleInteraction = "multiple_interaction"
}
/** 卡片来源样式信息 */
interface TemplateCardSource {
    /** 来源图片的 url */
    icon_url?: string;
    /** 来源图片的描述，建议不超过 13 个字 */
    desc?: string;
    /** 来源文字的颜色，0(默认)灰色，1 黑色，2 红色，3 绿色 */
    desc_color?: 0 | 1 | 2 | 3;
}
/** 卡片右上角更多操作按钮 */
interface TemplateCardActionMenu {
    /** 更多操作界面的描述 */
    desc: string;
    /** 操作列表，长度取值范围为 [1, 3] */
    action_list: Array<{
        /** 操作的描述文案 */
        text: string;
        /** 操作 key 值，最长支持 1024 字节，不可重复 */
        key: string;
    }>;
}
/** 模板卡片主标题 */
interface TemplateCardMainTitle {
    /** 一级标题，建议不超过 26 个字 */
    title?: string;
    /** 标题辅助信息，建议不超过 30 个字 */
    desc?: string;
}
/** 关键数据样式 */
interface TemplateCardEmphasisContent {
    /** 关键数据样式的数据内容，建议不超过 10 个字 */
    title?: string;
    /** 关键数据样式的数据描述内容，建议不超过 15 个字 */
    desc?: string;
}
/** 引用文献样式 */
interface TemplateCardQuoteArea {
    /** 引用文献样式区域点击事件，0 或不填代表没有点击事件，1 代表跳转 url，2 代表跳转小程序 */
    type?: 0 | 1 | 2;
    /** 点击跳转的 url，type 是 1 时必填 */
    url?: string;
    /** 点击跳转的小程序的 appid，type 是 2 时必填 */
    appid?: string;
    /** 点击跳转的小程序的 pagepath，type 是 2 时选填 */
    pagepath?: string;
    /** 引用文献样式的标题 */
    title?: string;
    /** 引用文献样式的引用文案 */
    quote_text?: string;
}
/** 二级标题+文本列表 */
interface TemplateCardHorizontalContent {
    /** 链接类型，0 或不填代表普通文本，1 代表跳转 url，3 代表点击跳转成员详情 */
    type?: 0 | 1 | 3;
    /** 二级标题，建议不超过 5 个字 */
    keyname: string;
    /** 二级文本，建议不超过 26 个字 */
    value?: string;
    /** 链接跳转的 url，type 是 1 时必填 */
    url?: string;
    /** 成员详情的 userid，type 是 3 时必填 */
    userid?: string;
}
/** 跳转指引样式 */
interface TemplateCardJumpAction {
    /** 跳转链接类型，0 或不填代表不是链接，1 代表跳转 url，2 代表跳转小程序，3 代表触发消息智能回复 */
    type?: 0 | 1 | 2 | 3;
    /** 跳转链接样式的文案内容，建议不超过 13 个字 */
    title: string;
    /** 跳转链接的 url，type 是 1 时必填 */
    url?: string;
    /** 跳转链接的小程序的 appid，type 是 2 时必填 */
    appid?: string;
    /** 跳转链接的小程序的 pagepath，type 是 2 时选填 */
    pagepath?: string;
    /** 智能问答问题，最长不超过 200 个字节，type 为 3 时必填 */
    question?: string;
}
/** 整体卡片的点击跳转事件 */
interface TemplateCardAction {
    /** 卡片跳转类型，0 或不填代表不是链接，1 代表跳转 url，2 代表打开小程序 */
    type: 0 | 1 | 2;
    /** 跳转事件的 url，type 是 1 时必填 */
    url?: string;
    /** 跳转事件的小程序的 appid，type 是 2 时必填 */
    appid?: string;
    /** 跳转事件的小程序的 pagepath，type 是 2 时选填 */
    pagepath?: string;
}
/** 卡片二级垂直内容 */
interface TemplateCardVerticalContent {
    /** 卡片二级标题，建议不超过 26 个字 */
    title: string;
    /** 二级普通文本，建议不超过 112 个字 */
    desc?: string;
}
/** 图片样式 */
interface TemplateCardImage {
    /** 图片的 url */
    url: string;
    /** 图片的宽高比，宽高比要小于 2.25，大于 1.3，不填默认 1.3 */
    aspect_ratio?: number;
}
/** 左图右文样式 */
interface TemplateCardImageTextArea {
    /** 左图右文样式区域点击事件，0 或不填代表没有点击事件，1 代表跳转 url，2 代表跳转小程序 */
    type?: 0 | 1 | 2;
    /** 点击跳转的 url，type 是 1 时必填 */
    url?: string;
    /** 点击跳转的小程序的 appid，type 是 2 时必填 */
    appid?: string;
    /** 点击跳转的小程序的 pagepath，type 是 2 时选填 */
    pagepath?: string;
    /** 左图右文样式的标题 */
    title?: string;
    /** 左图右文样式的描述 */
    desc?: string;
    /** 左图右文样式的图片 url */
    image_url: string;
}
/** 提交按钮样式 */
interface TemplateCardSubmitButton {
    /** 按钮文案，建议不超过 10 个字 */
    text: string;
    /** 提交按钮的 key，最长支持 1024 字节 */
    key: string;
}
/** 下拉式选择器 */
interface TemplateCardSelectionItem {
    /** 下拉式选择器题目的 key，最长支持 1024 字节，不可重复 */
    question_key: string;
    /** 选择器的标题，建议不超过 13 个字 */
    title?: string;
    /** 是否不可选，false 为可选，true 为不可选（仅更新模版卡片时有效） */
    disable?: boolean;
    /** 默认选定的 id，不填或错填默认第一个 */
    selected_id?: string;
    /** 选项列表，不超过 10 个，最少 1 个 */
    option_list: Array<{
        /** 选项 id，最长支持 128 字节，不可重复 */
        id: string;
        /** 选项文案，建议不超过 10 个字 */
        text: string;
    }>;
}
/** 模板卡片按钮 */
interface TemplateCardButton {
    /** 按钮文案，建议不超过 10 个字 */
    text: string;
    /** 按钮样式，1~4，不填或错填默认 1 */
    style?: number;
    /** 按钮 key 值，最长支持 1024 字节，不可重复 */
    key: string;
}
/** 选择题样式（投票选择） */
interface TemplateCardCheckbox {
    /** 选择题 key 值，最长支持 1024 字节 */
    question_key: string;
    /** 是否不可选，false 为可选，true 为不可选（仅更新模版卡片时有效） */
    disable?: boolean;
    /** 选择题模式，单选：0，多选：1，不填默认 0 */
    mode?: 0 | 1;
    /** 选项列表，不超过 20 个，最少 1 个 */
    option_list: Array<{
        /** 选项 id，最长支持 128 字节，不可重复 */
        id: string;
        /** 选项文案描述，建议不超过 11 个字 */
        text: string;
        /** 该选项是否默认选中 */
        is_checked?: boolean;
    }>;
}
/** 模板卡片结构（通用类型，包含所有可能的字段） */
interface TemplateCard {
    /** 卡片类型 */
    card_type: string;
    /** 卡片来源样式信息 */
    source?: TemplateCardSource;
    /** 卡片右上角更多操作按钮 */
    action_menu?: TemplateCardActionMenu;
    /** 模版卡片的主要内容 */
    main_title?: TemplateCardMainTitle;
    /** 关键数据样式，建议不与引用样式共用 */
    emphasis_content?: TemplateCardEmphasisContent;
    /** 引用文献样式，建议不与关键数据共用 */
    quote_area?: TemplateCardQuoteArea;
    /** 二级普通文本，建议不超过 112 个字 */
    sub_title_text?: string;
    /** 二级标题+文本列表，列表长度不超过 6 */
    horizontal_content_list?: TemplateCardHorizontalContent[];
    /** 跳转指引样式的列表，列表长度不超过 3 */
    jump_list?: TemplateCardJumpAction[];
    /** 整体卡片的点击跳转事件 */
    card_action?: TemplateCardAction;
    /** 图片样式（news_notice 类型卡片使用） */
    card_image?: TemplateCardImage;
    /** 左图右文样式（news_notice 类型卡片使用） */
    image_text_area?: TemplateCardImageTextArea;
    /** 卡片二级垂直内容，列表长度不超过 4（news_notice 类型卡片使用） */
    vertical_content_list?: TemplateCardVerticalContent[];
    /** 下拉式的选择器（button_interaction 类型卡片使用） */
    button_selection?: TemplateCardSelectionItem;
    /** 按钮列表，列表长度不超过 6（button_interaction 类型卡片使用） */
    button_list?: TemplateCardButton[];
    /** 选择题样式（vote_interaction 类型卡片使用） */
    checkbox?: TemplateCardCheckbox;
    /** 下拉式选择器列表，最多支持 3 个（multiple_interaction 类型卡片使用） */
    select_list?: TemplateCardSelectionItem[];
    /** 提交按钮样式（vote_interaction / multiple_interaction 类型卡片使用） */
    submit_button?: TemplateCardSubmitButton;
    /** 任务 ID，同一个机器人不能重复，只能由数字、字母和"_-@"组成，最长 128 字节 */
    task_id?: string;
    /** 反馈信息 */
    feedback?: ReplyFeedback;
}
/** 模板卡片回复消息体 */
interface TemplateCardReplyBody {
    /** 消息类型，固定值 template_card */
    msgtype: 'template_card';
    /** 模板卡片内容 */
    template_card: TemplateCard;
}
/** 模板卡片回复消息体 */
interface TemplateCardReplyBody {
    /** 消息类型，固定值 template_card */
    msgtype: 'template_card';
    /** 模板卡片内容 */
    template_card: TemplateCard;
}
/** 主动发送 Markdown 消息体 */
interface SendMarkdownMsgBody {
    /** 消息类型，固定值 markdown */
    msgtype: 'markdown';
    /** markdown 消息内容 */
    markdown: {
        /** markdown 文本内容 */
        content: string;
    };
}
/** 主动发送模板卡片消息体 */
interface SendTemplateCardMsgBody {
    /** 消息类型，固定值 template_card */
    msgtype: 'template_card';
    /** 模板卡片内容 */
    template_card: TemplateCard;
}
/** 主动发送消息体联合类型 */
type SendMsgBody = SendMarkdownMsgBody | SendTemplateCardMsgBody | SendMediaMsgBody;
/** 更新模板卡片消息体 */
interface UpdateTemplateCardBody {
    /** 响应类型，固定值 update_template_card */
    response_type: 'update_template_card';
    /** 要替换模版卡片消息的 userid 列表。若不填，则表示替换当前消息涉及到的所有用户 */
    userids?: string[];
    /** 要替换的模版卡片内容 */
    template_card: TemplateCard;
}
/** 更新模板卡片消息体 */
interface UpdateTemplateCardBody {
    /** 响应类型，固定值 update_template_card */
    response_type: 'update_template_card';
    /** 要替换模版卡片消息的 userid 列表。若不填，则表示替换当前消息涉及到的所有用户 */
    userids?: string[];
    /** 要替换的模版卡片内容 */
    template_card: TemplateCard;
}
/** 企业微信媒体类型 */
type WeComMediaType = 'file' | 'image' | 'voice' | 'video';
/** 媒体消息发送体（主动发送 + 被动回复共用） */
interface SendMediaMsgBody {
    /** 消息类型 */
    msgtype: WeComMediaType;
    /** 文件消息 */
    file?: {
        media_id: string;
    };
    /** 图片消息 */
    image?: {
        media_id: string;
    };
    /** 语音消息 */
    voice?: {
        media_id: string;
    };
    /** 视频消息 */
    video?: {
        media_id: string;
        /** 视频消息的标题，不超过128个字节，超过会自动截断 */
        title?: string;
        /** 视频消息的描述，不超过512个字节，超过会自动截断 */
        description?: string;
    };
}
/** 上传素材初始化请求 body */
interface UploadMediaInitBody {
    /** 素材类型 */
    type: WeComMediaType;
    /** 文件名 */
    filename: string;
    /** 文件总大小（字节） */
    total_size: number;
    /** 分片总数 */
    total_chunks: number;
    /** 文件 MD5 值（可选） */
    md5?: string;
}
/** 上传素材初始化响应 body */
interface UploadMediaInitResult {
    /** 上传会话 ID */
    upload_id: string;
}
/** 上传素材分片请求 body */
interface UploadMediaChunkBody {
    /** 上传会话 ID */
    upload_id: string;
    /** 分片索引（从 1 开始） */
    chunk_index: number;
    /** 分片数据（Base64 编码） */
    base64_data: string;
}
/** 完成上传请求 body */
interface UploadMediaFinishBody {
    /** 上传会话 ID */
    upload_id: string;
}
/** 完成上传响应 body */
interface UploadMediaFinishResult {
    /** 素材类型 */
    type: WeComMediaType;
    /** 临时素材 media_id，3天内有效 */
    media_id: string;
    /** 创建时间 */
    created_at: string;
}
/** uploadMedia 方法选项 */
interface UploadMediaOptions {
    /** 素材类型 */
    type: WeComMediaType;
    /** 文件名 */
    filename: string;
}

/**
 * 事件相关类型定义
 */

/** 事件类型枚举 */
declare enum EventType {
    /** 进入会话事件：用户当天首次进入机器人单聊会话 */
    EnterChat = "enter_chat",
    /** 模板卡片事件：用户点击模板卡片按钮 */
    TemplateCardEvent = "template_card_event",
    /** 用户反馈事件：用户对机器人回复进行反馈 */
    FeedbackEvent = "feedback_event",
    /** 连接断开事件：有新连接建立时，服务端向旧连接发送此事件并主动断开 */
    Disconnected = "disconnected_event"
}
/** 事件发送者信息（比 MessageFrom 多了 corpid 字段） */
interface EventFrom {
    /** 事件触发者的 userid */
    userid: string;
    /** 事件触发者的 corpid，企业内部机器人不返回 */
    corpid?: string;
}
/** 进入会话事件 */
interface EnterChatEvent {
    /** 事件类型 */
    eventtype: EventType.EnterChat;
}
/** 模板卡片事件 */
interface TemplateCardEventData {
    /** 事件类型 */
    eventtype: EventType.TemplateCardEvent;
    /** 用户点击的按钮 key */
    event_key?: string;
    /** 任务 ID */
    task_id?: string;
}
/** 用户反馈事件 */
interface FeedbackEventData {
    /** 事件类型 */
    eventtype: EventType.FeedbackEvent;
}
/** 连接断开事件：有新连接建立时，服务端向旧连接推送此事件并主动断开旧连接 */
interface DisconnectedEventData {
    /** 事件类型 */
    eventtype: EventType.Disconnected;
}
/** 事件内容联合类型 */
type EventContent = EnterChatEvent | TemplateCardEventData | FeedbackEventData | DisconnectedEventData;
/** 事件回调消息结构 */
interface EventMessage {
    /** 本次回调的唯一性标志，用于事件排重 */
    msgid: string;
    /** 事件产生的时间戳 */
    create_time: number;
    /** 智能机器人 id */
    aibotid: string;
    /** 会话 id，仅群聊类型时返回 */
    chatid?: string;
    /** 会话类型：single 单聊, group 群聊 */
    chattype?: 'single' | 'group';
    /** 事件触发者信息 */
    from: EventFrom;
    /** 消息类型，事件回调固定为 event */
    msgtype: 'event';
    /** 事件内容 */
    event: EventContent;
}
/** 带有特定事件类型的事件消息 */
type EventMessageWith<E extends EventContent> = Omit<EventMessage, 'event'> & {
    event: E;
};
/** WSClient 事件映射类型 */
interface WSClientEventMap {
    /** 收到消息（所有类型），body 为 BaseMessage */
    message: (data: WsFrame<BaseMessage>) => void;
    /** 收到文本消息，body 为 TextMessage */
    'message.text': (data: WsFrame<TextMessage>) => void;
    /** 收到图片消息，body 为 ImageMessage */
    'message.image': (data: WsFrame<ImageMessage>) => void;
    /** 收到图文混排消息，body 为 MixedMessage */
    'message.mixed': (data: WsFrame<MixedMessage>) => void;
    /** 收到语音消息，body 为 VoiceMessage */
    'message.voice': (data: WsFrame<VoiceMessage>) => void;
    /** 收到文件消息，body 为 FileMessage */
    'message.file': (data: WsFrame<FileMessage>) => void;
    /** 收到视频消息，body 为 VideoMessage */
    'message.video': (data: WsFrame<VideoMessage>) => void;
    /** 收到事件回调（所有事件类型），body 为 EventMessage */
    event: (data: WsFrame<EventMessage>) => void;
    /** 收到进入会话事件，body 为 EventMessage（event 字段为 EnterChatEvent） */
    'event.enter_chat': (data: WsFrame<EventMessageWith<EnterChatEvent>>) => void;
    /** 收到模板卡片事件，body 为 EventMessage（event 字段为 TemplateCardEventData） */
    'event.template_card_event': (data: WsFrame<EventMessageWith<TemplateCardEventData>>) => void;
    /** 收到用户反馈事件，body 为 EventMessage（event 字段为 FeedbackEventData） */
    'event.feedback_event': (data: WsFrame<EventMessageWith<FeedbackEventData>>) => void;
    /** 收到连接断开事件：有新连接建立，服务端主动断开当前旧连接 */
    'event.disconnected_event': (data: WsFrame<EventMessageWith<DisconnectedEventData>>) => void;
    /** 连接建立 */
    connected: () => void;
    /** 认证成功 */
    authenticated: () => void;
    /** 连接断开 */
    disconnected: (reason: string) => void;
    /** 重连中 */
    reconnecting: (attempt: number) => void;
    /** 发生错误 */
    error: (error: Error) => void;
}

/**
 * 企业微信 API 客户端
 * 仅负责文件下载等 HTTP 辅助功能，消息收发均走 WebSocket 通道
 */
declare class WeComApiClient {
    private httpClient;
    private logger;
    constructor(logger: Logger, timeout?: number);
    /**
     * 下载文件（返回原始 Buffer 及文件名）
     */
    downloadFileRaw(url: string): Promise<{
        buffer: Buffer;
        filename?: string;
    }>;
}

declare class WSClient extends EventEmitter<WSClientEventMap> {
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

declare class WsConnectionManager {
    private ws;
    private logger;
    private wsUrl;
    private wsOptions;
    private heartbeatInterval;
    private heartbeatTimer;
    private maxReconnectAttempts;
    private maxAuthFailureAttempts;
    private reconnectAttempts;
    private authFailureAttempts;
    private isManualClose;
    /** 标记最近一次连接关闭是否因认证失败触发（用于 scheduleReconnect 区分重连类型） */
    private lastCloseWasAuthFailure;
    /** 认证凭证 */
    private botId;
    private botSecret;
    /** 额外的认证参数（如 scene、plug_version 等），会展开到认证帧 body 中 */
    private extraAuthParams;
    /** Number of consecutive missed heartbeat acks (pong) */
    private missedPongCount;
    /** Max missed pong before treating connection as dead */
    private readonly maxMissedPong;
    /** Base delay (ms) for exponential back-off reconnection */
    private reconnectBaseDelay;
    /** Upper cap (ms) for reconnect delay */
    private readonly reconnectMaxDelay;
    /** 重连定时器引用，用于在 disconnect/connect 时取消挂起的重连 */
    private reconnectTimer;
    /** 按 req_id 分组的回复发送队列，保证同一 req_id 的消息串行发送 */
    private replyQueues;
    /** 正在等待回执的 req_id 集合，value 包含超时定时器、resolve/reject 和序列号 */
    private pendingAcks;
    /** 自增序列号，用于区分同一 reqId 的不同 pending，防止超时与 ack 竞态 */
    private pendingAckSeq;
    /** 回执超时时间（毫秒） */
    private readonly replyAckTimeout;
    /** 单个 req_id 的回复队列最大长度，超过后新消息将被拒绝 */
    private maxReplyQueueSize;
    /** 连接建立回调（WebSocket open 事件，认证尚未完成） */
    onConnected: (() => void) | null;
    /** 认证成功回调 */
    onAuthenticated: (() => void) | null;
    /** 连接断开回调 */
    onDisconnected: ((reason: string) => void) | null;
    /** 收到消息回调 */
    onMessage: ((frame: WsFrame) => void) | null;
    /** 重连回调 */
    onReconnecting: ((attempt: number) => void) | null;
    /** 错误回调 */
    onError: ((error: Error) => void) | null;
    /** 服务端主动断开回调（新连接建立导致旧连接被断开） */
    onServerDisconnect: ((reason: string) => void) | null;
    constructor(logger: Logger, heartbeatInterval?: number, reconnectBaseDelay?: number, maxReconnectAttempts?: number, wsUrl?: string, wsOptions?: ClientOptions, maxReplyQueueSize?: number, maxAuthFailureAttempts?: number);
    /**
     * 设置认证凭证
     */
    setCredentials(botId: string, botSecret: string, extraAuthParams?: Record<string, any>): void;
    /**
     * 建立 WebSocket 连接（使用 SDK 内置默认地址）
     */
    connect(): void;
    /**
     * 设置 WebSocket 事件处理器
     */
    private setupEventHandlers;
    /**
     * 发送认证帧
     *
     * 格式：{ cmd: "aibot_subscribe", headers: { req_id }, body: { secret, bot_id } }
     */
    private sendAuth;
    /**
     * 处理收到的帧数据
     *
     * 接收帧结构：
     * - 消息推送：{ cmd: "aibot_msg_callback", headers: { req_id }, body: { ... } }
     * - 认证/心跳响应：{ headers: { req_id }, errcode: 0, errmsg: "ok" }
     */
    private handleFrame;
    /**
     * 启动心跳定时器
     */
    private startHeartbeat;
    /**
     * 停止心跳定时器
     */
    private stopHeartbeat;
    /**
     * 发送心跳
     * If consecutive missed pong count reaches the threshold, treat the
     * connection as dead and trigger reconnection.
     *
     * 格式：{ cmd: "ping", headers: { req_id } }
     */
    private sendHeartbeat;
    /**
     * 安排重连
     *
     * 区分两种重连场景，使用独立的计数器和最大重试次数：
     * - 认证失败（lastCloseWasAuthFailure=true）：使用 authFailureAttempts / maxAuthFailureAttempts
     * - 连接断开（lastCloseWasAuthFailure=false）：使用 reconnectAttempts / maxReconnectAttempts
     *
     * disconnected_event（被踢下线）不会触发重连，因为 isManualClose 已被设为 true。
     */
    private scheduleReconnect;
    /**
     * 发送数据帧
     *
     * 统一格式：{ cmd, headers: { req_id }, body }
     */
    send(frame: WsFrame): void;
    /**
     * 通过 WebSocket 通道发送回复消息（串行队列版本）
     *
     * 同一个 req_id 的消息会被放入队列中串行发送：
     * 发送一条后等待服务端回执，收到回执或超时后才发送下一条。
     *
     * 格式：{ cmd: "aibot_respond_msg", headers: { req_id }, body: { ... } }
     *
     * @param reqId - 透传回调中的 req_id
     * @param body - 回复消息体（如 StreamReplyBody）
     * @param cmd - 发送的命令类型，默认 WsCmd.RESPONSE
     * @returns Promise，收到回执时 resolve(回执帧)，超时或errcode非0时 reject(Error)
     */
    sendReply(reqId: string, body: any, cmd?: string): Promise<WsFrame>;
    /**
     * 处理指定 req_id 的回复队列
     * 取出队列头部的消息发送，并设置回执超时
     */
    private processReplyQueue;
    /**
     * 处理回复消息的回执
     * 收到回执后释放队列锁，继续处理下一条
     */
    private handleReplyAck;
    /**
     * 主动断开连接
     */
    /**
     * 清理所有待处理的消息和回执
     * @param reason - 清理原因，用于 reject 的错误信息
     */
    private clearPendingMessages;
    disconnect(): void;
    /**
     * 检查指定 reqId 是否有待回执的消息（即上一条消息还未收到 ack）
     *
     * 用于流式场景：调用方可据此决定是否跳过当前帧，避免排队积压。
     *
     * @param reqId - 要检查的 req_id
     * @returns true 表示有消息正在等待 ack
     */
    hasPendingAck(reqId: string): boolean;
    /**
     * 获取当前连接状态
     */
    get isConnected(): boolean;
}

/**
 * 消息处理器
 * 负责解析 WebSocket 帧并分发为具体的消息事件和事件回调
 */
declare class MessageHandler {
    private logger;
    constructor(logger: Logger);
    /**
     * 处理收到的 WebSocket 帧，解析并触发对应的消息/事件
     *
     * WebSocket 推送帧结构：
     * - 消息推送：{ cmd: "aibot_msg_callback", headers: { req_id: "xxx" }, body: { msgid, msgtype, ... } }
     * - 事件推送：{ cmd: "aibot_event_callback", headers: { req_id: "xxx" }, body: { msgid, msgtype: "event", event: { ... } } }
     *
     * @param frame - WebSocket 接收帧
     * @param emitter - WSClient 实例，用于触发事件
     */
    handleFrame(frame: WsFrame, emitter: WSClient): void;
    /**
     * 处理消息推送回调 (aibot_msg_callback)
     */
    private handleMessageCallback;
    /**
     * 处理事件推送回调 (aibot_event_callback)
     */
    private handleEventCallback;
}

/**
 * WeCom 加解密通用核心
 * 独立于 Webhook、WebSocket、Agent 的具体协议形态，统一提供基于 AES-256-CBC
 * 的加解密与 SHA1 签名计算能力。
 */
/**
 * 解码企业微信提供的 Base64 encodingAESKey
 */
declare function decodeEncodingAESKey(encodingAESKey: string): Buffer;
/**
 * PKCS#7 填充
 */
declare function pkcs7Pad(buf: Buffer, blockSize: number): Buffer;
/**
 * PKCS#7 解除填充
 */
declare function pkcs7Unpad(buf: Buffer, blockSize: number): Buffer;
declare class WecomCrypto {
    private token;
    private encodingAESKey;
    private receiveId?;
    private aesKey;
    private iv;
    constructor(token: string, encodingAESKey: string, receiveId?: string | undefined);
    /**
     * 计算 WeCom 消息签名
     */
    computeSignature(timestamp: string, nonce: string, encrypt: string): string;
    /**
     * 验证 WeCom 消息签名
     */
    verifySignature(signature: string, timestamp: string, nonce: string, encrypt: string): boolean;
    /**
     * 消息解密
     * 返回纯文本字符串（XML 或 JSON 根据上层业务而定）
     */
    decrypt(encryptText: string): string;
    /**
     * 消息加密
     * 加密明文并返回 base64 格式密文与对应的新签名
     */
    encrypt(plainText: string, timestamp: string, nonce: string): {
        encrypt: string;
        signature: string;
    };
}

/**
 * 加解密工具模块
 * 提供文件加解密相关的功能函数
 */
/**
 * 使用 AES-256-CBC 解密文件
 *
 * @param encryptedBuffer - 加密的文件数据
 * @param aesKey - Base64 编码的 AES-256 密钥
 * @returns 解密后的文件 Buffer
 */
declare function decryptFile(encryptedBuffer: Buffer, aesKey: string): Buffer;

/**
 * 默认日志实现
 * 带有日志级别和时间戳的控制台日志
 */
declare class DefaultLogger implements Logger {
    private prefix;
    constructor(prefix?: string);
    private formatTime;
    debug(message: string, ...args: any[]): void;
    info(message: string, ...args: any[]): void;
    warn(message: string, ...args: any[]): void;
    error(message: string, ...args: any[]): void;
}

/**
 * 通用工具方法
 */
/**
 * 生成随机字符串
 *
 * @param length - 随机字符串长度，默认 8
 * @returns 随机字符串
 */
declare function generateRandomString(length?: number): string;
/**
 * 生成唯一请求 ID
 *
 * 格式：`{prefix}_{timestamp}_{random}`
 *
 * @param prefix - 前缀，通常为 cmd 名称
 * @returns 唯一请求 ID
 */
declare function generateReqId(prefix: string): string;

/** 默认导出 AiBot 命名空间 */
declare const AiBot: {
    WSClient: typeof WSClient;
};

export { DefaultLogger, EventType, MessageHandler, MessageType, TemplateCardType, WSAuthFailureError, WSClient, WSReconnectExhaustedError, WeComApiClient, WecomCrypto, WsCmd, WsConnectionManager, decodeEncodingAESKey, decryptFile, AiBot as default, generateRandomString, generateReqId, pkcs7Pad, pkcs7Unpad };
export type { BaseMessage, EnterChatEvent, EventContent, EventFrom, EventMessage, EventMessageWith, FeedbackEventData, FileContent, FileMessage, ImageContent, ImageMessage, Logger, MessageFrom, MixedContent, MixedMessage, MixedMsgItem, QuoteContent, ReplyFeedback, ReplyMsgItem, ReplyOptions, SendMarkdownMsgBody, SendMarkdownParams, SendMediaMsgBody, SendMsgBody, SendTemplateCardMsgBody, SendTextParams, StreamReplyBody, StreamWithTemplateCardReplyBody, TemplateCard, TemplateCardAction, TemplateCardActionMenu, TemplateCardButton, TemplateCardCheckbox, TemplateCardEmphasisContent, TemplateCardEventData, TemplateCardHorizontalContent, TemplateCardImage, TemplateCardImageTextArea, TemplateCardJumpAction, TemplateCardMainTitle, TemplateCardQuoteArea, TemplateCardReplyBody, TemplateCardSelectionItem, TemplateCardSource, TemplateCardSubmitButton, TemplateCardVerticalContent, TextContent, TextMessage, UpdateTemplateCardBody, UploadMediaChunkBody, UploadMediaFinishBody, UploadMediaFinishResult, UploadMediaInitBody, UploadMediaInitResult, UploadMediaOptions, VideoContent, VideoMessage, VoiceContent, VoiceMessage, WSClientEventMap, WSClientOptions, WeComMediaType, WelcomeReplyBody, WelcomeTemplateCardReplyBody, WelcomeTextReplyBody, WsFrame, WsFrameHeaders };
