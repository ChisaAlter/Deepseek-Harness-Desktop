import { describe, expect, it } from 'vitest'
import { clampFileLine, resolveCenteredFileLineScrollTop } from '../src/client/fileLineReveal.ts'

describe('resolveCenteredFileLineScrollTop', () => {
  it('centers an estimated virtualized line position', () => {
    expect(
      resolveCenteredFileLineScrollTop({
        scrollTop: 0,
        scrollHeight: 2_000,
        viewportTop: 100,
        viewportHeight: 400,
        fileTop: 20,
        estimatedLine: { top: 1_000, height: 20 },
      }),
    ).toBe(830)
  })

  it('corrects a stale estimate from the rendered line geometry', () => {
    expect(
      resolveCenteredFileLineScrollTop({
        scrollTop: 830,
        scrollHeight: 2_000,
        viewportTop: 100,
        viewportHeight: 400,
        fileTop: 20,
        estimatedLine: { top: 1_000, height: 20 },
        renderedLine: { top: 620, height: 20 },
      }),
    ).toBe(1_160)
  })
})

describe('clampFileLine', () => {
  it('clamps a 1-based request to the CRLF-aware line count', () => {
    expect(clampFileLine('one\ntwo\nthree', 3)).toBe(3)
    expect(clampFileLine('one\ntwo\nthree', 12)).toBe(3)
    expect(clampFileLine('one\ntwo\nthree', 0)).toBe(1)
    expect(clampFileLine('a\r\nb\r\nc', 9)).toBe(3)
    expect(clampFileLine('', 4)).toBe(1)
    expect(clampFileLine('only\n', 2)).toBe(2)
  })
})
