/**
 * 事件相关类型定义
 */
import type { BaseMessage, TextMessage, ImageMessage, MixedMessage, VoiceMessage, FileMessage, VideoMessage } from './message';
import type { WsFrame } from './api';
/** 事件类型枚举 */
export declare enum EventType {
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
export interface EventFrom {
    /** 事件触发者的 userid */
    userid: string;
    /** 事件触发者的 corpid，企业内部机器人不返回 */
    corpid?: string;
}
/** 进入会话事件 */
export interface EnterChatEvent {
    /** 事件类型 */
    eventtype: EventType.EnterChat;
}
/** 模板卡片事件 */
export interface TemplateCardEventData {
    /** 事件类型 */
    eventtype: EventType.TemplateCardEvent;
    /** 用户点击的按钮 key */
    event_key?: string;
    /** 任务 ID */
    task_id?: string;
}
/** 用户反馈事件 */
export interface FeedbackEventData {
    /** 事件类型 */
    eventtype: EventType.FeedbackEvent;
}
/** 连接断开事件：有新连接建立时，服务端向旧连接推送此事件并主动断开旧连接 */
export interface DisconnectedEventData {
    /** 事件类型 */
    eventtype: EventType.Disconnected;
}
/** 事件内容联合类型 */
export type EventContent = EnterChatEvent | TemplateCardEventData | FeedbackEventData | DisconnectedEventData;
/** 事件回调消息结构 */
export interface EventMessage {
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
export type EventMessageWith<E extends EventContent> = Omit<EventMessage, 'event'> & {
    event: E;
};
/** WSClient 事件映射类型 */
export interface WSClientEventMap {
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
