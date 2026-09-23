import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type {
  TeamMemberView as TeamRosterMember,
  TeamTaskView as TeamTask,
  TeamView,
} from '@deepseek-ai/dsh-experimental-agent-team/client'
import type { RemoteResult } from '@deepseek-ai/dsh-api-remotes/client'
import {
  IconCloseOutlineRegular, IconRefreshOutlineRegular, IconUserOutlineRegular, StateDot,
  useAnchoredPosition, useDismissOnOutsidePointer, type StateDotState,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import { NS, type TeamKey } from './locales.ts'
import css from './TeamAction.module.css'

/** Generated Remote result consumed directly by the Team UI. */
export type TeamActionResult<T> = RemoteResult<T>

/** Business actions injected by the browser plugin. */
export interface TeamActionInjected {
  load: (sessionId: SessionId) => Promise<TeamActionResult<TeamView>>
  openTeammate: (sessionId: SessionId, member: TeamRosterMember) => void
}

/** Full props of the Team conversation-header action. */
export type TeamActionProps =
  PropsRuntime<'conversation.session.header.actions'> & TeamActionInjected & PropsLocale<typeof NS>

function failureText(error: { readonly code: string; readonly message: string }): string {
  return `${error.message} (${error.code})`
}

function statusKey(status: TeamTask['status']): TeamKey {
  switch (status) {
    case 'pending': return 'status.pending'
    case 'in_progress': return 'status.in_progress'
    case 'completed': return 'status.completed'
    /* v8 ignore next -- Team views omit deleted task tombstones. */
    case 'deleted': return 'status.completed'
  }
}

function memberStatusKey(status: TeamRosterMember['status']): TeamKey {
  switch (status) {
    case 'running': return 'memberStatus.running'
    case 'inactive': return 'memberStatus.inactive'
    case 'provisioning': return 'memberStatus.provisioning'
    case 'failed': return 'memberStatus.failed'
  }
}

function memberDotState(status: TeamRosterMember['status']): StateDotState {
  switch (status) {
    case 'running':
    case 'provisioning': return 'ongoing'
    case 'inactive': return 'idle'
    case 'failed': return 'error'
  }
}

function taskDotState(task: TeamTask): StateDotState {
  switch (task.status) {
    case 'pending': return task.ready ? 'idle' : 'warning'
    case 'in_progress': return 'ongoing'
    case 'completed': return 'done'
    /* v8 ignore next -- Team views omit deleted task tombstones. */
    case 'deleted': return 'idle'
  }
}

/** Render the Team roster and read-only task board. */
export function TeamAction({
  sessionId, load, openTeammate, t,
}: TeamActionProps) {
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [view, setView] = useState<TeamView | null>(null)
  const [error, setError] = useState<string | null>(null)
  const rootRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const position = useAnchoredPosition({
    open, anchorRef: triggerRef, panelRef, gap: 5, margin: 16,
  })
  const positioned = position !== null
  useDismissOnOutsidePointer(rootRef, open, setOpen, panelRef)
  const sessionRef = useRef(sessionId)
  const refreshGeneration = useRef(0)
  sessionRef.current = sessionId

  useEffect(() => {
    refreshGeneration.current += 1
    setOpen(false)
    setLoading(false)
    setView(null)
    setError(null)
  }, [sessionId])

  useLayoutEffect(() => {
    if (open && positioned) panelRef.current?.focus()
  }, [open, positioned])

  const close = (): void => {
    setOpen(false)
    triggerRef.current?.focus()
  }

  const refresh = useCallback(async (): Promise<void> => {
    const requestedSession = sessionId
    const generation = ++refreshGeneration.current
    setLoading(true)
    const result = await load(requestedSession)
    if (sessionRef.current !== requestedSession || refreshGeneration.current !== generation) return
    setLoading(false)
    if (result.ok) {
      setView(result.value)
      setError(null)
    } else {
      setError(failureText(result.error))
    }
  }, [load, sessionId])

  const teammates = view?.members.filter(member => member.role === 'teammate') ?? []

  return (
    <div ref={rootRef} className={css.root} data-team-action onKeyDown={(event) => {
      if (event.key !== 'Escape' || !open) return
      event.preventDefault()
      close()
    }} onBlur={(event) => {
      const target = event.relatedTarget
      if (target instanceof Node && !event.currentTarget.contains(target) && !panelRef.current?.contains(target)) {
        setOpen(false)
      }
    }}>
      <button
        type="button"
        ref={triggerRef}
        className={css.trigger}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => {
          const next = !open
          setOpen(next)
          if (next) void refresh()
        }}
      >
        <IconUserOutlineRegular size={14} />
        <span>{t('trigger')}</span>
        {teammates.length > 0 && <span className={css.count}>{teammates.length}</span>}
      </button>
      {open && createPortal(
        <div
          ref={panelRef}
          className={css.panel}
          style={position ?? { visibility: 'hidden', left: 0, top: 0 }}
          role="dialog"
          tabIndex={-1}
          aria-label={t('trigger')}
          data-team-panel
        >
          <div className={css.toolbar}>
            <strong>{t('trigger')}</strong>
            <span className={css.spacer} />
            {loading && view !== null && (
              <span role="status" aria-label={t('loading')}><StateDot state="ongoing" /></span>
            )}
            <button type="button" className={css.iconButton} aria-label={t('refresh')} onClick={() => { void refresh() }}>
              <IconRefreshOutlineRegular size={14} />
            </button>
            <button type="button" className={css.iconButton} aria-label={t('close')} onClick={close}>
              <IconCloseOutlineRegular size={14} />
            </button>
          </div>
          {error !== null && (
            <div className={css.error} role="alert"><StateDot state="error" />{error}</div>
          )}
          {loading && view === null && (
            <div className={css.notice} role="status"><StateDot state="ongoing" />{t('loading')}</div>
          )}
          {view !== null && (
            <>
              <section>
                <h3>{t('roster')}</h3>
                <div className={css.roster}>
                  {view.members.map(member => (
                    <button
                      key={member.id}
                      type="button"
                      className={css.member}
                      disabled={member.role === 'lead' || member.status === 'failed' || member.status === 'provisioning'}
                      title={member.role === 'teammate' ? t('open') : undefined}
                      onClick={() => {
                        try {
                          openTeammate(sessionId, member)
                        } catch (reason) {
                          setError(String(reason))
                        }
                      }}
                    >
                      <StateDot state={memberDotState(member.status)} />
                      <span className={css.memberText}>
                        <span>{member.name}</span>
                        <small>{t(memberStatusKey(member.status))}{member.model === undefined ? '' : ` · ${t('model')}: ${member.model}`}</small>
                        {member.diagnostics.map(diagnostic => <small key={diagnostic} className={css.diagnostic}>{diagnostic}</small>)}
                      </span>
                    </button>
                  ))}
                </div>
              </section>
              <section>
                <h3>{t('tasks')}</h3>
                {view.tasks.length === 0 && <div className={css.notice}>{t('empty')}</div>}
                <div className={css.tasks}>
                  {view.tasks.map(task => (
                    <article key={task.id} className={css.task}>
                      <div className={css.taskTitle}>
                        <strong>{task.subject}</strong>
                        <span className={css.taskState}>
                          <StateDot state={taskDotState(task)} />
                          <span>{t(statusKey(task.status))}</span>
                        </span>
                      </div>
                      <p>{task.description}</p>
                      <div className={css.meta}>
                        <span>{task.id}</span>
                        <span>{t('owner')}: {task.ownerName ?? t('unowned')}</span>
                        {task.status === 'pending' && <span>{task.ready ? t('ready') : t('blocked')}</span>}
                        {task.blockedBy.length > 0 && <span>{t('blockedBy')}: {task.blockedBy.join(', ')}</span>}
                        {task.writeScopes.length > 0 && <span>{t('writeScopes')}: {task.writeScopes.join(', ')}</span>}
                        {task.writeScopeWarnings.map(warning => <span key={warning} className={css.warning}>{warning}</span>)}
                      </div>
                    </article>
                  ))}
                </div>
              </section>
            </>
          )}
        </div>,
        document.body,
      )}
    </div>
  )
}
