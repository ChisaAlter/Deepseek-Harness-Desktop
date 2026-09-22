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
export declare function decryptFile(encryptedBuffer: Buffer, aesKey: string): Buffer;
