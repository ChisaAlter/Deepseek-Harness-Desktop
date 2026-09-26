// @vitest-environment jsdom

import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, waitFor } from '@testing-library/react'
import {
  hunkLineCount, hunkRows, MAX_RENDERED_LINES, renderedHunks, ReviewDiff, splitRows,
} from '../src/ReviewDiff.tsx'
import type { ReviewHunk } from '../src/ReviewDiff.tsx'

afterEach(cleanup)

const HUNK: ReviewHunk = {
  oldStart: 10,
  oldLines: 4,
  newStart: 10,
  newLines: 5,
  lines: [
    ' ctx one',
    '-old line',
    '+new line',
    '+extra line',
    ' ctx two',
    '\\ No newline at end of file',
  ],
}

describe('hunkRows', () => {
  it('numbers context on both sides, deletions old-side, additions new-side', () => {
    expect(hunkRows(HUNK)).toEqual([
      { kind: 'context', old: 10, new: 10, text: 'ctx one' },
      { kind: 'del', old: 11, new: undefined, text: 'old line' },
      { kind: 'add', old: undefined, new: 11, text: 'new line' },
      { kind: 'add', old: undefined, new: 12, text: 'extra line' },
      { kind: 'context', old: 12, new: 13, text: 'ctx two' },
      { kind: 'eof', old: undefined, new: undefined, text: 'No newline at end of file' },
    ])
  })

  it('keeps rows numberless when the hunk carries no starts', () => {
    const rows = hunkRows({ lines: ['-a', '+b'] })
    expect(rows.map(row => row.old)).toEqual([undefined, undefined])
    expect(rows.map(row => row.new)).toEqual([undefined, undefined])
    expect(rows.map(row => row.kind)).toEqual(['del', 'add'])
  })
})

describe('splitRows', () => {
  it('pairs deletion runs with the additions that follow them', () => {
    const rows = splitRows(HUNK)
    expect(rows[0]).toEqual({
      left: { no: 10, text: 'ctx one', kind: 'context' },
      right: { no: 10, text: 'ctx one', kind: 'context' },
    })
    expect(rows[1]).toEqual({ left: { no: 11, text: 'old line', kind: 'del' }, right: { no: 11, text: 'new line', kind: 'add' } })
    expect(rows[2]).toEqual({ right: { no: 12, text: 'extra line', kind: 'add' } })
    expect(rows[3]?.left?.kind).toBe('context')
    expect(rows[4]).toEqual({ eof: 'No newline at end of file' })
  })
})

describe('renderedHunks', () => {
  const twoHunks: ReviewHunk[] = [
    { oldStart: 1, oldLines: 3, newStart: 1, newLines: 3, lines: [' a', '-b', '+c'] },
    { oldStart: 20, oldLines: 4, newStart: 20, newLines: 4, lines: [' x', '-y', '+z', ' w'] },
  ]

  it('keeps every hunk under the default budget', () => {
    expect(renderedHunks(twoHunks)).toEqual({ hunks: twoHunks, truncated: false })
  })

  it('shortens the last affordable hunk and reports truncation', () => {
    const { hunks, truncated } = renderedHunks(twoHunks, 5)
    expect(truncated).toBe(true)
    expect(hunks[0]?.lines).toHaveLength(3)
    expect(hunks[1]?.lines).toHaveLength(2)
  })

  it('drops hunks once the budget is gone', () => {
    const { hunks, truncated } = renderedHunks(twoHunks, 3)
    expect(truncated).toBe(true)
    expect(hunks).toHaveLength(1)
  })

  it('counts body lines for panel budgets', () => {
    expect(hunkLineCount(twoHunks[1]!)).toBe(4)
  })
})

const SAMPLE: ReviewHunk[] = [{
  oldStart: 1,
  oldLines: 3,
  newStart: 1,
  newLines: 4,
  lines: [' const a = 1', '-const b = 2', '+const b = 3', '+const c = 4', ' const d = 5'],
}]

describe('ReviewDiff', () => {
  it('draws unified numbered rows with the hunk header', () => {
    const { container } = render(<ReviewDiff hunks={SAMPLE} split={false} wrap={false} />)
    expect(container.querySelector('[data-review-view]')?.getAttribute('data-review-view')).toBe('unified')
    expect(container.querySelector('[data-diff-hunk-header]')?.textContent).toBe('@@ -1,3 +1,4 @@')
    const rows = [...container.querySelectorAll('[data-diff-line]')]
    expect(rows.map(row => row.getAttribute('data-diff-line'))).toEqual(['context', 'del', 'add', 'add', 'context'])
    expect(rows[0]?.textContent).toContain('const a = 1')
    expect(rows[1]?.querySelectorAll('[class*="_number_"]')[0]?.textContent).toBe('2')
  })

  it('draws paired columns for split without wrap', () => {
    const { container } = render(<ReviewDiff hunks={SAMPLE} split wrap={false} />)
    expect(container.querySelector('[data-review-view]')?.getAttribute('data-review-view')).toBe('split')
    expect(container.querySelectorAll('[data-diff-side]')).toHaveLength(2)
  })

  it('draws paired cells for split with wrap', () => {
    const { container } = render(<ReviewDiff hunks={SAMPLE} split wrap />)
    expect(container.querySelector('[data-review-view]')?.hasAttribute('data-review-wrap')).toBe(true)
    expect(container.querySelectorAll('[data-diff-side]')).toHaveLength(0)
    const rows = [...container.querySelectorAll('[data-diff-line]')]
    expect(rows.map(row => row.getAttribute('data-diff-line'))).toEqual(['context', 'del', 'add', 'context'])
  })

  it('keeps a one-sided comparison unified even when split is requested', () => {
    const added: ReviewHunk[] = [{ oldStart: 0, oldLines: 0, newStart: 1, newLines: 2, lines: ['+a', '+b'] }]
    const { container } = render(<ReviewDiff hunks={added} split wrap={false} />)
    expect(container.querySelector('[data-review-view]')?.getAttribute('data-review-view')).toBe('unified')
  })

  it('renders notes, truncation, and skipped-highlight notices', () => {
    const big: ReviewHunk[] = [{ oldStart: 1, oldLines: 1, newStart: 1, newLines: 2, lines: Array.from({ length: MAX_RENDERED_LINES + 2 }, (_v, i) => `+line ${i}`) }]
    const { container } = render(
      <ReviewDiff
        hunks={big}
        split={false}
        wrap={false}
        notes={[{ text: 'Created file', attrs: { 'data-diff-note': 'metadata' } }]}
        truncatedNote="Showing first lines"
        skippedNote="No highlight"
      />,
    )
    expect(container.querySelector('[data-diff-note="metadata"]')?.textContent).toBe('Created file')
    expect(container.querySelector('[data-diff-truncated]')?.textContent).toBe('Showing first lines')
    const rows = container.querySelectorAll('[data-diff-line]')
    expect(rows.length).toBe(MAX_RENDERED_LINES)
  })

  it('paints plain text first, then lands token spans asynchronously', async () => {
    const { container } = render(<ReviewDiff hunks={SAMPLE} language="typescript" split={false} wrap={false} />)
    expect(container.querySelector('[data-diff-line]')).not.toBeNull()
    // The first highlight waits on the shared engine warmup; allow that
    // one-time cost so suite scheduling cannot flake the assertion.
    await waitFor(() => {
      expect(container.querySelector('[data-diff-code]')).not.toBeNull()
    }, { timeout: 10_000 })
    const spans = container.querySelectorAll('[data-diff-code] span[style]')
    expect(spans.length).toBeGreaterThan(0)
  })

  it('drops stale highlights when the hunks change', async () => {
    const first: ReviewHunk[] = [{ oldStart: 1, oldLines: 1, newStart: 1, newLines: 1, lines: ['-const a = 1', '+const a = 2'] }]
    const second: ReviewHunk[] = [{ oldStart: 1, oldLines: 1, newStart: 1, newLines: 1, lines: ['-let x = 1', '+let x = 2'] }]
    const { container, rerender } = render(<ReviewDiff hunks={first} language="typescript" split={false} wrap={false} />)
    await waitFor(() => { expect(container.querySelector('[data-diff-code]')).not.toBeNull() }, { timeout: 10_000 })
    rerender(<ReviewDiff hunks={second} language="typescript" split={false} wrap={false} />)
    // Stale spans must not dress the new rows: either freshly highlighted new
    // text or plain text is acceptable, never the old line's spans.
    const texts = [...container.querySelectorAll('[data-diff-line]')].map(row => row.textContent)
    expect(texts.some(text => text?.includes('let x = 2'))).toBe(true)
    await waitFor(() => { expect(container.querySelector('[data-diff-code]')).not.toBeNull() }, { timeout: 10_000 })
  })
})
