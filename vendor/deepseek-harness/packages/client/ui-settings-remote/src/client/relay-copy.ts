/** Map raw relay / daemon error strings to popover-safe copy kinds. */

/**
 * Drop the Electron `Error invoking remote method 'x': Error: ` wrapper an
 * `ipcRenderer.invoke` rejection carries, leaving the main-process message.
 * @param caught - rejected IPC call value.
 * @returns the underlying message for display.
 */
export function ipcErrorMessage(caught: unknown): string {
  const message = caught instanceof Error ? caught.message : String(caught)
  return message.replace(/^Error invoking remote method '[^']+':\s*(?:Error:\s*)?/, '')
}

/**
 * Classify a relay control-plane error for the sidebar popup.
 * @param raw - snapshot `relayError` (may be empty).
 * @returns which locale key family to use; unknown → generic (no wire dump).
 */
export function humanizeRelayError(raw: string): 'disconnected' | 'unavailable' | 'generic' {
  const s = raw.trim()
  if (s === 'relay_control_disconnected' || /relay_control_disconnected/i.test(s)) {
    return 'disconnected'
  }
  if (/\b503\b/.test(s) || /desktop relay is offline/i.test(s)) {
    return 'unavailable'
  }
  return 'generic'
}

/**
 * Classify a daemon / mobile-web `snap.error` for the sidebar popup.
 * @param raw - snapshot or local error string.
 * @returns copy kind for known failures; never returns the raw string.
 */
export function humanizeRemoteError(raw: string): 'portInUse' | 'bindGone' | 'generic' {
  if (/EADDRINUSE/i.test(raw)) return 'portInUse'
  if (/端口\s*\d+\s*已被占用/.test(raw)) return 'portInUse'
  // A saved per-NIC listen address that no longer exists on this machine.
  if (/EADDRNOTAVAIL/i.test(raw)) return 'bindGone'
  if (/监听地址 .+ 已失效/.test(raw)) return 'bindGone'
  return 'generic'
}
