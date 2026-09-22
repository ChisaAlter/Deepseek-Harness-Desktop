/** Line-range helpers for Files comments into the composer. */

/** 1-based line span from a textarea selection (`end` inclusive after normalize). */
export type SelectedLineRange = { start: number; end: number }

/** One gutter-style comment grouping entry; remap keeps these when lines move. */
export type FileCommentAnnotationEntry = {
  id: string
  kind: 'draft' | 'comment'
  startLine: number
  endLine: number
  text: string
}

let fileCommentSequence = 0

/**
 * Mint a unique id for a file comment annotation entry.
 * @returns `file-comment-<timestamp>-<sequence>`.
 */
export function nextFileCommentId(): string {
  fileCommentSequence += 1
  return `file-comment-${Date.now()}-${fileCommentSequence}`
}

/**
 * Order a 1-based selected line range.
 * @param range - DOM-derived `{ start, end }` that may be reversed.
 * @returns inclusive `startLine` / `endLine` with start ≤ end.
 */
export function normalizeFileCommentRange(range: SelectedLineRange): {
  startLine: number
  endLine: number
} {
  return {
    startLine: Math.min(range.start, range.end),
    endLine: Math.max(range.start, range.end),
  }
}

/**
 * Format a 1-based inclusive line span for the composer header.
 * @param startLine - first line (already ordered).
 * @param endLine - last line (already ordered).
 * @returns `L4` or `L12 to L20`.
 */
export function formatFileCommentRange(startLine: number, endLine: number): string {
  return startLine === endLine ? `L${startLine}` : `L${startLine} to L${endLine}`
}

/**
 * Rebase comment entries onto a (possibly moved) annotation line.
 * @param annotations - groups keyed by the current `lineNumber`.
 * @returns new groups whose entries end on that line and keep their span.
 */
export function remapFileCommentAnnotations(
  annotations: ReadonlyArray<{ lineNumber: number; metadata: { entries: FileCommentAnnotationEntry[] } }>,
): Array<{ lineNumber: number; metadata: { entries: FileCommentAnnotationEntry[] } }> {
  return annotations.map((annotation) => ({
    ...annotation,
    metadata: {
      entries: annotation.metadata.entries.map((entry) => {
        const lineCount = entry.endLine - entry.startLine
        return {
          ...entry,
          endLine: annotation.lineNumber,
          startLine: Math.max(1, annotation.lineNumber - lineCount),
        }
      }),
    },
  }))
}

function lineNumberAt(text: string, index: number): number {
  let line = 1
  const limit = Math.max(0, Math.min(index, text.length))
  for (let offset = 0; offset < limit; offset += 1) {
    if (text.charCodeAt(offset) === 10) line += 1
  }
  return line
}

/**
 * Convert a textarea selection into 1-based line numbers.
 * `selectionEnd` is exclusive: covering only `b` in `'a\\nb\\nc'` is `(2, 4)`
 * → `{ start: 2, end: 2 }`.
 * @param text - current editor value.
 * @param selectionStart - inclusive UTF-16 offset.
 * @param selectionEnd - exclusive UTF-16 offset.
 * @returns `{ start, end }` line numbers (not yet ordered).
 */
export function selectionToLineRange(
  text: string,
  selectionStart: number,
  selectionEnd: number,
): SelectedLineRange {
  const from = Math.min(selectionStart, selectionEnd)
  const to = Math.max(selectionStart, selectionEnd)
  return {
    start: lineNumberAt(text, from),
    end: lineNumberAt(text, to > from ? to - 1 : to),
  }
}
