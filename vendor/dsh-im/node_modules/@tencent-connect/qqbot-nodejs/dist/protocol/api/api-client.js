/**
 * Core HTTP client for the QQ Open Platform REST API.
 *
 * - `ApiClient` is an instance — config (baseUrl, timeout, logger, UA)
 *   is injected via the constructor, eliminating module-level globals.
 * - Throws structured `ApiError` with httpStatus, bizCode, and path fields.
 * - Detects HTML error pages from CDN/gateway and returns user-friendly messages.
 */
import { ApiError } from "../types.js";
import { formatErrorMessage } from "../utils/format.js";
const DEFAULT_BASE_URL = "https://api.sgroup.qq.com";
const DEFAULT_TIMEOUT_MS = 30_000;
const FILE_UPLOAD_TIMEOUT_MS = 120_000;
/**
 * Stateful HTTP client for the QQ Open Platform.
 */
export class ApiClient {
    baseUrl;
    defaultTimeoutMs;
    fileUploadTimeoutMs;
    logger;
    resolveUserAgent;
    constructor(config = {}) {
        this.baseUrl = config.baseUrl ?? DEFAULT_BASE_URL;
        this.defaultTimeoutMs = config.defaultTimeoutMs ?? DEFAULT_TIMEOUT_MS;
        this.fileUploadTimeoutMs = config.fileUploadTimeoutMs ?? FILE_UPLOAD_TIMEOUT_MS;
        this.logger = config.logger;
        const ua = config.userAgent ?? "qqbot-nodejs/unknown";
        this.resolveUserAgent = typeof ua === "function" ? ua : () => ua;
    }
    async request(accessToken, method, path, body, options) {
        const url = `${this.baseUrl}${path}`;
        const headers = {
            Authorization: `QQBot ${accessToken}`,
            "Content-Type": "application/json",
            "User-Agent": this.resolveUserAgent(),
        };
        const isFileUpload = options?.uploadRequest === true ||
            path.includes("/files") ||
            path.includes("/upload_prepare") ||
            path.includes("/upload_part_finish");
        const timeout = options?.timeoutMs ?? (isFileUpload ? this.fileUploadTimeoutMs : this.defaultTimeoutMs);
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), timeout);
        const fetchInit = { method, headers, signal: controller.signal };
        if (body) {
            fetchInit.body = JSON.stringify(body);
        }
        this.logger?.debug?.(`[qqbot:api] >>> ${method} ${url} (timeout: ${timeout}ms)`);
        if (body && this.logger?.debug) {
            const logBody = { ...body };
            for (const key of options?.redactBodyKeys ?? ["file_data"]) {
                if (typeof logBody[key] === "string") {
                    logBody[key] = `<redacted ${logBody[key].length} chars>`;
                }
            }
            this.logger.debug(`[qqbot:api] >>> Body: ${JSON.stringify(logBody)}`);
        }
        let res;
        try {
            res = await fetch(url, fetchInit);
        }
        catch (err) {
            clearTimeout(timeoutId);
            if (err instanceof Error && err.name === "AbortError") {
                this.logger?.error?.(`[qqbot:api] <<< Timeout after ${timeout}ms`);
                throw new ApiError(`Request timeout [${path}]: exceeded ${timeout}ms`, 0, path);
            }
            this.logger?.error?.(`[qqbot:api] <<< Network error: ${formatErrorMessage(err)}`);
            throw new ApiError(`Network error [${path}]: ${formatErrorMessage(err)}`, 0, path);
        }
        finally {
            clearTimeout(timeoutId);
        }
        const traceId = res.headers.get("x-tps-trace-id") ?? "";
        this.logger?.info?.(`[qqbot:api] <<< Status: ${res.status} ${res.statusText}${traceId ? ` | TraceId: ${traceId}` : ""}`);
        let rawBody;
        try {
            rawBody = await res.text();
        }
        catch (err) {
            throw new ApiError(`Failed to read response [${path}]: ${formatErrorMessage(err)}`, res.status, path);
        }
        this.logger?.debug?.(`[qqbot:api] <<< Body: ${rawBody}`);
        const contentType = res.headers.get("content-type") ?? "";
        const isHtmlResponse = contentType.includes("text/html") || rawBody.trimStart().startsWith("<");
        if (!res.ok) {
            if (isHtmlResponse) {
                const statusHint = res.status === 502 || res.status === 503 || res.status === 504
                    ? "调用发生异常，请稍候重试"
                    : res.status === 429
                        ? "请求过于频繁，已被限流"
                        : `开放平台返回 HTTP ${res.status}`;
                throw new ApiError(`${statusHint}（${path}），请稍后重试`, res.status, path);
            }
            try {
                const error = JSON.parse(rawBody);
                const bizCode = error.code ?? error.err_code;
                throw new ApiError(`API Error [${path}]: ${error.message ?? rawBody}`, res.status, path, bizCode, error.message);
            }
            catch (parseErr) {
                if (parseErr instanceof ApiError) {
                    throw parseErr;
                }
                throw new ApiError(`API Error [${path}] HTTP ${res.status}: ${rawBody.slice(0, 200)}`, res.status, path);
            }
        }
        if (isHtmlResponse) {
            throw new ApiError(`QQ 服务端返回了非 JSON 响应（${path}），可能是临时故障，请稍后重试`, res.status, path);
        }
        try {
            return JSON.parse(rawBody);
        }
        catch {
            throw new ApiError(`开放平台响应格式异常（${path}），请稍后重试`, res.status, path);
        }
    }
}
//# sourceMappingURL=api-client.js.map