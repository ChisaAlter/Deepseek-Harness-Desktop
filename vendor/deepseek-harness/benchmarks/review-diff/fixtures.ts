/**
 * Deterministic fixtures for the D5 review-diff measurement protocol.
 * Every byte is generated from fixed formulas — no recorded user material.
 *
 * The interfaces mirror the `window.shell` wire shape declared by
 * `packages/client/ui-diff/src/client/shell.ts`; a Host-face benchmark cannot
 * import Client sources, so the structural contract is restated here.
 */

/** One unified-diff line; `eof` is the `\` end-of-file annotation. */
export interface DiffLine {
  kind: 'context' | 'add' | 'del' | 'eof'
  text: string
}

/** One hunk inside a changed file. */
export interface DiffHunk {
  header: string
  lines: DiffLine[]
}

/** One changed path in the working tree. */
export interface DiffFile {
  path: string
  status: 'added' | 'modified' | 'deleted' | 'renamed'
  oldPath?: string
  hunks: DiffHunk[]
}

/** One deterministic TypeScript-looking source line. */
function codeLine(index: number): string {
  return `const metric${index} = aggregate(samples[${index % 64}], { weight: 0.${String(index % 89).padStart(2, '0')} })`
}

/** Kinds of one 10-line block inside a mixed modified-file hunk. */
const MIX: readonly DiffLine['kind'][] = ['context', 'context', 'del', 'add', 'context', 'context', 'del', 'add', 'context', 'context']

interface HunkOptions {
  /** Emit the end-of-file marker after the last hunk body line. */
  eof?: boolean
}

/**
 * Build contiguous hunks totaling `total` body lines for a modified file.
 * Old/new starts track the line mix so rendered numbers stay truthful.
 * @param total - total body lines across all hunks.
 * @param options - fixture flags.
 * @returns the hunk list.
 */
export function mixedHunks(total: number, options: HunkOptions = {}): DiffHunk[] {
  const hunks: DiffHunk[] = []
  let oldCursor = 1
  let newCursor = 1
  let produced = 0
  let index = 0
  while (produced < total) {
    const size = Math.min(100, total - produced)
    const oldStart = oldCursor
    const newStart = newCursor
    const lines: DiffLine[] = []
    for (let at = 0; at < size; at += 1) {
      const kind = MIX[index % MIX.length]!
      index += 1
      lines.push({ kind, text: codeLine(index) })
      if (kind === 'add') newCursor += 1
      else if (kind === 'del') oldCursor += 1
      else { oldCursor += 1; newCursor += 1 }
    }
    produced += size
    hunks.push({
      header: `@@ -${oldStart},${oldCursor - oldStart} +${newStart},${newCursor - newStart} @@`,
      lines,
    })
  }
  if (options.eof === true) hunks[hunks.length - 1]!.lines.push({ kind: 'eof', text: 'No newline at end of file' })
  return hunks
}

/** Uniform hunks of a single kind, for pure-addition/pure-deletion files. */
function flatHunks(total: number, kind: 'add' | 'del'): DiffHunk[] {
  const lines: DiffLine[] = Array.from({ length: total }, (_v, i) => ({ kind, text: codeLine(i) }))
  return [{ header: kind === 'add' ? `@@ -0,0 +1,${total} @@` : `@@ -1,${total} +0,0 @@`, lines }]
}

/** Fixed D5 fixture set keyed by case name. */
export const FIXTURES = {
  /** One modified file rendering ~1000 diff lines plus the EOF marker. */
  'single-1000': (): DiffFile[] => [{ path: 'src/metrics.ts', status: 'modified', hunks: mixedHunks(1000, { eof: true }) }],
  /** One modified file past the single-comparison render budget. */
  'single-6000': (): DiffFile[] => [{ path: 'src/metrics-large.ts', status: 'modified', hunks: mixedHunks(6000) }],
  /** A 100,000-character line inside an otherwise ordinary hunk. */
  'long-line-100k': (): DiffFile[] => [{
    path: 'src/bundle.ts',
    status: 'modified',
    hunks: [{
      header: '@@ -1,3 +1,4 @@',
      lines: [
        { kind: 'context', text: codeLine(1) },
        { kind: 'del', text: codeLine(2) },
        { kind: 'add', text: `${'x'.repeat(99_940)}= aggregate(samples)` },
        { kind: 'context', text: codeLine(3) },
      ],
    }],
  }],
  /** One hundred files of ~200 rendered lines each: lazy-mount territory. */
  'files-100x200': (): DiffFile[] => Array.from({ length: 100 }, (_v, i) => ({
    path: `src/gen/part-${String(i).padStart(3, '0')}.ts`,
    status: 'modified' as const,
    hunks: mixedHunks(200),
  })),
  /** Binary-style file: recognized as changed, carrying no hunks. */
  'binary': (): DiffFile[] => [{ path: 'assets/icon.png', status: 'modified', hunks: [] }],
  /** Renamed file carrying its prior path. */
  'renamed': (): DiffFile[] => [{
    path: 'src/new-name.ts',
    oldPath: 'src/old-name.ts',
    status: 'renamed',
    hunks: mixedHunks(40),
  }],
  /** Pure additions only — one-sided comparison, unified fallback. */
  'pure-add': (): DiffFile[] => [{ path: 'src/added.ts', status: 'added', hunks: flatHunks(120, 'add') }],
  /** Pure deletions only. */
  'pure-del': (): DiffFile[] => [{ path: 'src/removed.ts', status: 'deleted', hunks: flatHunks(120, 'del') }],
} satisfies Record<string, () => DiffFile[]>

export type FixtureName = keyof typeof FIXTURES
