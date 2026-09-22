/**
 * Format and classify mcp-client connection errors for Settings health text.
 * @module
 */

const AUTH_LAST_ERROR = /\b(?:HTTP\s+)?(?:401|403)\b|\b(?:unauthorized|forbidden)\b|\b(?:invalid_token|invalid_grant|insufficient_scope)\b|missing bearer token/i

function errorStatus(error: unknown): number | undefined {
  if (error === null || typeof error !== 'object' || !('code' in error)) return undefined
  const code = (error as { code: unknown }).code
  return typeof code === 'number' && Number.isInteger(code) ? code : undefined
}

/**
 * Turn a thrown connect/transport error into the string stored as `lastError`.
 * Streamable HTTP SDK errors keep status on `.code`, which `String(error)` omits.
 * @param error - the thrown value from connect or transport `onerror`.
 * @returns a stable lastError string.
 */
export function formatMcpClientError(error: unknown): string {
  const code = errorStatus(error)
  const text = error instanceof Error ? `${error.name}: ${error.message}` : String(error)
  if (code !== undefined && !text.includes(String(code))) {
    return `HTTP ${String(code)}: ${text}`
  }
  return text
}

/**
 * Whether a stored lastError string is an HTTP auth challenge Settings should treat as Sign in.
 * @param lastError - connection.lastError text.
 * @returns true when the text is a 401/403 or bearer/token challenge, not a port or hostname substring.
 */
export function isMcpAuthLastError(lastError: string): boolean {
  return AUTH_LAST_ERROR.test(lastError)
}

/**
 * Whether a live error object is an auth challenge (status code or formatted text).
 * @param error - the thrown value.
 * @returns true when Sign in is the recovery.
 */
export function isMcpAuthError(error: unknown): boolean {
  const code = errorStatus(error)
  if (code === 401 || code === 403) return true
  return isMcpAuthLastError(formatMcpClientError(error))
}
