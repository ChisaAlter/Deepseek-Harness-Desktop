/** Markdown for a completed preview element pick. */

/** Minimal pick result used to build composer markdown. */
export interface PickedAnnotationMarkdownInput {
  annotation?: {
    comment?: string
    elements?: Array<{ element?: { selector?: string } }>
  }
  screenshot?: { dataUrl?: string }
}

/**
 * Format a pick as optional comment, markdown image, and a backtick selector.
 * @param result - pick IPC result.
 * @returns composer markdown. Empty string when there is nothing to insert.
 */
export function formatPickedAnnotationMarkdown(result: PickedAnnotationMarkdownInput): string {
  const selector = result.annotation?.elements?.[0]?.element?.selector
  const label = selector !== undefined && selector.length > 0 ? selector : 'element'
  const lines: string[] = []
  const comment = result.annotation?.comment?.trim()
  if (comment !== undefined && comment.length > 0) lines.push(comment)
  const dataUrl = result.screenshot?.dataUrl
  if (dataUrl !== undefined && dataUrl.length > 0) lines.push(`![${label}](${dataUrl})`)
  if (selector !== undefined && selector.length > 0) lines.push(`\`${selector}\``)
  return lines.join('\n')
}
