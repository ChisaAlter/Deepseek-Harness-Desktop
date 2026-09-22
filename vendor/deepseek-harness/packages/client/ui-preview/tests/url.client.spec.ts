import { describe, expect, it } from 'vitest'
import {
  isLoopbackHost,
  isPreviewableUrl,
  newPreviewTabId,
  normalizePreviewUrl,
  PreviewUrlNormalizationError,
} from '../src/client/url.ts'

describe('newPreviewTabId', () => {
  it('returns a unique id with the dshd-tab_ prefix', () => {
    const a = newPreviewTabId()
    const b = newPreviewTabId()
    expect(a).not.toBe(b)
    expect(a.startsWith('dshd-tab_')).toBe(true)
  })
})

describe('isLoopbackHost', () => {
  it.each(['localhost', '127.0.0.1', '0.0.0.0', '::1', '[::1]'])('%s is loopback', (host) => {
    expect(isLoopbackHost(host)).toBe(true)
  })

  it.each(['example.com', '192.168.1.10', '10.0.0.1', ''])('%s is not loopback', (host) => {
    expect(isLoopbackHost(host)).toBe(false)
  })
})

describe('isPreviewableUrl', () => {
  it('treats loopback http as previewable', () => {
    expect(isPreviewableUrl('http://127.0.0.1:3000')).toBe(true)
  })

  it('rejects a public https host', () => {
    expect(isPreviewableUrl('https://example.com')).toBe(false)
  })

  it.each([
    'http://localhost:5173',
    'http://127.0.0.1:3000/path',
    'http://0.0.0.0:8080',
    'http://[::1]:5173',
  ])('%s is previewable', (url) => {
    expect(isPreviewableUrl(url)).toBe(true)
  })

  it.each(['https://example.com', 'ws://localhost:5173', 'file:///etc/passwd', 'not-a-url', ''])(
    '%s is not previewable',
    (url) => {
      expect(isPreviewableUrl(url)).toBe(false)
    },
  )
})

describe('normalizePreviewUrl', () => {
  it('treats bare loopback hosts as http with a trailing slash from URL.href', () => {
    expect(normalizePreviewUrl('localhost:5173')).toBe('http://localhost:5173/')
    expect(normalizePreviewUrl('127.0.0.1:3000')).toBe('http://127.0.0.1:3000/')
    expect(normalizePreviewUrl('127.0.0.1:3000/app')).toBe('http://127.0.0.1:3000/app')
    expect(normalizePreviewUrl('0.0.0.0:4173')).toBe('http://0.0.0.0:4173/')
    expect(normalizePreviewUrl('[::1]:8080')).toBe('http://[::1]:8080/')
    expect(normalizePreviewUrl('http://127.0.0.1:3000')).toBe('http://127.0.0.1:3000/')
  })

  it('treats bare public hosts as https', () => {
    expect(normalizePreviewUrl('example.com')).toMatch(/^https:\/\/example\.com\/?/)
    expect(normalizePreviewUrl('example.com')).toBe('https://example.com/')
  })

  it('respects explicit schemes', () => {
    expect(normalizePreviewUrl('https://localhost:5173')).toBe('https://localhost:5173/')
    expect(normalizePreviewUrl('http://example.com/path?q=1')).toBe('http://example.com/path?q=1')
  })

  it('rejects empty input', () => {
    expect(() => normalizePreviewUrl('')).toThrow(PreviewUrlNormalizationError)
    try {
      normalizePreviewUrl('   ')
      expect.unreachable('expected URL normalization to fail')
    } catch (error) {
      expect(error).toBeInstanceOf(PreviewUrlNormalizationError)
      expect(error).toMatchObject({ inputLength: 3, reason: 'empty' })
      expect(error).not.toHaveProperty('rawUrl')
      expect('cause' in (error as object)).toBe(false)
    }
  })

  it('rejects unsupported protocols', () => {
    try {
      normalizePreviewUrl('ftp://example.com')
      expect.unreachable('expected URL normalization to fail')
    } catch (error) {
      expect(error).toBeInstanceOf(PreviewUrlNormalizationError)
      expect(error).toMatchObject({
        inputLength: 'ftp://example.com'.length,
        reason: 'unsupported-protocol',
        protocol: 'ftp:',
      })
    }
  })

  it('rejects unparseable input without retaining credentials or tokens', () => {
    const rawUrl = 'https://user:password@example.com:bad/path?access_token=secret#fragment'
    try {
      normalizePreviewUrl(rawUrl)
      expect.unreachable('expected URL normalization to fail')
    } catch (error) {
      expect(error).toBeInstanceOf(PreviewUrlNormalizationError)
      expect(error).toMatchObject({
        inputLength: rawUrl.length,
        reason: 'parse',
        protocol: 'https:',
      })
      expect(error).not.toHaveProperty('rawUrl')
      expect((error as PreviewUrlNormalizationError).cause).toBeInstanceOf(Error)
      expect((error as PreviewUrlNormalizationError).message).not.toContain(
        ((error as PreviewUrlNormalizationError).cause as Error).message,
      )
      expect((error as PreviewUrlNormalizationError).message).not.toMatch(
        /user|password|access_token|secret|fragment/,
      )
    }
  })
})
