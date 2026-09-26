/** Adapt the desktop git-diff IPC hunks to the shared ReviewDiff hunk shape. */
import type { ReviewHunk } from '@deepseek-ai/dsh-client-ui-primitives'
import type { DiffHunk, DiffLine } from './shell.ts'

const HUNK_HEADER = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/

/**
 * Parse an `@@ -old,count +new,count @@` header for its start lines.
 * @param header - the hunk's header line.
 * @returns the 1-based starts, or `undefined` when the header is malformed.
 */
export function hunkStarts(header: string): { oldStart: number; newStart: number } | undefined {
  const match = HUNK_HEADER.exec(header)
  if (match === null) return undefined
  return { oldStart: Number(match[1]), newStart: Number(match[3]) }
}

/**
 * Convert one IPC hunk into the shared renderer's shape: the header rides
 * verbatim and body lines regain their `+`/`-`/` `/`\` prefixes. A malformed
 * header yields rows without line numbers rather than invented ones.
 * @param hunk - a parsed hunk from `shell:git-diff`.
 * @returns the shared hunk.
 */
export function toReviewHunk(hunk: DiffHunk): ReviewHunk {
  const starts = hunkStarts(hunk.header)
  return {
    header: hunk.header,
    oldStart: starts?.oldStart,
    newStart: starts?.newStart,
    lines: hunk.lines.map((line: DiffLine) => `${line.kind === 'add' ? '+' : line.kind === 'del' ? '-' : line.kind === 'eof' ? '\\' : ' '}${line.text}`),
  }
}
