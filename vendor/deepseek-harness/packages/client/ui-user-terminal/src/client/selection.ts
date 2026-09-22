/** Format a terminal selection for the composer draft. */

/**
 * Normalize selected PTY text: CRLF to LF, trim surrounding blank lines.
 * @param text - raw xterm selection.
 * @returns the body written into a fenced block, or empty when nothing remains.
 */
export function normalizeSelection(text: string): string {
  return text.replace(/\r\n/g, '\n').replace(/^\n+|\n+$/g, '')
}

/**
 * Wrap a terminal selection so the model sees it as terminal output, not
 * prose. This desktop has no composer chip; the fence is the honest form.
 * @param text - raw xterm selection.
 * @returns a fenced `terminal` block, or empty when the selection is blank.
 */
export function formatTerminalDraft(text: string): string {
  const body = normalizeSelection(text)
  if (body.length === 0) return ''
  return `\`\`\`terminal\n${body}\n\`\`\``
}
