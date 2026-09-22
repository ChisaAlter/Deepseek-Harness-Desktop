/**
 * WSClient 配置相关类型定义
 */
import type { ClientOptions as WsClientOptions } from 'ws';
import type { Logger } from './common';
/** WSClient 配置选项 */
export interface WSClientOptions {
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
    wsOptions?: WsClientOptions;
    /** 单个 req_id 的回复队列最大长度，超过后新消息将被拒绝，默认 500 */
    maxReplyQueueSize?: number;
    /** 自定义日志函数 */
    logger?: Logger;
}
