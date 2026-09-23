'use strict';

// Atomic publication of a cleanup receipt, shared by the Electron launcher
// (`verify-preview-permissions.cjs`) and the detached helper
// (`preview-profile-cleanup.cjs`) so both writers behave identically.
//
// Invariant: a failed publication must never destroy the last readable receipt.
// The previous implementation unlinked the destination before retrying the
// rename, which deleted the only valid evidence precisely when publishing the
// terminal result failed. Replacement now retries in place and, on exhaustion,
// throws so the caller reports a failure instead of claiming success.

const fs = require('node:fs');
const path = require('node:path');

const DEFAULT_REPLACE_ATTEMPTS = 5;
const RETRY_DELAY_MS = 25;

// Test-only hook: force every replacement (destination already present) to fail
// without touching the destination, so a test can prove the previous receipt
// survives a failed terminal publication.
const FORCE_REPLACE_FAILURE_ENV = 'DSHD_RECEIPT_FORCE_REPLACE_FAILURE';

function sleepSync(ms) {
  // Synchronous sleep without a busy loop; used only between bounded retries.
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function injectedReplacementFailure(receiptPath) {
  if (process.env[FORCE_REPLACE_FAILURE_ENV] !== '1') return null;
  if (!fs.existsSync(receiptPath)) return null;
  const error = new Error('injected receipt replacement failure');
  error.code = 'EPERM';
  return error;
}

/**
 * Publish `receipt` to `receiptPath` by renaming a fully written temp file over
 * it. The destination is never deleted: on failure the previous receipt is left
 * byte-for-byte intact and the error propagates.
 *
 * @param {string} receiptPath absolute destination path
 * @param {unknown} receipt JSON-serializable receipt body
 * @param {{ replaceAttempts?: number, guard?: (receiptPath: string) => void }} [options]
 */
function writeReceiptAtomic(receiptPath, receipt, options = {}) {
  const requestedAttempts = options.replaceAttempts;
  const replaceAttempts = Number.isInteger(requestedAttempts) && requestedAttempts > 0
    ? requestedAttempts
    : DEFAULT_REPLACE_ATTEMPTS;
  if (typeof options.guard === 'function') options.guard(receiptPath);

  const directory = path.dirname(receiptPath);
  fs.mkdirSync(directory, { recursive: true });

  const tempPath = path.join(
    directory,
    `.${path.basename(receiptPath)}.${process.pid}.${Date.now()}.${Math.random().toString(16).slice(2)}.tmp`,
  );
  fs.writeFileSync(tempPath, `${JSON.stringify(receipt, null, 2)}\n`, {
    encoding: 'utf8',
    mode: 0o600,
  });

  let lastError = null;
  for (let attempt = 0; attempt < replaceAttempts; attempt += 1) {
    try {
      const injected = injectedReplacementFailure(receiptPath);
      if (injected) throw injected;
      fs.renameSync(tempPath, receiptPath);
      return;
    } catch (error) {
      lastError = error;
      if (attempt < replaceAttempts - 1) sleepSync(RETRY_DELAY_MS);
    }
  }

  try {
    fs.unlinkSync(tempPath);
  } catch {
    // The publication error is the actionable diagnostic; the temp file is
    // best-effort debris removal only.
  }

  const failure = new Error(
    `could not publish receipt to ${receiptPath} after ${replaceAttempts} attempt(s): `
    + `${lastError instanceof Error ? lastError.message : String(lastError)}`,
  );
  if (lastError && lastError.code) failure.code = lastError.code;
  failure.cause = lastError;
  throw failure;
}

module.exports = {
  writeReceiptAtomic,
  DEFAULT_REPLACE_ATTEMPTS,
  FORCE_REPLACE_FAILURE_ENV,
};
