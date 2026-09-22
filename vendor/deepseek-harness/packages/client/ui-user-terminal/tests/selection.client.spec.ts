import { describe, expect, it } from 'vitest'
import { formatTerminalDraft, normalizeSelection } from '../src/client/selection.ts'

describe('formatTerminalDraft', () => {
  it('wraps normalized text in a terminal fence', () => {
    expect(formatTerminalDraft('\r\nls\r\n\n')).toBe('```terminal\nls\n```')
  })

  it('returns empty when the selection is only whitespace', () => {
    expect(normalizeSelection('\n\n')).toBe('')
    expect(formatTerminalDraft('\n')).toBe('')
  })
})
