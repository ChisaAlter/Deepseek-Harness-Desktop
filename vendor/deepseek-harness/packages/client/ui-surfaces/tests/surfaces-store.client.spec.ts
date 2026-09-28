/**
 * createSurfacesStore: open files then close returns to the empty session.
 */
import { beforeEach, describe, expect, it } from 'vitest'
import { createSurfacesStore, sessionSurfaces } from '../src/client/stores.ts'

const SESSION = 'session-1'

beforeEach(() => {
  if (typeof localStorage !== 'undefined') localStorage.clear()
})

describe('createSurfacesStore', () => {
  it('starts with no sessions', () => {
    const { store } = createSurfacesStore().create()
    expect(store.getSnapshot()).toEqual({ bySession: {} })
  })

  it('open files records the files singleton and close returns to empty', () => {
    const { store, actions } = createSurfacesStore().create()
    actions.open(SESSION, 'files')
    expect(sessionSurfaces(store.getSnapshot(), SESSION)).toEqual({
      activeId: 'files',
      surfaces: [{ id: 'files', kind: 'files' }],
    })
    actions.close(SESSION, 'files')
    expect(store.getSnapshot()).toEqual({ bySession: {} })
    expect(sessionSurfaces(store.getSnapshot(), SESSION)).toEqual({
      activeId: null,
      surfaces: [],
    })
  })

  it('open upserts preview, terminal, and the other singletons without duplicating', () => {
    const { store, actions } = createSurfacesStore().create()
    actions.open(SESSION, 'preview')
    actions.open(SESSION, 'preview')
    actions.open(SESSION, 'terminal')
    actions.open(SESSION, 'diff')
    actions.open(SESSION, 'agents')
    const bucket = sessionSurfaces(store.getSnapshot(), SESSION)
    expect(bucket.surfaces.map(surface => surface.kind)).toEqual([
      'preview', 'terminal', 'diff', 'agents',
    ])
    expect(bucket.surfaces.find(surface => surface.kind === 'preview')).toEqual({
      id: 'browser:new', kind: 'preview',
    })
    expect(bucket.surfaces.find(surface => surface.kind === 'terminal')).toEqual({
      id: 'terminal:new', kind: 'terminal',
    })
    expect(bucket.activeId).toBe('agents')
  })

  it('activate, closeOthers, closeToRight, and closeAll edit one session only', () => {
    const { store, actions } = createSurfacesStore().create()
    actions.open(SESSION, 'files')
    actions.open(SESSION, 'diff')
    actions.open(SESSION, 'agents')
    actions.open('session-2', 'files')
    actions.activate(SESSION, 'files')
    expect(sessionSurfaces(store.getSnapshot(), SESSION).activeId).toBe('files')

    actions.closeToRight(SESSION, 'files')
    expect(sessionSurfaces(store.getSnapshot(), SESSION).surfaces.map(surface => surface.id)).toEqual(['files'])

    actions.open(SESSION, 'diff')
    actions.open(SESSION, 'agents')
    actions.activate(SESSION, 'agents')
    actions.closeToRight(SESSION, 'files')
    expect(sessionSurfaces(store.getSnapshot(), SESSION).activeId).toBe('files')

    actions.open(SESSION, 'diff')
    actions.closeOthers(SESSION, 'diff')
    expect(sessionSurfaces(store.getSnapshot(), SESSION)).toEqual({
      activeId: 'diff',
      surfaces: [{ id: 'diff', kind: 'diff' }],
    })
    expect(sessionSurfaces(store.getSnapshot(), 'session-2').surfaces).toEqual([
      { id: 'files', kind: 'files' },
    ])

    actions.closeAll(SESSION)
    expect(store.getSnapshot().bySession[SESSION]).toBeUndefined()
    expect(sessionSurfaces(store.getSnapshot(), 'session-2').surfaces).toHaveLength(1)
  })

  it('openFile keeps the files explorer and adds a file: surface', () => {
    const { store, actions } = createSurfacesStore().create()
    actions.open(SESSION, 'files')
    actions.openFile(SESSION, 'src/index.ts')
    expect(sessionSurfaces(store.getSnapshot(), SESSION)).toEqual({
      activeId: 'file:src/index.ts',
      surfaces: [
        { id: 'files', kind: 'files' },
        { id: 'file:src/index.ts', kind: 'file', relativePath: 'src/index.ts' },
      ],
    })
    actions.openFile(SESSION, 'src/index.ts')
    expect(sessionSurfaces(store.getSnapshot(), SESSION).surfaces).toHaveLength(2)
  })

  it('openFile inserts the files explorer when it is absent', () => {
    const { store, actions } = createSurfacesStore().create()
    actions.openFile(SESSION, 'README.md')
    expect(sessionSurfaces(store.getSnapshot(), SESSION).surfaces.map(surface => surface.id)).toEqual([
      'files',
      'file:README.md',
    ])
  })

  it('openFile stores revealLine and bumps revealRequestId on an existing tab', () => {
    const { store, actions } = createSurfacesStore().create()
    actions.openFile(SESSION, 'a.ts')
    actions.openFile(SESSION, 'a.ts', { revealLine: 12 })
    expect(sessionSurfaces(store.getSnapshot(), SESSION).surfaces).toEqual([
      { id: 'files', kind: 'files' },
      {
        id: 'file:a.ts',
        kind: 'file',
        relativePath: 'a.ts',
        revealLine: 12,
        revealRequestId: 1,
      },
    ])
    actions.openFile(SESSION, 'a.ts', { revealLine: 12 })
    const file = sessionSurfaces(store.getSnapshot(), SESSION).surfaces.find(
      surface => surface.kind === 'file',
    )
    expect(file).toEqual({
      id: 'file:a.ts',
      kind: 'file',
      relativePath: 'a.ts',
      revealLine: 12,
      revealRequestId: 2,
    })
  })

  it('no-ops close family actions when the session or id is missing', () => {
    const { store, actions } = createSurfacesStore().create()
    actions.activate(SESSION, 'files')
    actions.close(SESSION, 'files')
    actions.closeOthers(SESSION, 'files')
    actions.closeToRight(SESSION, 'files')
    actions.closeAll(SESSION)
    actions.open(SESSION, 'files')
    actions.activate(SESSION, 'missing')
    actions.close(SESSION, 'missing')
    actions.closeOthers(SESSION, 'files')
    actions.closeToRight(SESSION, 'files')
    expect(sessionSurfaces(store.getSnapshot(), SESSION).surfaces).toEqual([
      { id: 'files', kind: 'files' },
    ])
    actions.open(SESSION, 'diff')
    actions.close(SESSION, 'files')
    expect(sessionSurfaces(store.getSnapshot(), SESSION).surfaces).toEqual([
      { id: 'diff', kind: 'diff' },
    ])
  })
})
