/**
 * The workspace/session browsing region filling the sidebar shell's
 * `sidebar.workspaces` hole: section header (title + view options + add
 * workspace), search, the grouped tree or flat list, and the workspace
 * dialogs. Wide state renders the full browser; rail state renders the two
 * region icons (search / add workspace) as 36px controls on the shell's shared
 * rail entry path, each requesting expansion through the owner share. Adding
 * is the header button's one action, so it raises the directory flow with no
 * menu in between; the flow and its error dialog live in WorkspacePicker
 * (same package — direct composition, no slot between them).
 */
import { type CSSProperties, type ReactNode, useEffect, useMemo, useRef, useState } from 'react'
import clsx from 'clsx'
import {
  Button, IconCloseFill14, IconPersonalizationOutline16,
  IconProjectAddOutline16, IconSearchOutline16, Menu, Modal, Tooltip,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { SessionSearchResultItem } from '@deepseek-ai/dsh-api-session-controller/client'
import type { WorkspaceId, WorkspaceView } from '@deepseek-ai/dsh-api-workspace-controller/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { WorkspaceBrowserProps } from '../contract/slots.ts'
import type { GroupNode, SessionNode, SessionOrderBy } from '../tree.ts'
import {
  currentGroupKey, deriveArchived, deriveFlat, deriveGroups, deriveSearchResults, isNoDirectorySession,
  orderByRecency, owningGroupKey, owningParentFolder, pinCurrentBlank, reconcileManualOrder,
  UNGROUPED_KEY, visibleSessionIds,
} from '../tree.ts'
import {
  ArchivedSectionHeader, ArchivedSessionNodeItem, GroupSessionRun, ProjectRowItem,
  SearchResultItem, SessionNodeItem, TasksSectionHeader,
} from './Rows.tsx'
import { FLAT_SESSION_ORDER_KEY, type SessionGroupBy } from '../stores.ts'
import { WorkspacePickFlow } from '../WorkspacePicker.tsx'
import css from './WorkspaceBrowser.module.css'

/**
 * Column slide length (--ds-transition-duration-slow): rail-search focus waits it out —
 * focus() forces a synchronous layout and would jank the slide.
 */
const EXPAND_SLIDE_MS = 300
/** Pause between the latest keystroke and a Host content-search request. */
const SEARCH_DEBOUNCE_MS = 250
/** `session.search` wire bound, measured in JavaScript UTF-16 code units. */
const SEARCH_QUERY_MAX_CODE_UNITS = 500
/** Session rows visible per Workspace before the local overflow control. */
const COLLAPSED_SESSION_LIMIT = 5

/** Fold one Workspace without charging its provisional New Session against the ordinary-row limit. */
function collapsedSessionRows(sessions: readonly SessionNode[]): {
  rows: readonly SessionNode[]
  hiddenCount: number
} {
  let ordinaryCount = 0
  const rows = sessions.filter((session) => {
    if (session.blank) return true
    if (ordinaryCount >= COLLAPSED_SESSION_LIMIT) return false
    ordinaryCount += 1
    return true
  })
  return { rows, hiddenCount: sessions.length - rows.length }
}

/** Keep controlled input and RPC payload inside the session.search wire contract. */
function sanitizeSearchQuery(value: string): string {
  const withoutNul = value.replaceAll('\0', '')
  if (withoutNul.length <= SEARCH_QUERY_MAX_CODE_UNITS) return withoutNul
  let end = SEARCH_QUERY_MAX_CODE_UNITS
  const last = withoutNul.charCodeAt(end - 1)
  const next = withoutNul.charCodeAt(end)
  if (last >= 0xD800 && last <= 0xDBFF && next >= 0xDC00 && next <= 0xDFFF) end--
  return withoutNul.slice(0, end)
}


/** Dialog error slot: map known Host delete refusals; other failures pass through. */
function sessionDeleteErrorText(reason: unknown, t: WorkspaceBrowserProps['t']): string {
  if (typeof reason === 'object' && reason !== null && 'code' in reason) {
    const code = (reason as { code: unknown }).code
    if (code === 'session-running') return t('delete.session.running')
    if (code === 'session-not-archived') return t('delete.session.notArchived')
    if (code === 'session-not-found') return t('delete.session.notFound')
    if (code === 'session-live-unowned') return t('delete.session.liveUnowned')
    if (code === 'session-delete-partial') return t('delete.session.partial')
    if (code === 'session-delete-incomplete') return t('delete.session.incomplete')
    if (code === 'session-delete-in-progress') return t('delete.session.inProgress')
  }
  return reason instanceof Error ? reason.message : String(reason)
}

/** Immutable membership toggle for the local expand-all array. */
function toggled(list: readonly string[], key: string): string[] {
  return list.includes(key) ? list.filter(k => k !== key) : [...list, key]
}

/**
 * Accept the native drag at document level while a row drag is active: row
 * hover still owns the insertion marker, and releasing outside the list must
 * not be rendered as a rejected drop before dragend commits that last marker.
 */
function useNativeDragAcceptance(active: boolean): void {
  useEffect(() => {
    if (!active) return
    const acceptDrag = (event: DragEvent): void => {
      event.preventDefault()
      if (event.dataTransfer !== null) event.dataTransfer.dropEffect = 'move'
    }
    const acceptDrop = (event: DragEvent): void => { event.preventDefault() }
    document.addEventListener('dragover', acceptDrag)
    document.addEventListener('drop', acceptDrop)
    return () => {
      document.removeEventListener('dragover', acceptDrag)
      document.removeEventListener('drop', acceptDrop)
    }
  }, [active])
}

/** Grouping and ordering menu; own open state so it resets with the wide chrome. */
function ViewOptionsMenu({ groupBy, orderBy, onGroupPick, onOrderPick, t }: {
  groupBy: SessionGroupBy
  orderBy: SessionOrderBy
  onGroupPick: (mode: SessionGroupBy) => void
  onOrderPick: (mode: SessionOrderBy) => void
  t: WorkspaceBrowserProps['t']
}) {
  const [open, setOpen] = useState(false)
  return (
    <Menu
      open={open}
      onClose={() => { setOpen(false) }}
      items={[
        { type: 'label' as const, id: 'group-by', text: t('groupBy.label') },
        { id: 'workspace', label: t('groupBy.workspace') },
        { id: 'workspace-tree', label: t('groupBy.workspaceTree') },
        { id: 'flat', label: t('groupBy.flat') },
        { type: 'separator' as const, id: 'order-by-separator' },
        { type: 'label' as const, id: 'order-by', text: t('orderBy.label') },
        { id: 'manual', label: t('orderBy.manual') },
        { id: 'updated', label: t('orderBy.updated') },
      ]}
      selectedIds={[groupBy, orderBy]}
      onSelect={(id) => {
        if (id === 'workspace' || id === 'workspace-tree' || id === 'flat') onGroupPick(id)
        else if (id === 'manual' || id === 'updated') onOrderPick(id)
        setOpen(false)
      }}
      align="end"
      dense
      // Portal: the section header clips overflow, so an in-place list would
      // be cut off at the header's bounds.
      portal
      anchor={(
        <Tooltip label={t('viewOptions.label')} side="bottom" delayMs={500}>
          <button
            type="button"
            className={clsx(css.iconButton, css.wide)}
            aria-label={t('viewOptions.label')}
            onClick={() => { setOpen(v => !v) }}
          >
            <IconPersonalizationOutline16 />
          </button>
        </Tooltip>
      )}
    />
  )
}

/** In-flight root-row drag: source identity plus the current insert marker. */
interface DragState {
  /** Workspace id, or {@link UNGROUPED_KEY} for the browser-local loose-session account. */
  accountKey: string
  sessionId: SessionNode['id']
  /** Row the marker sits on and which half (insert above/below it). */
  over: { id: SessionNode['id']; half: 'before' | 'after' } | null
}

/** In-flight Workspace-row drag: source identity plus the current marker. */
interface WorkspaceDragState {
  workspaceId: WorkspaceId
  over: { id: WorkspaceId; half: 'before' | 'after' } | null
}

/** Resolve an insertion side across the Workspace header, descendants, and Sessions. */
function workspaceGroupHalf(e: { clientY: number; currentTarget: HTMLElement }): 'before' | 'after' {
  const rect = e.currentTarget.getBoundingClientRect()
  return e.clientY < rect.top + rect.height / 2 ? 'before' : 'after'
}


function ArchivedSessionSection({
  nodes, currentId, now, expanded, onToggle, onUnarchive, onDelete, t,
}: {
  nodes: readonly SessionNode[]
  currentId: SessionId | undefined
  now: number
  expanded: boolean
  onToggle: () => void
  onUnarchive: (id: SessionNode['id']) => void
  onDelete: (id: SessionNode['id'], title: string) => void
  t: WorkspaceBrowserProps['t']
}) {
  if (nodes.length === 0) return null
  return (
    <div className={css.groupSection}>
      <ArchivedSectionHeader expanded={expanded} onToggle={onToggle} t={t} />
      {expanded && nodes.map(node => (
        <ArchivedSessionNodeItem
          key={node.id}
          node={node}
          currentId={currentId}
          now={now}
          onUnarchive={onUnarchive}
          onDelete={onDelete}
          t={t}
        />
      ))}
    </div>
  )
}

type SessionTreeProps = Pick<
  WorkspaceBrowserProps,
  'useSessions' | 'useSessionStatus' | 'startSession' | 'connectNoDirectory' | 'open' | 'forkSession'
  | 'insertWorkspaceBefore' | 'insertSessionBefore' | 't' | 'usePanelInfo'
> & {
  /** Host account home for POSIX hover-path abbreviation. */
  home?: string | undefined
  /** Real Workspaces in Host group order with browser-projected Session order. */
  workspaces: readonly WorkspaceView[]
  /** Host scratch cwd from the Workspace baseline; gates the no-directory bucket. */
  scratchCwd: string | undefined
  /** Ordered no-directory members, including any pinned blank. */
  ungroupedSessionIds: readonly SessionId[]
  /** Whether the current Workspace stream has a complete Host baseline. */
  workspaceReady: boolean
  /** Nest Workspaces under their nearest registered ancestors. */
  nestWorkspaces: boolean
  /** Explicit persisted group expansion, including descendants in tree mode. */
  groupExpansion: Readonly<Record<string, boolean>>
  /** Persist one Workspace group's expansion. */
  setGroupExpanded: (key: string, expanded: boolean) => void
  /** Apply a drag to one shared order. */
  setSessionOrder: (accountKey: string, order: readonly string[]) => void
  /** Registry-global archive set (hidden rows). */
  archivedSessionIds: readonly SessionNode['id'][]
  /** Open the browser-owned rename dialog for a real Workspace group. */
  onRenameRequest: (workspaceId: WorkspaceId, currentTitle: string) => void
  /** Open the browser-owned delete-confirmation dialog for a real Workspace group. */
  onDeleteRequest: (workspaceId: WorkspaceId, currentTitle: string) => void
  /** Open the browser-owned session rename dialog. */
  onSessionRename: (sessionId: SessionNode['id'], currentTitle: string) => void
  /** Archive a session (row menu action; the row disappears on the state echo). */
  onSessionArchive: (sessionId: SessionNode['id']) => void
  /** Unarchive without opening (archived row menu). */
  onSessionUnarchive: (sessionId: SessionNode['id']) => void
  /** Open the browser-owned delete confirmation for an archived session. */
  onSessionDelete: (sessionId: SessionNode['id'], title: string) => void
  /** Whether the archived section is rendered at all. */
  showArchivedList: boolean
  /** Session-local expand of the archived section. */
  archivedExpanded: boolean
  /** Toggle archived-section expand. */
  onToggleArchived: () => void
  /** One Session chosen from search that must be exposed and scrolled into view. */
  revealSessionId?: SessionId | undefined
  /** Acknowledge that the chosen Session row has been revealed. */
  onSessionRevealed: (sessionId: SessionId) => void
}

/** The scrolling session tree; unmounting drops the sessions subscription and expand-all state. */
function SessionTree({
  useSessions, useSessionStatus, startSession, connectNoDirectory, open, forkSession,
  workspaces, scratchCwd, ungroupedSessionIds, archivedSessionIds,
  workspaceReady, usePanelInfo,
  showArchivedList, archivedExpanded, onToggleArchived,
  onRenameRequest, onDeleteRequest, onSessionRename, onSessionArchive,
  onSessionUnarchive, onSessionDelete,
  insertWorkspaceBefore, insertSessionBefore,
  nestWorkspaces, groupExpansion, setGroupExpanded,
  setSessionOrder, home, t,
  revealSessionId, onSessionRevealed,
}: SessionTreeProps) {
  const panelActive = usePanelInfo(info => info.activePanelId !== null)
  const list = useSessions(s => s)
  const statuses = useSessionStatus(s => s)
  const current = panelActive
    ? undefined
    : Object.values(list.byId).find(session => (session.retainedBy.mainView ?? 0) > 0)?.id
  const revealGroup = revealSessionId === undefined || !workspaceReady
    ? undefined
    : owningGroupKey(workspaces, revealSessionId)
  const [expandedSessionGroups, setExpandedSessionGroups] = useState<string[]>([])
  // Transient drag marker state; the selected mode owns the resulting order.
  const [drag, setDrag] = useState<DragState | null>(null)
  const sessionDropCommitted = useRef(false)
  // Preserve the last visible session run while a group folds so the shared
  // presence wrapper can play its exit transition without the derivation
  // having to keep folded rows in the semantic tree.
  const heldRuns = useRef(new Map<string, { rows: readonly SessionNode[]; hiddenCount: number }>())
  const [workspaceDrag, setWorkspaceDrag] = useState<WorkspaceDragState | null>(null)
  const workspaceDropCommitted = useRef(false)
  const nativeDragActive = drag !== null || workspaceDrag !== null
  useNativeDragAcceptance(nativeDragActive)
  const currentGroup = workspaceReady ? currentGroupKey(list, workspaces, scratchCwd) : undefined
  useEffect(() => {
    if (current === undefined || currentGroup === undefined || Object.hasOwn(groupExpansion, currentGroup)) return
    setGroupExpanded(currentGroup, true)
  }, [current, currentGroup, setGroupExpanded, groupExpansion])
  const parents = useMemo(() => {
    if (!nestWorkspaces) return new Map<string, WorkspaceId | undefined>()
    const keysByPath = new Map(workspaces.map(workspace => [workspace.path, workspace.workspaceId]))
    const paths = [...keysByPath.keys()]
    return new Map<string, WorkspaceId | undefined>(workspaces.map((workspace) => {
      const path = owningParentFolder(workspace.path, paths)
      return [workspace.workspaceId, path === undefined ? undefined : keysByPath.get(path)]
    }))
  }, [nestWorkspaces, workspaces])
  const currentAncestors = useMemo(() => {
    const keys = new Set<string>()
    for (let key = currentGroup === undefined ? undefined : parents.get(currentGroup); key !== undefined; key = parents.get(key)) {
      keys.add(key)
    }
    return keys
  }, [currentGroup, parents])
  const expandedGroups = useMemo(() => {
    const ancestorKeys = new Set<string | undefined>(parents.values())
    return [...workspaces.map(workspace => workspace.workspaceId), UNGROUPED_KEY]
      .filter(key => groupExpansion[key] ?? ancestorKeys.has(key))
  }, [groupExpansion, parents, workspaces])
  const groups = useMemo(
    () => deriveGroups(list, workspaces, archivedSessionIds, statuses, {
      expandedGroups,
      ungroupedOrder: ungroupedSessionIds,
    }, scratchCwd),
    [list, workspaces, archivedSessionIds, statuses, expandedGroups, ungroupedSessionIds, scratchCwd],
  )
  const archivedNodes = useMemo(
    () => deriveArchived(list, workspaces, archivedSessionIds, scratchCwd, t('archived.missingTitle')),
    [list, workspaces, archivedSessionIds, scratchCwd, t],
  )
  useEffect(() => {
    for (let key = revealGroup; key !== undefined; key = parents.get(key)) {
      if (groupExpansion[key] === false || (key === revealGroup && groupExpansion[key] !== true)) {
        setGroupExpanded(key, true)
      }
    }
  }, [groupExpansion, parents, revealGroup, setGroupExpanded])
  useEffect(() => {
    if (revealSessionId === undefined || revealGroup === undefined) return
    const group = groups.find(candidate => candidate.key === revealGroup)
    if (group === undefined || !group.expanded || !group.sessions.some(row => row.id === revealSessionId)) return
    if (collapsedSessionRows(group.sessions).rows.some(row => row.id === revealSessionId)) return
    setExpandedSessionGroups(keys => keys.includes(revealGroup) ? keys : [...keys, revealGroup])
  }, [groups, revealGroup, revealSessionId])
  const now = Date.now()
  const commitSessionDrag = (activeDrag: DragState, over: NonNullable<DragState['over']>): void => {
    if (sessionDropCommitted.current) return
    sessionDropCommitted.current = true
    setDrag(null)
    const group = groups.find(candidate => candidate.key === activeDrag.accountKey)
    if (group === undefined) return
    const sessionsExpanded = expandedSessionGroups.includes(group.key)
    const renderedSessions = sessionsExpanded ? group.sessions : collapsedSessionRows(group.sessions).rows
    const targetIndex = renderedSessions.findIndex(session => session.id === over.id)
    if (targetIndex === -1) return
    const sourceIndex = renderedSessions.findIndex(session => session.id === activeDrag.sessionId)
    if (over.id === activeDrag.sessionId) return
    const withoutSource = renderedSessions.filter(session => session.id !== activeDrag.sessionId)
    const targetWithoutSourceIndex = withoutSource.findIndex(session => session.id === over.id)
    if (targetWithoutSourceIndex === -1) return
    const visibleInsertAt = over.half === 'before' ? targetWithoutSourceIndex : targetWithoutSourceIndex + 1
    if (sourceIndex !== -1 && visibleInsertAt === sourceIndex) return
    const accountSessionIds = activeDrag.accountKey === UNGROUPED_KEY
      ? ungroupedSessionIds
      : workspaces.find(workspace => workspace.workspaceId === activeDrag.accountKey)?.sessionIds
    if (accountSessionIds === undefined) return
    const nextOrder = accountSessionIds.filter(id => id !== activeDrag.sessionId)
    let anchor: SessionId | undefined
    if (sessionsExpanded) {
      anchor = over.half === 'before' ? over.id : renderedSessions[targetIndex + 1]?.id
    } else {
      // A collapsed group may render the blank row after hidden ordinary rows.
      // Place the source at the visible boundary before those hidden account members.
      const previousVisible = withoutSource[visibleInsertAt - 1]?.id
      if (previousVisible === undefined) {
        anchor = nextOrder[0]
      } else {
        const previousIndex = nextOrder.indexOf(previousVisible)
        if (previousIndex === -1) return
        anchor = nextOrder[previousIndex + 1]
      }
    }
    const insertAt = anchor === undefined ? nextOrder.length : nextOrder.indexOf(anchor)
    nextOrder.splice(insertAt === -1 ? nextOrder.length : insertAt, 0, activeDrag.sessionId)
    if (!sessionsExpanded && sourceIndex !== -1) {
      const nodes = new Map(group.sessions.map(node => [node.id, node]))
      const nextGroup = nextOrder.flatMap((id) => {
        const node = nodes.get(id)
        return node === undefined ? [] : [node]
      })
      if (!collapsedSessionRows(nextGroup).rows.some(node => node.id === activeDrag.sessionId)) return
    }
    setSessionOrder(activeDrag.accountKey, nextOrder.map(id => id as string))
    if (activeDrag.accountKey === UNGROUPED_KEY) return
    insertSessionBefore(activeDrag.accountKey as WorkspaceId, activeDrag.sessionId, anchor).catch((reason: unknown) => {
      console.warn('session reorder rejected:', reason)
    })
  }
  const commitWorkspaceDrag = (
    activeDrag: WorkspaceDragState,
    over: NonNullable<WorkspaceDragState['over']>,
  ): void => {
    if (workspaceDropCommitted.current) return
    workspaceDropCommitted.current = true
    setWorkspaceDrag(null)
    const owner = parents.get(activeDrag.workspaceId)
    const siblings = workspaces.filter(workspace => parents.get(workspace.workspaceId) === owner)
    const rowIndex = siblings.findIndex(workspace => workspace.workspaceId === over.id)
    if (rowIndex === -1) return
    const anchor = over.half === 'before' ? over.id : siblings[rowIndex + 1]?.workspaceId
    if (anchor === activeDrag.workspaceId) return
    const sourceIndex = siblings.findIndex(workspace => workspace.workspaceId === activeDrag.workspaceId)
    const anchorIndex = anchor === undefined
      ? siblings.length
      : siblings.findIndex(workspace => workspace.workspaceId === anchor)
    if (sourceIndex !== -1 && (anchorIndex === sourceIndex || anchorIndex === sourceIndex + 1)) return
    insertWorkspaceBefore(activeDrag.workspaceId, anchor).catch((reason: unknown) => {
      console.warn('workspace reorder rejected:', reason)
    })
  }
  const childrenByParent = useMemo(() => {
    const children = new Map<string | undefined, GroupNode[]>()
    for (const group of groups) {
      const parent = parents.get(group.key)
      const siblings = children.get(parent)
      if (siblings === undefined) children.set(parent, [group])
      else siblings.push(group)
    }
    return children
  }, [groups, parents])
  const rootGroups = childrenByParent.get(undefined) ?? []
  const workspaceDropAtListStart = rootGroups[0]?.workspaceId !== undefined
    && workspaceDrag?.over?.id === rootGroups[0].workspaceId
    && workspaceDrag.over.half === 'before'

  const renderGroup = (group: GroupNode, depth: number): ReactNode => {
    const workspaceId = group.workspaceId
    const children = childrenByParent.get(group.key) ?? []
    const compatibleDrag = workspaceDrag !== null && parents.get(workspaceDrag.workspaceId) === parents.get(group.key)
    const collapsed = collapsedSessionRows(group.sessions)
    const sessionsExpanded = expandedSessionGroups.includes(group.key)
    const liveRows = sessionsExpanded ? group.sessions : collapsed.rows
    if (group.expanded) {
      heldRuns.current.set(group.key, { rows: liveRows, hiddenCount: collapsed.hiddenCount })
    }
    const run = group.expanded
      ? { rows: liveRows, hiddenCount: collapsed.hiddenCount }
      : (heldRuns.current.get(group.key) ?? { rows: [], hiddenCount: 0 })
    const workspaceMarker = workspaceId !== undefined && workspaceDrag?.over?.id === workspaceId
      ? workspaceDrag.over.half
      : null
    const workspaceDragProps = workspaceId === undefined ? undefined : {
      start: () => {
        workspaceDropCommitted.current = false
        setWorkspaceDrag({ workspaceId, over: null })
      },
      end: () => {
        if (workspaceDrag?.over !== null && workspaceDrag?.over !== undefined) {
          commitWorkspaceDrag(workspaceDrag, workspaceDrag.over)
        } else {
          setWorkspaceDrag(null)
        }
        workspaceDropCommitted.current = false
      },
    }
    const hoverWorkspace = workspaceId === undefined || !compatibleDrag
      ? undefined
      : (half: 'before' | 'after') => {
        setWorkspaceDrag(active => active === null
          ? active
          : { ...active, over: { id: workspaceId, half } })
      }
    const dropWorkspace = workspaceId === undefined || !compatibleDrag
      ? undefined
      : (half: 'before' | 'after') => {
        commitWorkspaceDrag(workspaceDrag, { id: workspaceId, half })
      }
    return (
    // Group section: header, descendant Workspaces, and own Session rows. The
    // inter-group breathing room is the section's own margin
    // (WorkspaceBrowser.module.css).
      <div
        key={group.key}
        style={{ '--dsh-workspace-indent': `${depth * 12}px` } as CSSProperties}
        className={clsx(
          css.groupSection,
          workspaceMarker === 'before' && css.workspaceDropBefore,
          workspaceMarker === 'after' && css.workspaceDropAfter,
        )}
        onDragOver={workspaceDrag === null
          ? undefined
          : (e) => {
            e.preventDefault()
            if (hoverWorkspace === undefined && parents.get(group.key) !== undefined) return
            e.stopPropagation()
            if (hoverWorkspace === undefined) {
              e.dataTransfer.dropEffect = 'none'
              if (workspaceDrag.over !== null) setWorkspaceDrag({ ...workspaceDrag, over: null })
            } else {
              e.dataTransfer.dropEffect = 'move'
              hoverWorkspace(workspaceGroupHalf(e))
            }
          }}
        onDrop={workspaceDrag === null
          ? undefined
          : (e) => {
            e.preventDefault()
            if (dropWorkspace === undefined && parents.get(group.key) !== undefined) return
            e.stopPropagation()
            if (dropWorkspace === undefined) {
              workspaceDropCommitted.current = true
              setWorkspaceDrag(null)
            } else {
              dropWorkspace(workspaceGroupHalf(e))
            }
          }}
      >
        {workspaceId === undefined
          ? (
            <TasksSectionHeader
              expanded={group.expanded}
              containsCurrent={group.containsCurrent}
              t={t}
              onToggle={() => {
                if (group.expanded) {
                  setExpandedSessionGroups(keys => keys.filter(key => key !== group.key))
                }
                setGroupExpanded(group.key, !group.expanded)
              }}
              onCreate={() => {
                setGroupExpanded(group.key, true)
                connectNoDirectory()
              }}
            />
          )
          : (
            <ProjectRowItem
              group={group}
              containsCurrentDescendant={currentAncestors.has(group.key)}
              home={home}
              t={t}
              onToggle={() => {
                if (group.expanded) {
                  setExpandedSessionGroups(keys => keys.filter(key => key !== group.key))
                }
                setGroupExpanded(group.key, !group.expanded)
              }}
              onCreate={() => {
                setGroupExpanded(group.key, true)
                startSession(workspaceId)
              }}
              drag={workspaceDragProps}
              actions={{
                rename: () => { onRenameRequest(workspaceId, group.label) },
                delete: () => { onDeleteRequest(workspaceId, group.label) },
              }}
            />
          )}
        {group.expanded && children.length > 0 && (
          <div role="group">
            {children.map(child => renderGroup(child, depth + 1))}
          </div>
        )}
        <GroupSessionRun open={group.expanded}>
          {run.rows.map((node) => {
        // Session drag never leaves its browser-local account.
          const sameGroupDrag = drag !== null && drag.accountKey === group.key
          const normalizeHalf = (half: 'before' | 'after'): 'before' | 'after' =>
            node.blank ? 'after' : half
          const dragProps = {
            start: () => {
              sessionDropCommitted.current = false
              setDrag({ accountKey: group.key, sessionId: node.id, over: null })
            },
            active: sameGroupDrag,
            marker: sameGroupDrag && drag.over?.id === node.id ? drag.over.half : null,
            hover: (half: 'before' | 'after') => {
            /* v8 ignore next -- narrowing guard: Rows gates hover on `active`, which is false while the drag state is null. */
              setDrag(d => (d === null ? d : {
                ...d, over: { id: node.id, half: normalizeHalf(half) },
              }))
            },
            drop: (half: 'before' | 'after') => {
            /* v8 ignore next -- narrowing guard: Rows gates drop on `active`, which is false while the drag state is null. */
              if (drag === null) return
              commitSessionDrag(drag, { id: node.id, half: normalizeHalf(half) })
            },
            end: () => {
              if (drag?.over !== null && drag?.over !== undefined) commitSessionDrag(drag, drag.over)
              else setDrag(null)
              sessionDropCommitted.current = false
            },
          }
            return (
              <SessionNodeItem
                key={node.id}
                node={node}
                currentId={current}
                now={now}
                onOpen={open}
                onRename={onSessionRename}
                onFork={forkSession}
                onArchive={onSessionArchive}
                onReveal={node.id === revealSessionId && group.key === revealGroup
                  ? () => { onSessionRevealed(node.id) }
                  : undefined}
                drag={dragProps}
                t={t}
              />
            )
          })}
          {run.hiddenCount > 0 && (
            <button
              type="button"
              className={css.sessionOverflowButton}
              aria-expanded={sessionsExpanded}
              onClick={() => { setExpandedSessionGroups(keys => toggled(keys, group.key)) }}
            >
              {sessionsExpanded
                ? t('sessions.collapse')
                : t('sessions.expand', { n: run.hiddenCount })}
            </button>
          )}
        </GroupSessionRun>
      </div>
    )
  }

  return (
    <div className={clsx(css.treeBody, css.wide)}>
      {workspaceDropAtListStart && <span className={css.listTopDropIndicator} aria-hidden="true" />}
      <div
        className={clsx(css.list, workspaceDropAtListStart && css.listTopDropActive)}
        role="tree"
        aria-label={t('section.sessions')}
      >
        {groups.length === 0 && archivedNodes.length === 0 && (
          <div className={css.empty}>{t('empty.none')}</div>
        )}
        {rootGroups.map(group => renderGroup(group, 0))}
        <ArchivedSessionSection
          nodes={showArchivedList ? archivedNodes : []}
          currentId={current}
          now={now}
          expanded={archivedExpanded}
          onToggle={onToggleArchived}
          onUnarchive={onSessionUnarchive}
          onDelete={onSessionDelete}
          t={t}
        />
      </div>
      <span className={css.fade} />
    </div>
  )
}

/** The flat "In one list" body: every session is one draggable top-level row. */
function FlatList({
  useSessions, useSessionStatus, open, forkSession, onSessionRename, onSessionArchive,
  onSessionUnarchive, onSessionDelete, workspaces, scratchCwd, archivedSessionIds, usePanelInfo,
  showArchivedList, archivedExpanded, onToggleArchived,
  sessionIds, setSessionOrder,
  revealSessionId, onSessionRevealed, t,
}: Pick<
  SessionTreeProps,
  | 'useSessions'
  | 'useSessionStatus'
  | 'open'
  | 'forkSession'
  | 'onSessionRename'
  | 'onSessionArchive'
  | 'onSessionUnarchive'
  | 'onSessionDelete'
  | 'workspaces'
  | 'scratchCwd'
  | 'archivedSessionIds'
  | 'showArchivedList'
  | 'archivedExpanded'
  | 'onToggleArchived'
  | 'usePanelInfo'
  | 'setSessionOrder'
  | 'revealSessionId'
  | 'onSessionRevealed'
  | 't'
> & {
  /** Ordered flat members, including any pinned blank. */
  sessionIds: readonly SessionId[]
}) {
  const panelActive = usePanelInfo(info => info.activePanelId !== null)
  const list = useSessions(s => s)
  const statuses = useSessionStatus(s => s)
  const rows = useMemo(
    () => deriveFlat(list, sessionIds, statuses),
    [list, sessionIds, statuses],
  )
  const [drag, setDrag] = useState<DragState | null>(null)
  const dropCommitted = useRef(false)
  useNativeDragAcceptance(drag !== null)
  const currentId = panelActive
    ? undefined
    : Object.values(list.byId).find(session => (session.retainedBy.mainView ?? 0) > 0)?.id
  const commitDrag = (activeDrag: DragState, over: NonNullable<DragState['over']>): void => {
    if (dropCommitted.current) return
    dropCommitted.current = true
    setDrag(null)
    const targetIndex = rows.findIndex(row => row.id === over.id)
    if (targetIndex === -1) return
    const anchor = over.half === 'before' ? over.id : rows[targetIndex + 1]?.id
    if (anchor === activeDrag.sessionId) return
    const sourceIndex = rows.findIndex(row => row.id === activeDrag.sessionId)
    const anchorIndex = anchor === undefined ? rows.length : rows.findIndex(row => row.id === anchor)
    if (sourceIndex !== -1 && (anchorIndex === sourceIndex || anchorIndex === sourceIndex + 1)) return
    const nextOrder = rows.map(row => row.id).filter(id => id !== activeDrag.sessionId)
    const insertAt = anchor === undefined ? nextOrder.length : nextOrder.indexOf(anchor)
    nextOrder.splice(insertAt === -1 ? nextOrder.length : insertAt, 0, activeDrag.sessionId)
    setSessionOrder(FLAT_SESSION_ORDER_KEY, nextOrder.map(id => id as string))
  }
  const archivedNodes = useMemo(
    () => deriveArchived(list, workspaces, archivedSessionIds, scratchCwd, t('archived.missingTitle')),
    [list, workspaces, archivedSessionIds, scratchCwd, t],
  )
  const now = Date.now()
  return (
    <div className={clsx(css.treeBody, css.wide)}>
      <div className={clsx(css.list, css.flatList)} role="tree" aria-label={t('section.sessions')}>
        {rows.length === 0 && archivedNodes.length === 0 && (
          <div className={css.empty}>{t('empty.none')}</div>
        )}
        {rows.map((node) => {
          const active = drag !== null
          return (
            <SessionNodeItem
              key={node.id}
              node={node}
              currentId={currentId}
              now={now}
              onOpen={open}
              onRename={onSessionRename}
              onFork={forkSession}
              onArchive={onSessionArchive}
              onReveal={node.id === revealSessionId
                ? () => { onSessionRevealed(node.id) }
                : undefined}
              flat
              drag={{
                start: () => {
                  dropCommitted.current = false
                  setDrag({ accountKey: FLAT_SESSION_ORDER_KEY, sessionId: node.id, over: null })
                },
                active,
                marker: active && drag.over?.id === node.id ? drag.over.half : null,
                hover: (half) => {
                  setDrag(current => current === null ? current : { ...current, over: { id: node.id, half } })
                },
                drop: (half) => {
                  if (drag !== null) commitDrag(drag, { id: node.id, half })
                },
                end: () => {
                  if (drag?.over !== null && drag?.over !== undefined) commitDrag(drag, drag.over)
                  else setDrag(null)
                  dropCommitted.current = false
                },
              }}
              t={t}
            />
          )
        })}
        <ArchivedSessionSection
          nodes={showArchivedList ? archivedNodes : []}
          currentId={currentId}
          now={now}
          expanded={archivedExpanded}
          onToggle={onToggleArchived}
          onUnarchive={onSessionUnarchive}
          onDelete={onSessionDelete}
          t={t}
        />
      </div>
      <span className={css.fade} />
    </div>
  )
}

interface RemoteSearchState {
  query: string
  status: 'idle' | 'loading' | 'ready' | 'error'
  items: readonly SessionSearchResultItem[]
  hasMore: boolean
}

/** Flat search body: local metadata matches plus the current Host result page. */
function SearchResults({
  useSessions,
  useSessionStatus,
  open,
  workspaces,
  scratchCwd,
  archivedSessionIds,
  query,
  remote,
  resultLimit,
  usePanelInfo,
  t,
}: Pick<WorkspaceBrowserProps, 'useSessions' | 'useSessionStatus' | 'open' | 't' | 'usePanelInfo'> & {
  workspaces: readonly WorkspaceView[]
  scratchCwd: string | undefined
  archivedSessionIds: readonly SessionNode['id'][]
  query: string
  remote: RemoteSearchState
  resultLimit: number
}) {
  const panelActive = usePanelInfo(info => info.activePanelId !== null)
  const list = useSessions(s => s)
  const statuses = useSessionStatus(s => s)
  const currentRemote = remote.query === query
    ? remote
    : { query, status: 'loading' as const, items: [], hasMore: false }
  const results = useMemo(
    () => deriveSearchResults(
      list,
      workspaces,
      query,
      archivedSessionIds,
      statuses,
      currentRemote,
      resultLimit,
      scratchCwd,
    ),
    [list, workspaces, query, archivedSessionIds, statuses, currentRemote, resultLimit, scratchCwd],
  )
  const pending = currentRemote.status === 'loading'
  const failed = currentRemote.status === 'error'
  const currentId = panelActive
    ? undefined
    : Object.values(list.byId).find(session => (session.retainedBy.mainView ?? 0) > 0)?.id

  return (
    <div className={clsx(css.treeBody, css.wide)}>
      <div className={css.list}>
        <div className={css.searchTree} role="tree" aria-label={t('search.results.aria')}>
          {results.items.map(result => (
            <SearchResultItem
              key={result.id}
              result={result}
              currentId={currentId}
              onOpen={open}
              t={t}
            />
          ))}
        </div>
        {pending && (
          <div className={css.searchStatus} role="status">{t('search.pending')}</div>
        )}
        {failed && (
          <div className={css.searchWarning} role="status">
            {t('search.unavailable')}
          </div>
        )}
        {!pending && results.items.length === 0 && (
          <div className={css.empty}>{t('search.noMatches')}</div>
        )}
        {results.hasMore && (
          <div className={css.searchStatus}>
            {t('search.hasMore', { n: resultLimit })}
          </div>
        )}
      </div>
      <span className={css.fade} />
    </div>
  )
}

/**
 * Render the browsing region.
 * @param props - composed slot props (shell owner share + store + injected actions).
 * @returns the region element tree.
 */
export function WorkspaceBrowser({
  wide,
  usePanelInfo,
  expandSidebar,
  useSessions,
  useSessionStatus,
  useWorkspaces,
  useStore,
  actions,
  startSession,
  connectNoDirectory,
  open,
  renameSession,
  forkSession,
  renameWorkspace,
  deleteWorkspace,
  insertWorkspaceBefore,
  archiveSession,
  unarchiveSession,
  deleteSession,
  insertSessionBefore,
  createWorkspace,
  searchSessions,
  searchResultLimit,
  useDirectoryFlow,
  useHostInfo,
  renderSlot,
  t,
}: WorkspaceBrowserProps) {
  const home = useHostInfo(info => info.home)
  // Ordering remains live while the rail or search replaces the list body.
  const list = useSessions(state => state)
  const workspaces = useWorkspaces(state => state.items)
  const workspacePhase = useWorkspaces(state => state.phase)
  const workspaceStreamState = useWorkspaces(state => state.state)
  const archivedSessionIds = useWorkspaces(state => state.archivedSessionIds)
  const scratchCwd = useWorkspaces(state => state.scratchCwd)
  // Live occupancy of this surface's directory-flow hole (the same source the
  // flow reads): a composition without a picking affordance can add nothing.
  const directoryFlowAvailable = useDirectoryFlow(occupied => occupied)
  const groupBy = useStore(s => s.groupBy)
  const orderBy = useStore(s => s.orderBy)
  const groupExpansion = useStore(s => s.groupExpansion)
  const sessionOrderByAccount = useStore(s => s.sessionOrderByAccount)
  const showArchivedList = useStore(s => s.showArchivedList)
  // Session-local only: always start collapsed so a prior expand cannot stick
  // across reloads and fight the "默认折叠" product default.
  const [archivedExpanded, setArchivedExpanded] = useState(false)
  const onToggleArchived = () => { setArchivedExpanded(open => !open) }
  const workspaceReady = workspacePhase === 'ready' && workspaceStreamState !== 'loading'
  const mainSessionId = Object.values(list.byId)
    .find(session => (session.retainedBy.mainView ?? 0) > 0)?.id
  const currentBlank = mainSessionId !== undefined && list.byId[mainSessionId]?.blank === true
    ? mainSessionId
    : undefined
  // The bucket account holds no-directory tasks only; unaccounted Sessions in
  // any other cwd are unlisted (their Workspace is not registered right now).
  const ungroupedMemberIds = useMemo(() => {
    const accounted = new Set(workspaces.flatMap(workspace => workspace.sessionIds))
    return list.ids.filter((id: SessionId) => {
      const summary = list.byId[id]
      return summary !== undefined && isNoDirectorySession(summary, accounted, scratchCwd)
    })
  }, [list, workspaces, scratchCwd])
  const flatMemberIds = useMemo(
    () => visibleSessionIds(list, workspaces, archivedSessionIds, scratchCwd),
    [list, workspaces, archivedSessionIds, scratchCwd],
  )
  const orderedWorkspaces = useMemo(() => workspaces.map((workspace) => {
    const memberIds = workspace.sessionIds
    const baseOrder = orderBy === 'updated'
      ? orderByRecency(memberIds, list.byId)
      : reconcileManualOrder(memberIds, sessionOrderByAccount[workspace.workspaceId], list.byId)
    return {
      ...workspace,
      sessionIds: pinCurrentBlank(
        baseOrder,
        currentBlank !== undefined && memberIds.includes(currentBlank) ? currentBlank : undefined,
      ),
    }
  }), [currentBlank, list.byId, orderBy, sessionOrderByAccount, workspaces])
  const orderedUngroupedSessionIds = useMemo(() => {
    const baseOrder = orderBy === 'updated'
      ? orderByRecency(ungroupedMemberIds, list.byId)
      : reconcileManualOrder(ungroupedMemberIds, sessionOrderByAccount[UNGROUPED_KEY], list.byId)
    return pinCurrentBlank(
      baseOrder,
      currentBlank !== undefined && ungroupedMemberIds.includes(currentBlank) ? currentBlank : undefined,
    )
  }, [currentBlank, list.byId, orderBy, sessionOrderByAccount, ungroupedMemberIds])
  const orderedFlatSessionIds = useMemo(() => {
    const baseOrder = orderBy === 'updated'
      ? orderByRecency(flatMemberIds, list.byId)
      : reconcileManualOrder(flatMemberIds, sessionOrderByAccount[FLAT_SESSION_ORDER_KEY], list.byId)
    return pinCurrentBlank(
      baseOrder,
      currentBlank !== undefined && flatMemberIds.includes(currentBlank) ? currentBlank : undefined,
    )
  }, [currentBlank, flatMemberIds, list.byId, orderBy, sessionOrderByAccount])
  const activeSessionOrders = useMemo<Readonly<Record<string, readonly string[]>>>(() => Object.fromEntries([
    ...orderedWorkspaces.map(workspace => [workspace.workspaceId, workspace.sessionIds] as const),
    [UNGROUPED_KEY, orderedUngroupedSessionIds] as const,
    [FLAT_SESSION_ORDER_KEY, orderedFlatSessionIds] as const,
  ]), [orderedFlatSessionIds, orderedUngroupedSessionIds, orderedWorkspaces])
  useEffect(() => {
    if (workspacePhase !== 'ready') return
    actions.retainAccountKeys([
      UNGROUPED_KEY,
      FLAT_SESSION_ORDER_KEY,
      ...workspaces.map(workspace => workspace.workspaceId),
    ])
  }, [actions.retainAccountKeys, workspacePhase, workspaces])
  useEffect(() => {
    if (list.phase !== 'ready' || workspaceReady || orderBy !== 'manual' || currentBlank === undefined) return
    // A first prompt can end blank pinning before the Workspace baseline arrives.
    // Preserve saved members until that baseline can establish departures.
    const changed: Record<string, readonly string[]> = {}
    for (const [key, ids] of Object.entries(activeSessionOrders)) {
      if (key !== FLAT_SESSION_ORDER_KEY && workspacePhase !== 'ready') continue
      const saved = sessionOrderByAccount[key] ?? []
      if (ids[0] !== currentBlank || saved[0] === currentBlank) continue
      changed[key] = [currentBlank, ...saved.filter(id => id !== currentBlank)]
    }
    if (Object.keys(changed).length > 0) actions.syncSessionOrders(changed)
  }, [
    actions.syncSessionOrders,
    activeSessionOrders,
    currentBlank,
    list.phase,
    orderBy,
    sessionOrderByAccount,
    workspacePhase,
    workspaceReady,
  ])
  useEffect(() => {
    if (list.phase !== 'ready' || !workspaceReady || orderBy !== 'manual') return
    const changed = Object.fromEntries(Object.entries(activeSessionOrders).filter(([key, ids]) => {
      const saved = sessionOrderByAccount[key]
      return saved === undefined || saved.length !== ids.length || ids.some((id, index) => id !== saved[index])
    }))
    if (Object.keys(changed).length > 0) actions.syncSessionOrders(changed)
  }, [
    actions.syncSessionOrders,
    activeSessionOrders,
    list.phase,
    orderBy,
    sessionOrderByAccount,
    workspaceReady,
  ])
  const saveSessionOrder = (accountKey: string, order: readonly string[]): void => {
    actions.setSessionOrder(accountKey, order, activeSessionOrders)
  }
  // The query outlives the tree and the input (both wide-only) so collapsing
  // does not silently drop an in-progress filter.
  const [query, setQuery] = useState('')
  const [searchExpanded, setSearchExpanded] = useState(false)
  const [revealSessionId, setRevealSessionId] = useState<SessionId | undefined>(undefined)
  const normalizedQuery = sanitizeSearchQuery(query).trim()
  const [remoteSearch, setRemoteSearch] = useState<RemoteSearchState>({
    query: '',
    status: 'idle',
    items: [],
    hasMore: false,
  })
  const searchRoot = useRef<HTMLDivElement | null>(null)
  const searchInput = useRef<HTMLInputElement | null>(null)
  // Section-header ＋ opens the picker menu (same popover in wide and rail
  // states; the menu anchors on this button).
  const [wsPickerOpen, setWsPickerOpen] = useState(false)
  const wsPlusRef = useRef<HTMLButtonElement>(null)
  const composingRef = useRef(false)

  const openSearchResult = (sessionId: SessionId): void => {
    setRevealSessionId(sessionId)
    setQuery('')
    setSearchExpanded(false)
    open(sessionId)
  }
  const acknowledgeSessionReveal = (sessionId: SessionId): void => {
    setRevealSessionId(current => current === sessionId ? undefined : current)
  }
  useEffect(() => {
    if (normalizedQuery !== '') setRevealSessionId(undefined)
  }, [normalizedQuery])

  // Rail search = expand + land in the search box: the flag arms before the
  // expand request; once the shell flips wide the input mounts and takes focus.
  const [searchOnExpand, setSearchOnExpand] = useState(false)
  useEffect(() => {
    if (wide && searchOnExpand) {
      const timer = window.setTimeout(() => {
        searchInput.current?.focus({ preventScroll: true })
        setSearchOnExpand(false)
      }, EXPAND_SLIDE_MS)
      return () => { window.clearTimeout(timer) }
    }
  }, [wide, searchOnExpand])

  useEffect(() => {
    if (!wide || !searchExpanded || searchOnExpand) return
    searchInput.current?.focus({ preventScroll: true })
  }, [wide, searchExpanded, searchOnExpand])

  // Outside-click dismissal stays off while the rail gesture is in flight
  // (searchOnExpand): the rail click flips the shell wide and mounts this
  // listener during its own dispatch, then keeps bubbling to document with
  // the now-unmounted rail button as its target — outside searchRoot, so the
  // listener would dismiss the search that click just opened.
  useEffect(() => {
    if (!wide || !searchExpanded || searchOnExpand) return
    const onClick = (event: MouseEvent): void => {
      if (!(event.target instanceof Node) || searchRoot.current?.contains(event.target) === true) return
      searchInput.current?.blur()
      if (normalizedQuery !== '') return
      setSearchExpanded(false)
    }
    document.addEventListener('click', onClick)
    return () => { document.removeEventListener('click', onClick) }
  }, [normalizedQuery, wide, searchExpanded, searchOnExpand])

  useEffect(() => {
    if (normalizedQuery === '') {
      setRemoteSearch({ query: '', status: 'idle', items: [], hasMore: false })
      return
    }
    const controller = new AbortController()
    setRemoteSearch({
      query: normalizedQuery,
      status: 'loading',
      items: [],
      hasMore: false,
    })
    const timer = window.setTimeout(() => {
      searchSessions(normalizedQuery, controller.signal).then((result) => {
        if (controller.signal.aborted) return
        setRemoteSearch({
          query: normalizedQuery,
          status: 'ready',
          items: result.items,
          hasMore: result.hasMore,
        })
      }).catch(() => {
        if (controller.signal.aborted) return
        setRemoteSearch({
          query: normalizedQuery,
          status: 'error',
          items: [],
          hasMore: false,
        })
      })
    }, SEARCH_DEBOUNCE_MS)
    return () => {
      window.clearTimeout(timer)
      controller.abort()
    }
  }, [normalizedQuery, searchSessions])

  // Rename dialog (browser-owned so it outlives row unmounts during collapse).
  const [renameTarget, setRenameTarget] = useState<{ workspaceId: WorkspaceId; currentTitle: string } | null>(null)
  const [renameDraft, setRenameDraft] = useState('')
  const [renaming, setRenaming] = useState(false)
  const [renameError, setRenameError] = useState<string | null>(null)
  const renameTrimmed = renameDraft.trim()
  const renameDuplicate = renameTarget !== null && renameTrimmed !== '' && renameTrimmed !== renameTarget.currentTitle
    && workspaces.some(w => w.title === renameTrimmed)
  const renameBlocked = renaming || renameTrimmed === ''
    || renameTarget === null || renameTrimmed === renameTarget.currentTitle || renameDuplicate
  const closeRename = () => {
    if (renaming) return
    setRenameTarget(null)
    setRenameError(null)
  }
  const confirmRename = () => {
    if (renameBlocked) return
    setRenaming(true)
    setRenameError(null)
    renameWorkspace(renameTarget.workspaceId, renameTrimmed).then(() => {
      setRenaming(false)
      setRenameTarget(null)
    }).catch((reason: unknown) => {
      setRenaming(false)
      setRenameError(reason instanceof Error ? reason.message : String(reason))
    })
  }

  // Session rename dialog (same browser-owned pattern as workspace rename;
  // sessions have no client-side name-conflict rule — the host normalizes).
  // Unlike workspace rename, an unchanged title is NOT blocked: confirming
  // the current automatic title is the gesture that pins it.
  const [sessionRenameTarget, setSessionRenameTarget] = useState<{ sessionId: SessionNode['id']; currentTitle: string } | null>(null)
  const [sessionRenameDraft, setSessionRenameDraft] = useState('')
  const [sessionRenaming, setSessionRenaming] = useState(false)
  const [sessionRenameError, setSessionRenameError] = useState<string | null>(null)
  const sessionRenameTrimmed = sessionRenameDraft.trim()
  const sessionRenameBlocked = sessionRenaming || sessionRenameTrimmed === '' || sessionRenameTarget === null
  const closeSessionRename = () => {
    if (sessionRenaming) return
    setSessionRenameTarget(null)
    setSessionRenameError(null)
  }
  const confirmSessionRename = () => {
    if (sessionRenameBlocked) return
    setSessionRenaming(true)
    setSessionRenameError(null)
    renameSession(sessionRenameTarget.sessionId, sessionRenameTrimmed).then(() => {
      setSessionRenaming(false)
      setSessionRenameTarget(null)
    }).catch((reason: unknown) => {
      setSessionRenaming(false)
      setSessionRenameError(reason instanceof Error ? reason.message : String(reason))
    })
  }
  const onSessionRename = (sessionId: SessionNode['id'], currentTitle: string) => {
    setSessionRenameTarget({ sessionId, currentTitle })
    setSessionRenameDraft(currentTitle)
    setSessionRenameError(null)
  }

  // Archive is dialog-free: not destructive (the log and the accounting slot
  // remain), so the menu action commits directly; the row disappears when the
  // archive-set echo lands. Failures are non-fatal console diagnostics, the
  // same posture as reorder rejections.
  const onSessionArchive = (sessionId: SessionNode['id']) => {
    archiveSession(sessionId).catch((reason: unknown) => {
      console.warn('session archive rejected:', reason)
    })
  }

  const onSessionUnarchive = (sessionId: SessionNode['id']) => {
    unarchiveSession(sessionId).catch((reason: unknown) => {
      console.warn('session unarchive rejected:', reason)
    })
  }

  // Delete dialog is separate from the row so a successful removal can
  // unmount that row without tearing down the in-flight confirmation state.
  const [deleteTarget, setDeleteTarget] = useState<{ workspaceId: WorkspaceId; title: string } | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [deleteCommittedId, setDeleteCommittedId] = useState<WorkspaceId | null>(null)
  const [deleteError, setDeleteError] = useState<string | null>(null)
  useEffect(() => {
    if (deleteCommittedId === null
      || workspaces.some(workspace => workspace.workspaceId === deleteCommittedId)) return
    setDeleting(false)
    setDeleteCommittedId(null)
    setDeleteTarget(null)
  }, [deleteCommittedId, workspaces])
  const closeDelete = () => {
    if (deleting) return
    setDeleteTarget(null)
    setDeleteError(null)
  }
  const confirmDelete = () => {
    /* v8 ignore next -- the Modal is absent without a target and its button is disabled while deleting. */
    if (deleting || deleteTarget === null) return
    setDeleting(true)
    setDeleteCommittedId(null)
    setDeleteError(null)
    deleteWorkspace(deleteTarget.workspaceId).then(() => {
      // Keep the confirmation pending until this component has rendered the
      // committed list projection without the deleted id. Closing earlier
      // exposes one stale React frame to the next Create Workspace gesture.
      setDeleteCommittedId(deleteTarget.workspaceId)
    }).catch((reason: unknown) => {
      setDeleting(false)
      setDeleteError(reason instanceof Error ? reason.message : String(reason))
    })
  }

  const [sessionDeleteTarget, setSessionDeleteTarget] = useState<{ sessionId: SessionNode['id']; title: string } | null>(null)
  const [sessionDeleting, setSessionDeleting] = useState(false)
  const [sessionDeleteCommittedId, setSessionDeleteCommittedId] = useState<SessionNode['id'] | null>(null)
  const [sessionDeleteError, setSessionDeleteError] = useState<string | null>(null)
  useEffect(() => {
    if (sessionDeleteCommittedId === null || archivedSessionIds.includes(sessionDeleteCommittedId)) return
    setSessionDeleting(false)
    setSessionDeleteCommittedId(null)
    setSessionDeleteTarget(null)
  }, [archivedSessionIds, sessionDeleteCommittedId])
  const onSessionDeleteRequest = (sessionId: SessionNode['id'], title: string) => {
    setSessionDeleteTarget({ sessionId, title })
    setSessionDeleteError(null)
  }
  const closeSessionDelete = () => {
    if (sessionDeleting) return
    setSessionDeleteTarget(null)
    setSessionDeleteError(null)
  }
  const confirmSessionDelete = () => {
    /* v8 ignore next -- the Modal is absent without a target and its button is disabled while deleting. */
    if (sessionDeleting || sessionDeleteTarget === null) return
    setSessionDeleting(true)
    setSessionDeleteCommittedId(null)
    setSessionDeleteError(null)
    deleteSession(sessionDeleteTarget.sessionId).then(() => {
      setSessionDeleteCommittedId(sessionDeleteTarget.sessionId)
    }).catch((reason: unknown) => {
      setSessionDeleting(false)
      setSessionDeleteError(sessionDeleteErrorText(reason, t))
    })
  }

  return (
    <div className={clsx(css.root, !wide && css.rail)}>
      <div className={css.sectionHeader}>
        {wide && (
          <span className={clsx(css.sectionLabel, css.wide, searchExpanded && css.sectionLabelHidden)}>
            {groupBy === 'flat' ? t('section.sessions') : t('section.workspaces')}
          </span>
        )}
        {wide && (
          <div className={clsx(css.searchSlot, searchExpanded && css.searchSlotExpanded)}>
            <div
              ref={searchRoot}
              className={clsx(css.search, searchExpanded && css.searchExpanded)}
              onClick={() => {
                setWsPickerOpen(false)
                setSearchExpanded(true)
                searchInput.current?.focus()
              }}
            >
              <Tooltip label={t('search')} side="bottom" delayMs={500} disabled={searchExpanded}>
                <button
                  type="button"
                  className={css.searchButton}
                  aria-label={t('search.sessions.aria')}
                  aria-expanded={searchExpanded}
                  onClick={() => {
                    setWsPickerOpen(false)
                    setSearchExpanded(true)
                  }}
                >
                  <IconSearchOutline16 size={searchExpanded ? 11 : 14} />
                </button>
              </Tooltip>
              <input
                ref={searchInput}
                className={css.searchInput}
                type="text"
                placeholder={t('search.placeholder')}
                maxLength={SEARCH_QUERY_MAX_CODE_UNITS}
                value={query}
                tabIndex={searchExpanded ? 0 : -1}
                onChange={(e) => { setQuery(sanitizeSearchQuery(e.target.value)) }}
                onKeyDown={(e) => {
                  if (e.key !== 'Escape') return
                  setQuery('')
                  setSearchExpanded(false)
                }}
              />
              {searchExpanded && (
                <button
                  type="button"
                  className={css.clearButton}
                  aria-label={t('search.clear')}
                  onClick={(e) => {
                    e.stopPropagation()
                    setQuery('')
                    setSearchExpanded(false)
                  }}
                >
                  <IconCloseFill14 />
                </button>
              )}
            </div>
          </div>
        )}
        <div className={clsx(css.headerActions, wide && searchExpanded && css.headerActionsHidden)}>
          {wide && (
            <ViewOptionsMenu
              groupBy={groupBy}
              orderBy={orderBy}
              onGroupPick={(mode) => { actions.setGroupBy(mode) }}
              onOrderPick={(mode) => { actions.setOrderBy(mode, activeSessionOrders) }}
              t={t}
            />
          )}
          {/* Adding is the button's one action, so a composition with no
              picking affordance has nothing to offer here: the region hides the
              button rather than leaving a dead one in the header. */}
          {directoryFlowAvailable && (
            <Tooltip label={t('workspace.add')} side="bottom" delayMs={500}>
              <button
                ref={wsPlusRef}
                type="button"
                className={css.iconButton}
                aria-label={t('workspace.add')}
                onClick={() => {
                  setWsPickerOpen(v => !v)
                }}
              >
                <IconProjectAddOutline16 size={wide ? 16 : 18} />
              </button>
            </Tooltip>
          )}
        </div>
        {/* Add flow + its error dialog (same package — direct composition). */}
        <WorkspacePickFlow
          t={t}
          open={wsPickerOpen}
          anchorRef={wsPlusRef}
          useWorkspaces={useWorkspaces}
          createWorkspace={createWorkspace}
          useDirectoryFlow={useDirectoryFlow}
          renderDirectoryFlow={owner => renderSlot('sidebar.workspaces.directoryFlow', owner)}
          addOnly
          side="right"
          onPick={(workspaceId) => {
            setWsPickerOpen(false)
            startSession(workspaceId)
          }}
          onClose={() => { setWsPickerOpen(false) }}
        />
      </div>

      {/* The collapsed rail keeps search as its own 36px control. */}
      {!wide && <div className={css.search}>
        <Tooltip label={t('search')}>
          <button
            type="button"
            className={css.searchButton}
            aria-label={t('search.sessions.aria')}
            onClick={() => {
              setSearchExpanded(true)
              setSearchOnExpand(true)
              expandSidebar()
            }}
          >
            <IconSearchOutline16 size={18} />
          </button>
        </Tooltip>
      </div>}

      {/* Always-mounted seat keeps the region's flex slot while the list
          itself is wide-only. */}
      <div className={css.listArea}>
        {wide && (normalizedQuery !== ''
          ? (
            <SearchResults
              usePanelInfo={usePanelInfo}
              useSessions={useSessions}
              useSessionStatus={useSessionStatus}
              open={openSearchResult}
              workspaces={workspaces}
              scratchCwd={scratchCwd}
              archivedSessionIds={archivedSessionIds}
              query={normalizedQuery}
              remote={remoteSearch}
              resultLimit={searchResultLimit}
              t={t}
            />
          )
          : groupBy === 'flat'
            ? (
              <FlatList
                usePanelInfo={usePanelInfo}
                useSessions={useSessions}
                useSessionStatus={useSessionStatus}
                sessionIds={orderedFlatSessionIds}
                open={open} forkSession={forkSession}
                onSessionRename={onSessionRename} onSessionArchive={onSessionArchive}
                onSessionUnarchive={onSessionUnarchive}
                onSessionDelete={onSessionDeleteRequest}
                workspaces={workspaces}
                scratchCwd={scratchCwd}
                archivedSessionIds={archivedSessionIds}
                showArchivedList={showArchivedList}
                archivedExpanded={archivedExpanded}
                onToggleArchived={onToggleArchived}
                setSessionOrder={saveSessionOrder}
                revealSessionId={revealSessionId}
                onSessionRevealed={acknowledgeSessionReveal}
                t={t}
              />
            )
            : (
              <SessionTree
                usePanelInfo={usePanelInfo}
                useSessions={useSessions}
                useSessionStatus={useSessionStatus}
                onSessionRename={onSessionRename}
                onSessionArchive={onSessionArchive}
                onSessionUnarchive={onSessionUnarchive}
                onSessionDelete={onSessionDeleteRequest}
                forkSession={forkSession}
                workspaces={orderedWorkspaces}
                scratchCwd={scratchCwd}
                ungroupedSessionIds={orderedUngroupedSessionIds}
                workspaceReady={workspaceReady}
                nestWorkspaces={groupBy === 'workspace-tree'}
                groupExpansion={groupExpansion}
                setGroupExpanded={actions.setGroupExpanded}
                setSessionOrder={saveSessionOrder}
                archivedSessionIds={archivedSessionIds}
                showArchivedList={showArchivedList}
                archivedExpanded={archivedExpanded}
                onToggleArchived={onToggleArchived}
                startSession={startSession}
                connectNoDirectory={connectNoDirectory}
                open={open}
                insertWorkspaceBefore={insertWorkspaceBefore}
                insertSessionBefore={insertSessionBefore}
                revealSessionId={revealSessionId}
                onSessionRevealed={acknowledgeSessionReveal}
                home={home}
                t={t}
                onRenameRequest={(workspaceId, currentTitle) => {
                  setRenameTarget({ workspaceId, currentTitle })
                  setRenameDraft(currentTitle)
                  setRenameError(null)
                }}
                onDeleteRequest={(workspaceId, title) => {
                  setDeleteTarget({ workspaceId, title })
                  setDeleteError(null)
                }}
              />
            ))}
      </div>

      <Modal
        open={renameTarget !== null}
        onClose={closeRename}
        closeLabel={t('close')}
        title={t('rename.workspace.title')}
        footer={(
          <>
            <Button variant="outline" disabled={renaming} onClick={closeRename}>{t('cancel')}</Button>
            <Button variant="primary" disabled={renameBlocked} onClick={confirmRename}>{t('rename')}</Button>
          </>
        )}
      >
        <input
          className={css.renameInput}
          value={renameDraft}
          aria-label={t('field.workspaceName')}
          autoFocus
          disabled={renaming}
          onFocus={(e) => { e.target.select() }}
          onChange={(e) => { setRenameDraft(e.target.value); setRenameError(null) }}
          onCompositionStart={() => { composingRef.current = true }}
          onCompositionEnd={() => { composingRef.current = false }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !composingRef.current) {
              e.preventDefault()
              confirmRename()
            }
          }}
        />
        {renameDuplicate && (
          <div className={css.renameError} role="alert">{t('conflict.named', { name: renameTrimmed })}</div>
        )}
        {renameError !== null && <div className={css.renameError} role="alert">{renameError}</div>}
      </Modal>

      <Modal
        open={sessionRenameTarget !== null}
        onClose={closeSessionRename}
        closeLabel={t('close')}
        title={t('rename.session.title')}
        footer={(
          <>
            <Button variant="outline" disabled={sessionRenaming} onClick={closeSessionRename}>{t('cancel')}</Button>
            <Button variant="primary" disabled={sessionRenameBlocked} onClick={confirmSessionRename}>{t('rename')}</Button>
          </>
        )}
      >
        <input
          className={css.renameInput}
          value={sessionRenameDraft}
          aria-label={t('field.sessionName')}
          autoFocus
          disabled={sessionRenaming}
          onFocus={(e) => { e.target.select() }}
          onChange={(e) => { setSessionRenameDraft(e.target.value); setSessionRenameError(null) }}
          onCompositionStart={() => { composingRef.current = true }}
          onCompositionEnd={() => { composingRef.current = false }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !composingRef.current) {
              e.preventDefault()
              confirmSessionRename()
            }
          }}
        />
        {sessionRenameError !== null && <div className={css.renameError} role="alert">{sessionRenameError}</div>}
      </Modal>
      <Modal
        open={deleteTarget !== null}
        onClose={closeDelete}
        closeLabel={t('close')}
        title={t('delete.workspace')}
        {...deleteTarget === null
          ? {}
          : { description: t('delete.desc', { name: deleteTarget.title }) }}
        footer={(
          <>
            <Button variant="outline" disabled={deleting} onClick={closeDelete}>{t('cancel')}</Button>
            <Button
              variant="outline"
              className={css.deleteAction}
              disabled={deleting}
              onClick={confirmDelete}
            >
              {t('delete.workspace')}
            </Button>
          </>
        )}
      >
        {deleting && <div className={css.deleteStatus} role="status">{t('delete.pending')}</div>}
        {deleteError !== null && <div className={css.renameError} role="alert">{deleteError}</div>}
      </Modal>
      <Modal
        open={sessionDeleteTarget !== null}
        onClose={closeSessionDelete}
        closeLabel={t('close')}
        title={t('delete.session.title')}
        {...sessionDeleteTarget === null
          ? {}
          : { description: t('delete.session.desc', { name: sessionDeleteTarget.title }) }}
        footer={(
          <>
            <Button variant="outline" disabled={sessionDeleting} onClick={closeSessionDelete}>{t('cancel')}</Button>
            <Button
              variant="outline"
              className={css.deleteAction}
              disabled={sessionDeleting}
              onClick={confirmSessionDelete}
            >
              {t('delete.session.title')}
            </Button>
          </>
        )}
      >
        {sessionDeleting && <div className={css.deleteStatus} role="status">{t('delete.session.pending')}</div>}
        {sessionDeleteError !== null && <div className={css.renameError} role="alert">{sessionDeleteError}</div>}
      </Modal>
    </div>
  )
}
