// @vitest-environment jsdom
/**
 * Typing-effect detection and settings boundaries: the insert diff, the
 * update-tag skip set, normalization, and the versioned JSON envelope.
 */
import { describe, expect, it } from 'vitest'
import {
  COMPOSITION_END_TAG, COMPOSITION_START_TAG, CUT_TAG,
  HISTORIC_TAG, HISTORY_MERGE_TAG, HISTORY_PUSH_TAG,
  PASTE_TAG, SKIP_COLLAB_TAG,
} from 'lexical'
import {
  diffInsertedText, MAX_TYPING_FX_ECHOES, MAX_TYPING_FX_INSERT_CHARS, typingFxInsertedText,
} from '../src/client/input/editor/typing-fx.ts'
import {
  parseTypingFxConfiguration, serializeTypingFxConfiguration,
} from '../src/client/settings/TypingFxModal.tsx'
import {
  DEFAULT_TYPING_FX_PRESETS, DEFAULT_TYPING_FX_STYLE, MAX_TYPING_FX_SPEED, MIN_TYPING_FX_SPEED,
  normalizeTypingFxPresets, normalizeTypingFxStyle, resolveTypingFxColors,
} from '../src/submission-settings.ts'

const NO_TAGS = new Set<string>()

function inserted(prev: string, next: string, tags: ReadonlySet<string> = NO_TAGS) {
  return typingFxInsertedText({ prev, next, tags, composing: false })
}

describe('typing-fx insert diff', () => {
  it('reports the inserted span of a pure insertion and nothing else', () => {
    expect(diffInsertedText('abc', 'abcd')).toBe('d')
    expect(diffInsertedText('', 'a')).toBe('a')
    expect(diffInsertedText('abc', 'abXc')).toBe('X')
    expect(diffInsertedText('ac', 'abc')).toBe('b')
    expect(diffInsertedText('abc', 'aXbc')).toBe('X')
  })

  it('rejects deletions, replacements, and identical states', () => {
    expect(diffInsertedText('abc', 'ab')).toBeNull()
    expect(diffInsertedText('abc', 'axc')).toBeNull()
    expect(diffInsertedText('abc', 'abc')).toBeNull()
  })
})

describe('typingFxInsertedText', () => {
  it('echoes a plain keystroke', () => {
    expect(inserted('', 'x')).toBe('x')
    expect(inserted('你好', '你好世')).toBe('世')
  })

  it('skips paste, cut, history, composition start, and collab-marked updates', () => {
    for (const tag of [
      PASTE_TAG, CUT_TAG, HISTORIC_TAG, HISTORY_MERGE_TAG, HISTORY_PUSH_TAG,
      COMPOSITION_START_TAG, SKIP_COLLAB_TAG,
    ]) {
      expect(inserted('a', 'ab', new Set([tag])), tag).toBeNull()
    }
  })

  it('skips in-flight IME composition even when the update carries no tag', () => {
    expect(typingFxInsertedText({ prev: 'n', next: 'ni', tags: NO_TAGS, composing: true })).toBeNull()
  })

  it('echoes the committed span at composition end against the session base', () => {
    expect(typingFxInsertedText({
      prev: 'nihao', next: '你好',
      tags: new Set([COMPOSITION_END_TAG]),
      composing: false,
      compositionBase: '',
    })).toBe('你好')
    expect(typingFxInsertedText({
      prev: 'hellon', next: 'hello你好',
      tags: new Set([COMPOSITION_END_TAG]),
      composing: false,
      compositionBase: 'hello',
    })).toBe('你好')
  })

  it('reports null when a composition ends without a committed delta', () => {
    expect(typingFxInsertedText({
      prev: 'n', next: '',
      tags: new Set([COMPOSITION_END_TAG]),
      composing: false,
      compositionBase: '',
    })).toBeNull()
  })

  it('diffs an orphan composition end against its own prev', () => {
    expect(typingFxInsertedText({
      prev: 'a', next: 'ab',
      tags: new Set([COMPOSITION_END_TAG]),
      composing: false,
    })).toBe('b')
    expect(typingFxInsertedText({
      prev: 'a', next: 'a',
      tags: new Set([COMPOSITION_END_TAG]),
      composing: false,
    })).toBeNull()
  })

  it('bounds committed spans like keystrokes: bulk and whitespace stay silent', () => {
    expect(typingFxInsertedText({
      prev: '', next: '字'.repeat(MAX_TYPING_FX_INSERT_CHARS + 1),
      tags: new Set([COMPOSITION_END_TAG]),
      composing: false,
      compositionBase: '',
    })).toBeNull()
    expect(typingFxInsertedText({
      prev: '', next: ' ',
      tags: new Set([COMPOSITION_END_TAG]),
      composing: false,
      compositionBase: '',
    })).toBeNull()
  })

  it('skips bulk insertions and invisible whitespace-only ghosts', () => {
    const bulk = 'x'.repeat(MAX_TYPING_FX_INSERT_CHARS + 1)
    expect(inserted('', bulk)).toBeNull()
    expect(inserted('', 'x'.repeat(MAX_TYPING_FX_INSERT_CHARS))).toBe('x'.repeat(MAX_TYPING_FX_INSERT_CHARS))
    expect(inserted('a', 'a ')).toBeNull()
    expect(inserted('a', 'a\n')).toBeNull()
  })

  it('bounds the echo pool so a burst cannot grow DOM without limit', () => {
    expect(MAX_TYPING_FX_ECHOES).toBeGreaterThan(0)
    expect(MAX_TYPING_FX_ECHOES).toBeLessThanOrEqual(64)
  })
})

describe('typing-fx settings normalization', () => {
  it('keeps documented defaults for garbage and clamps out-of-range speed', () => {
    expect(normalizeTypingFxStyle(undefined)).toEqual(DEFAULT_TYPING_FX_STYLE)
    expect(normalizeTypingFxStyle({ effect: 'spiral', cursor: 'beam', cursorBlink: 'yes', speed: 9999 }))
      .toEqual({ ...DEFAULT_TYPING_FX_STYLE, speed: MAX_TYPING_FX_SPEED })
    expect(normalizeTypingFxStyle({ speed: 1 }))
      .toEqual({ ...DEFAULT_TYPING_FX_STYLE, speed: MIN_TYPING_FX_SPEED })
    expect(normalizeTypingFxStyle({ effect: 'rise', cursor: 'block', cursorBlink: false, speed: 160 }))
      .toEqual({ ...DEFAULT_TYPING_FX_STYLE, effect: 'rise', cursor: 'block', cursorBlink: false, speed: 160 })
  })

  it('normalizes the color source and falls back to theme for garbage', () => {
    expect(normalizeTypingFxStyle({ colors: { kind: 'preset', id: 'ocean' } }).colors)
      .toEqual({ kind: 'preset', id: 'ocean' })
    expect(normalizeTypingFxStyle({ colors: { kind: 'custom', echo: '#AABBCC', caret: '#112233' } }).colors)
      .toEqual({ kind: 'theme' })
    expect(normalizeTypingFxStyle({
      colors: { kind: 'custom', echo: '#AABBCC', caret: '#112233', text: '#FF00FF' },
    }).colors)
      .toEqual({ kind: 'custom', echo: '#aabbcc', caret: '#112233', text: '#ff00ff' })
    expect(normalizeTypingFxStyle({
      colors: { kind: 'custom', echo: '#aabbcc', caret: '#112233', text: 'red' },
    }).colors)
      .toEqual({ kind: 'theme' })
    expect(normalizeTypingFxStyle({ colors: { kind: 'preset', id: 'neon' } }).colors)
      .toEqual({ kind: 'theme' })
    expect(normalizeTypingFxStyle({ colors: { kind: 'custom', echo: 'red', caret: '#112233' } }).colors)
      .toEqual({ kind: 'theme' })
    expect(normalizeTypingFxStyle({ colors: 'blue' }).colors).toEqual({ kind: 'theme' })
  })

  it('resolves scheme triplets and nulls every stop for theme', () => {
    expect(resolveTypingFxColors({ kind: 'theme' })).toEqual({ echo: null, caret: null, text: null })
    expect(resolveTypingFxColors({ kind: 'preset', id: 'ocean' })).toEqual({
      echo: '#7dd3fc', caret: '#38bdf8', text: '#0284c7',
    })
    expect(resolveTypingFxColors({ kind: 'custom', echo: '#aabbcc', caret: '#ddeeff', text: '#334455' }))
      .toEqual({ echo: '#aabbcc', caret: '#ddeeff', text: '#334455' })
  })

  it('caps the preset library at five and strips dangerous names', () => {
    const source: Record<string, unknown> = {
      '  one  ': DEFAULT_TYPING_FX_STYLE,
      two: DEFAULT_TYPING_FX_STYLE,
      three: DEFAULT_TYPING_FX_STYLE,
      four: DEFAULT_TYPING_FX_STYLE,
      five: DEFAULT_TYPING_FX_STYLE,
      six: DEFAULT_TYPING_FX_STYLE,
      __proto__: DEFAULT_TYPING_FX_STYLE,
    }
    expect(normalizeTypingFxPresets(source)).toEqual({
      one: DEFAULT_TYPING_FX_STYLE,
      two: DEFAULT_TYPING_FX_STYLE,
      three: DEFAULT_TYPING_FX_STYLE,
      four: DEFAULT_TYPING_FX_STYLE,
      five: DEFAULT_TYPING_FX_STYLE,
    })
    expect(DEFAULT_TYPING_FX_PRESETS).toEqual({})
  })
})

describe('typing-fx JSON envelope', () => {
  const style = {
    effect: 'flash' as const, cursor: 'underline' as const, cursorBlink: false, speed: 160,
    colors: { kind: 'custom' as const, echo: '#aabbcc', caret: '#ddeeff', text: '#334455' },
  }

  it('round-trips style and presets and ignores unknown JSON fields', () => {
    const serialized = serializeTypingFxConfiguration(style, { Calm: style })
    const parsed = parseTypingFxConfiguration(serialized)
    expect(parsed.style).toEqual(style)
    expect(parsed.presets).toEqual({ Calm: style })

    const withUnknown = JSON.parse(serialized) as Record<string, unknown>
    withUnknown.unrelated = { shouldBeIgnored: true }
    withUnknown.style = { ...(withUnknown.style as object), unrelated: true }
    expect(parseTypingFxConfiguration(JSON.stringify(withUnknown)).style).toEqual(style)
  })

  it('rejects unsupported cores, versions, malformed fields, and oversize payloads', () => {
    expect(() => parseTypingFxConfiguration(JSON.stringify({ core: 'other', version: 1 }))).toThrow()
    expect(() => parseTypingFxConfiguration(JSON.stringify({ core: 'dsh-typing-fx', version: 2 }))).toThrow()
    expect(() => parseTypingFxConfiguration('x'.repeat(33 * 1024))).toThrow()
    expect(() => parseTypingFxConfiguration('not json')).toThrow()

    const invalid = JSON.parse(serializeTypingFxConfiguration(style, {})) as { style: Record<string, unknown> }
    invalid.style.effect = 'spiral'
    expect(() => parseTypingFxConfiguration(JSON.stringify(invalid))).toThrow()
    invalid.style.effect = 'drop'
    invalid.style.speed = 'fast'
    expect(() => parseTypingFxConfiguration(JSON.stringify(invalid))).toThrow()

    const invalidName = JSON.parse(serializeTypingFxConfiguration(style, {})) as {
      presets: Record<string, unknown>
    }
    invalidName.presets = { ' bad ': style }
    expect(() => parseTypingFxConfiguration(JSON.stringify(invalidName))).toThrow()

    const tooMany = JSON.parse(serializeTypingFxConfiguration(style, {})) as {
      presets: Record<string, unknown>
    }
    tooMany.presets = Object.fromEntries(Array.from({ length: 6 }, (_unused, index) => [`p${index}`, style]))
    expect(() => parseTypingFxConfiguration(JSON.stringify(tooMany))).toThrow()
  })
})
