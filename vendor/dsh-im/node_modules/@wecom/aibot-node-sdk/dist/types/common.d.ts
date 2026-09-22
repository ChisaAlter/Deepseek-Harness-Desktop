/**
 * 通用基础类型定义
 */
/** 日志接口 */
export interface Logger {
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
export declare class WSAuthFailureError extends Error {
    readonly code = "WS_AUTH_FAILURE_EXHAUSTED";
    constructor(maxAttempts: number);
}
/**
 * 连接断开重连次数用尽错误
 *
 * 当 WebSocket 连接断开后重连次数达到 maxReconnectAttempts 时抛出。
 * 通常表示网络或服务端持续不可用。
 */
export declare class WSReconnectExhaustedError extends Error {
    readonly code = "WS_RECONNECT_EXHAUSTED";
    constructor(maxAttempts: number);
}
