'use strict';

/** Preview URL helpers (CJS twin of ui-preview `url.ts`). */

const TAB_ID_PREFIX = 'dshd-tab_';
let nextPreviewTabSequence = 0;

/**
 * Mint a preview tab id. Sequence increments per call in this module.
 * @returns {string} id starting with `dshd-tab_`.
 */
function newPreviewTabId() {
  nextPreviewTabSequence += 1;
  return `${TAB_ID_PREFIX}${nextPreviewTabSequence.toString(36)}`;
}

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '0.0.0.0', '::1']);

const LOOPBACK_PREFIX_PATTERN = /^(?:localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1?\])(?::|\/|$)/i;

/**
 * True when `host` is a loopback hostname token (bracketed IPv6 included).
 * @param {string} host
 * @returns {boolean}
 */
function isLoopbackHost(host) {
  if (LOOPBACK_HOSTS.has(host)) return true;
  if (host === '[::1]') return true;
  return false;
}

/**
 * True when a raw URL string is http(s) to a loopback host.
 * Public `https://example.com` is false. Guest document policy is
 * {@link isHttpOrHttpsUrl}; this helper stays loopback-dev-only.
 * @param {string} rawUrl
 * @returns {boolean}
 */
function isPreviewableUrl(rawUrl) {
  try {
    const parsed = new URL(rawUrl);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false;
    return isLoopbackHost(parsed.hostname);
  } catch {
    // Unparseable input is not a previewable URL.
    return false;
  }
}

/**
 * True when `raw` is an http(s) URL (any host). `file:`, `javascript:`, and
 * `ftp:` are false. Guest documents use this; the harness window stays loopback.
 * @param {unknown} raw
 * @returns {boolean}
 */
function isHttpOrHttpsUrl(raw) {
  if (typeof raw !== 'string' || raw.trim() === '') return false;
  try {
    const parsed = new URL(raw);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    // Unparseable input is not an http(s) document URL.
    return false;
  }
}

/**
 * Thrown when {@link normalizePreviewUrl} cannot produce an http(s) URL.
 * Message is `Invalid preview URL (${reason}${protocol bit}; input length ${inputLength}).`
 * and never includes the raw input or parse-cause text.
 */
class PreviewUrlNormalizationError extends Error {
  /**
   * @param {{ reason: 'empty' | 'parse' | 'unsupported-protocol', inputLength: number, protocol?: string, cause?: unknown }} init
   */
  constructor(init) {
    const protocolBit = init.protocol === undefined ? '' : `: ${init.protocol}`;
    super(
      `Invalid preview URL (${init.reason}${protocolBit}; input length ${init.inputLength}).`,
      init.cause === undefined ? undefined : { cause: init.cause },
    );
    this.name = 'PreviewUrlNormalizationError';
    this.reason = init.reason;
    this.inputLength = init.inputLength;
    if (init.protocol !== undefined) this.protocol = init.protocol;
  }
}

/**
 * @param {string} rawUrl
 * @returns {string | undefined}
 */
function previewUrlProtocol(rawUrl) {
  return /^([A-Za-z][A-Za-z\d+.-]*):/.exec(rawUrl)?.[1]?.toLowerCase().concat(':');
}

/**
 * Normalize free-form URL text into a fully-qualified `http(s)://` URL (`URL.href`).
 *
 * Bare loopback hosts become `http://…`. Bare public hosts become `https://…`.
 * Already-qualified URLs are validated and returned as `URL.href`.
 *
 * @param {string} rawUrl
 * @returns {string}
 * @throws {PreviewUrlNormalizationError} empty, unparseable, or unsupported-protocol input.
 */
function normalizePreviewUrl(rawUrl) {
  const trimmed = rawUrl.trim();
  if (trimmed.length === 0) {
    throw new PreviewUrlNormalizationError({ inputLength: rawUrl.length, reason: 'empty' });
  }
  const useHttp = LOOPBACK_PREFIX_PATTERN.test(trimmed);
  const candidate = trimmed.includes('://')
    ? trimmed
    : `${useHttp ? 'http' : 'https'}://${trimmed}`;
  let parsed;
  try {
    parsed = new URL(candidate);
  } catch (cause) {
    throw new PreviewUrlNormalizationError({
      inputLength: rawUrl.length,
      reason: 'parse',
      protocol: previewUrlProtocol(candidate),
      cause,
    });
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new PreviewUrlNormalizationError({
      inputLength: rawUrl.length,
      reason: 'unsupported-protocol',
      protocol: parsed.protocol,
    });
  }
  return parsed.href;
}

module.exports = {
  isLoopbackHost,
  isPreviewableUrl,
  isHttpOrHttpsUrl,
  PreviewUrlNormalizationError,
  normalizePreviewUrl,
  newPreviewTabId,
};
