/**
 * Generic retry engine for QQ Bot API requests.
 */

import type { Logger } from "../types.js";
import { formatErrorMessage } from "../utils/format.js";

export interface RetryPolicy {
  maxRetries: number;
  baseDelayMs: number;
  backoff: "exponential" | "fixed";
  shouldRetry?: (error: Error, attempt: number) => boolean;
}

export interface PersistentRetryPolicy {
  timeoutMs: number;
  intervalMs: number;
  shouldPersistRetry: (error: Error) => boolean;
}

export async function withRetry<T>(
  fn: () => Promise<T>,
  policy: RetryPolicy,
  persistentPolicy?: PersistentRetryPolicy,
  logger?: Logger,
): Promise<T> {
  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= policy.maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(formatErrorMessage(err));

      if (persistentPolicy?.shouldPersistRetry(lastError)) {
        (logger?.warn ?? logger?.error)?.(
          `[qqbot:retry] Hit persistent-retry trigger, entering persistent loop (timeout=${persistentPolicy.timeoutMs / 1000}s)`,
        );
        return await persistentRetryLoop(fn, persistentPolicy, logger);
      }

      if (policy.shouldRetry?.(lastError, attempt) === false) {
        throw lastError;
      }

      if (attempt < policy.maxRetries) {
        const delay =
          policy.backoff === "exponential" ? policy.baseDelayMs * 2 ** attempt : policy.baseDelayMs;

        logger?.debug?.(
          `[qqbot:retry] Attempt ${attempt + 1} failed, retrying in ${delay}ms: ${lastError.message.slice(0, 100)}`,
        );
        await sleep(delay);
      }
    }
  }

  throw lastError!;
}

async function persistentRetryLoop<T>(
  fn: () => Promise<T>,
  policy: PersistentRetryPolicy,
  logger?: Logger,
): Promise<T> {
  const deadline = Date.now() + policy.timeoutMs;
  let attempt = 0;
  let lastError: Error | null = null;

  while (Date.now() < deadline) {
    try {
      const result = await fn();
      logger?.debug?.(`[qqbot:retry] Persistent retry succeeded after ${attempt} retries`);
      return result;
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(formatErrorMessage(err));

      if (!policy.shouldPersistRetry(lastError)) {
        logger?.error?.(`[qqbot:retry] Persistent retry: error is no longer retryable, aborting`);
        throw lastError;
      }

      attempt++;
      const remaining = deadline - Date.now();
      if (remaining <= 0) {
        break;
      }

      const actualDelay = Math.min(policy.intervalMs, remaining);
      (logger?.warn ?? logger?.error)?.(
        `[qqbot:retry] Persistent retry #${attempt}: retrying in ${actualDelay}ms (remaining=${Math.round(remaining / 1000)}s)`,
      );
      await sleep(actualDelay);
    }
  }

  logger?.error?.(
    `[qqbot:retry] Persistent retry timed out after ${policy.timeoutMs / 1000}s (${attempt} attempts)`,
  );
  throw lastError ?? new Error(`Persistent retry timed out (${policy.timeoutMs / 1000}s)`);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ============ Pre-built Retry Policies ============

export const UPLOAD_RETRY_POLICY: RetryPolicy = {
  maxRetries: 2,
  baseDelayMs: 1000,
  backoff: "exponential",
  shouldRetry: (error) => {
    const msg = error.message;
    return !(
      msg.includes("400") ||
      msg.includes("401") ||
      msg.includes("Invalid") ||
      msg.includes("timeout") ||
      msg.includes("Timeout")
    );
  },
};

export const COMPLETE_UPLOAD_RETRY_POLICY: RetryPolicy = {
  maxRetries: 2,
  baseDelayMs: 2000,
  backoff: "exponential",
};

export const PART_FINISH_RETRY_POLICY: RetryPolicy = {
  maxRetries: 2,
  baseDelayMs: 1000,
  backoff: "exponential",
};

export function buildPartFinishPersistentPolicy(
  retryTimeoutMs?: number,
  retryableCodes: Set<number> = PART_FINISH_RETRYABLE_CODES,
): PersistentRetryPolicy {
  return {
    timeoutMs: retryTimeoutMs ?? 2 * 60 * 1000,
    intervalMs: 1000,
    shouldPersistRetry: (error) => {
      if (retryableCodes.size === 0) {
        return false;
      }
      if ("bizCode" in error && typeof (error as { bizCode?: number }).bizCode === "number") {
        return retryableCodes.has((error as { bizCode: number }).bizCode);
      }
      return false;
    },
  };
}

export const PART_FINISH_RETRYABLE_CODES: Set<number> = new Set([40093001]);
export const UPLOAD_PREPARE_FALLBACK_CODE = 40093002;
