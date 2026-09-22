import { Context } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type {
  ISessions, SessionListState, SessionReference, SessionSummary,
} from '@deepseek-ai/dsh-api-session-controller/client'
import type { SubagentAddress } from '@deepseek-ai/dsh-subagent/client'
import type {
  IWorkspaces, WorkspaceId, WorkspaceSnapshot, WorkspaceView,
} from '@deepseek-ai/dsh-api-workspace-controller/client'
import type { ClientRemote, DirectoryListing } from '@deepseek-ai/dsh-api-remotes/client'
import { RemoteError } from '@deepseek-ai/dsh-client-test-runtime'
import type { RemoteResult } from '@deepseek-ai/dsh-api-remotes/client'
import { SessionId } from '@deepseek-ai/dsh-session/types'
import { LayoutController } from '@deepseek-ai/dsh-client-ui-layout/client'
import type { MainPanelId } from '@deepseek-ai/dsh-client-ui-layout/client'
import { DirectoryBrowseError, UiWorkspaceService } from '../src/client/navigation.ts'

const sid = (id: string): SessionId => SessionId(id)
const wid = (id: string): WorkspaceId => id as WorkspaceId

const contexts: Context[] = []

afterEach(async () => {
  for (const ctx of contexts.splice(0)) await ctx.fiber.dispose()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

function persistSelection(selection: {
  readonly sessionId?: SessionId
  readonly subagentAddress?: SubagentAddress
}): Map<string, string> {
  const backing = new Map([['dsh.sessions.current', JSON.stringify(selection)]])
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => backing.get(key) ?? null,
    setItem: (key: string, value: string) => { backing.set(key, value) },
    removeItem: (key: string) => { backing.delete(key) },
  })
  return backing
}

function workspace(
  id: string,
  sessionIds: readonly SessionId[] = [],
  createdAt = '2026-01-01T00:00:00.000Z',
): WorkspaceView {
  return {
    workspaceId: wid(id),
    path: `/w/${id}`,
    title: id,
    sessionIds,
    createdAt,
    updatedAt: createdAt,
  }
}

function summary(id: string, overrides: Partial<SessionSummary> = {}): SessionSummary {
  return {
    id: sid(id),
    displayTitle: id,
    running: false,
    blank: false,
    updatedAt: 0,
    ...overrides,
    retainedBy: overrides.retainedBy ?? {},
  }
}

function sessionState(
  summaries: readonly SessionSummary[] = [],
  phase: SessionListState['phase'] = 'ready',
): SessionListState {
  return {
    ids: summaries.map(item => item.id),
    byId: Object.fromEntries(summaries.map(item => [item.id, item])),
    phase,
    subagentsByParent: {},
    jobsBySession: {},
  }
}

const SCRATCH = '/dsh-home/no-workspace'

function workspaceState(
  items: WorkspaceSnapshot['items'] = [],
  archivedSessionIds: readonly SessionId[] = [],
  phase: WorkspaceSnapshot['phase'] = 'ready',
): WorkspaceSnapshot {
  return {
    items,
    archivedSessionIds,
    ...(phase === 'ready' ? { scratchCwd: SCRATCH } : {}),
    phase,
    state: phase === 'ready' ? 'idle' : 'loading',
    error: null,
  }
}

class MutableSource<T> {
  private readonly listeners = new Set<() => void>()

  constructor(private value: T) {}

  getSnapshot(): T {
    return this.value
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  set(value: T): void {
    this.value = value
    for (const listener of [...this.listeners]) listener()
  }

  update(update: (value: T) => T): void {
    this.set(update(this.value))
  }

  listenersSnapshot(): readonly (() => void)[] {
    return [...this.listeners]
  }
}

interface RetainedSession {
  readonly reference: SessionReference
  readonly release: ReturnType<typeof vi.fn<() => void>>
}

class FakeSessions implements ISessions {
  readonly canReuseBlank = vi.fn<(id: SessionId, signal?: AbortSignal) => Promise<boolean>>(async () => true)
  readonly list: MutableSource<SessionListState>
  readonly create: ReturnType<typeof vi.fn<ISessions['create']>>
  readonly deleteCalls: SessionId[] = []
  onDelete: ISessions['delete'] = async sessionId => ({
    deletedSessionIds: [sessionId],
    archivedSessionIds: [],
  })
  readonly fork = vi.fn<ISessions['fork']>(async () => sid('forked'))
  readonly retained: RetainedSession[] = []
  readonly refreshSubagents = vi.fn<ISessions['refreshSubagents']>(() => Promise.resolve())
  readonly retain = vi.fn<ISessions['retain']>((target) => {
    const release = vi.fn<() => void>()
    const sessionId = typeof target === 'string' ? target : target.childSessionId
    const binding = { sessionId } as SessionReference['binding']
    const reference: SessionReference = {
      sessionId,
      binding,
      ready: Promise.resolve(binding),
      release,
      [Symbol.dispose]: release,
    }
    this.retained.push({ reference, release })
    return reference
  })
  readonly subagentAddress = vi.fn<ISessions['subagentAddress']>()
  declare readonly using: ISessions['using']
  declare readonly retainInfo: ISessions['retainInfo']
  declare readonly searchResultLimit: ISessions['searchResultLimit']
  declare readonly setSubagentCatalogOpen: ISessions['setSubagentCatalogOpen']
  declare readonly refresh: ISessions['refresh']
  declare readonly search: ISessions['search']
  declare readonly scope: ISessions['scope']
  declare readonly scopeOf: ISessions['scopeOf']
  declare readonly sessionOf: ISessions['sessionOf']
  declare readonly binding: ISessions['binding']

  constructor(initial: SessionListState) {
    this.list = new MutableSource(initial)
    this.create = vi.fn<ISessions['create']>(async options =>
      options?.sessionId ?? sid(`created-${String(options?.workspaceId ?? 'none')}`))
  }

  delete(sessionId: SessionId): ReturnType<ISessions['delete']> {
    this.deleteCalls.push(sessionId)
    return this.onDelete(sessionId)
  }
}

class FakeWorkspaces implements IWorkspaces {
  readonly list: MutableSource<WorkspaceSnapshot>
  readonly archiveCalls: SessionId[] = []
  readonly unarchiveCalls: SessionId[] = []
  readonly echoCalls: SessionId[][] = []
  onArchive: IWorkspaces['archiveSession'] = async (sessionId) => {
    this.list.update(state => ({
      ...state,
      archivedSessionIds: [...state.archivedSessionIds, sessionId],
    }))
  }
  onUnarchive: IWorkspaces['unarchiveSession'] = async (sessionId) => {
    this.list.update(state => ({
      ...state,
      archivedSessionIds: state.archivedSessionIds.filter(id => id !== sessionId),
    }))
  }

  declare readonly create: IWorkspaces['create']
  declare readonly rename: IWorkspaces['rename']
  declare readonly insertBefore: IWorkspaces['insertBefore']
  declare readonly insertSessionBefore: IWorkspaces['insertSessionBefore']
  readonly deleteCalls: WorkspaceId[] = []
  onDelete: IWorkspaces['delete'] = async (workspaceId) => {
    this.list.update(state => ({
      ...state,
      items: state.items.filter(item => item.workspaceId !== workspaceId),
    }))
  }

  constructor(initial: WorkspaceSnapshot) {
    this.list = new MutableSource(initial)
  }

  delete(workspaceId: WorkspaceId): Promise<void> {
    this.deleteCalls.push(workspaceId)
    return this.onDelete(workspaceId)
  }

  archiveSession(sessionId: SessionId): Promise<void> {
    this.archiveCalls.push(sessionId)
    return this.onArchive(sessionId)
  }

  unarchiveSession(sessionId: SessionId): Promise<void> {
    this.unarchiveCalls.push(sessionId)
    return this.onUnarchive(sessionId)
  }

  applyArchivedEcho(archivedSessionIds: readonly SessionId[]): void {
    this.echoCalls.push([...archivedSessionIds])
    this.list.update(state => ({ ...state, archivedSessionIds: [...archivedSessionIds] }))
  }
}

const listing: DirectoryListing = {
  path: '/home/u',
  home: '/home/u',
  crumbs: [{ name: '/', path: '/', hidden: false }],
  entries: [{ name: 'project', path: '/home/u/project', hidden: false }],
  truncated: false,
}

/** The directory-picking Remote namespace, recorded and scripted per case. */
class FakeDirectoryPicker {
  readonly calls: { method: string; payload: unknown }[] = []

  onPick: () => Promise<RemoteResult<string | null>> = () => Promise.resolve({ ok: true, value: null })
  onList: () => Promise<RemoteResult<DirectoryListing>> = () => Promise.resolve({ ok: true, value: listing })
  onCreateDirectory: () => Promise<RemoteResult<string>> =
    () => Promise.resolve({ ok: true, value: '/home/u/new' })

  readonly remote: ClientRemote['directoryPicker'] = {
    pick: () => this.record('pick', {}, this.onPick()),
    list: (path?: string) => this.record('list', { path }, this.onList()),
    createDirectory: (path: string, name: string) =>
      this.record('createDirectory', { path, name }, this.onCreateDirectory()),
  }

  callsOf(method: string): unknown[] {
    return this.calls.filter(call => call.method === method).map(call => call.payload)
  }

  private record<T>(method: string, payload: unknown, result: Promise<T>): Promise<T> {
    this.calls.push({ method, payload })
    return result
  }
}

interface BenchOptions {
  readonly workspaces?: WorkspaceSnapshot
  readonly sessions?: SessionListState
  readonly configureSessions?: (sessions: FakeSessions) => void
}

function bench(options: BenchOptions = {}) {
  const ctx = new Context()
  contexts.push(ctx)
  const layout = new LayoutController({
    selectPanel: vi.fn(), retainMainPanels: vi.fn(),
    setSidebar: vi.fn(), toggleSidebar: vi.fn(), setViewportWidth: vi.fn(),
    setNarrow: vi.fn(), closeNarrowSidebar: vi.fn(),
    setRightbar: vi.fn(), openRightbar: vi.fn(), closeRightbar: vi.fn(),
    setSurfaces: vi.fn(), toggleSurfaces: vi.fn(), openSurfaces: vi.fn(), closeSurfaces: vi.fn(),
    toggleTerminalDrawer: vi.fn(), setTerminalDrawer: vi.fn(),
  }, () => true)
  const selectPanel = vi.spyOn(layout, 'selectPanel')
  ctx.provide('layout', layout)
  ctx.effect(() => () => { layout.dispose() })
  const directoryPicker = new FakeDirectoryPicker()
  const workspaces = new FakeWorkspaces(options.workspaces ?? workspaceState([], [], 'pending'))
  const sessions = new FakeSessions(options.sessions ?? sessionState([], 'pending'))
  options.configureSessions?.(sessions)
  const uiWorkspace = new UiWorkspaceService(
    ctx,
    directoryPicker.remote,
    workspaces,
    sessions,
  )
  return { ctx, directoryPicker, sessions, uiWorkspace, workspaces, layout, selectPanel }
}

describe('UiWorkspaceService', () => {
  it('retains an explicit main target before revealing its Conversation', () => {
    const b = bench()
    b.uiWorkspace.openSession(sid('target'))
    expect(b.selectPanel).toHaveBeenCalledWith(null)
    expect(b.sessions.retain).toHaveBeenCalledWith(sid('target'), { source: 'mainView' })
    expect(b.sessions.refreshSubagents).toHaveBeenCalledWith(sid('target'))
  })

  it('keeps the current panel when retaining the target fails', () => {
    const b = bench()
    b.sessions.retain.mockImplementationOnce(() => { throw new Error('open failed') })
    expect(() => { b.uiWorkspace.openSession(sid('target')) }).toThrow('open failed')
    expect(b.selectPanel).not.toHaveBeenCalled()
  })

  it('releases a newly retained target when Workspace preparation throws', async () => {
    const b = bench({
      workspaces: workspaceState([workspace('a')]),
      sessions: sessionState([], 'pending'),
    })
    b.uiWorkspace.openSession(sid('current'))
    const failure = new Error('preparation failed')

    await expect(b.uiWorkspace.openWorkspace(wid('a'), () => { throw failure })).rejects.toBe(failure)

    expect(b.sessions.retained.map(item => item.reference.sessionId)).toEqual([sid('current'), sid('created-a')])
    expect(b.sessions.retained[0]!.release).not.toHaveBeenCalled()
    expect(b.sessions.retained[1]!.release).toHaveBeenCalledOnce()
  })

  it('opens only the latest Workspace when creation finishes out of order', async () => {
    const b = bench({ workspaces: workspaceState([workspace('a'), workspace('b')]) })
    const first = Promise.withResolvers<SessionId>()
    const second = Promise.withResolvers<SessionId>()
    b.sessions.create.mockImplementation(options => options?.workspaceId === wid('a') ? first.promise : second.promise)
    const prepareA = vi.fn()
    const prepareB = vi.fn()
    const openingA = b.uiWorkspace.openWorkspace(wid('a'), prepareA)
    const openingB = b.uiWorkspace.openWorkspace(wid('b'), prepareB)
    second.resolve(sid('newer'))
    await openingB
    first.resolve(sid('older'))
    await openingA
    expect(b.sessions.retain).toHaveBeenCalledExactlyOnceWith(sid('newer'), { source: 'mainView' })
    expect(prepareB).toHaveBeenCalledExactlyOnceWith(sid('newer'))
    expect(prepareA).not.toHaveBeenCalled()
  })

  it('retains a no-directory target before beforeOpen and releases the previous main binding after preparation', async () => {
    const b = bench({ workspaces: workspaceState([]) })
    b.uiWorkspace.openSession(sid('old'))
    const created = Promise.withResolvers<SessionId>()
    b.sessions.create.mockReturnValueOnce(created.promise)
    const beforeOpen = vi.fn(() => {
      expect(b.sessions.retained.map(item => item.reference.sessionId)).toEqual([sid('old'), sid('fresh')])
      expect(b.sessions.retained[0]!.release).not.toHaveBeenCalled()
      expect(b.sessions.retained[1]!.release).not.toHaveBeenCalled()
    })
    const opening = b.uiWorkspace.openNoDirectory(beforeOpen)
    created.resolve(sid('fresh'))
    await opening
    expect(beforeOpen).toHaveBeenCalledExactlyOnceWith(sid('fresh'))
    expect(b.sessions.retained[0]!.release).toHaveBeenCalledOnce()
    expect(b.sessions.retained[1]!.release).not.toHaveBeenCalled()
  })

  it('does not let a superseded no-directory connection steal the later Session selection', async () => {
    const b = bench({ workspaces: workspaceState([]) })
    const created = Promise.withResolvers<SessionId>()
    b.sessions.create.mockReturnValueOnce(created.promise)
    const beforeOpen = vi.fn()
    const opening = b.uiWorkspace.openNoDirectory(beforeOpen)
    b.uiWorkspace.openSession(sid('override'))
    created.resolve(sid('late'))
    await opening
    expect(beforeOpen).not.toHaveBeenCalled()
    expect(b.sessions.retain.mock.calls.map(([target]) => target)).toEqual([sid('override')])
    expect(b.sessions.retained[0]!.release).not.toHaveBeenCalled()
  })

  it('does not reopen a Workspace after a later panel or Session navigation', async () => {
    for (const panel of [true, false]) {
      const b = bench({ workspaces: workspaceState([workspace('a')]) })
      const created = Promise.withResolvers<SessionId>()
      b.sessions.create.mockReturnValueOnce(created.promise)
      const opening = b.uiWorkspace.openWorkspace(wid('a'))
      if (panel) b.layout.selectPanel('other-panel' as MainPanelId)
      else b.uiWorkspace.openSession(sid('chosen'))
      created.resolve(sid('late'))
      await opening
      expect(b.sessions.retain.mock.calls.map(args => args[0])).toEqual(panel ? [] : [sid('chosen')])
    }
  })

  it('does not deliver pending Workspace and fork targets after disposal', async () => {
    for (const kind of ['workspace', 'fork'] as const) {
      const b = bench({ workspaces: workspaceState([workspace('a')]) })
      const created = Promise.withResolvers<SessionId>()
      b.sessions.create.mockReturnValueOnce(created.promise)
      b.sessions.fork.mockReturnValueOnce(created.promise)
      const pending = kind === 'workspace' ? b.uiWorkspace.openWorkspace(wid('a')) : b.uiWorkspace.forkSession(sid('source'))
      await b.ctx.fiber.dispose()
      created.resolve(sid('late'))
      await pending
      expect(b.sessions.retain).not.toHaveBeenCalled()
    }
  })

  it('does not reuse a presentation-owned blank Workspace Session', async () => {
    const ownedBlank = summary('owned-blank', {
      blank: true,
      cwd: '/w/plugin-only',
      presentation: { owner: 'dshbot', title: 'Bot room' },
    })
    const b = bench({
      sessions: sessionState([ownedBlank]),
      workspaces: workspaceState([workspace('plugin-only', [ownedBlank.id])]),
    })
    const connected = await b.uiWorkspace.connectWorkspace(wid('plugin-only'))
    expect(connected).not.toBe(ownedBlank.id)
    expect(b.sessions.create).toHaveBeenCalledWith({ workspaceId: wid('plugin-only') })
  })

  describe.each(['workspace', 'no-directory'] as const)('%s draft identity', (mode) => {
    function setup(overrides: Partial<SessionSummary> = {}) {
      const candidate = summary('old-blank', {
        blank: true, cwd: mode === 'workspace' ? '/w/alpha' : SCRATCH, ...overrides,
      })
      const current = summary('current')
      persistSelection({ sessionId: current.id })
      const b = bench({
        sessions: sessionState([candidate, current]),
        workspaces: workspaceState(mode === 'workspace' ? [workspace('alpha', [candidate.id])] : []),
      })
      const connect = () => mode === 'workspace'
        ? b.uiWorkspace.connectWorkspace(wid('alpha'))
        : b.uiWorkspace.connectNoDirectory()
      return { ...b, candidate, connect }
    }

    it.each([
      { title: '千咲' },
      { parentId: sid('parent') },
      { origin: 'subagent' as const },
      { running: true },
    ])('does not repurpose a blank with existing identity %j', async (identity) => {
      const b = setup(identity)
      await expect(b.connect()).resolves.not.toBe(b.candidate.id)
      expect(b.sessions.canReuseBlank).not.toHaveBeenCalled()
      expect(b.sessions.list.getSnapshot().byId[b.candidate.id]).toEqual(b.candidate)
    })

    it('checks history even when the list no longer shows a plugin owner or title', async () => {
      const b = setup()
      b.sessions.canReuseBlank.mockResolvedValue(false)
      await expect(b.connect()).resolves.not.toBe(b.candidate.id)
      expect(b.sessions.canReuseBlank).toHaveBeenCalledWith(b.candidate.id, expect.any(AbortSignal))
      expect(b.sessions.create).toHaveBeenCalledOnce()
    })

    it('coalesces the history check and subsequent creation', async () => {
      const b = setup()
      const check = Promise.withResolvers<boolean>()
      b.sessions.canReuseBlank.mockReturnValue(check.promise)
      const first = b.connect()
      const second = b.connect()
      expect(b.sessions.canReuseBlank).toHaveBeenCalledOnce()
      expect(b.sessions.create).not.toHaveBeenCalled()
      check.resolve(false)
      const results = await Promise.all([first, second])
      expect(results[0]).toBe(results[1])
      expect(results[0]).not.toBe(b.candidate.id)
      expect(b.sessions.create).toHaveBeenCalledOnce()
    })

    it('keeps a genuinely reusable draft and shares the pending check', async () => {
      const b = setup()
      const check = Promise.withResolvers<boolean>()
      b.sessions.canReuseBlank.mockReturnValue(check.promise)
      const first = b.connect()
      const second = b.connect()
      check.resolve(true)
      await expect(Promise.all([first, second])).resolves.toEqual([b.candidate.id, b.candidate.id])
      expect(b.sessions.canReuseBlank).toHaveBeenCalledOnce()
      expect(b.sessions.create).not.toHaveBeenCalled()
    })

    it.each(['archived', 'removed', 'renamed', 'started', 'moved'] as const)(
      'rechecks a candidate that is %s while history is loading', async (change) => {
        const b = setup()
        const check = Promise.withResolvers<boolean>()
        b.sessions.canReuseBlank.mockReturnValue(check.promise)
        const pending = b.connect()
        if (change === 'archived') {
          b.workspaces.list.update(state => ({ ...state, archivedSessionIds: [b.candidate.id] }))
        } else if (change === 'moved') {
          b.workspaces.list.update(state => ({
            ...state, items: [workspace('other', [b.candidate.id])],
          }))
        } else {
          b.sessions.list.update(state => ({
            ...state,
            byId: Object.fromEntries(Object.entries(state.byId).flatMap(([id, item]) =>
              id !== b.candidate.id ? [[id, item]]
                : change === 'removed' ? []
                  : [[id, { ...item, ...(change === 'renamed' ? { title: 'Named' } : { blank: false }) }]])),
          }))
        }
        check.resolve(true)
        if (change === 'moved' && mode === 'workspace') {
          await expect(pending).rejects.toThrow('unknown workspace alpha')
          expect(b.sessions.create).not.toHaveBeenCalled()
        } else {
          await expect(pending).resolves.not.toBe(b.candidate.id)
          expect(b.sessions.create).toHaveBeenCalledOnce()
        }
      },
    )

    it('surfaces a history failure without creating, and permits a later retry', async () => {
      const b = setup()
      b.sessions.canReuseBlank.mockRejectedValueOnce(new Error('history unavailable'))
      await expect(b.connect()).rejects.toThrow('history unavailable')
      expect(b.sessions.create).not.toHaveBeenCalled()
      await expect(b.connect()).resolves.toBe(b.candidate.id)
    })

    it.each([
      { running: true },
      { cwd: '/moved-away' },
      { presentation: { owner: 'dshbot', title: 'New owner' } },
      { parentId: sid('new-parent') },
      { origin: 'subagent' as const },
    ])('rechecks changed identity after Host inspection %j', async (change) => {
      const b = setup()
      const check = Promise.withResolvers<boolean>()
      b.sessions.canReuseBlank.mockReturnValue(check.promise)
      const pending = b.connect()
      b.sessions.list.update(state => ({
        ...state, byId: { ...state.byId, [b.candidate.id]: { ...b.candidate, ...change } },
      }))
      check.resolve(true)
      await expect(pending).resolves.not.toBe(b.candidate.id)
      expect(b.sessions.create).toHaveBeenCalledOnce()
    })

    it('continues past a rejected history to a genuine draft without creating', async () => {
      const b = setup()
      const next = summary('genuine-draft', {
        blank: true, ...(b.candidate.cwd === undefined ? {} : { cwd: b.candidate.cwd }),
      })
      b.sessions.list.update(state => ({
        ...state, ids: [...state.ids, next.id], byId: { ...state.byId, [next.id]: next },
      }))
      if (mode === 'workspace') {
        b.workspaces.list.update(state => ({ ...state, items: [workspace('alpha', [b.candidate.id, next.id])] }))
      }
      b.sessions.canReuseBlank.mockResolvedValueOnce(false)
      await expect(b.connect()).resolves.toBe(next.id)
      expect(b.sessions.canReuseBlank).toHaveBeenCalledTimes(2)
      expect(b.sessions.create).not.toHaveBeenCalled()
    })

    it('does not create after disposal interrupts the history check', async () => {
      const b = setup()
      const check = Promise.withResolvers<boolean>()
      b.sessions.canReuseBlank.mockReturnValue(check.promise)
      const pending = b.connect()
      await b.ctx.fiber.dispose()
      check.resolve(false)
      await expect(pending).rejects.toThrow()
      expect(b.sessions.create).not.toHaveBeenCalled()
    })
  })

  it('connects a no-directory task by reusing the scratch blank or creating one in the scratch cwd', async () => {
    const memberBlank = summary('member-blank', { blank: true, cwd: SCRATCH })
    const orphanBlank = summary('orphan-blank', { blank: true, cwd: '/w/deleted' })
    const ownedBlank = summary('owned-blank', {
      blank: true,
      cwd: SCRATCH,
      presentation: { owner: 'dshbot', title: 'Bot room' },
    })
    const archivedTask = summary('archived-task', { blank: true, cwd: SCRATCH })
    const usedTask = summary('used-task', { cwd: SCRATCH })
    const b = bench({
      sessions: sessionState([memberBlank, orphanBlank, ownedBlank, archivedTask, usedTask]),
      workspaces: workspaceState([workspace('alpha', [memberBlank.id])], [archivedTask.id]),
    })

    // A ready Workspace baseline independently starts its most-recent
    // Workspace navigation. Clear that initialization call so this assertion
    // measures only the two concurrent no-directory requests below.
    await vi.waitFor(() => {
      expect(b.sessions.create).toHaveBeenCalledWith({ workspaceId: wid('alpha') })
    })
    b.sessions.create.mockClear()

    // A Workspace member, a blank from an unregistered Workspace, a
    // presentation-owned blank, an archived scratch blank, and a used scratch
    // task never count as the reusable blank.
    const creation = Promise.withResolvers<SessionId>()
    b.sessions.create.mockImplementation(() => creation.promise)
    const first = b.uiWorkspace.connectNoDirectory()
    const second = b.uiWorkspace.connectNoDirectory()
    expect(b.sessions.create).toHaveBeenCalledTimes(1)
    expect(b.sessions.create).toHaveBeenCalledWith({ cwd: SCRATCH })
    creation.resolve(sid('fresh-task'))
    await expect(Promise.all([first, second])).resolves.toEqual([sid('fresh-task'), sid('fresh-task')])

    const reusable = summary('reusable', { blank: true, cwd: SCRATCH })
    b.sessions.list.set(sessionState([memberBlank, reusable]))
    await expect(b.uiWorkspace.connectNoDirectory()).resolves.toBe(reusable.id)
    expect(b.sessions.create).toHaveBeenCalledTimes(1)

    const pending = bench()
    await expect(pending.uiWorkspace.connectNoDirectory())
      .rejects.toThrow('the Workspace baseline has not arrived yet')
    expect(pending.sessions.create).not.toHaveBeenCalled()
  })

  it('clears the selection when the deleted Workspace held the current Session', async () => {
    const inside = summary('inside', { cwd: '/w/gone' })
    const outside = summary('outside', { cwd: '/w/kept' })
    const b = bench({
      sessions: sessionState([inside, outside]),
      workspaces: workspaceState([workspace('gone', [inside.id]), workspace('kept', [outside.id])]),
    })
    b.uiWorkspace.openSession(inside.id)

    await b.uiWorkspace.deleteWorkspace(wid('kept'))
    expect(b.workspaces.deleteCalls).toEqual([wid('kept')])
    expect(b.sessions.retained[0]!.release).not.toHaveBeenCalled()

    await b.uiWorkspace.deleteWorkspace(wid('gone'))
    expect(b.sessions.retained[0]!.release).toHaveBeenCalledOnce()
    expect(b.selectPanel).toHaveBeenCalledTimes(2)

    b.workspaces.onDelete = () => Promise.reject(new Error('delete rejected'))
    await expect(b.uiWorkspace.deleteWorkspace(wid('ghost'))).rejects.toThrow('delete rejected')
    expect(b.sessions.retained[0]!.release).toHaveBeenCalledOnce()
  })

  it('ignores a rejected startup selection and stale catalog callbacks after disposal', async () => {
    const created = Promise.withResolvers<SessionId>()
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const b = bench({
      workspaces: workspaceState([workspace('a')], [], 'ready'),
      sessions: sessionState([], 'pending'),
      configureSessions: (sessions) => { sessions.create.mockReturnValue(created.promise) },
    })
    const staleReconcile = b.sessions.list.listenersSnapshot()[0]!
    b.sessions.list.set(sessionState())
    await b.ctx.fiber.dispose()
    staleReconcile()
    created.reject(new Error('late failure'))
    await Promise.resolve()

    expect(warning).not.toHaveBeenCalled()
  })

  it('does not run startup selection after a main Session was chosen while catalogs loaded', () => {
    const b = bench()
    b.uiWorkspace.openSession(sid('chosen'))

    b.workspaces.list.set(workspaceState([workspace('a')]))
    b.sessions.list.set(sessionState())

    expect(b.sessions.retain).toHaveBeenCalledExactlyOnceWith(sid('chosen'), { source: 'mainView' })
    expect(b.sessions.create).not.toHaveBeenCalled()
  })

  it('forwards fork policy and rejects a failed fork', async () => {
    const b = bench()
    await b.uiWorkspace.forkSession(sid('source'))
    expect(b.sessions.fork).toHaveBeenCalledWith({ sessionId: sid('source'), increaseTitle: true })
    expect(b.sessions.retain).toHaveBeenCalledWith(sid('forked'), { source: 'mainView' })
    b.sessions.fork.mockRejectedValueOnce(new Error('fork failed'))
    await expect(b.uiWorkspace.forkSession(sid('source'))).rejects.toThrow('fork failed')
  })

  it('reuses only an unarchived member blank and coalesces concurrent creation', async () => {
    const b = bench({
      sessions: sessionState([
        summary('stray', { blank: true, cwd: '/w/a' }),
        summary('blank', { blank: true, cwd: '/w/a' }),
        summary('archived', { blank: true, cwd: '/w/b' }),
      ]),
      workspaces: workspaceState([workspace('a', [sid('blank')]), workspace('b', [sid('archived')])], [sid('archived')]),
    })
    await expect(b.uiWorkspace.connectWorkspace(wid('a'))).resolves.toBe(sid('blank'))
    expect(b.sessions.create).not.toHaveBeenCalled()
    b.sessions.retain.mockClear()
    const created = Promise.withResolvers<SessionId>()
    b.sessions.create.mockReturnValue(created.promise)
    const first = b.uiWorkspace.connectWorkspace(wid('b'))
    const second = b.uiWorkspace.connectWorkspace(wid('b'))
    expect(b.sessions.create).toHaveBeenCalledOnce()
    created.resolve(sid('new'))
    await expect(Promise.all([first, second])).resolves.toEqual([sid('new'), sid('new')])
    await expect(b.uiWorkspace.connectWorkspace(wid('missing'))).rejects.toThrow('unknown workspace')
    expect(b.sessions.retain).not.toHaveBeenCalled()
  })

  it('uses only an explicit Workspace or the recent-Workspace policy for new Sessions', async () => {
    const current = summary('current', { cwd: '/w/current-home', updatedAt: 1 })
    const recent = summary('recent', { cwd: '/w/recent-home', updatedAt: 2 })
    const pluginOnly = summary('plugin-only', {
      cwd: '/w/plugin-only',
      updatedAt: 100,
      presentation: { owner: 'dshbot', title: 'Bot room' },
    })
    const b = bench({
      sessions: sessionState([current, recent, pluginOnly]),
      workspaces: workspaceState([
        workspace('old'),
        workspace('current-home', [current.id]),
        workspace('recent-home', [recent.id]),
        workspace('plugin-only', [pluginOnly.id], '1970-01-01T00:00:00.000Z'),
      ]),
    })
    b.uiWorkspace.startSession(wid('old'))
    await vi.waitFor(() => {
      expect(b.sessions.retain).toHaveBeenLastCalledWith(sid('created-old'), { source: 'mainView' })
    })
    b.uiWorkspace.openSession(current.id)
    b.uiWorkspace.startSession()
    await vi.waitFor(() => {
      expect(b.sessions.retain).toHaveBeenLastCalledWith(sid('created-current-home'), { source: 'mainView' })
    })
    const recentOnly = bench({
      sessions: sessionState([current, recent]),
      workspaces: workspaceState([
        workspace('current-home', [current.id]),
        workspace('recent-home', [recent.id]),
        workspace('plugin-only', [pluginOnly.id], '1970-01-01T00:00:00.000Z'),
      ]),
    })
    recentOnly.uiWorkspace.startSession()
    await vi.waitFor(() => {
      expect(recentOnly.sessions.retain).toHaveBeenLastCalledWith(sid('created-recent-home'), { source: 'mainView' })
    })
    b.sessions.create.mockRejectedValueOnce(new Error('create failed'))
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    b.uiWorkspace.startSession(wid('recent-home'))
    await vi.waitFor(() => { expect(warning).toHaveBeenCalledWith('new session failed:', expect.any(Error)) })
    const empty = bench()
    empty.uiWorkspace.startSession()
    expect(empty.selectPanel).toHaveBeenCalledWith(null)

    const missingMember = bench({
      sessions: sessionState(),
      workspaces: workspaceState([
        workspace('older', [sid('missing')], '2026-01-01T00:00:00.000Z'),
        workspace('newer', [], '2026-02-01T00:00:00.000Z'),
      ]),
    })
    missingMember.uiWorkspace.startSession()
    await vi.waitFor(() => {
      expect(missingMember.sessions.create).toHaveBeenCalledWith({ workspaceId: wid('newer') })
    })
  })

  it('releases a prepared Workspace target when synchronous preparation supersedes it', async () => {
    const b = bench({ workspaces: workspaceState([workspace('a')]) })

    await b.uiWorkspace.openWorkspace(wid('a'), () => {
      b.uiWorkspace.openSession(sid('override'))
    })

    expect(b.sessions.retained.map(item => item.reference.sessionId)).toEqual([
      sid('created-a'), sid('override'),
    ])
    expect(b.sessions.retained[0]!.release).toHaveBeenCalledOnce()
    expect(b.sessions.retained[1]!.release).not.toHaveBeenCalled()
  })

  it('opens the most recent Workspace after both startup catalogs become ready', async () => {
    const b = bench()
    b.workspaces.list.set(workspaceState([
      workspace('newest', [], '2026-03-01T00:00:00.000Z'),
      workspace('same-time', [], '2026-03-01T00:00:00.000Z'),
      workspace('older', [], '2026-01-01T00:00:00.000Z'),
    ]))
    b.sessions.list.set(sessionState())
    await vi.waitFor(() => {
      expect(b.sessions.retain).toHaveBeenCalledWith(sid('created-newest'), { source: 'mainView' })
    })
  })

  it('does not let a pending startup Workspace replace a manual Session selection', async () => {
    const created = Promise.withResolvers<SessionId>()
    const b = bench({
      workspaces: workspaceState([workspace('a')]),
      sessions: sessionState(),
      configureSessions: (sessions) => { sessions.create.mockReturnValue(created.promise) },
    })
    b.uiWorkspace.openSession(sid('chosen'))

    created.resolve(sid('automatic'))
    await b.uiWorkspace.connectWorkspace(wid('a'))

    expect(b.sessions.retain.mock.calls.map(([target]) => target)).toEqual([sid('chosen')])
  })

  it('restores a persisted subagent address without a parent catalog', () => {
    const address: SubagentAddress = {
      parentSessionId: sid('parent'),
      childSessionId: sid('child'),
      mode: 'continuable',
    }
    persistSelection({ sessionId: address.childSessionId, subagentAddress: address })

    const b = bench({
      workspaces: workspaceState(),
      sessions: sessionState(),
    })

    expect(b.sessions.retain).toHaveBeenCalledExactlyOnceWith(address, { source: 'mainView' })
    expect(b.sessions.refreshSubagents.mock.calls).toEqual([
      [address.parentSessionId],
      [address.childSessionId],
    ])
  })

  it('persists a catalog-resolved address after string subagent navigation', () => {
    const address: SubagentAddress = {
      parentSessionId: sid('parent'),
      childSessionId: sid('child'),
      mode: 'continuable',
    }
    const backing = persistSelection({})
    const b = bench({
      configureSessions: (sessions) => { sessions.subagentAddress.mockReturnValue(address) },
    })

    b.uiWorkspace.openSession(address.childSessionId)

    expect(JSON.parse(backing.get('dsh.sessions.current')!)).toEqual({
      sessionId: address.childSessionId,
      subagentAddress: address,
    })
  })

  it('reports and retries a failed persisted Session restoration', () => {
    const failure = new Error('restore failed')
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const sessions = sessionState([summary('saved')])
    persistSelection({ sessionId: sid('saved') })
    const b = bench({
      workspaces: workspaceState(),
      sessions,
      configureSessions: (face) => {
        face.retain.mockImplementationOnce(() => { throw failure })
      },
    })

    expect(warning).toHaveBeenCalledWith('initial Session restoration failed:', failure)
    b.sessions.list.set(sessions)

    expect(b.sessions.retain).toHaveBeenCalledTimes(2)
    expect(b.sessions.retained).toHaveLength(1)
    expect(b.sessions.retained[0]!.reference.sessionId).toBe(sid('saved'))
  })

  it('clears a selected Session when an external archive snapshot arrives', () => {
    const b = bench()
    b.uiWorkspace.openSession(sid('current'))

    b.workspaces.list.set(workspaceState([], [sid('current')]))

    expect(b.sessions.retained[0]!.release).toHaveBeenCalledOnce()
    expect(b.selectPanel).toHaveBeenCalledTimes(2)
  })

  it('clears a selected Session after archiving it without an intervening snapshot', async () => {
    const b = bench()
    b.workspaces.onArchive = async () => {}
    b.uiWorkspace.openSession(sid('current'))

    await b.uiWorkspace.archiveSession(sid('current'))

    expect(b.sessions.retained[0]!.release).toHaveBeenCalledOnce()
    expect(b.selectPanel).toHaveBeenCalledTimes(2)
  })

  it('forwards archive commands and preserves failures', async () => {
    const idle = sid('idle')
    const b = bench()

    await b.uiWorkspace.archiveSession(idle)
    expect(b.workspaces.archiveCalls).toEqual([idle])

    b.workspaces.onArchive = () => Promise.reject(new Error('archive rejected'))
    await expect(b.uiWorkspace.archiveSession(idle)).rejects.toThrow('archive rejected')
    expect(b.workspaces.archiveCalls).toEqual([idle, idle])
  })

  it('forwards unarchive and delete, installing the archive echo after delete', async () => {
    const idle = sid('idle')
    const b = bench()

    await b.uiWorkspace.unarchiveSession(idle)
    expect(b.workspaces.unarchiveCalls).toEqual([idle])

    b.workspaces.onUnarchive = () => Promise.reject(new Error('unarchive rejected'))
    await expect(b.uiWorkspace.unarchiveSession(idle)).rejects.toThrow('unarchive rejected')
    expect(b.workspaces.unarchiveCalls).toEqual([idle, idle])

    await b.uiWorkspace.deleteSession(idle)
    expect(b.sessions.deleteCalls).toEqual([idle])
    expect(b.workspaces.echoCalls).toEqual([[]])

    b.sessions.onDelete = () => Promise.reject(new Error('delete rejected'))
    await expect(b.uiWorkspace.deleteSession(idle)).rejects.toThrow('delete rejected')
    expect(b.workspaces.echoCalls).toEqual([[]])
  })

  it('passes directory operations to the Host and preserves structured browse failures', async () => {
    const b = bench()
    b.directoryPicker.onPick = () => Promise.resolve({ ok: true, value: '/w/alpha' })
    await expect(b.uiWorkspace.pickDirectory()).resolves.toBe('/w/alpha')
    b.directoryPicker.onPick = () => Promise.resolve({ ok: true, value: null })
    await expect(b.uiWorkspace.pickDirectory()).resolves.toBeNull()
    expect(b.directoryPicker.callsOf('pick')).toEqual([{}, {}])

    await expect(b.uiWorkspace.listDirectory()).resolves.toEqual(listing)
    await expect(b.uiWorkspace.listDirectory('/home/u')).resolves.toEqual(listing)
    expect(b.directoryPicker.callsOf('list')).toEqual([{ path: undefined }, { path: '/home/u' }])
    await expect(b.uiWorkspace.createDirectory('/home/u', 'new')).resolves.toBe('/home/u/new')
    expect(b.directoryPicker.callsOf('createDirectory')).toEqual([{ path: '/home/u', name: 'new' }])
    b.directoryPicker.onPick = () => Promise.resolve({
      ok: false, error: new RemoteError('gateway/internal', 'no chooser', {}),
    })
    await expect(b.uiWorkspace.pickDirectory()).rejects.toThrow('directory picker failed: no chooser')
    b.directoryPicker.onList = () => Promise.resolve({
      ok: false, error: new RemoteError('directory-picker/unreadable', 'denied', { path: '/private' }),
    })
    const listFailure = b.uiWorkspace.listDirectory('/private')
    await expect(listFailure).rejects.toBeInstanceOf(DirectoryBrowseError)
    await expect(listFailure).rejects.toMatchObject({ rpcError: { code: 'directory-picker/unreadable' } })
    b.directoryPicker.onCreateDirectory = () => Promise.resolve({
      ok: false, error: new RemoteError('directory-picker/exists', 'taken', { path: '/home/u/new' }),
    })
    await expect(b.uiWorkspace.createDirectory('/home/u', 'new')).rejects.toMatchObject({
      rpcError: { code: 'directory-picker/exists' },
    })
  })
})
