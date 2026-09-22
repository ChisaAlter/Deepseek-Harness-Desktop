import { describe, expect, it } from 'vitest'
import {
  formatFileCommentRange,
  nextFileCommentId,
  normalizeFileCommentRange,
  remapFileCommentAnnotations,
  selectionToLineRange,
} from '../src/client/fileCommentAnnotations.ts'

describe('normalizeFileCommentRange', () => {
  it('orders a reversed line range', () => {
    expect(normalizeFileCommentRange({ start: 8, end: 3 })).toEqual({
      startLine: 3,
      endLine: 8,
    })
  })

  it('keeps an already ordered range', () => {
    expect(normalizeFileCommentRange({ start: 2, end: 5 })).toEqual({
      startLine: 2,
      endLine: 5,
    })
  })
})

describe('formatFileCommentRange', () => {
  it('formats a single line as L4', () => {
    expect(formatFileCommentRange(4, 4)).toBe('L4')
  })

  it('formats a span as L12 to L20', () => {
    expect(formatFileCommentRange(12, 20)).toBe('L12 to L20')
  })
})

describe('selectionToLineRange', () => {
  it('maps an exclusive DOM range covering only b to line 2', () => {
    expect(selectionToLineRange('a\nb\nc', 2, 4)).toEqual({ start: 2, end: 2 })
  })

  it('maps a two-line exclusive range', () => {
    expect(selectionToLineRange('one\ntwo\nthree', 0, 8)).toEqual({ start: 1, end: 2 })
  })

  it('maps a collapsed caret to the line it sits on', () => {
    expect(selectionToLineRange('a\nb\nc', 2, 2)).toEqual({ start: 2, end: 2 })
  })
})

describe('nextFileCommentId', () => {
  it('returns unique file-comment ids', () => {
    const first = nextFileCommentId()
    const second = nextFileCommentId()
    expect(first).toMatch(/^file-comment-\d+-\d+$/)
    expect(second).not.toBe(first)
  })
})

describe('remapFileCommentAnnotations', () => {
  it('rewrites entry lines onto the annotation lineNumber', () => {
    expect(
      remapFileCommentAnnotations([
        {
          lineNumber: 10,
          metadata: {
            entries: [
              { id: 'a', kind: 'comment', startLine: 3, endLine: 5, text: 'note' },
            ],
          },
        },
      ]),
    ).toEqual([
      {
        lineNumber: 10,
        metadata: {
          entries: [
            { id: 'a', kind: 'comment', startLine: 8, endLine: 10, text: 'note' },
          ],
        },
      },
    ])
  })
})
