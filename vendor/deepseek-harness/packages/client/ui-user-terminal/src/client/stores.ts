/**
 * PTY session table for one terminal shell. Production seats one handle on
 * the drawer and a second handle on the right-panel Terminal surface so
 * each shell keeps its own sessions, groups, and active id.
 */
import { defineStore } from '@deepseek-ai/dsh-client-store'
import type { EngineStoreHandle, EngineStoreInstance } from '@deepseek-ai/dsh-client-store'
/** Per-group split ceiling. */
export const MAX_TERMINALS_PER_GROUP = 4
/** Default PTY columns before the viewport reports a fit. `DEFAULT_OPEN_COLS`. */
export const DEFAULT_TERMINAL_COLS = 120
/** Default PTY rows before the viewport reports a fit. `DEFAULT_OPEN_ROWS`. */
export const DEFAULT_TERMINAL_ROWS = 30
/** Retained scrollback cap; appendData drops from the head past this length. */
export const MAX_TERMINAL_BUFFER = 256 * 1024

/**
 * How far past the cap cut appendData scans for a clean boundary. A cut at an
 * arbitrary byte can split an escape sequence and corrupt the replay parse;
 * realigning to the next line start or ESC keeps the replay well-formed.
 */
export const BUFFER_REALIGN_WINDOW = 4096

/**
 * First index at or after `start` that begins a parseable replay: just after
 * the next newline, or at the next ESC, whichever comes first within the
 * realign window. Falls back to `start` when neither is near.
 * @param text - the concatenated PTY output.
 * @param start - the raw cap cut position.
 * @returns the realigned slice start.
 */
export function realignBufferStart(text: string, start: number): number {
  const newline = text.indexOf('\n', start)
  const escape = text.indexOf('\u001b', start)
  let aligned = Number.POSITIVE_INFINITY
  if (newline !== -1 && newline + 1 - start <= BUFFER_REALIGN_WINDOW) aligned = newline + 1
  if (escape !== -1 && escape - start <= BUFFER_REALIGN_WINDOW) aligned = Math.min(aligned, escape)
  return Number.isFinite(aligned) ? aligned : start
}

/** One live PTY session owned by a single terminal shell. */
export type TerminalSessionRecord = {
  id: string
  cwd: string
  cols: number
  rows: number
  buffer: string
}

/** How panes in a split group are tiled. Omitted means horizontal. */
export type TerminalSplitDirection = 'horizontal' | 'vertical'

/** Split group: terminals tiled together, capped at MAX_TERMINALS_PER_GROUP. */
export type TerminalGroup = {
  id: string
  terminalIds: string[]
  splitDirection?: TerminalSplitDirection
}

/** Shared terminal UI state. */
export type TerminalSessionState = {
  sessions: TerminalSessionRecord[]
  activeId: string
  groups: TerminalGroup[]
  createFailed: boolean
}

type TerminalSessionActions = {
  activate: (draft: TerminalSessionState, id: string) => void
  newTerminal: (draft: TerminalSessionState, id: string, cwd: string) => void
  split: (draft: TerminalSessionState, id: string, cwd: string, direction: TerminalSplitDirection) => void
  close: (draft: TerminalSessionState, id: string) => void
  setSize: (draft: TerminalSessionState, id: string, cols: number, rows: number) => void
  appendData: (draft: TerminalSessionState, id: string, data: string) => void
  failCreate: (draft: TerminalSessionState) => void
}

/** Handle that fans PTY events to every live instance created from it. */
export type TerminalSessionStoreHandle = EngineStoreHandle<TerminalSessionState, TerminalSessionActions> & {
  dispatchData: (id: string, data: string) => void
  dispatchExit: (id: string) => void
}

const createInFlight = new WeakMap<object, boolean>()
const instanceByActions = new WeakMap<object, EngineStoreInstance<TerminalSessionState, TerminalSessionActions>>()

/**
 * Live snapshot for the store instance that owns `actions`.
 * @param actions - the store instance actions.
 * @returns the current snapshot, or undefined when the instance is unknown.
 */
export function snapshotOf(actions: object): TerminalSessionState | undefined {
  return instanceByActions.get(actions)?.getSnapshot()
}

/**
 * Take the create lock for this actions object. Separate handles do not share it.
 * @param actions - the store instance actions (identity is the lock key).
 * @returns whether this caller acquired the lock.
 */
export function acquireCreate(actions: object): boolean {
  if (createInFlight.get(actions)) return false
  createInFlight.set(actions, true)
  return true
}

/**
 * Release the shared create lock.
 * @param actions - the store instance actions passed to acquireCreate.
 */
export function releaseCreate(actions: object): void {
  createInFlight.delete(actions)
}

function emptyState(): TerminalSessionState {
  return { sessions: [], activeId: '', groups: [], createFailed: false }
}

function recordOf(id: string, cwd: string): TerminalSessionRecord {
  return { id, cwd, cols: DEFAULT_TERMINAL_COLS, rows: DEFAULT_TERMINAL_ROWS, buffer: '' }
}

function groupIdFor(terminalId: string): string {
  return `group-${terminalId}`
}

function findGroupIndex(state: TerminalSessionState, terminalId: string): number {
  return state.groups.findIndex(group => group.terminalIds.includes(terminalId))
}

function activeGroupIndex(state: TerminalSessionState): number {
  const byActive = findGroupIndex(state, state.activeId)
  if (byActive >= 0) return byActive
  return state.groups.length === 0 ? -1 : 0
}

function hasSession(state: TerminalSessionState, id: string): boolean {
  return state.sessions.some(session => session.id === id)
}

/**
 * Replay bytes for a pane. Empty when the store row has already closed.
 * @param session - the live record, or undefined while visible ids lag a close.
 * @returns the retained PTY buffer, or an empty string.
 */
export function sessionBuffer(session: TerminalSessionRecord | undefined): string {
  return session === undefined ? '' : session.buffer
}

/**
 * Create a terminal-session store handle. Production seats one handle per
 * shell; tests call create().
 * @returns the store handle.
 */
export function createTerminalSessionStore(): TerminalSessionStoreHandle {
  const live = new Set<EngineStoreInstance<TerminalSessionState, TerminalSessionActions>>()
  const inner = defineStore({
    init: emptyState,
    actions: {
      activate: (draft, id: string) => {
        if (!hasSession(draft, id)) return
        draft.activeId = id
      },
      newTerminal: (draft, id: string, cwd: string) => {
        draft.createFailed = false
        if (id.trim() === '' || hasSession(draft, id)) {
          if (hasSession(draft, id)) draft.activeId = id
          return
        }
        draft.sessions.push(recordOf(id, cwd))
        draft.groups.push({ id: groupIdFor(id), terminalIds: [id] })
        draft.activeId = id
      },
      split: (draft, id: string, cwd: string, direction: TerminalSplitDirection) => {
        draft.createFailed = false
        if (id.trim() === '' || hasSession(draft, id)) return
        if (draft.sessions.length === 0) {
          draft.sessions.push(recordOf(id, cwd))
          draft.groups.push({ id: groupIdFor(id), terminalIds: [id] })
          draft.activeId = id
          return
        }
        const groupIndex = activeGroupIndex(draft)
        const group = groupIndex >= 0 ? draft.groups[groupIndex] : undefined
        if (group === undefined || group.terminalIds.length >= MAX_TERMINALS_PER_GROUP) return
        draft.sessions.push(recordOf(id, cwd))
        group.terminalIds.push(id)
        if (direction === 'vertical') group.splitDirection = 'vertical'
        else delete group.splitDirection
        draft.activeId = id
      },
      close: (draft, id: string) => {
        const index = draft.sessions.findIndex(session => session.id === id)
        if (index < 0) return
        draft.sessions.splice(index, 1)
        for (let groupIndex = draft.groups.length - 1; groupIndex >= 0; groupIndex -= 1) {
          const group = draft.groups[groupIndex]
          if (group === undefined) continue
          group.terminalIds = group.terminalIds.filter(terminalId => terminalId !== id)
          if (group.terminalIds.length === 0) draft.groups.splice(groupIndex, 1)
        }
        if (draft.sessions.length === 0) {
          draft.activeId = ''
          return
        }
        if (draft.activeId === id) {
          const neighbor = draft.sessions[Math.min(index, draft.sessions.length - 1)]
          draft.activeId = neighbor?.id ?? ''
        }
      },
      setSize: (draft, id: string, cols: number, rows: number) => {
        const session = draft.sessions.find(item => item.id === id)
        if (session === undefined) return
        session.cols = cols
        session.rows = rows
      },
      appendData: (draft, id: string, data: string) => {
        const session = draft.sessions.find(item => item.id === id)
        if (session === undefined) return
        const next = session.buffer + data
        session.buffer = next.length <= MAX_TERMINAL_BUFFER
          ? next
          : next.slice(realignBufferStart(next, next.length - MAX_TERMINAL_BUFFER))
      },
      failCreate: (draft) => {
        draft.createFailed = true
      },
    },
  })
  return {
    spec: inner.spec,
    create(scopeKey?: string) {
      const inst = inner.create(scopeKey)
      live.add(inst)
      instanceByActions.set(inst.actions, inst)
      return inst
    },
    dispatchData(id: string, data: string) {
      for (const inst of live) inst.actions.appendData(id, data)
    },
    dispatchExit(id: string) {
      for (const inst of live) inst.actions.close(id)
    },
  }
}
