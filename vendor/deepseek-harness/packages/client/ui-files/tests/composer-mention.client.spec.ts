import { describe, expect, it } from 'vitest'
import {
  COMPOSER_MENTION_DRAG_TYPE,
  composerMentionFromTreePath,
  dataTransferHasComposerMention,
  detectComposerTrigger,
  replaceTextRange,
  serializeComposerFileLink,
  serializeComposerMentionPath,
} from '../src/client/composerMention.ts'

describe('serializeComposerMentionPath', () => {
  it('keeps simple mention paths unquoted', () => {
    expect(serializeComposerMentionPath('src/index.ts')).toBe('src/index.ts')
  })
  it('quotes mention paths containing whitespace', () => {
    expect(serializeComposerMentionPath('docs/My File.md')).toBe('"docs/My File.md"')
  })
  it('escapes quoted mention path content', () => {
    expect(serializeComposerMentionPath('docs/My "File".md')).toBe('"docs/My \\"File\\".md"')
  })
})

describe('serializeComposerFileLink', () => {
  it('uses the basename as the markdown label', () => {
    expect(serializeComposerFileLink('path/to/package.json')).toBe(
      '[package.json](path/to/package.json)',
    )
  })
  it('encodes markdown-sensitive destination characters', () => {
    expect(serializeComposerFileLink('docs/My File (draft).md')).toBe(
      '[My File (draft).md](docs/My%20File%20%28draft%29.md)',
    )
  })
  it('supports windows paths', () => {
    expect(serializeComposerFileLink('C:\\repo\\src\\index.ts')).toBe(
      '[index.ts](C:%5Crepo%5Csrc%5Cindex.ts)',
    )
  })
  it('preserves paths that legitimately start with an at sign', () => {
    expect(serializeComposerFileLink('@scope/package.json')).toBe(
      '[package.json](@scope/package.json)',
    )
  })
})

describe('composerMentionFromTreePath', () => {
  it('serializes a relative tree path as a markdown file link', () => {
    expect(composerMentionFromTreePath('src/a.ts')).toBe('[a.ts](src/a.ts)')
  })
  it('returns null for empty or slash-only paths', () => {
    expect(composerMentionFromTreePath('')).toBeNull()
    expect(composerMentionFromTreePath('///')).toBeNull()
  })
  it('uses the dshd mention MIME', () => {
    expect(COMPOSER_MENTION_DRAG_TYPE).toBe('application/x-dshd-composer-mention')
  })
})

describe('dataTransferHasComposerMention', () => {
  it('accepts only the dshd mention MIME', () => {
    expect(dataTransferHasComposerMention(['application/x-dshd-composer-mention'])).toBe(true)
    expect(dataTransferHasComposerMention(['text/plain'])).toBe(false)
  })
})

describe('detectComposerTrigger', () => {
  it('detects an @path query at the end of see @fo', () => {
    expect(detectComposerTrigger('see @fo', 7)).toEqual({
      kind: 'path',
      query: 'fo',
      rangeStart: 4,
      rangeEnd: 7,
    })
  })

  it('treats a leading /model token as slash-model with an empty query', () => {
    expect(detectComposerTrigger('/model', 6)).toEqual({
      kind: 'slash-model',
      query: '',
      rangeStart: 0,
      rangeEnd: 6,
    })
  })

  it('keeps /model args on the slash-model kind', () => {
    expect(detectComposerTrigger('/model gpt', 10)).toEqual({
      kind: 'slash-model',
      query: 'gpt',
      rangeStart: 0,
      rangeEnd: 10,
    })
  })

  it('treats a leading / as slash-command with an empty query', () => {
    expect(detectComposerTrigger('/', 1)).toEqual({
      kind: 'slash-command',
      query: '',
      rangeStart: 0,
      rangeEnd: 1,
    })
  })

  it('treats a leading /command token as slash-command', () => {
    expect(detectComposerTrigger('/go', 3)).toEqual({
      kind: 'slash-command',
      query: 'go',
      rangeStart: 0,
      rangeEnd: 3,
    })
  })

  it('does not treat a $ token as a live trigger', () => {
    expect(detectComposerTrigger('$fo', 3)).toBeNull()
  })

  it('returns null when no trigger is live', () => {
    expect(detectComposerTrigger('hello', 5)).toBeNull()
  })

  it('treats a custom whitespace char as a token boundary', () => {
    expect(detectComposerTrigger('ab@fo', 5, char => char === 'b')).toEqual({
      kind: 'path',
      query: 'fo',
      rangeStart: 2,
      rangeEnd: 5,
    })
  })

  it('clamps a fractional cursor downward', () => {
    expect(detectComposerTrigger('see @fo', 6.9)).toEqual({
      kind: 'path',
      query: 'f',
      rangeStart: 4,
      rangeEnd: 6,
    })
  })

  it('clamps a non-finite cursor to the end of the text', () => {
    expect(detectComposerTrigger('see @fo', Number.NaN)).toEqual({
      kind: 'path',
      query: 'fo',
      rangeStart: 4,
      rangeEnd: 7,
    })
  })

  it('clamps a cursor past the end of the text', () => {
    expect(detectComposerTrigger('see @fo', 99)).toEqual({
      kind: 'path',
      query: 'fo',
      rangeStart: 4,
      rangeEnd: 7,
    })
  })

  it('clamps a negative cursor to the start', () => {
    expect(detectComposerTrigger('see @fo', -3)).toBeNull()
  })

  it('does not treat a slash command with args as a live slash token', () => {
    expect(detectComposerTrigger('/foo bar', 8)).toBeNull()
  })

  it('treats tab and carriage return as token boundaries', () => {
    expect(detectComposerTrigger('x\t@fo', 5)).toEqual({
      kind: 'path',
      query: 'fo',
      rangeStart: 2,
      rangeEnd: 5,
    })
    expect(detectComposerTrigger('x\r@fo', 5)).toEqual({
      kind: 'path',
      query: 'fo',
      rangeStart: 2,
      rangeEnd: 5,
    })
  })

  it('reads /model with a trailing space as slash-model', () => {
    expect(detectComposerTrigger('/model ', 7)).toEqual({
      kind: 'slash-model',
      query: '',
      rangeStart: 0,
      rangeEnd: 7,
    })
  })
})

describe('replaceTextRange', () => {
  it('replaces the $fo span with a skill token and space', () => {
    expect(replaceTextRange('$fo', 0, 3, 'replaced ')).toEqual({
      text: 'replaced ',
      cursor: 9,
    })
  })

  it('clamps a range that overshoots the text', () => {
    expect(replaceTextRange('ab', -2, 9, 'x')).toEqual({ text: 'x', cursor: 1 })
  })
})
