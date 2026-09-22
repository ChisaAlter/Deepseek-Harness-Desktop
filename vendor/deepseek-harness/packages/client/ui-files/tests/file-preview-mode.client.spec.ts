import { describe, expect, it } from 'vitest'
import { isMarkdownPreviewFile, setMarkdownTaskChecked } from '../src/client/filePreviewMode.ts'

describe('isMarkdownPreviewFile', () => {
  it('recognizes markdown and mdx paths', () => {
    expect(isMarkdownPreviewFile('a.mdx')).toBe(true)
  })
})

describe('setMarkdownTaskChecked', () => {
  it('toggles a task checkbox at the given offset', () => {
    expect(setMarkdownTaskChecked('- [ ] x', 2, true)).toBe('- [x] x')
  })

  it('returns the original string for an invalid offset', () => {
    expect(setMarkdownTaskChecked('- [ ] x', 99, true)).toBe('- [ ] x')
  })
})
