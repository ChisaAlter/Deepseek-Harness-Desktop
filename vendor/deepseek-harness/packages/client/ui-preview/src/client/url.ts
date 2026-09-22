/** Preview URL helpers: loopback host check, free-form http(s) normalize, tab ids. */

const TAB_ID_PREFIX = 'dshd-tab_'
let nextPreviewTabSequence = 0

/**
 * Mint a preview tab id. Sequence increments per call in this module.
 * @returns id starting with `dshd-tab_`.
 */
export function newPreviewTabId(): string {
  nextPreviewTabSequence += 1
  return `${TAB_ID_PREFIX}${nextPreviewTabSequence.toString(36)}`
}

const LOOPBACK_HOSTS: ReadonlySet<string> = new Set(['localhost', '127.0.0.1', '0.0.0.0', '::1'])

const LOOPBACK_PREFIX_PATTERN = /^(?:localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1?\])(?::|\/|$)/i

/**
 * True when `host` is a loopback hostname token (bracketed IPv6 included).
 * @param host - hostname from `URL.hostname` or a typed host token.
 * @returns whether the host is loopback.
 */
export function isLoopbackHost(host: string): boolean {
  if (LOOPBACK_HOSTS.has(host)) return true
  if (host === '[::1]') return true
  return false
}

/**
 * True when a raw URL string is http(s) to a loopback host.
 * Public `https://example.com` is false. Guest documents may still be any
 * http(s) URL; this helper stays loopback-dev-only.
 * @param rawUrl - candidate URL text.
 * @returns whether the URL is a loopback http(s) preview candidate.
 */
export function isPreviewableUrl(rawUrl: string): boolean {
  try {
    const parsed = new URL(rawUrl)
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false
    return isLoopbackHost(parsed.hostname)
  } catch {
    // Unparseable input is not a previewable URL.
    return false
  }
}

/**
 * Thrown when {@link normalizePreviewUrl} cannot produce an http(s) URL.
 * Message is `Invalid preview URL (${reason}${protocol bit}; input length ${inputLength}).`
 * and never includes the raw input or parse-cause text.
 */
export class PreviewUrlNormalizationError extends Error {
  readonly reason: 'empty' | 'parse' | 'unsupported-protocol'
  readonly inputLength: number
  readonly protocol?: string

  /**
   * @param init - reason, original input length, optional protocol, optional parse cause.
   */
  constructor(init: {
    reason: 'empty' | 'parse' | 'unsupported-protocol'
    inputLength: number
    protocol?: string
    cause?: unknown
  }) {
    const protocolBit = init.protocol === undefined ? '' : `: ${init.protocol}`
    const message = `Invalid preview URL (${init.reason}${protocolBit}; input length ${init.inputLength}).`
    if (init.cause === undefined) super(message)
    else super(message, { cause: init.cause })
    this.name = 'PreviewUrlNormalizationError'
    this.reason = init.reason
    this.inputLength = init.inputLength
    if (init.protocol !== undefined) this.protocol = init.protocol
  }
}

function previewUrlProtocol(rawUrl: string): string | undefined {
  return /^([A-Za-z][A-Za-z\d+.-]*):/.exec(rawUrl)?.[1]?.toLowerCase().concat(':')
}

/**
 * Normalize free-form URL text into a fully-qualified `http(s)://` URL (`URL.href`).
 *
 * Bare loopback hosts (`localhost`, `localhost:5173`) become `http://…`.
 * Bare public hosts (`example.com`) become `https://…`.
 * Already-qualified URLs are validated and returned as `URL.href`.
 *
 * @param rawUrl - typed or pasted URL text.
 * @returns canonical http(s) URL.
 * @throws {PreviewUrlNormalizationError} empty, unparseable, or unsupported-protocol input.
 */
export function normalizePreviewUrl(rawUrl: string): string {
  const trimmed = rawUrl.trim()
  if (trimmed.length === 0) {
    throw new PreviewUrlNormalizationError({ inputLength: rawUrl.length, reason: 'empty' })
  }
  const useHttp = LOOPBACK_PREFIX_PATTERN.test(trimmed)
  const candidate = trimmed.includes('://')
    ? trimmed
    : `${useHttp ? 'http' : 'https'}://${trimmed}`
  let parsed: URL
  try {
    parsed = new URL(candidate)
  } catch (cause) {
    const protocol = previewUrlProtocol(candidate)
    throw new PreviewUrlNormalizationError({
      inputLength: rawUrl.length,
      reason: 'parse',
      ...(protocol === undefined ? {} : { protocol }),
      cause,
    })
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new PreviewUrlNormalizationError({
      inputLength: rawUrl.length,
      reason: 'unsupported-protocol',
      protocol: parsed.protocol,
    })
  }
  return parsed.href
}
