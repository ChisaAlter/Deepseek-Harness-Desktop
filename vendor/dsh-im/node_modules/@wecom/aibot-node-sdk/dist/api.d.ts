import type { Logger } from './types';
/**
 * 企业微信 API 客户端
 * 仅负责文件下载等 HTTP 辅助功能，消息收发均走 WebSocket 通道
 */
export declare class WeComApiClient {
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
