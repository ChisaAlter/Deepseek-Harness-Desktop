/** Human-readable label for a Browser guest shown in the chat mini player. */
export function miniPlayerLabelFromUrl(value: string): string {
  try {
    const url = new URL(value)
    const segment = url.pathname.split('/').filter(Boolean).at(-1)
    if (segment && /\.[a-z\d]{1,8}$/i.test(segment)) {
      try { return decodeURIComponent(segment) } catch { return segment }
    }
    return url.hostname
  } catch {
    return ''
  }
}
