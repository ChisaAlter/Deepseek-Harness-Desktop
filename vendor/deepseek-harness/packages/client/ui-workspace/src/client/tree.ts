/**
 * Derives the workspace browser tree from Host Workspace order and membership.
 * Only two kinds of Session are listed: members of a registered Workspace, and
 * no-directory tasks living in the Host scratch cwd (they trail under the
 * "No workspace folder" section). Any other unaccounted Session belongs to a
 * Workspace that is not registered right now — deleting a registration hides
 * its Sessions, registering the same directory again brings them back — so it
 * appears nowhere: not grouped, not in the flat list, not in search, not in
 * Archived. Only the selected blank Session remains visible.
 */
import {
  type SessionListState, type SessionSearchResultItem, type SessionSummary,
} from '@deepseek-ai/dsh-api-session-controller/client'
import type { WorkspaceId, WorkspaceView } from '@deepseek-ai/dsh-api-workspace-controller/client'
import type {
  SessionPendingInteractionBase,
} from '@deepseek-ai/dsh-client-ui-session/client'
import type {} from '@deepseek-ai/dsh-schedule/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { workspaceTitleOf } from '@deepseek-ai/dsh-util-workspace-path'
import {
  indexSubagentDescendants, type SubagentDescendantSummary,
} from './subagent-lineage.ts'

/** Group key for no-directory Sessions (the Host scratch cwd bucket). */
export const UNGROUPED_KEY = ''

/**
 * Whether a Session is a no-directory task: no Workspace accounts it and it
 * runs in the Host scratch cwd. Until the Workspace baseline supplies that cwd
 * nothing qualifies.
 * @param session - list summary.
 * @param accounted - ids every registered Workspace accounts.
 * @param scratchCwd - Host scratch cwd from the Workspace baseline.
 * @returns true for a listable no-directory Session.
 */
export function isNoDirectorySession(
  session: SessionSummary,
  accounted: ReadonlySet<SessionId>,
  scratchCwd: string | undefined,
): boolean {
  return scratchCwd !== undefined && session.cwd === scratchCwd && !accounted.has(session.id)
}

/** Ids accounted by the registered Workspaces (membership, never cwd). */
function accountedIds(workspaces: readonly WorkspaceView[]): Set<SessionId> {
  const accounted = new Set<SessionId>()
  for (const workspace of workspaces) {
    for (const id of workspace.sessionIds) accounted.add(id)
  }
  return accounted
}

/** A Session the browser may list at all: Workspace member or no-directory task. */
function listed(session: SessionSummary, accounted: ReadonlySet<SessionId>, scratchCwd: string | undefined): boolean {
  return accounted.has(session.id) || isNoDirectorySession(session, accounted, scratchCwd)
}

/** Pending interaction kinds with dedicated Workspace-row presentation. */
export type SessionPendingInteractionStatus = 'approval' | 'plan-review' | 'question'
type SessionPendingInteractions = ReadonlyMap<SessionId, SessionPendingInteractionBase>

/** One top-level session row in a group or the flat list. */
export interface SessionNode {
  id: SessionId
  /** Stored display title; the renderer substitutes the localized New Session label for blank rows. */
  title: string
  /** The provisional blank session (renderer shows the localized New Session title). */
  blank: boolean
  /** A Session-scoped UI consumer is awaiting this user. */
  pendingInteraction?: SessionPendingInteractionStatus
  running: boolean
  /** Running descendants connected through uninterrupted subagent-origin lineage. */
  runningSubagentCount: number
  /** Finished running while not selected and not yet opened (the green "done" reminder dot). */
  completed: boolean
  /** The current list projection contains at least one active Schedule record. */
  hasActiveSchedule: boolean
  updatedAt: number
}

/** Session order selected by the Workspace browser. */
export type SessionOrderBy = 'manual' | 'updated'

/** One workspace group section: header row facts + visible top-level session rows. */
export interface GroupNode {
  /** Group key: the workspace id or {@link UNGROUPED_KEY}. */
  key: string
  /** Backing Workspace id; absent only for the no-directory bucket. */
  workspaceId: WorkspaceId | undefined
  cwd: string | undefined
  /** Workspace creation time (epoch ms); absent only for the no-directory bucket. */
  createdAt: number | undefined
  label: string
  /** Total visible sessions in the group. */
  sessionCount: number
  expanded: boolean
  /** The group contains the selected session (active folder tint; supplied here so the renderer never scans). */
  containsCurrent: boolean
  /** Visible session rows (empty while the group is folded). */
  sessions: readonly SessionNode[]
}

/** One flat search row combining list metadata with an optional content match. */
export interface SearchResultNode {
  id: SessionId
  title: string
  workspace: string
  /** A Session-scoped UI consumer is awaiting this user. */
  pendingInteraction?: SessionPendingInteractionStatus
  running: boolean
  /** Running descendants connected through uninterrupted subagent-origin lineage. */
  runningSubagentCount: number
  /** Finished running while not selected and not yet opened (the green "done" reminder dot). */
  completed: boolean
  /** The current list projection contains at least one active Schedule record. */
  hasActiveSchedule: boolean
  snippet?: string
}

/** Bounded merged search projection plus the refine-query hint bit. */
export interface SearchResultSet {
  items: readonly SearchResultNode[]
  hasMore: boolean
}

/** Viewing state consumed by the derivation. */
export interface TreeView {
  expandedGroups: readonly string[]
  /** Browser-local order for no-directory Sessions (no Host account to write). */
  ungroupedOrder?: readonly string[]
}

interface Group {
  key: string
  workspaceId: WorkspaceId | undefined
  cwd: string | undefined
  createdAt: number | undefined
  label: string
  sessions: SessionSummary[]
}

/**
 * Directory display label: basename of the path (both separators accepted).
 * Ungrouped-bucket fallback for surfaces without a workspace title.
 * @param cwd - directory path, or undefined for the ungrouped bucket.
 * @returns basename, the raw cwd when it has no basename, or an empty ungrouped marker.
 */
export function workspaceLabel(cwd: string | undefined): string {
  if (cwd === undefined || cwd === '') return ''
  const base = workspaceTitleOf(cwd)
  return base !== '' ? base : cwd
}

/** Recency comparator: newest first, id as the deterministic tiebreak (ids are unique per group). */
function byRecency(a: SessionSummary, b: SessionSummary): number {
  if (b.updatedAt !== a.updatedAt) return b.updatedAt - a.updatedAt
  return a.id < b.id ? -1 : 1
}

/**
 * Ordinary sessions are visible; among blank sessions, only the current one
 * is visible. Subagent children use their parent header catalog; archived
 * sessions are visible nowhere, while their accounting slots remain so
 * unarchiving restores position.
 */
function sessionVisible(session: SessionSummary, current: SessionId | undefined, archived: ReadonlySet<SessionId>): boolean {
  return session.origin !== 'subagent'
    && !archived.has(session.id)
    && (!session.blank || session.id === current)
}

/**
 * A blank session is the selected Workspace's provisional New Session row;
 * its canonical title never enters search (blank rows are query-excluded)
 * and the renderer localizes its display label.
 */
function sessionTitle(session: SessionSummary): string {
  return session.blank ? '' : session.displayTitle
}

/** The list projection alone owns the best-effort active-Schedule indicator. */
function hasActiveSchedule(session: SessionSummary): boolean {
  return (session.projectionValues?.schedule?.length ?? 0) > 0
}

/** Build one group without projecting session lineage into presentation. */
function buildGroup(
  key: string,
  workspaceId: WorkspaceId | undefined,
  cwd: string | undefined,
  createdAt: number | undefined,
  label: string,
  members: readonly SessionSummary[],
  order: 'account' | 'recency',
): Group {
  const sessions = [...members]
  // Real Workspace order comes from sessionIds. Ungrouped falls back to
  // recency until the browser supplies its persisted local order.
  if (order === 'recency') sessions.sort(byRecency)
  return { key, workspaceId, cwd, createdAt, label, sessions }
}

/** Apply a stored Ungrouped order and append newly loose Sessions by recency. */
function orderedUngrouped(members: readonly SessionSummary[], stored: readonly string[]): SessionSummary[] {
  const byId = new Map(members.map(session => [session.id as string, session]))
  const included = new Set<string>()
  const ordered: SessionSummary[] = []
  for (const key of stored) {
    const session = byId.get(key)
    if (session === undefined || included.has(key)) continue
    ordered.push(session)
    included.add(key)
  }
  for (const session of [...members].sort(byRecency)) {
    if (included.has(session.id)) continue
    ordered.push(session)
  }
  return ordered
}

/**
 * Group Sessions by Host Workspace: one group per entity in stable Host
 * order, with members resolved from sessionIds in their stored order.
 * No-directory Sessions trail in the browser-local bucket order, which falls
 * back to recency before that order is initialized. Unaccounted Sessions in
 * any other cwd are not listed.
 */
function groupByWorkspace(
  list: SessionListState,
  workspaces: readonly WorkspaceView[],
  archived: ReadonlySet<SessionId>,
  ungroupedOrder: readonly string[] | undefined,
  scratchCwd: string | undefined,
): Group[] {
  const groups: Group[] = []
  const accounted = accountedIds(workspaces)
  for (const workspace of workspaces) {
    const members: SessionSummary[] = []
    for (const id of workspace.sessionIds) {
      const summary = list.byId[id]
      if (summary === undefined) continue // account may lead the list pull; the row appears when the summary lands
      if (!sessionVisible(summary, list.current, archived)) continue
      members.push(summary)
    }
    groups.push(buildGroup(
      workspace.workspaceId, workspace.workspaceId, workspace.path,
      Date.parse(workspace.createdAt), workspace.title, members, 'account',
    ))
  }
  const stray = list.ids
    .map(id => list.byId[id])
    .filter((s): s is SessionSummary =>
      s !== undefined && isNoDirectorySession(s, accounted, scratchCwd) && sessionVisible(s, list.current, archived))
  if (stray.length > 0) {
    groups.push(buildGroup(
      UNGROUPED_KEY,
      undefined,
      undefined,
      undefined,
      '',
      ungroupedOrder === undefined ? stray : orderedUngrouped(stray, ungroupedOrder),
      ungroupedOrder === undefined ? 'recency' : 'account',
    ))
  }
  return groups
}

/**
 * Group key holding the current Session: its Workspace id, {@link UNGROUPED_KEY}
 * for a no-directory task, undefined when nothing is selected or the current
 * Session is not listed (member of an unregistered Workspace).
 * @param list - sessions list snapshot.
 * @param workspaces - real workspaces.
 * @param scratchCwd - Host scratch cwd from the Workspace baseline.
 * @returns the account key, or undefined.
 */
export function currentGroupKey(
  list: SessionListState,
  workspaces: readonly WorkspaceView[],
  scratchCwd: string | undefined,
): string | undefined {
  const current = list.current
  if (current === undefined) return undefined
  const owner = workspaces.find(w => w.sessionIds.includes(current))
  if (owner !== undefined) return owner.workspaceId
  const summary = list.byId[current]
  return summary !== undefined && isNoDirectorySession(summary, accountedIds(workspaces), scratchCwd)
    ? UNGROUPED_KEY
    : undefined
}

/** Keep navigation presentation independent from domain-owned interaction objects. */
function visiblePendingKind(kind: string | undefined): SessionPendingInteractionStatus | undefined {
  switch (kind) {
    case 'approval':
    case 'plan-review':
    case 'question':
      return kind
    default:
      return undefined
  }
}

function sessionNode(
  s: SessionSummary,
  descendants: ReadonlyMap<SessionId, SubagentDescendantSummary>,
  pendingInteractions: SessionPendingInteractions,
): SessionNode {
  const pendingInteraction = visiblePendingKind(pendingInteractions.get(s.id)?.kind)
  return {
    id: s.id,
    title: sessionTitle(s),
    blank: s.blank,
    running: s.running,
    runningSubagentCount: descendants.get(s.id)?.runningCount ?? 0,
    completed: s.completed === true,
    hasActiveSchedule: hasActiveSchedule(s),
    updatedAt: s.updatedAt,
    ...(pendingInteraction === undefined ? {} : { pendingInteraction }),
  }
}

/**
 * Derive the workspace browser groups with every session as a top-level row.
 *
 * Every group shows; sessions populate under expanded groups in the selected
 * local order. Blank sessions are excluded except for the selected
 * provisional New Session row; archived sessions are excluded everywhere.
 * Content search lives outside this derivation
 * (see {@link deriveSearchResults}).
 * @param list - sessions list snapshot (`current` feeds containsCurrent).
 * @param workspaces - real workspaces in stable Host order.
 * @param archivedSessionIds - registry-global archive set.
 * @param pendingInteractions - pending UI interactions by Session.
 * @param view - local expansion arrays.
 * @param scratchCwd - Host scratch cwd (Workspace baseline); gates the no-directory bucket.
 * @returns group sections in render order.
 */
export function deriveGroups(
  list: SessionListState,
  workspaces: readonly WorkspaceView[],
  archivedSessionIds: readonly SessionId[],
  pendingInteractions: SessionPendingInteractions,
  view: TreeView,
  scratchCwd: string | undefined,
): GroupNode[] {
  const archived = new Set(archivedSessionIds)
  const expandedGroups = new Set(view.expandedGroups)
  const descendants = indexSubagentDescendants(list.byId)
  const currentGroup = currentGroupKey(list, workspaces, scratchCwd)
  const groups: GroupNode[] = []
  for (const g of groupByWorkspace(list, workspaces, archived, view.ungroupedOrder, scratchCwd)) {
    const expanded = expandedGroups.has(g.key)
    groups.push({
      key: g.key,
      workspaceId: g.workspaceId,
      cwd: g.cwd,
      createdAt: g.createdAt,
      label: g.label,
      sessionCount: g.sessions.length,
      expanded,
      containsCurrent: g.key === currentGroup,
      sessions: expanded
        ? g.sessions.map(session => sessionNode(session, descendants, pendingInteractions))
        : [],
    })
  }
  return groups
}

/**
 * Derive the flat session list ("In one list" mode): every session — fork
 * children included — as a top-level row, strictly newest-first. No grouping,
 * no parent/child adjacency. Content search lives outside this derivation
 * (see {@link deriveSearchResults}).
 * @param list - sessions list snapshot.
 * @param workspaces - real workspaces (membership decides what is listed).
 * @param archivedSessionIds - registry-global archive set.
 * @param pendingInteractions - pending UI interactions by Session.
 * @param scratchCwd - Host scratch cwd from the Workspace baseline.
 * @returns flat rows in render order.
 */
export function deriveFlat(
  list: SessionListState,
  workspaces: readonly WorkspaceView[],
  archivedSessionIds: readonly SessionId[],
  pendingInteractions: SessionPendingInteractions,
  scratchCwd: string | undefined,
): SessionNode[] {
  const archived = new Set(archivedSessionIds)
  const accounted = accountedIds(workspaces)
  const descendants = indexSubagentDescendants(list.byId)
  const rows: SessionSummary[] = []
  for (const id of list.ids) {
    const s = list.byId[id]
    if (s === undefined || !listed(s, accounted, scratchCwd) || !sessionVisible(s, list.current, archived)) continue
    rows.push(s)
  }
  rows.sort(byRecency)
  return rows.map(session => sessionNode(session, descendants, pendingInteractions))
}

/**
 * Derive archived session rows in registry-set order. Subagent-origin ids are
 * skipped, as are archived members of unregistered Workspaces (they come back
 * with the directory). Ids with no summary become non-blank placeholders so
 * Unarchive / Delete stay reachable (Host prune removes true ghosts on list).
 * @param list - session list snapshot.
 * @param workspaces - real workspaces (membership decides what is listed).
 * @param archivedSessionIds - registry-global archive set.
 * @param scratchCwd - Host scratch cwd from the Workspace baseline.
 * @param missingTitle - localized title for summary-less archive rows.
 * @returns archived rows in set order.
 */
export function deriveArchived(
  list: SessionListState,
  workspaces: readonly WorkspaceView[],
  archivedSessionIds: readonly SessionId[],
  scratchCwd: string | undefined,
  missingTitle = 'Missing session',
): SessionNode[] {
  const descendants = indexSubagentDescendants(list.byId)
  const accounted = accountedIds(workspaces)
  const pendingInteractions: SessionPendingInteractions = new Map()
  const rows: SessionSummary[] = []
  for (const id of archivedSessionIds) {
    const s = list.byId[id]
    if (s?.origin === 'subagent') continue
    if (s === undefined) {
      rows.push({
        id,
        displayTitle: missingTitle,
        running: false,
        blank: false,
        updatedAt: 0,
      })
      continue
    }
    if (!listed(s, accounted, scratchCwd)) continue
    rows.push(s)
  }
  return rows.map(session => sessionNode(session, descendants, pendingInteractions))
}

/**
 * Merge immediate title/Workspace substring matches with ranked Host content
 * matches. Local rows lead newest-first, content-only rows retain backend
 * order, and duplicate sessions receive the backend snippet in place.
 * @param list - session metadata authority.
 * @param workspaces - Workspace membership and display labels.
 * @param query - caller text; surrounding whitespace is ignored.
 * @param archivedSessionIds - registry-global archive set (members never match).
 * @param pendingInteractions - pending UI interactions by Session.
 * @param content - ranked Host content-search page.
 * @param limit - protocol-owned maximum merged row count.
 * @param scratchCwd - Host scratch cwd from the Workspace baseline.
 * @returns bounded deduplicated flat rows and a refine-query hint bit.
 */
export function deriveSearchResults(
  list: SessionListState,
  workspaces: readonly WorkspaceView[],
  query: string,
  archivedSessionIds: readonly SessionId[],
  pendingInteractions: SessionPendingInteractions,
  content: { items: readonly SessionSearchResultItem[]; hasMore: boolean },
  limit: number,
  scratchCwd: string | undefined,
): SearchResultSet {
  const q = query.trim().toLowerCase()
  if (q === '') return { items: [], hasMore: false }
  const archived = new Set(archivedSessionIds)
  const accounted = accountedIds(workspaces)
  const descendants = indexSubagentDescendants(list.byId)

  const workspaceBySession = new Map<SessionId, string>()
  for (const workspace of workspaces) {
    for (const sessionId of workspace.sessionIds) {
      if (!workspaceBySession.has(sessionId)) workspaceBySession.set(sessionId, workspace.title)
    }
  }
  // A no-directory task has no folder to name: its workspace column stays
  // empty and the renderer substitutes the localized bucket label.
  const labelOf = (summary: SessionSummary): string => workspaceBySession.get(summary.id) ?? ''
  const contentBySession = new Map<SessionId, SessionSearchResultItem>()
  for (const item of content.items) {
    if (!contentBySession.has(item.sessionId)) contentBySession.set(item.sessionId, item)
  }
  const searchable = (summary: SessionSummary | undefined): summary is SessionSummary =>
    // Blank placeholders never match a query (their canonical title displays
    // localized, so matching it would tie search to one language).
    summary !== undefined && !summary.blank
    && listed(summary, accounted, scratchCwd)
    && sessionVisible(summary, list.current, archived)

  const local: SessionSummary[] = []
  for (const id of list.ids) {
    const summary = list.byId[id]
    if (!searchable(summary)) continue
    if (
      sessionTitle(summary).toLowerCase().includes(q)
      || labelOf(summary).toLowerCase().includes(q)
    ) {
      local.push(summary)
    }
  }
  local.sort(byRecency)

  const ordered: SessionSummary[] = []
  const included = new Set<SessionId>()
  const include = (summary: SessionSummary): void => {
    if (included.has(summary.id)) return
    included.add(summary.id)
    ordered.push(summary)
  }
  for (const summary of local) include(summary)
  for (const item of content.items) {
    const summary = list.byId[item.sessionId]
    if (searchable(summary)) include(summary)
  }

  return {
    items: ordered.slice(0, limit).map((summary) => {
      const match = contentBySession.get(summary.id)
      const pendingInteraction = visiblePendingKind(pendingInteractions.get(summary.id)?.kind)
      return {
        id: summary.id,
        title: sessionTitle(summary),
        workspace: labelOf(summary),
        running: summary.running,
        runningSubagentCount: descendants.get(summary.id)?.runningCount ?? 0,
        ...(pendingInteraction === undefined
          ? {}
          : { pendingInteraction }),
        completed: summary.completed === true,
        hasActiveSchedule: hasActiveSchedule(summary),
        ...match === undefined ? {} : { snippet: match.snippet },
      }
    }),
    hasMore: content.hasMore || ordered.length > limit,
  }
}
