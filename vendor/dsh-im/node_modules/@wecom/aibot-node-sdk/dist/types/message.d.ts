/**
 * 消息相关类型定义
 * 按照企业微信智能机器人接收消息协议定义
 */
/** 消息类型枚举 */
export declare enum MessageType {
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
export interface MessageFrom {
    /** 操作者的 userid */
    userid: string;
}
/** 文本结构体 */
export interface TextContent {
    /** 文本消息内容 */
    content: string;
}
/** 图片结构体 */
export interface ImageContent {
    /** 图片的下载 url（五分钟内有效，已加密） */
    url: string;
    /** 解密密钥，长连接模式下返回，每个下载链接的 aeskey 唯一 */
    aeskey?: string;
}
/** 语音结构体 */
export interface VoiceContent {
    /** 语音转换成文本的内容 */
    content: string;
}
/** 文件结构体 */
export interface FileContent {
    /** 文件的下载 url（五分钟内有效，已加密） */
    url: string;
    /** 解密密钥，长连接模式下返回，每个下载链接的 aeskey 唯一 */
    aeskey?: string;
}
/** 视频结构体 */
export interface VideoContent {
    /** 视频的下载 url（五分钟内有效，已加密） */
    url: string;
    /** 解密密钥，长连接模式下返回，每个下载链接的 aeskey 唯一 */
    aeskey?: string;
}
/** 图文混排子项 */
export interface MixedMsgItem {
    /** 图文混排中的类型：text / image */
    msgtype: 'text' | 'image';
    /** 文本内容（msgtype 为 text 时存在） */
    text?: TextContent;
    /** 图片内容（msgtype 为 image 时存在） */
    image?: ImageContent;
}
/** 图文混排结构体 */
export interface MixedContent {
    /** 图文混排消息项列表 */
    msg_item: MixedMsgItem[];
}
/** 引用结构体 */
export interface QuoteContent {
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
export interface BaseMessage {
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
export interface TextMessage extends BaseMessage {
    msgtype: MessageType.Text;
    /** 文本消息内容 */
    text: TextContent;
}
/** 图片消息 */
export interface ImageMessage extends BaseMessage {
    msgtype: MessageType.Image;
    /** 图片内容 */
    image: ImageContent;
}
/** 图文混排消息 */
export interface MixedMessage extends BaseMessage {
    msgtype: MessageType.Mixed;
    /** 图文混排内容 */
    mixed: MixedContent;
}
/** 语音消息 */
export interface VoiceMessage extends BaseMessage {
    msgtype: MessageType.Voice;
    /** 语音内容 */
    voice: VoiceContent;
}
/** 文件消息 */
export interface FileMessage extends BaseMessage {
    msgtype: MessageType.File;
    /** 文件内容 */
    file: FileContent;
}
/** 视频消息 */
export interface VideoMessage extends BaseMessage {
    msgtype: MessageType.Video;
    /** 视频内容 */
    video: VideoContent;
}
/** 回复消息选项 */
export interface ReplyOptions {
    /** 回复的消息 ID */
    msgid: string;
    /** 聊天 ID */
    chatid: string;
}
/** 发送文本消息参数 */
export interface SendTextParams extends ReplyOptions {
    content: string;
}
/** 发送 Markdown 消息参数 */
export interface SendMarkdownParams extends ReplyOptions {
    content: string;
}
