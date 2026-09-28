// @vitest-environment jsdom
/**
 * Surfaces persist: round-trip and drop unknown kinds.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  cancelPersist, collectDirtyDrafts, loadPersistedDrafts, loadPersistedState, persistSession, readBucket, readDrafts, SURFACES_PERSIST_PREFIX, writeSession,
} from '../src/client/persist.ts'
import { createSurfacesStore, sessionSurfaces } from '../src/client/stores.ts'
import type { SessionSurfaces } from '../src/client/stores.ts'

afterEach(() => {
  localStorage.clear()
  vi.useRealTimers()
})

describe('surfaces persist', () => {
  it('round-trips a files tab plus a file surface', () => {
    writeSession('sess-1', {
      activeId: 'file:a.ts',
      surfaces: [
        { id: 'files', kind: 'files' },
        { id: 'file:a.ts', kind: 'file', relativePath: 'a.ts' },
      ],
    })
    const loaded = loadPersistedState()
    expect(sessionSurfaces(loaded, 'sess-1')).toEqual({
      activeId: 'file:a.ts',
      surfaces: [
        { id: 'files', kind: 'files' },
        { id: 'file:a.ts', kind: 'file', relativePath: 'a.ts' },
      ],
    })
  })

  it('drops unknown kinds and keeps the rest', () => {
    const bucket = readBucket(JSON.stringify({
      activeId: 'mystery',
      surfaces: [
        { id: 'files', kind: 'files' },
        { id: 'x', kind: 'portal' },
        { id: 'file:nopath', kind: 'file' },
        { id: 'diff', kind: 'diff' },
      ],
    }))
    expect(bucket).toEqual({
      activeId: 'files',
      surfaces: [
        { id: 'files', kind: 'files' },
        { id: 'diff', kind: 'diff' },
      ],
    })
  })

  it('createSurfacesStore init hydrates from localStorage', () => {
    localStorage.setItem(`${SURFACES_PERSIST_PREFIX}sess-1`, JSON.stringify({
      activeId: 'files',
      surfaces: [{ id: 'files', kind: 'files' }],
    }))
    const { store } = createSurfacesStore().create()
    expect(sessionSurfaces(store.getSnapshot(), 'sess-1').surfaces).toEqual([
      { id: 'files', kind: 'files' },
    ])
  })

  it('writeSession removes the key when the bucket is empty', () => {
    writeSession('sess-1', {
      activeId: 'files',
      surfaces: [{ id: 'files', kind: 'files' }],
    })
    writeSession('sess-1', { activeId: null, surfaces: [] })
    expect(localStorage.getItem(`${SURFACES_PERSIST_PREFIX}sess-1`)).toBeNull()
  })

  it('debounces persistSession and cancelPersist drops the pending write', () => {
    vi.useFakeTimers()
    persistSession('sess-1', {
      activeId: 'files',
      surfaces: [{ id: 'files', kind: 'files' }],
    })
    expect(localStorage.getItem(`${SURFACES_PERSIST_PREFIX}sess-1`)).toBeNull()
    vi.advanceTimersByTime(80)
    expect(localStorage.getItem(`${SURFACES_PERSIST_PREFIX}sess-1`)).toContain('files')
    persistSession('sess-1', {
      activeId: 'diff',
      surfaces: [{ id: 'diff', kind: 'diff' }],
    })
    persistSession('sess-1', {
      activeId: 'agents',
      surfaces: [{ id: 'agents', kind: 'agents' }],
    })
    cancelPersist('sess-1')
    vi.advanceTimersByTime(80)
    expect(localStorage.getItem(`${SURFACES_PERSIST_PREFIX}sess-1`)).toContain('files')
    persistSession('', { activeId: null, surfaces: [] })
    cancelPersist('missing')
  })

  it('sanitizes preview, terminal, and malformed payloads', () => {
    expect(readBucket(null)).toBeUndefined()
    expect(readBucket('')).toBeUndefined()
    expect(readBucket('{')).toBeUndefined()
    expect(readBucket('1')).toBeUndefined()
    expect(readBucket(JSON.stringify({ surfaces: 'nope' }))).toBeUndefined()
    expect(readBucket(JSON.stringify({ surfaces: [{ kind: 'portal' }] }))).toBeUndefined()
    localStorage.setItem('other', '1')
    localStorage.setItem(SURFACES_PERSIST_PREFIX, '{}')
    const bucket = readBucket(JSON.stringify({
      activeId: 'browser:new',
      surfaces: [
        { id: 'wrong', kind: 'files' },
        { id: 'wrong', kind: 'diff' },
        { id: 'wrong', kind: 'agents' },
        { id: 'agents', kind: 'agents' },
        { id: 'browser:new', kind: 'preview', resourceId: 'r1' },
        { id: 'terminal:new', kind: 'terminal', terminalIds: ['a', 1], activeTerminalId: 'a' },
        { id: 'file:nopath', kind: 'file', relativePath: '' },
        null,
      ],
    }))
    expect(bucket?.surfaces).toEqual([
      { id: 'agents', kind: 'agents' },
      { id: 'browser:new', kind: 'preview' },
      { id: 'terminal:new', kind: 'terminal' },
    ])
    expect(readBucket(JSON.stringify({
      activeId: 'p',
      surfaces: [{ id: 'p', kind: 'preview' }, { id: 't', kind: 'terminal' }],
    }))?.surfaces).toEqual([
      { id: 'p', kind: 'preview' },
      { id: 't', kind: 'terminal' },
    ])
    expect(loadPersistedState().bySession).toEqual({})
    localStorage.setItem(`${SURFACES_PERSIST_PREFIX}bad`, '{')
    expect(loadPersistedState().bySession).toEqual({})
  })

  it('uses localStorage when the storage argument is omitted or undefined', () => {
    writeSession('sess-1', {
      activeId: 'files',
      surfaces: [{ id: 'files', kind: 'files' }],
    }, undefined)
    expect(localStorage.getItem(`${SURFACES_PERSIST_PREFIX}sess-1`)).toContain('files')
    persistSession('sess-2', {
      activeId: 'diff',
      surfaces: [{ id: 'diff', kind: 'diff' }],
    }, undefined)
    cancelPersist('sess-2')
  })

  it('round-trips dirty drafts and drops clean, closed, malformed, and oversized ones', () => {
    const fileBucket: SessionSurfaces = {
      activeId: 'file:a.ts',
      surfaces: [
        { id: 'files', kind: 'files' },
        { id: 'file:a.ts', kind: 'file', relativePath: 'a.ts' },
      ],
    }
    writeSession('sess-1', fileBucket, undefined, {
      'file:a.ts': { text: 'disk', draft: 'edited' },
      'file:gone.ts': { text: 'x', draft: 'y' },
      'file:clean.ts': { text: 'same', draft: 'same' },
    })
    expect(loadPersistedDrafts().get('sess-1:file:a.ts')).toEqual({ text: 'disk', draft: 'edited' })
    expect(loadPersistedDrafts().has('sess-1:file:gone.ts')).toBe(false)
    expect(JSON.parse(localStorage.getItem(`${SURFACES_PERSIST_PREFIX}sess-1`) ?? '{}').drafts).toEqual({
      'file:a.ts': { text: 'disk', draft: 'edited' },
    })

    expect(readDrafts(null)).toEqual({})
    expect(readDrafts('')).toEqual({})
    expect(readDrafts('{')).toEqual({})
    expect(readDrafts('1')).toEqual({})
    expect(readDrafts(JSON.stringify({ drafts: null }))).toEqual({})
    expect(readDrafts(JSON.stringify({ drafts: [] }))).toEqual({})
    expect(readDrafts(JSON.stringify({ drafts: { x: 1 } }))).toEqual({})
    expect(readDrafts(JSON.stringify({ drafts: { x: { text: 'a', draft: 'a' } } }))).toEqual({})
    // The cap counts utf8 bytes (1 MiB, matching workspace-fs MAX_WRITE_BYTES):
    // a large ASCII draft under the cap survives, one byte over is dropped, and
    // multi-byte characters trip the cap at fewer code units.
    const bigAscii = 'x'.repeat(1024 * 1024)
    expect(readDrafts(JSON.stringify({ drafts: { x: { text: 'y', draft: bigAscii } } })))
      .toEqual({ x: { text: 'y', draft: bigAscii } })
    const huge = 'x'.repeat(1024 * 1024 + 1)
    expect(readDrafts(JSON.stringify({ drafts: { x: { text: huge, draft: 'y' } } }))).toEqual({})
    expect(readDrafts(JSON.stringify({ drafts: { x: { text: 'y', draft: huge } } }))).toEqual({})
    const multiByte = '€'.repeat(350 * 1024)
    expect(readDrafts(JSON.stringify({ drafts: { x: { text: 'y', draft: multiByte } } }))).toEqual({})

    const buffers = new Map([
      ['sess-1:file:a.ts', { text: 'disk', draft: 'edited' }],
      ['sess-1:file:a.ts-clean', { text: 'a', draft: 'a' }],
      ['sess-2:file:a.ts', { text: 'other', draft: 'session' }],
      ['sess-1:file:closed.ts', { text: 'a', draft: 'b' }],
    ])
    expect(collectDirtyDrafts('sess-1', buffers, fileBucket.surfaces)).toEqual({
      'file:a.ts': { text: 'disk', draft: 'edited' },
    })

    localStorage.setItem('other', '1')
    localStorage.setItem(SURFACES_PERSIST_PREFIX, JSON.stringify({
      drafts: { 'file:x': { text: 'a', draft: 'b' } },
    }))
    expect(loadPersistedDrafts().has(':file:x')).toBe(false)

    const storage = {
      length: 2,
      key: (index: number) => (index === 0 ? null : `${SURFACES_PERSIST_PREFIX}sess-2`),
      getItem: () => JSON.stringify({
        activeId: 'file:b.ts',
        surfaces: [{ id: 'file:b.ts', kind: 'file', relativePath: 'b.ts' }],
        drafts: { 'file:b.ts': { text: 'old', draft: 'new' } },
      }),
      setItem: () => {},
      removeItem: () => {},
      clear: () => {},
    } as Storage
    expect(loadPersistedDrafts(storage).get('sess-2:file:b.ts')).toEqual({ text: 'old', draft: 'new' })
  })

  it('persistSession writes drafts after the debounce', () => {
    vi.useFakeTimers()
    persistSession('sess-1', {
      activeId: 'file:a.ts',
      surfaces: [{ id: 'file:a.ts', kind: 'file', relativePath: 'a.ts' }],
    }, undefined, { 'file:a.ts': { text: 'disk', draft: 'typed' } })
    expect(loadPersistedDrafts().size).toBe(0)
    vi.advanceTimersByTime(80)
    expect(loadPersistedDrafts().get('sess-1:file:a.ts')).toEqual({ text: 'disk', draft: 'typed' })
  })
})
