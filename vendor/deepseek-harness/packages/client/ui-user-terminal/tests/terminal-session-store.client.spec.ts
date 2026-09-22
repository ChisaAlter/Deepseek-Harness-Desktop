/**
 * Terminal session store: one handle owns one session table. Split honors
 * MAX_TERMINALS_PER_GROUP. Separate handles do not share sessions.
 */
import { describe, expect, it } from 'vitest'
import {
  acquireCreate,
  BUFFER_REALIGN_WINDOW,
  createTerminalSessionStore,
  MAX_TERMINAL_BUFFER,
  MAX_TERMINALS_PER_GROUP,
  realignBufferStart,
  releaseCreate,
  sessionBuffer,
} from '../src/client/stores.ts'

function sameHandleShells() {
  const instance = createTerminalSessionStore().create('session-1')
  return { drawer: instance, surface: instance }
}

describe('createTerminalSessionStore', () => {
  it('starts with no sessions and an empty active id', () => {
    const { store } = createTerminalSessionStore().create('session-1')
    expect(store.getSnapshot()).toEqual({
      sessions: [],
      activeId: '',
      groups: [],
      createFailed: false,
    })
  })

  it('keeps two handles on independent session tables', () => {
    const drawer = createTerminalSessionStore().create('session-1')
    const surface = createTerminalSessionStore().create('session-1')
    drawer.actions.newTerminal('term-a', '/work')
    drawer.actions.setSize('term-a', 120, 40)
    surface.actions.activate('term-a')

    expect(drawer.store.getSnapshot().activeId).toBe('term-a')
    expect(drawer.store.getSnapshot().sessions[0]).toEqual({
      id: 'term-a',
      cwd: '/work',
      cols: 120,
      rows: 40,
      buffer: '',
    })
    expect(surface.store.getSnapshot().sessions).toHaveLength(0)
    expect(surface.store.getSnapshot().activeId).toBe('')
  })

  it('refuses split once the active group reaches MAX_TERMINALS_PER_GROUP', () => {
    const { store, actions } = createTerminalSessionStore().create('session-1')
    actions.newTerminal('t1', '/work')
    for (let index = 2; index <= MAX_TERMINALS_PER_GROUP; index += 1) {
      actions.split(`t${index}`, '/work', 'horizontal')
    }
    expect(store.getSnapshot().sessions).toHaveLength(MAX_TERMINALS_PER_GROUP)
    expect(store.getSnapshot().groups[0]?.terminalIds).toHaveLength(MAX_TERMINALS_PER_GROUP)

    actions.split('overflow', '/work', 'horizontal')
    expect(store.getSnapshot().sessions).toHaveLength(MAX_TERMINALS_PER_GROUP)
    expect(store.getSnapshot().sessions.some(session => session.id === 'overflow')).toBe(false)
    expect(store.getSnapshot().activeId).toBe(`t${MAX_TERMINALS_PER_GROUP}`)
  })

  it('newTerminal opens a separate group so split can continue', () => {
    const { store, actions } = createTerminalSessionStore().create('session-1')
    actions.newTerminal('t1', '/work')
    actions.split('t2', '/work', 'horizontal')
    actions.newTerminal('n3', '/work')
    expect(store.getSnapshot().groups).toHaveLength(2)
    expect(store.getSnapshot().activeId).toBe('n3')
    expect(store.getSnapshot().groups[1]?.splitDirection).toBeUndefined()
    actions.split('t4', '/work', 'horizontal')
    expect(store.getSnapshot().groups[1]?.terminalIds).toEqual(['n3', 't4'])
  })

  it('stores vertical splitDirection and omits it for a horizontal split', () => {
    const { store, actions } = createTerminalSessionStore().create('session-1')
    actions.newTerminal('t1', '/work')
    expect(store.getSnapshot().groups[0]?.splitDirection).toBeUndefined()
    actions.split('t2', '/work', 'vertical')
    expect(store.getSnapshot().groups[0]?.splitDirection).toBe('vertical')
    expect(store.getSnapshot().groups[0]?.terminalIds).toEqual(['t1', 't2'])
    actions.close('t2')
    actions.split('n3', '/work', 'horizontal')
    expect(store.getSnapshot().groups[0]?.splitDirection).toBeUndefined()
    expect(store.getSnapshot().groups[0]?.terminalIds).toEqual(['t1', 'n3'])
  })

  it('split with no sessions opens the first group and ignores direction', () => {
    const { store, actions } = createTerminalSessionStore().create('session-1')
    actions.split('t1', '/work', 'vertical')
    expect(store.getSnapshot().sessions).toHaveLength(1)
    expect(store.getSnapshot().groups[0]?.terminalIds).toEqual(['t1'])
    expect(store.getSnapshot().groups[0]?.splitDirection).toBeUndefined()
  })

  it('close removes the session and activates a neighbor', () => {
    const { store, actions } = createTerminalSessionStore().create('session-1')
    actions.newTerminal('t1', '/work')
    actions.split('t2', '/work', 'horizontal')
    actions.close('t2')
    expect(store.getSnapshot().sessions.map(session => session.id)).toEqual(['t1'])
    expect(store.getSnapshot().activeId).toBe('t1')
    actions.close('t1')
    expect(store.getSnapshot()).toEqual({ sessions: [], activeId: '', groups: [], createFailed: false })
  })

  it('shares one in-flight create lock across two shells on the same actions object', () => {
    const { drawer, surface } = sameHandleShells()
    expect(acquireCreate(drawer.actions)).toBe(true)
    expect(acquireCreate(surface.actions)).toBe(false)
    releaseCreate(drawer.actions)
    expect(acquireCreate(surface.actions)).toBe(true)
    releaseCreate(surface.actions)
  })

  it('does not share the create lock across different handles', () => {
    const drawer = createTerminalSessionStore().create('session-1')
    const surface = createTerminalSessionStore().create('session-1')
    expect(acquireCreate(drawer.actions)).toBe(true)
    expect(acquireCreate(surface.actions)).toBe(true)
    releaseCreate(drawer.actions)
    releaseCreate(surface.actions)
  })

  it('caps the retained buffer at MAX_TERMINAL_BUFFER and drops from the head', () => {
    const { store, actions } = createTerminalSessionStore().create('session-1')
    actions.newTerminal('t1', '/work')
    actions.appendData('t1', 'under')
    expect(store.getSnapshot().sessions[0]?.buffer).toBe('under')
    actions.appendData('t1', 'x'.repeat(MAX_TERMINAL_BUFFER - 5))
    expect(store.getSnapshot().sessions[0]?.buffer).toHaveLength(MAX_TERMINAL_BUFFER)
    actions.appendData('t1', 'YZ')
    const buffer = store.getSnapshot().sessions[0]?.buffer ?? ''
    expect(buffer).toHaveLength(MAX_TERMINAL_BUFFER)
    expect(buffer.endsWith('YZ')).toBe(true)
    expect(buffer.startsWith('under')).toBe(false)
  })

  it('realigns the overflow cut to the next line start near the cap cut', () => {
    const { store, actions } = createTerminalSessionStore().create('session-1')
    actions.newTerminal('t1', '/work')
    actions.appendData('t1', 'ab\nrest')
    actions.appendData('t1', 'y'.repeat(MAX_TERMINAL_BUFFER - 5))
    const buffer = store.getSnapshot().sessions[0]?.buffer ?? ''
    expect(buffer.startsWith('rest')).toBe(true)
    expect(buffer.includes('\n')).toBe(false)
  })

  it('realigns the overflow cut to the next escape when no newline is near', () => {
    const { store, actions } = createTerminalSessionStore().create('session-1')
    actions.newTerminal('t1', '/work')
    actions.appendData('t1', 'ab\u001b[0m')
    actions.appendData('t1', 'y'.repeat(MAX_TERMINAL_BUFFER - 4))
    const buffer = store.getSnapshot().sessions[0]?.buffer ?? ''
    expect(buffer.startsWith('\u001b[0m')).toBe(true)
  })

  it('dispatches PTY data and exit once to the shared instance', () => {
    const handle = createTerminalSessionStore()
    const instance = handle.create('session-1')
    instance.actions.newTerminal('pty-1', '/work')
    handle.dispatchData('pty-1', 'hello')
    handle.dispatchData('pty-1', '!')
    expect(instance.getSnapshot().sessions[0]?.buffer).toBe('hello!')
    handle.dispatchExit('pty-1')
    expect(instance.getSnapshot().sessions).toHaveLength(0)
  })
})

describe('realignBufferStart', () => {
  it('prefers the earliest clean boundary within the window', () => {
    expect(realignBufferStart('ab\ncd\u001bef', 1)).toBe(3)
    expect(realignBufferStart('ab\u001bcd\nef', 1)).toBe(2)
  })

  it('falls back to the raw cut when no boundary is within the window', () => {
    const far = 'x'.repeat(BUFFER_REALIGN_WINDOW + 10)
    expect(realignBufferStart(`${far}\n`, 0)).toBe(0)
    expect(realignBufferStart(`${far}\u001b`, 0)).toBe(0)
    expect(realignBufferStart('plain text only', 3)).toBe(3)
  })
})

describe('sessionBuffer', () => {
  it('returns the record buffer and empty string when the row is missing', () => {
    expect(sessionBuffer(undefined)).toBe('')
    expect(sessionBuffer({ id: 'pty-1', cwd: '/work', cols: 80, rows: 24, buffer: 'hello' })).toBe('hello')
  })
})
