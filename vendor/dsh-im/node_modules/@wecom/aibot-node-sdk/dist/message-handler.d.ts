import type { WsFrame, Logger } from './types';
import type { WSClient } from './client';
/**
 * 消息处理器
 * 负责解析 WebSocket 帧并分发为具体的消息事件和事件回调
 */
export declare class MessageHandler {
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
