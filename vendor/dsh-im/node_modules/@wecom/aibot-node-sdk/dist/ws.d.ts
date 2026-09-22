import { type ClientOptions as WsClientOptions } from 'ws';
import type { Logger, WsFrame } from './types';
export declare class WsConnectionManager {
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
    constructor(logger: Logger, heartbeatInterval?: number, reconnectBaseDelay?: number, maxReconnectAttempts?: number, wsUrl?: string, wsOptions?: WsClientOptions, maxReplyQueueSize?: number, maxAuthFailureAttempts?: number);
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
