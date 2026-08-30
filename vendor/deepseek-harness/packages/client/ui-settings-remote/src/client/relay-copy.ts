/** Map raw relay / daemon error strings to popover-safe copy kinds. */

/**
 * Classify a relay control-plane error for the sidebar popup.
 * @param raw - snapshot `relayError` (may be empty).
 * @returns which locale key family to use; unknown → generic (no wire dump).
 */
export function humanizeRelayError(raw: string): 'disconnected' | 'generic' {
  const s = raw.trim()
  if (s === 'relay_control_disconnected' || /relay_control_disconnected/i.test(s)) {
    return 'disconnected'
  }
  return 'generic'
}

/**
 * Classify a daemon / mobile-web `snap.error` for the sidebar popup.
 * @param raw - snapshot or local error string.
 * @returns port-in-use vs generic human copy; never returns the raw string.
 */
export function humanizeRemoteError(raw: string): 'portInUse' | 'generic' {
  if (/EADDRINUSE/i.test(raw)) return 'portInUse'
  if (/端口\s*\d+\s*已被占用/.test(raw)) return 'portInUse'
  return 'generic'
}
