/**
 * 通用工具方法
 */
/**
 * 生成随机字符串
 *
 * @param length - 随机字符串长度，默认 8
 * @returns 随机字符串
 */
export declare function generateRandomString(length?: number): string;
/**
 * 生成唯一请求 ID
 *
 * 格式：`{prefix}_{timestamp}_{random}`
 *
 * @param prefix - 前缀，通常为 cmd 名称
 * @returns 唯一请求 ID
 */
export declare function generateReqId(prefix: string): string;
