import { describe, expect, it } from 'vitest'
import type { SessionListState, SessionSummary } from '@deepseek-ai/dsh-api-session-controller/client'
import type { WorkspaceId, WorkspaceView } from '@deepseek-ai/dsh-api-workspace-controller/client'
import type { SessionPendingInteractionBase } from '@deepseek-ai/dsh-client-ui-session/client'
import type { ScheduleId, ScheduleRecord } from '@deepseek-ai/dsh-schedule/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import {
  currentGroupKey, deriveArchived, deriveFlat, deriveGroups, deriveSearchResults, isNoDirectorySession,
  workspaceLabel, UNGROUPED_KEY,
} from '../src/client/tree.ts'
import { createWorkspaceViewStore } from '../src/client/stores.ts'

/** Host scratch cwd from the Workspace baseline; sessions here are no-directory tasks. */
const SCRATCH = '/dsh-home/no-workspace'
const sid = (id: string) => id as SessionId
const wid = (id: string) => id as WorkspaceId
// Unowned fixture sessions default to the scratch cwd so they stay listable;
// tests about unregistered Workspaces pass an explicit foreign cwd instead.
const summary = (id: string, updatedAt: number, cwd: string = SCRATCH): SessionSummary => ({
  id: sid(id), displayTitle: id, running: false, blank: false, updatedAt, cwd,
})
const list = (...items: SessionSummary[]): SessionListState => ({
  ids: items.map(item => item.id),
  byId: Object.fromEntries(items.map(item => [item.id, item])),
  current: undefined,
  phase: 'ready', subagentsByParent: {}, jobsBySession: {}, currentAddress: undefined,
})
const workspace = (id: string, sessionIds: string[], title = id): WorkspaceView => ({
  workspaceId: wid(id), path: `/projects/${id}`, title,
  sessionIds: sessionIds.map(sid), createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
})
const view = (expandedGroups: readonly string[] = [], ungroupedOrder?: readonly string[]) => ({
  expandedGroups,
  ...(ungroupedOrder === undefined ? {} : { ungroupedOrder }),
})
const noArchive: readonly SessionId[] = []
const noAttention: ReadonlyMap<SessionId, SessionPendingInteractionBase> = new Map()
const archived = (...ids: string[]): readonly SessionId[] => ids.map(sid)
const schedule = (id: string, scheduledAt: string): ScheduleRecord => ({
  id: id as ScheduleId,
  kind: 'at',
  prompt: id,
  scheduledAt,
})
const noContent = { items: [], hasMore: false }

describe('deriveGroups', () => {
  it('keeps Host Workspace and sessionIds order without Client recency sorting', () => {
    const sessions = list(summary('newer', 20), summary('older', 10))
    const workspaces = [workspace('first', ['older', 'newer']), workspace('empty', [])]
    const groups = deriveGroups(sessions, workspaces, noArchive, noAttention, view(['first']), SCRATCH)
    expect(groups.map(group => group.key)).toEqual(['first', 'empty'])
    expect(groups[0]!.sessions.map(session => session.id)).toEqual([sid('older'), sid('newer')])
  })

  it('projects pending-interaction state into grouped and flat rows', () => {
    const awaiting = { ...summary('awaiting', 10), running: true }
    const sessions = list(awaiting)
    const attention: ReadonlyMap<SessionId, SessionPendingInteractionBase> = new Map([[
      awaiting.id,
      { key: 'question:1', kind: 'plan-review', sessionId: awaiting.id },
    ]])
    const grouped = deriveGroups(
      sessions, [workspace('project', ['awaiting'])], noArchive, attention, view(['project']), SCRATCH,
    )
    expect(grouped[0]!.sessions[0]).toMatchObject({ pendingInteraction: 'plan-review', running: true })
    expect(deriveFlat(sessions, [], noArchive, attention, SCRATCH)[0])
      .toMatchObject({ pendingInteraction: 'plan-review', running: true })
  })

  it.each(['approval', 'question'] as const)(
    'projects the %s pending-interaction kind',
    (kind) => {
      const awaiting = summary(kind, 10)
      const attention: ReadonlyMap<SessionId, SessionPendingInteractionBase> = new Map([[
        awaiting.id,
        { key: `${kind}:1`, kind, sessionId: awaiting.id },
      ]])

      expect(deriveFlat(list(awaiting), [], noArchive, attention, SCRATCH)[0]?.pendingInteraction).toBe(kind)
    },
  )

  it('puts only scratch-cwd Sessions in the trailing no-directory group and hides other strays', () => {
    const sessions = list(
      summary('owned', 1, '/projects/first'),
      summary('task', 9, SCRATCH),
      // Member of a Workspace that is not registered right now (deleted from
      // the sidebar): listed nowhere until that directory is added again.
      summary('orphan', 8, '/projects/deleted'),
    )
    const groups = deriveGroups(
      sessions, [workspace('first', ['owned'])], noArchive, noAttention, view([UNGROUPED_KEY]), SCRATCH,
    )
    expect(groups.map(group => group.key)).toEqual(['first', UNGROUPED_KEY])
    expect(groups[1]!.sessions.map(session => session.id)).toEqual([sid('task')])
    expect(groups[1]!.workspaceId).toBeUndefined()
  })

  it('lists no stray at all before the baseline supplies the scratch cwd', () => {
    const sessions = list(summary('task', 9, SCRATCH))
    expect(deriveGroups(sessions, [], noArchive, noAttention, view([UNGROUPED_KEY]), undefined)).toEqual([])
    expect(deriveFlat(sessions, [], noArchive, noAttention, undefined)).toEqual([])
  })

  it('re-lists a deleted Workspace\'s sessions once the directory is registered again', () => {
    const sessions = list(summary('kept', 1, '/projects/back'), summary('also', 2, '/projects/back'))
    expect(deriveGroups(sessions, [], noArchive, noAttention, view([UNGROUPED_KEY]), SCRATCH)).toEqual([])
    const groups = deriveGroups(
      sessions, [workspace('back', ['also', 'kept'])], noArchive, noAttention, view(['back']), SCRATCH,
    )
    expect(groups.map(group => group.key)).toEqual(['back'])
    expect(groups[0]!.sessions.map(session => session.id)).toEqual([sid('also'), sid('kept')])
  })

  it('applies stored no-directory order and appends new tasks by recency', () => {
    const sessions = list(summary('one', 3), summary('two', 2), summary('new', 4))
    const groups = deriveGroups(
      sessions,
      [],
      noArchive,
      noAttention,
      view([UNGROUPED_KEY], ['two', 'stale', 'two']),
      SCRATCH,
    )
    expect(groups[0]!.sessions.map(session => session.id)).toEqual([
      sid('two'), sid('new'), sid('one'),
    ])
  })

  it('shows only the current blank session in its Workspace count and tree', () => {
    const currentBlank = { ...summary('current-blank', 5), blank: true }
    const staleBlank = { ...summary('stale-blank', 4), blank: true }
    const real = summary('shown', 3)
    const sessions = {
      ...list(real, currentBlank, staleBlank),
      current: currentBlank.id,
    }
    const groups = deriveGroups(
      sessions, [workspace('first', ['shown', 'current-blank', 'stale-blank'])],
      noArchive, noAttention, view(['first']), SCRATCH,
    )
    expect(groups[0]!.sessions.map(session => session.id)).toEqual([real.id, currentBlank.id])
    const blankNode = groups[0]!.sessions.find(session => session.id === currentBlank.id)!
    // The stored placeholder title stays canonical; the renderer swaps in
    // the localized New Session label via the blank flag.
    expect(blankNode.title).toBe('')
    expect(blankNode.blank).toBe(true)
    expect(groups[0]!.sessions.find(session => session.id === real.id)!.blank).toBe(false)
    expect(groups[0]!.sessionCount).toBe(2)
    // A non-current blank task never surfaces the no-directory bucket either.
    const strayGroups = deriveGroups(
      list({ ...summary('stray', 2), blank: true }),
      [workspace('first', [])], noArchive, noAttention, view(), SCRATCH,
    )
    expect(strayGroups.map(group => group.key)).toEqual(['first'])
  })

  it('projects the completion reminder into session and search rows (absent = false)', () => {
    const done = { ...summary('done', 3), completed: true }
    const plain = summary('plain', 2)
    const sessions = list(done, plain)
    const workspaces = [workspace('first', ['done', 'plain'])]
    const groups = deriveGroups(sessions, workspaces, noArchive, noAttention, view(['first']), SCRATCH)
    const doneNode = groups[0]!.sessions.find(session => session.id === done.id)!
    const plainNode = groups[0]!.sessions.find(session => session.id === plain.id)!
    expect(doneNode.completed).toBe(true)
    expect(plainNode.completed).toBe(false)
    expect(deriveFlat(sessions, workspaces, noArchive, noAttention, SCRATCH)
      .find(node => node.id === done.id)!.completed).toBe(true)
    const search = deriveSearchResults(
      sessions, workspaces, 'done', noArchive, noAttention, noContent, 10, SCRATCH,
    )
    expect(search.items[0]?.completed).toBe(true)
  })

  it('derives one active-Schedule fact for grouped, flat, and search rows', () => {
    const absent = summary('absent', 4)
    const empty = { ...summary('empty', 3), projectionValues: { schedule: [] } }
    const future = {
      ...summary('future', 2),
      projectionValues: { schedule: [schedule('future', '2099-01-01T00:00:00.000Z')] },
    }
    const overdue = {
      ...summary('overdue', 1),
      projectionValues: { schedule: [schedule('overdue', '2000-01-01T00:00:00.000Z')] },
    }
    const sessions = list(absent, empty, future, overdue)
    const workspaces = [workspace('project', ['absent', 'empty', 'future', 'overdue'], 'Project')]
    const expected = [
      [sid('absent'), false],
      [sid('empty'), false],
      [sid('future'), true],
      [sid('overdue'), true],
    ]

    expect(deriveGroups(
      sessions, workspaces, noArchive, noAttention, view(['project']), SCRATCH,
    )[0]!.sessions.map(node => [node.id, node.hasActiveSchedule])).toEqual(expected)
    expect(deriveFlat(sessions, workspaces, noArchive, noAttention, SCRATCH)
      .map(node => [node.id, node.hasActiveSchedule])).toEqual(expected)
    expect(deriveSearchResults(
      sessions, workspaces, 'project', noArchive, noAttention, noContent, 10, SCRATCH,
    ).items.map(node => [node.id, node.hasActiveSchedule])).toEqual(expected)
  })

  it('hides subagent-origin sessions without hiding ordinary forks', () => {
    const parent = summary('parent', 1)
    const subagent = {
      ...summary('subagent', 3), parentId: parent.id, origin: 'subagent' as const, running: true,
    }
    const grandchild = {
      ...summary('grandchild', 4), parentId: subagent.id, origin: 'subagent' as const, running: true,
    }
    const fork = { ...summary('fork', 2), parentId: subagent.id }
    const forkChild = {
      ...summary('fork-child', 5), parentId: fork.id, origin: 'subagent' as const, running: true,
    }
    const sessions = { ...list(parent, fork, subagent, grandchild, forkChild), current: subagent.id }
    const workspaces = [workspace('first', ['parent', 'fork', 'subagent', 'grandchild', 'fork-child'])]
    const groups = deriveGroups(sessions, workspaces, noArchive, noAttention, view(['first']), SCRATCH)

    expect(groups[0]!.sessions.map(node => node.id)).toEqual([parent.id, fork.id])
    expect(groups[0]!.sessionCount).toBe(2)
    expect(groups[0]!.sessions[0]).toMatchObject({ running: false, runningSubagentCount: 2 })
    expect(groups[0]!.sessions[1]).toMatchObject({ running: false, runningSubagentCount: 1 })
    expect(deriveFlat(sessions, workspaces, noArchive, noAttention, SCRATCH)
      .map(node => [node.id, node.runningSubagentCount])).toEqual([
      [fork.id, 1], [parent.id, 2],
    ])
    expect(deriveSearchResults(
      sessions, [workspace('first', ['parent', 'fork'])], 'parent', noArchive,
      noAttention, noContent, 10, SCRATCH,
    ).items[0]).toMatchObject({ id: parent.id, runningSubagentCount: 2 })
  })

  it('ignores fork lineage and sorts every no-directory session as a top-level row', () => {
    const parent = summary('parent', 1)
    const oldChild = { ...summary('old-child', 10), parentId: parent.id }
    const newChild = { ...summary('new-child', 20), parentId: parent.id }
    const tieB = { ...summary('tie-b', 20), parentId: parent.id }
    const tieA = { ...summary('tie-a', 20), parentId: parent.id }
    const self = { ...summary('self', 2), parentId: sid('self') }
    const orphan = { ...summary('orphan', 3), parentId: sid('missing') }
    const cycleA = { ...summary('cycle-a', 4), parentId: sid('cycle-b') }
    const cycleB = { ...summary('cycle-b', 5), parentId: sid('cycle-a') }
    const groups = deriveGroups(
      list(parent, oldChild, newChild, tieB, tieA, self, orphan, cycleA, cycleB),
      [],
      noArchive,
      noAttention,
      { expandedGroups: [UNGROUPED_KEY] },
      SCRATCH,
    )

    expect(groups).toHaveLength(1)
    expect(groups[0]!.sessions.map(node => node.id)).toEqual([
      newChild.id, tieA.id, tieB.id, oldChild.id,
      cycleB.id, cycleA.id, orphan.id, self.id, parent.id,
    ])

    // Equal timestamps use ids as a deterministic tiebreak in either input order.
    expect(deriveGroups(
      list(summary('tie-a', 1), summary('tie-b', 1)), [], noArchive, noAttention, view([UNGROUPED_KEY]), SCRATCH,
    )[0]!
      .sessions.map(node => node.id)).toEqual([sid('tie-a'), sid('tie-b')])
  })

  it('tolerates Workspace membership arriving before its Session summary', () => {
    const partial: SessionListState = {
      ...list(),
      ids: [sid('present')],
      byId: { [sid('present')]: summary('present', 1) },
    }
    const groups = deriveGroups(
      partial, [workspace('project', ['missing', 'present'])], noArchive, noAttention, view(['project']), SCRATCH,
    )
    expect(groups[0]!.sessions.map(node => node.id)).toEqual([sid('present')])
  })

  it('hides archived sessions from workspace groups and the no-directory bucket', () => {
    const kept = summary('kept', 1, '/projects/first')
    const gone = summary('gone', 2, '/projects/first')
    const taskGone = summary('task-gone', 3, SCRATCH)
    const sessions = list(kept, gone, taskGone)
    const groups = deriveGroups(
      sessions, [workspace('first', ['kept', 'gone'])], archived('gone', 'task-gone'),
      noAttention, view(['first', UNGROUPED_KEY]), SCRATCH,
    )
    // The archived member drops from its group AND the archived task never
    // surfaces the no-directory bucket; counts follow the visible rows.
    expect(groups.map(group => group.key)).toEqual(['first'])
    expect(groups[0]!.sessions.map(node => node.id)).toEqual([kept.id])
    expect(groups[0]!.sessionCount).toBe(1)
  })

  it('marks selected Workspace and no-directory sessions without relying on an Intent', () => {
    const owned = summary('owned', 1)
    const loose = summary('loose', 2)
    const ws = workspace('project', ['owned'])
    const ownedGroups = deriveGroups(
      { ...list(owned, loose), current: owned.id }, [ws], noArchive, noAttention, view(), SCRATCH,
    )
    expect(ownedGroups.find(group => group.key === 'project')!.containsCurrent).toBe(true)
    const looseGroups = deriveGroups(
      { ...list(owned, loose), current: loose.id }, [ws], noArchive, noAttention, view(), SCRATCH,
    )
    expect(looseGroups.find(group => group.key === UNGROUPED_KEY)!.containsCurrent).toBe(true)
  })
})

describe('currentGroupKey / isNoDirectorySession', () => {
  it('resolves the Workspace, the no-directory bucket, or nothing for an unlisted current', () => {
    const owned = summary('owned', 1, '/projects/project')
    const task = summary('task', 2, SCRATCH)
    const orphan = summary('orphan', 3, '/projects/deleted')
    const ws = workspace('project', ['owned'])
    const sessions = list(owned, task, orphan)
    expect(currentGroupKey({ ...sessions, current: owned.id }, [ws], SCRATCH)).toBe('project')
    expect(currentGroupKey({ ...sessions, current: task.id }, [ws], SCRATCH)).toBe(UNGROUPED_KEY)
    expect(currentGroupKey({ ...sessions, current: orphan.id }, [ws], SCRATCH)).toBeUndefined()
    expect(currentGroupKey({ ...sessions, current: task.id }, [ws], undefined)).toBeUndefined()
    expect(currentGroupKey(sessions, [ws], SCRATCH)).toBeUndefined()
  })

  it('never treats an accounted Session as a no-directory task even in the scratch cwd', () => {
    const accounted = new Set([sid('member')])
    expect(isNoDirectorySession(summary('member', 1, SCRATCH), accounted, SCRATCH)).toBe(false)
    expect(isNoDirectorySession(summary('task', 1, SCRATCH), accounted, SCRATCH)).toBe(true)
    expect(isNoDirectorySession(summary('elsewhere', 1, '/other'), accounted, SCRATCH)).toBe(false)
  })
})

describe('deriveFlat', () => {
  it('flattens every listed session — fork children included — newest-first with id tiebreak', () => {
    const parent = summary('parent', 10)
    const child = { ...summary('child', 30), parentId: parent.id }
    const tieB = summary('tie-b', 20)
    const tieA = summary('tie-a', 20)
    const rows = deriveFlat(list(parent, child, tieB, tieA), [], noArchive, noAttention, SCRATCH)
    expect(rows.map(row => row.id)).toEqual([sid('child'), sid('tie-a'), sid('tie-b'), sid('parent')])
  })

  it('hides members of unregistered Workspaces in flat mode too', () => {
    const member = summary('member', 3, '/projects/first')
    const task = summary('task', 2, SCRATCH)
    const orphan = summary('orphan', 1, '/projects/deleted')
    const rows = deriveFlat(list(member, task, orphan), [workspace('first', ['member'])], noArchive, noAttention, SCRATCH)
    expect(rows.map(row => row.id)).toEqual([member.id, task.id])
  })

  it('hides subagent-origin rows but keeps ordinary forks', () => {
    const parent = summary('parent', 1)
    const fork = { ...summary('fork', 2), parentId: parent.id }
    const subagent = { ...summary('subagent', 3), parentId: parent.id, origin: 'subagent' as const }
    const rows = deriveFlat(
      { ...list(parent, fork, subagent), current: subagent.id },
      [],
      noArchive,
      noAttention,
      SCRATCH,
    )
    expect(rows.map(row => row.id)).toEqual([fork.id, parent.id])
  })

  it('tolerates ids whose summary has not landed yet', () => {
    const partial: SessionListState = { ...list(summary('present', 1)), ids: [sid('ghost'), sid('present')] }
    expect(deriveFlat(partial, [], noArchive, noAttention, SCRATCH).map(row => row.id)).toEqual([sid('present')])
  })

  it('shows only the current blank session and excludes blanks from search', () => {
    const currentBlank = { ...summary('current-blank', 9), blank: true }
    const staleBlank = { ...summary('stale-blank', 8), blank: true }
    const sessions = {
      ...list(summary('real', 1), currentBlank, staleBlank),
      current: currentBlank.id,
    }
    const rows = deriveFlat(sessions, [], noArchive, noAttention, SCRATCH)
    expect(rows.map(row => row.id)).toEqual([currentBlank.id, sid('real')])
    expect(rows.map(row => row.title)).toEqual(['', 'real'])
    expect(rows.map(row => row.blank)).toEqual([true, false])
  })

  it('hides archived sessions in flat mode', () => {
    const kept = summary('kept', 1)
    const gone = summary('gone', 2)
    expect(deriveFlat(list(kept, gone), [], archived('gone'), noAttention, SCRATCH).map(row => row.id))
      .toEqual([kept.id])
  })
})

describe('deriveArchived', () => {
  it('lists archived members and tasks, hides archived orphans, keeps summary-less placeholders', () => {
    const member = summary('member', 3, '/projects/first')
    const task = summary('task', 2, SCRATCH)
    const orphan = summary('orphan', 1, '/projects/deleted')
    const rows = deriveArchived(
      list(member, task, orphan),
      [workspace('first', ['member'])],
      archived('member', 'task', 'orphan', 'ghost'),
      SCRATCH,
      'Missing',
    )
    expect(rows.map(row => [row.id, row.title])).toEqual([
      [member.id, 'member'], [task.id, 'task'], [sid('ghost'), 'Missing'],
    ])
  })
})

describe('deriveSearchResults archive filtering', () => {
  it('archived sessions never match — not by title and not via a backend content hit', () => {
    const hit = summary('hit', 2)
    hit.displayTitle = 'Needle row'
    const gone = summary('gone', 1)
    gone.displayTitle = 'Needle archived'
    const result = deriveSearchResults(
      list(hit, gone),
      [],
      'needle',
      archived('gone'),
      noAttention,
      { items: [{ sessionId: gone.id, snippet: 'needle body' }], hasMore: false },
      10,
      SCRATCH,
    )
    expect(result.items.map(item => item.id)).toEqual([hit.id])
  })

  it('members of unregistered Workspaces never match — not by title and not via a content hit', () => {
    const orphan = summary('orphan', 1, '/projects/deleted')
    orphan.displayTitle = 'Needle orphan'
    const result = deriveSearchResults(
      list(orphan),
      [],
      'needle',
      noArchive,
      noAttention,
      { items: [{ sessionId: orphan.id, snippet: 'needle body' }], hasMore: false },
      10,
      SCRATCH,
    )
    expect(result.items).toEqual([])
  })
})

describe('deriveSearchResults', () => {
  it('merges local title/Workspace matches before ranked content hits and enriches duplicates', () => {
    const titleHit = summary('title-hit', 30, '/projects/a')
    titleHit.displayTitle = 'Needle title'
    const workspaceHit = summary('workspace-hit', 20, '/projects/b')
    workspaceHit.displayTitle = 'Ordinary title'
    const contentHit = summary('content-hit', 10, SCRATCH)
    const sessions = list(titleHit, workspaceHit, contentHit)
    const result = deriveSearchResults(
      sessions,
      [
        workspace('a', ['title-hit'], 'Alpha'),
        workspace('b', ['workspace-hit'], 'Needle Workspace'),
        workspace('duplicate-owner', ['title-hit'], 'Ignored duplicate owner'),
      ],
      ' NEEDLE ',
      noArchive,
      new Map([[titleHit.id, {
        key: 'question:1', kind: 'plan-review', sessionId: titleHit.id,
      }]]),
      {
        items: [
          { sessionId: contentHit.id, snippet: 'body needle excerpt' },
          { sessionId: contentHit.id, snippet: 'ignored duplicate excerpt' },
          { sessionId: titleHit.id, snippet: 'title session body excerpt' },
          { sessionId: sid('unknown'), snippet: 'not in session.list' },
        ],
        hasMore: false,
      },
      10,
      SCRATCH,
    )

    expect(result).toEqual({
      items: [
        {
          id: titleHit.id,
          title: 'Needle title',
          workspace: 'Alpha',
          running: false,
          runningSubagentCount: 0,
          pendingInteraction: 'plan-review',
          completed: false,
          hasActiveSchedule: false,
          snippet: 'title session body excerpt',
        },
        {
          id: workspaceHit.id,
          title: 'Ordinary title',
          workspace: 'Needle Workspace',
          running: false,
          runningSubagentCount: 0,
          completed: false,
          hasActiveSchedule: false,
        },
        {
          id: contentHit.id,
          title: 'content-hit',
          // A no-directory task names no folder; the renderer substitutes the
          // localized bucket label for the empty column.
          workspace: '',
          running: false,
          runningSubagentCount: 0,
          completed: false,
          hasActiveSchedule: false,
          snippet: 'body needle excerpt',
        },
      ],
      hasMore: false,
    })
  })

  it('excludes blank sessions from search regardless of query or content hits', () => {
    const currentBlank = { ...summary('opaque-current', 5), blank: true }
    const staleBlank = { ...summary('new session stale', 4), blank: true }
    const sessions = {
      ...list(currentBlank, staleBlank),
      current: currentBlank.id,
    }
    // Blank placeholders never match — not their localized-display title, not
    // their id, and not even a backend content hit naming them.
    const result = deriveSearchResults(
      sessions,
      [workspace('first', ['opaque-current', 'new session stale'])],
      'new session',
      noArchive,
      noAttention,
      {
        items: [
          { sessionId: staleBlank.id, snippet: 'stale body' },
          { sessionId: currentBlank.id, snippet: 'current body' },
        ],
        hasMore: false,
      },
      10,
      SCRATCH,
    )
    expect(result.items).toEqual([])
  })

  it('uses the supplied cap and preserves either local overflow or backend hasMore', () => {
    const rows = Array.from({ length: 5 }, (_, index) => {
      const item = summary(`s-${String(index).padStart(2, '0')}`, index)
      item.displayTitle = `Needle ${String(index)}`
      return item
    })
    const overflow = deriveSearchResults(
      list(...rows),
      [],
      'needle',
      noArchive,
      noAttention,
      noContent,
      3,
      SCRATCH,
    )
    expect(overflow.items).toHaveLength(3)
    expect(overflow.hasMore).toBe(true)

    const backendMore = deriveSearchResults(
      list(summary('body', 1)),
      [],
      'needle',
      noArchive,
      noAttention,
      { items: [{ sessionId: sid('body'), snippet: 'needle' }], hasMore: true },
      3,
      SCRATCH,
    )
    expect(backendMore.items).toHaveLength(1)
    expect(backendMore.hasMore).toBe(true)
    expect(deriveSearchResults(list(), [], '  ', noArchive, noAttention, { items: [], hasMore: true }, 3, SCRATCH))
      .toEqual({ items: [], hasMore: false })
  })
})

describe('createWorkspaceViewStore', () => {
  it('stores grouping, ordering, Workspace expansion, and recent-session view order', () => {
    const store = createWorkspaceViewStore().create()
    expect(store.getSnapshot().groupBy).toBe('workspace')
    expect(store.getSnapshot().orderBy).toBe('updated')
    store.actions.setGroupBy('flat')
    store.actions.setOrderBy('updated')
    store.actions.setGroupExpanded('alpha', true)
    store.actions.syncSessionOrderAccount('alpha', ['two', 'one'], { one: 1, two: 2 })
    store.actions.setSessionOrder('alpha', ['one', 'two'])
    expect(store.getSnapshot().groupBy).toBe('flat')
    expect(store.getSnapshot()).toMatchObject({
      orderBy: 'updated',
      groupExpansion: { alpha: true },
      sessionOrderByAccount: { alpha: ['one', 'two'] },
      sessionUpdatedAtByAccount: { alpha: { one: 1, two: 2 } },
    })
  })

  it('removes view state outside the retained Workspace key set', () => {
    const store = createWorkspaceViewStore().create()
    store.actions.setGroupExpanded('', true)
    store.actions.setGroupExpanded('alpha', true)
    store.actions.setGroupExpanded('deleted', true)
    store.actions.syncSessionOrderAccount('alpha', ['alpha-session'], { 'alpha-session': 2 })
    store.actions.syncSessionOrderAccount('deleted', ['deleted-session'], { 'deleted-session': 1 })

    store.actions.retainAccountKeys(['', 'alpha'])

    const snapshot = store.getSnapshot()
    expect(snapshot.groupExpansion).toEqual({ '': true, alpha: true })
    expect(snapshot.sessionOrderByAccount).toEqual({ alpha: ['alpha-session'] })
    expect(snapshot.sessionUpdatedAtByAccount).toEqual({ alpha: { 'alpha-session': 2 } })
  })
})

describe('workspaceLabel', () => {
  it('uses the empty fallback and extracts POSIX and Windows basenames', () => {
    expect(workspaceLabel(undefined)).toBe('')
    expect(workspaceLabel('')).toBe('')
    expect(workspaceLabel('/projects/demo/')).toBe('demo')
    expect(workspaceLabel('C:\\projects\\demo\\')).toBe('demo')
    expect(workspaceLabel('/')).toBe('/')
  })
})
