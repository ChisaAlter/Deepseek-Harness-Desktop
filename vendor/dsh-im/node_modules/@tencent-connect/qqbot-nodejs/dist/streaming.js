/**
 * High-level helpers for QQ Bot C2C stream messages.
 *
 * QQ 开放平台只对 C2C（私聊）开放 stream_messages API。本模块提供一个
 * 简单的 sequencer，把上层应用的「逐字/逐 token 输出」适配为 QQ 协议
 * 要求的 `index + msg_seq` 序列。
 */
import { getNextMsgSeq } from "./protocol/api/routes.js";
import { StreamContentType, StreamInputMode, StreamInputState, } from "./protocol/types.js";
import { formatErrorMessage } from "./protocol/utils/format.js";
/** Throttle constants — match QQ open platform best practice. */
const DEFAULT_THROTTLE_MS = 500;
const MIN_THROTTLE_MS = 300;
/**
 * Lightweight controller for QQ C2C stream messages.
 *
 * Usage:
 * ```ts
 * const stream = bot.openStream({ openid, msgId });
 * for (const chunk of chunks) {
 *   await stream.update(currentText);  // currentText is the full text so far
 * }
 * await stream.complete();             // marks input_state = DONE
 * ```
 *
 * Important: `update()` expects the *full* current message text, not the
 * delta. The QQ API uses `input_mode=replace` semantics — each frame
 * replaces the previous one in place.
 */
/** Maximum number of retries on rate-limit (429 / 50002). */
const MAX_FLUSH_RETRIES = 3;
/** Base delay for exponential backoff on rate-limit (ms). */
const RATE_LIMIT_BASE_DELAY_MS = 1000;
export class StreamSession {
    api;
    opts;
    throttleMs;
    eventId;
    streamMsgId;
    index = 0;
    /**
     * `msg_seq` for the current stream session. QQ open platform expects all
     * frames in one stream to share the same `msg_seq` (only `index` advances).
     */
    msgSeq = null;
    lastFlushAt = 0;
    lastSentText = "";
    pendingText = "";
    pendingTimer = null;
    flushInProgress = false;
    flushPromise = null;
    isCompleted = false;
    constructor(api, opts) {
        this.api = api;
        this.opts = opts;
        this.throttleMs = Math.max(opts.throttleMs ?? DEFAULT_THROTTLE_MS, MIN_THROTTLE_MS);
        this.eventId = opts.eventId ?? opts.msgId;
    }
    /**
     * Update the current full message text. Will be sent at most once per
     * throttle window.
     */
    async update(fullText) {
        if (this.isCompleted) {
            return;
        }
        this.pendingText = fullText;
        const now = Date.now();
        const elapsed = now - this.lastFlushAt;
        if (this.flushInProgress) {
            // A flush is in flight — leave pendingText for the trailing flush.
            return;
        }
        if (elapsed >= this.throttleMs) {
            await this.flush(StreamInputState.GENERATING);
            return;
        }
        if (!this.pendingTimer) {
            const wait = this.throttleMs - elapsed;
            this.pendingTimer = setTimeout(() => {
                this.pendingTimer = null;
                if (!this.isCompleted) {
                    this.flush(StreamInputState.GENERATING).catch((err) => {
                        this.opts.logger?.error?.(`[qqbot:stream] throttle flush error: ${formatErrorMessage(err)}`);
                    });
                }
            }, wait);
        }
    }
    /** Mark the stream as DONE. Sends a final frame with the latest text. */
    async complete() {
        if (this.isCompleted) {
            return undefined;
        }
        this.isCompleted = true;
        if (this.pendingTimer) {
            clearTimeout(this.pendingTimer);
            this.pendingTimer = null;
        }
        // 等待当前正在进行的 flush 完成，避免 DONE 帧被跳过
        if (this.flushPromise) {
            await this.flushPromise.catch(() => { });
        }
        return this.flush(StreamInputState.DONE);
    }
    /** Force-cancel without sending a DONE frame (caller must clean up). */
    cancel() {
        this.isCompleted = true;
        if (this.pendingTimer) {
            clearTimeout(this.pendingTimer);
            this.pendingTimer = null;
        }
    }
    // ============ Internal ============
    async flush(state) {
        if (this.flushInProgress) {
            return undefined;
        }
        if (this.pendingText === this.lastSentText && state !== StreamInputState.DONE) {
            return undefined;
        }
        this.flushInProgress = true;
        const promise = this.doFlush(state);
        this.flushPromise = promise;
        return promise;
    }
    async doFlush(state) {
        let flushFailed = false;
        try {
            const text = this.pendingText;
            if (this.msgSeq === null) {
                this.msgSeq = getNextMsgSeq(this.opts.msgId);
            }
            const currentIndex = this.index++;
            const req = {
                input_mode: StreamInputMode.REPLACE,
                input_state: state,
                content_type: StreamContentType.MARKDOWN,
                content_raw: text,
                event_id: this.eventId,
                msg_id: this.opts.msgId,
                msg_seq: this.msgSeq,
                index: currentIndex,
            };
            if (this.streamMsgId) {
                req.stream_msg_id = this.streamMsgId;
            }
            const resp = await this.sendWithRetry(req);
            if (resp?.id && !this.streamMsgId) {
                this.streamMsgId = resp.id;
            }
            this.lastSentText = text;
            this.lastFlushAt = Date.now();
            return resp;
        }
        catch (err) {
            flushFailed = true;
            this.opts.logger?.error?.(`[qqbot:stream] flush failed (state=${state}): ${formatErrorMessage(err)}`);
            throw err;
        }
        finally {
            this.flushInProgress = false;
            // Trailing flush if more text arrived during the in-flight call.
            // Skip trailing flush on failure to avoid retry storm.
            if (!flushFailed &&
                !this.isCompleted &&
                this.pendingText !== this.lastSentText &&
                !this.pendingTimer &&
                state !== StreamInputState.DONE) {
                await this.flush(StreamInputState.GENERATING);
            }
        }
    }
    /**
     * Send a stream message with exponential backoff on rate-limit errors.
     * QQ returns err_code 50002 or HTTP 429 when rate-limited.
     */
    async sendWithRetry(req) {
        for (let attempt = 0; attempt <= MAX_FLUSH_RETRIES; attempt++) {
            try {
                return await this.api.sendC2CStreamMessage(this.opts.creds, this.opts.openid, req);
            }
            catch (err) {
                if (!this.isRateLimitError(err) || attempt >= MAX_FLUSH_RETRIES) {
                    throw err;
                }
                const delay = RATE_LIMIT_BASE_DELAY_MS * Math.pow(2, attempt);
                this.opts.logger?.debug?.(`[qqbot:stream] rate limited, retry ${attempt + 1}/${MAX_FLUSH_RETRIES} after ${delay}ms`);
                await new Promise((r) => setTimeout(r, delay));
                // Advance index for the retry to avoid stale index conflict
                req.index = this.index++;
            }
        }
        return undefined;
    }
    /** Check if an error is a rate-limit error (QQ err_code 50002 or HTTP 429). */
    isRateLimitError(err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.includes("rate limit"))
            return true;
        const code = err?.code ?? err?.err_code;
        if (code === 50002 || code === 429)
            return true;
        return false;
    }
}
//# sourceMappingURL=streaming.js.map