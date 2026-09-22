import type { Logger } from './types';
/**
 * 默认日志实现
 * 带有日志级别和时间戳的控制台日志
 */
export declare class DefaultLogger implements Logger {
    private prefix;
    constructor(prefix?: string);
    private formatTime;
    debug(message: string, ...args: any[]): void;
    info(message: string, ...args: any[]): void;
    warn(message: string, ...args: any[]): void;
    error(message: string, ...args: any[]): void;
}
