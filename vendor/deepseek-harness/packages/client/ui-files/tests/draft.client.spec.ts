/**
 * appendToDraft writes through ctx.get('conversation') without importing the plugin.
 */
import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it, vi } from 'vitest'
import { appendToDraft } from '../src/client/draft.ts'

describe('appendToDraft', () => {
  it('returns false when conversation is missing', () => {
    const ctx = new Context()
    ctx.provide('sessions', { scope: () => ({}) })
    expect(appendToDraft(ctx as never, 'sess', '`@a.ts`')).toBe(false)
  })

  it('returns false when session scope is missing', () => {
    const ctx = new Context()
    ctx.provide('sessions', { scope: () => undefined })
    ctx.provide('conversation', {
      input: { for: () => ({ setDraft: vi.fn(), state: { getSnapshot: () => ({ draft: '' }) } }) },
    })
    expect(appendToDraft(ctx as never, 'sess', '`@a.ts`')).toBe(false)
  })

  it('appends with a space when a draft already exists', () => {
    const ctx = new Context()
    const setDraft = vi.fn()
    ctx.provide('sessions', { scope: () => ({}) })
    ctx.provide('conversation', {
      input: {
        for: () => ({
          setDraft,
          state: { getSnapshot: () => ({ draft: 'hello' }) },
        }),
      },
    })
    expect(appendToDraft(ctx as never, 'sess', '`@a.ts`')).toBe(true)
    expect(setDraft).toHaveBeenCalledWith('hello `@a.ts`')
  })

  it('writes the fragment alone when the draft is empty', () => {
    const ctx = new Context()
    const setDraft = vi.fn()
    ctx.provide('sessions', { scope: () => ({}) })
    ctx.provide('conversation', {
      input: {
        for: () => ({
          setDraft,
          state: { getSnapshot: () => ({ draft: '' }) },
        }),
      },
    })
    expect(appendToDraft(ctx as never, 'sess', '`@a.ts`')).toBe(true)
    expect(setDraft).toHaveBeenCalledWith('`@a.ts`')
  })

  it('writes through ctx.get("sessions") when ctx.sessions throws without inject', () => {
    const setDraft = vi.fn()
    const sessions = { scope: () => ({}) }
    const conversation = {
      input: {
        for: () => ({
          setDraft,
          state: { getSnapshot: () => ({ draft: '' }) },
        }),
      },
    }
    let sessionsPropReads = 0
    const ctx = {
      get(name: string) {
        if (name === 'conversation') return conversation
        if (name === 'sessions') return sessions
        return undefined
      },
      get sessions(): never {
        sessionsPropReads += 1
        throw new Error('cannot get property "sessions" without inject')
      },
    }
    expect(appendToDraft(ctx as never, 'sess', '[note.md](note.md)')).toBe(true)
    expect(setDraft).toHaveBeenCalledWith('[note.md](note.md)')
    expect(sessionsPropReads).toBe(0)
  })

  it('appends a markdown mention through get("sessions") when a draft already exists', () => {
    const setDraft = vi.fn()
    const sessions = { scope: () => ({}) }
    const conversation = {
      input: {
        for: () => ({
          setDraft,
          state: { getSnapshot: () => ({ draft: 'see' }) },
        }),
      },
    }
    const ctx = {
      get(name: string) {
        if (name === 'conversation') return conversation
        if (name === 'sessions') return sessions
        return undefined
      },
      get sessions(): never {
        throw new Error('cannot get property "sessions" without inject')
      },
    }
    expect(appendToDraft(ctx as never, 'sess', '[note.md](note.md)')).toBe(true)
    expect(setDraft).toHaveBeenCalledWith('see [note.md](note.md)')
  })

  it('returns false when ctx.get("sessions") is missing even if ctx.sessions would throw', () => {
    const conversation = {
      input: {
        for: () => ({
          setDraft: vi.fn(),
          state: { getSnapshot: () => ({ draft: '' }) },
        }),
      },
    }
    const ctx = {
      get(name: string) {
        if (name === 'conversation') return conversation
        return undefined
      },
      get sessions(): never {
        throw new Error('cannot get property "sessions" without inject')
      },
    }
    expect(appendToDraft(ctx as never, 'sess', '`@a.ts`')).toBe(false)
  })
})
