/**
 * WeCom 加解密通用核心
 * 独立于 Webhook、WebSocket、Agent 的具体协议形态，统一提供基于 AES-256-CBC
 * 的加解密与 SHA1 签名计算能力。
 */
/**
 * 解码企业微信提供的 Base64 encodingAESKey
 */
export declare function decodeEncodingAESKey(encodingAESKey: string): Buffer;
/**
 * PKCS#7 填充
 */
export declare function pkcs7Pad(buf: Buffer, blockSize: number): Buffer;
/**
 * PKCS#7 解除填充
 */
export declare function pkcs7Unpad(buf: Buffer, blockSize: number): Buffer;
export declare class WecomCrypto {
    private token;
    private encodingAESKey;
    private receiveId?;
    private aesKey;
    private iv;
    constructor(token: string, encodingAESKey: string, receiveId?: string | undefined);
    /**
     * 计算 WeCom 消息签名
     */
    computeSignature(timestamp: string, nonce: string, encrypt: string): string;
    /**
     * 验证 WeCom 消息签名
     */
    verifySignature(signature: string, timestamp: string, nonce: string, encrypt: string): boolean;
    /**
     * 消息解密
     * 返回纯文本字符串（XML 或 JSON 根据上层业务而定）
     */
    decrypt(encryptText: string): string;
    /**
     * 消息加密
     * 加密明文并返回 base64 格式密文与对应的新签名
     */
    encrypt(plainText: string, timestamp: string, nonce: string): {
        encrypt: string;
        signature: string;
    };
}
