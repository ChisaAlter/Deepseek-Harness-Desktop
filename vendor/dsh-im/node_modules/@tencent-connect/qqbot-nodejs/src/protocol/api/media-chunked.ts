/**
 * Chunked media upload for the QQ Open Platform (large files > 5MB).
 *
 * Flow:
 * 1. `upload_prepare` — submit file metadata + (md5/sha1/md5_10m) hashes,
 *    receive `{ upload_id, block_size, parts[], concurrency? }`.
 * 2. For every part:
 *    a. PUT bytes to the pre-signed COS URL.
 *    b. POST `upload_part_finish` with persistent retry.
 * 3. POST `complete_upload` — returns `{ file_uuid, file_info, ttl }`.
 */

import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as https from "node:https";
import {
  ApiError,
  MediaFileType,
  type ChatScope,
  type Credentials,
  type Logger,
  type UploadMediaResponse,
  type UploadPart,
  type UploadPrepareHashes,
  type UploadPrepareResponse,
} from "../types.js";
import { formatFileSize } from "../utils/format.js";
import type { ApiClient } from "./api-client.js";
import type { SanitizeFileNameFn, UploadCacheAdapter } from "./media.js";
import {
  buildPartFinishPersistentPolicy,
  COMPLETE_UPLOAD_RETRY_POLICY,
  PART_FINISH_RETRY_POLICY,
  UPLOAD_PREPARE_FALLBACK_CODE,
  withRetry,
} from "./retry.js";
import { uploadCompletePath, uploadPartFinishPath, uploadPreparePath } from "./routes.js";
import type { TokenManager } from "./token.js";

/**
 * Raised when `upload_prepare` returns {@link UPLOAD_PREPARE_FALLBACK_CODE}.
 */
export class UploadDailyLimitExceededError extends Error {
  override readonly name = "UploadDailyLimitExceededError";

  constructor(
    public readonly filePath: string,
    public readonly fileSize: number,
    originalMessage: string,
  ) {
    super(originalMessage);
  }
}

export interface ChunkedUploadProgress {
  completedParts: number;
  totalParts: number;
  uploadedBytes: number;
  totalBytes: number;
}

/** Source of bytes for a chunked upload. */
export type ChunkedMediaSource =
  | { kind: "localPath"; path: string; size: number }
  | { kind: "buffer"; buffer: Buffer; fileName?: string };

export interface UploadChunkedOptions {
  scope: ChatScope;
  targetId: string;
  fileType: MediaFileType;
  source: ChunkedMediaSource;
  creds: Credentials;
  fileName?: string;
  onProgress?: (progress: ChunkedUploadProgress) => void;
  logPrefix?: string;
}

export interface ChunkedMediaApiConfig {
  logger?: Logger;
  uploadCache?: UploadCacheAdapter;
  sanitizeFileName?: SanitizeFileNameFn;
}

const DEFAULT_CONCURRENT_PARTS = 1;
const MAX_CONCURRENT_PARTS = 10;
const MAX_PART_FINISH_RETRY_TIMEOUT_MS = 10 * 60 * 1000;
const PART_UPLOAD_TIMEOUT_MS = 300_000;
const MD5_10M_SIZE = 10_002_432;

export class ChunkedMediaApi {
  private readonly client: ApiClient;
  private readonly tokenManager: TokenManager;
  private readonly logger?: Logger;
  private readonly cache?: UploadCacheAdapter;
  private readonly sanitize: SanitizeFileNameFn;

  constructor(client: ApiClient, tokenManager: TokenManager, config: ChunkedMediaApiConfig = {}) {
    this.client = client;
    this.tokenManager = tokenManager;
    this.logger = config.logger;
    this.cache = config.uploadCache;
    this.sanitize = config.sanitizeFileName ?? ((n) => n);
  }

  async uploadChunked(opts: UploadChunkedOptions): Promise<UploadMediaResponse> {
    const prefix = opts.logPrefix ?? "[qqbot:chunked-upload]";
    const input = resolveSource(opts.source, opts.fileName);

    const displayName = input.fileName;
    const fileSize = input.size;
    const pathLabel = input.kind === "localPath" ? input.path : "<buffer>";

    this.logger?.info?.(
      `${prefix} Start: file=${displayName} size=${formatFileSize(fileSize)} type=${opts.fileType}`,
    );

    const hashes = await computeHashes(input);
    this.logger?.debug?.(
      `${prefix} hashes: md5=${hashes.md5} sha1=${hashes.sha1} md5_10m=${hashes.md5_10m}`,
    );

    if (this.cache) {
      const cached = this.cache.get(hashes.md5, opts.scope, opts.targetId, opts.fileType);
      if (cached) {
        this.logger?.info?.(
          `${prefix} cache HIT (md5=${hashes.md5.slice(0, 8)}) — skipping chunked upload`,
        );
        return { file_uuid: "", file_info: cached, ttl: 0 };
      }
    }

    const fileNameForPrepare =
      opts.fileType === MediaFileType.FILE ? this.sanitize(displayName) : displayName;
    const prepareResp = await this.callUploadPrepare(
      opts,
      fileNameForPrepare,
      fileSize,
      hashes,
      pathLabel,
    );

    const { upload_id, parts } = prepareResp;
    const block_size = prepareResp.block_size;
    const maxConcurrent = Math.min(
      prepareResp.concurrency ? prepareResp.concurrency : DEFAULT_CONCURRENT_PARTS,
      MAX_CONCURRENT_PARTS,
    );
    const retryTimeoutMs = prepareResp.retry_timeout
      ? Math.min(prepareResp.retry_timeout * 1000, MAX_PART_FINISH_RETRY_TIMEOUT_MS)
      : undefined;

    this.logger?.info?.(
      `${prefix} prepared: upload_id=${upload_id} block=${formatFileSize(block_size)} parts=${parts.length} concurrency=${maxConcurrent}`,
    );

    let completedParts = 0;
    let uploadedBytes = 0;

    const uploadPart = async (part: UploadPart): Promise<void> => {
      const partIndex = part.index;
      const offset = (partIndex - 1) * block_size;
      const length = Math.min(block_size, fileSize - offset);

      const partBuffer = await readPart(input, offset, length);
      const md5Hex = crypto.createHash("md5").update(partBuffer).digest("hex");

      this.logger?.debug?.(
        `${prefix} part ${partIndex}/${parts.length}: ${formatFileSize(length)} offset=${offset} md5=${md5Hex}`,
      );

      await putToPresignedUrl(
        part.presigned_url,
        partBuffer,
        partIndex,
        parts.length,
        this.logger,
        prefix,
      );

      await this.callUploadPartFinish(opts, upload_id, partIndex, length, md5Hex, retryTimeoutMs);

      completedParts++;
      uploadedBytes += length;
      this.logger?.info?.(
        `${prefix} part ${partIndex}/${parts.length} done (${completedParts}/${parts.length})`,
      );

      opts.onProgress?.({
        completedParts,
        totalParts: parts.length,
        uploadedBytes,
        totalBytes: fileSize,
      });
    };

    await runWithConcurrency(
      parts.map((part) => () => uploadPart(part)),
      maxConcurrent,
    );

    this.logger?.info?.(`${prefix} all parts uploaded, completing...`);

    const result = await this.callCompleteUpload(opts, upload_id);
    this.logger?.info?.(`${prefix} completed: file_uuid=${result.file_uuid} ttl=${result.ttl}s`);

    if (this.cache && result.file_info && result.ttl > 0) {
      this.cache.set(
        hashes.md5,
        opts.scope,
        opts.targetId,
        opts.fileType,
        result.file_info,
        result.file_uuid,
        result.ttl,
      );
    }

    return result;
  }

  private async callUploadPrepare(
    opts: UploadChunkedOptions,
    fileName: string,
    fileSize: number,
    hashes: UploadPrepareHashes,
    pathLabel: string,
  ): Promise<UploadPrepareResponse> {
    const token = await this.tokenManager.getAccessToken(opts.creds.appId, opts.creds.clientSecret);
    const path = uploadPreparePath(opts.scope, opts.targetId);
    try {
      return await this.client.request<UploadPrepareResponse>(
        token,
        "POST",
        path,
        {
          file_type: opts.fileType,
          file_name: fileName,
          file_size: fileSize,
          md5: hashes.md5,
          sha1: hashes.sha1,
          md5_10m: hashes.md5_10m,
        },
        { uploadRequest: true },
      );
    } catch (err) {
      if (err instanceof ApiError && err.bizCode === UPLOAD_PREPARE_FALLBACK_CODE) {
        throw new UploadDailyLimitExceededError(pathLabel, fileSize, err.message);
      }
      throw err;
    }
  }

  private async callUploadPartFinish(
    opts: UploadChunkedOptions,
    uploadId: string,
    partIndex: number,
    blockSize: number,
    md5: string,
    retryTimeoutMs?: number,
  ): Promise<void> {
    const persistentPolicy = buildPartFinishPersistentPolicy(retryTimeoutMs);
    const path = uploadPartFinishPath(opts.scope, opts.targetId);
    await withRetry(
      async () => {
        const token = await this.tokenManager.getAccessToken(
          opts.creds.appId,
          opts.creds.clientSecret,
        );
        return this.client.request(
          token,
          "POST",
          path,
          {
            upload_id: uploadId,
            part_index: partIndex,
            block_size: blockSize,
            md5,
          },
          { uploadRequest: true },
        );
      },
      PART_FINISH_RETRY_POLICY,
      persistentPolicy,
      this.logger,
    );
  }

  private async callCompleteUpload(
    opts: UploadChunkedOptions,
    uploadId: string,
  ): Promise<UploadMediaResponse> {
    const path = uploadCompletePath(opts.scope, opts.targetId);
    return withRetry(
      async () => {
        const token = await this.tokenManager.getAccessToken(
          opts.creds.appId,
          opts.creds.clientSecret,
        );
        return this.client.request<UploadMediaResponse>(
          token,
          "POST",
          path,
          { upload_id: uploadId },
          { uploadRequest: true },
        );
      },
      COMPLETE_UPLOAD_RETRY_POLICY,
      undefined,
      this.logger,
    );
  }
}

// ============ Source resolution ============

type ChunkedInput =
  | { kind: "localPath"; path: string; size: number; fileName: string }
  | { kind: "buffer"; buffer: Buffer; size: number; fileName: string };

function resolveSource(source: ChunkedMediaSource, fileNameOverride?: string): ChunkedInput {
  if (source.kind === "localPath") {
    const inferredName = source.path.split(/[/\\]/).pop() || "file";
    return {
      kind: "localPath",
      path: source.path,
      size: source.size,
      fileName: fileNameOverride ?? inferredName,
    };
  }
  return {
    kind: "buffer",
    buffer: source.buffer,
    size: source.buffer.length,
    fileName: fileNameOverride ?? source.fileName ?? "file",
  };
}

async function readPart(input: ChunkedInput, offset: number, length: number): Promise<Buffer> {
  if (input.kind === "buffer") {
    return input.buffer.subarray(offset, offset + length);
  }
  const handle = await fs.promises.open(input.path, "r");
  try {
    const buf = Buffer.alloc(length);
    const { bytesRead } = await handle.read(buf, 0, length, offset);
    return bytesRead < length ? buf.subarray(0, bytesRead) : buf;
  } finally {
    await handle.close();
  }
}

async function computeHashes(input: ChunkedInput): Promise<UploadPrepareHashes> {
  if (input.kind === "buffer") {
    const md5 = crypto.createHash("md5").update(input.buffer).digest("hex");
    const sha1 = crypto.createHash("sha1").update(input.buffer).digest("hex");
    const md5_10m =
      input.size > MD5_10M_SIZE
        ? crypto.createHash("md5").update(input.buffer.subarray(0, MD5_10M_SIZE)).digest("hex")
        : md5;
    return { md5, sha1, md5_10m };
  }

  return new Promise((resolve, reject) => {
    const md5 = crypto.createHash("md5");
    const sha1 = crypto.createHash("sha1");
    const md5_10m = crypto.createHash("md5");
    let consumed = 0;
    const needsMd5_10m = input.size > MD5_10M_SIZE;

    const stream = fs.createReadStream(input.path);
    stream.on("data", (chunk: Buffer | string) => {
      const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      md5.update(buf);
      sha1.update(buf);
      if (needsMd5_10m) {
        const remaining = MD5_10M_SIZE - consumed;
        if (remaining > 0) {
          md5_10m.update(remaining >= buf.length ? buf : buf.subarray(0, remaining));
        }
      }
      consumed += buf.length;
    });
    stream.on("end", () => {
      const md5Hex = md5.digest("hex");
      const sha1Hex = sha1.digest("hex");
      resolve({
        md5: md5Hex,
        sha1: sha1Hex,
        md5_10m: needsMd5_10m ? md5_10m.digest("hex") : md5Hex,
      });
    });
    stream.on("error", reject);
  });
}

// ============ COS PUT ============

const PART_UPLOAD_MAX_RETRIES = 2;

/**
 * PUT data to COS via raw https.request, bypassing fetch/undici.
 * Used because Node.js fetch can fail unpredictably in long-running processes.
 */
function putToCOS(
  presignedUrl: string,
  data: Buffer,
  signal: AbortSignal,
): Promise<{ status: number; etag: string; requestId: string }> {
  return new Promise((resolve, reject) => {
    const parsed = new URL(presignedUrl);
    const req = https.request(
      parsed,
      {
        method: "PUT",
        headers: { "Content-Length": String(data.length) },
        signal,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c: Buffer) => chunks.push(c));
        res.on("end", () => {
          const etag = (res.headers.etag ?? "").replace(/"/g, "");
          const requestId = res.headers["x-cos-request-id"]?.toString() ?? "-";
          if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
            resolve({ status: res.statusCode, etag, requestId });
          } else {
            reject(
              new Error(
                `COS PUT failed: ${res.statusCode} ${res.statusMessage ?? ""} - ${
                  Buffer.concat(chunks).toString().slice(0, 120)
                }`,
              ),
            );
          }
        });
        res.on("error", reject);
      },
    );
    req.on("error", (err) => {
      // Suppress DOMException typings from AbortSignal error events
      reject(err as unknown as Error);
    });
    req.end(data);
  });
}

async function putToPresignedUrl(
  presignedUrl: string,
  data: Buffer,
  partIndex: number,
  totalParts: number,
  logger: Logger | undefined,
  prefix: string,
): Promise<void> {
  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= PART_UPLOAD_MAX_RETRIES; attempt++) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), PART_UPLOAD_TIMEOUT_MS);

    try {
      const startTime = Date.now();
      const { etag, requestId } = await putToCOS(
        presignedUrl,
        data,
        controller.signal,
      );
      const elapsed = Date.now() - startTime;

      logger?.debug?.(
        `${prefix} PUT part ${partIndex}/${totalParts} OK (${elapsed}ms ETag=${etag} requestId=${requestId})`,
      );
      return;
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      const code = (err as NodeJS.ErrnoException).code ?? "none";
      const causeMsg = (() => {
        const c = err instanceof Error ? err.cause : undefined;
        return c instanceof Error ? c.message : "none";
      })();
      if (lastError.name === "AbortError") {
        lastError = new Error(
          `Part ${partIndex}/${totalParts} upload timeout after ${PART_UPLOAD_TIMEOUT_MS}ms`,
        );
      }
      if (attempt < PART_UPLOAD_MAX_RETRIES) {
        const delay = 1000 * 2 ** attempt;
        (logger?.warn ?? logger?.error)?.(
          `${prefix} PUT part ${partIndex}/${totalParts} attempt ${attempt + 1} failed (${lastError.message.slice(0, 120)} code=${code} cause=${causeMsg}), retrying in ${delay}ms`,
        );
        await sleep(delay);
      } else {
        (logger?.error)?.(
          `${prefix} PUT part ${partIndex}/${totalParts} all retries exhausted (code=${code} cause=${causeMsg})`,
        );
      }
    } finally {
      clearTimeout(timeoutId);
    }
  }

  throw lastError ?? new Error(`Part ${partIndex}/${totalParts} upload failed`);
}

async function runWithConcurrency(
  tasks: Array<() => Promise<void>>,
  maxConcurrent: number,
): Promise<void> {
  for (let i = 0; i < tasks.length; i += maxConcurrent) {
    const batch = tasks.slice(i, i + maxConcurrent);
    await Promise.all(batch.map((task) => task()));
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
