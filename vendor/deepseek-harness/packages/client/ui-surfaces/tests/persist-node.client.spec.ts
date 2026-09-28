/**
 * persist helpers no-op when localStorage is absent (Node coverage).
 */
import { describe, expect, it } from 'vitest'
import { loadPersistedDrafts, loadPersistedState, persistSession, writeSession } from '../src/client/persist.ts'

describe('surfaces persist without localStorage', () => {
  it('returns an empty state and ignores writes', () => {
    expect(loadPersistedState().bySession).toEqual({})
    expect(loadPersistedDrafts().size).toBe(0)
    persistSession('sess-1', {
      activeId: 'files',
      surfaces: [{ id: 'files', kind: 'files' }],
    })
    writeSession('sess-1', {
      activeId: 'files',
      surfaces: [{ id: 'files', kind: 'files' }],
    })
  })
})
