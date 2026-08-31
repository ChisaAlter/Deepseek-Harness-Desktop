import type { ReactNode } from 'react'
import { IconAgentPresetOutline16, StateDot } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { SessionJob as JobView } from '@deepseek-ai/dsh-api-session-controller/types'
import { listSessionAgents } from './agents.ts'
import { NS, type AgentsKey } from './locales.ts'
import css from './AgentsPanel.module.css'

/** Injected navigation into a child session. */
export interface AgentsPanelInjected {
  openAgent: (id: SessionId) => void
}

export type AgentsPanelProps =
  & PropsRuntime<'surfaces.agents'>
  & PropsLocale<typeof NS>
  & InjectFace<AgentsPanelInjected>

const JOB_STATUS_KEY = {
  running: 'jobs.status.running',
  stopping: 'jobs.status.stopping',
  completed: 'jobs.status.completed',
  killed: 'jobs.status.killed',
  failed: 'jobs.status.failed',
} as const satisfies Record<JobView['status'], AgentsKey>

/**
 * Current-session subagent occupant of `surfaces.agents`. Reads the existing
 * session snapshot; it does not dispatch or spawn agents.
 * @param props - session-maybe seats, openAgent, and copy.
 * @returns the agents surface.
 */
export function AgentsPanel({ sessionId, useSessions, openAgent, t }: AgentsPanelProps): ReactNode {
  const agents = useSessions(state => listSessionAgents(state, sessionId))
  const jobs = useSessions((state) => {
    const id = sessionId ?? state.current
    if (id === undefined) return []
    return state.jobsBySession[id] ?? []
  })

  return (
    <div className={css.root} data-agents-panel>
      <div className={css.body}>
        {agents.length === 0 ? (
          <div className={css.empty} data-agents-empty>
            <IconAgentPresetOutline16 size={20} />
            <p className={css.emptyTitle}>{t('empty.title')}</p>
            <p className={css.emptyBody}>{t('empty.body')}</p>
          </div>
        ) : (
          <ul className={css.list} aria-label={t('list.aria')}>
            {agents.map(agent => (
              <li key={agent.id} className={css.row} data-agent-id={agent.id}>
                <button
                  type="button"
                  className={css.open}
                  onClick={() => { openAgent(agent.id) }}
                >
                  <StateDot state={agent.activity === 'running' ? 'ongoing' : 'done'} />
                  <span className={css.label}>{agent.label}</span>
                  <span className={css.meta}>
                    {t(agent.activity === 'running' ? 'activity.running' : 'activity.inactive')}
                    {agent.mode === 'one-shot' ? ` · ${t('mode.oneShot')}` : null}
                    {agent.mode === 'continuable' ? ` · ${t('mode.continuable')}` : null}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
        {jobs.length > 0 ? (
          <div className={css.jobs} data-agents-jobs>
            <h4 className={css.jobsTitle}>{t('jobs.title')}</h4>
            <ul className={css.list} aria-label={t('jobs.aria')}>
              {jobs.map(job => (
                <li key={job.id} className={css.row} data-job-id={job.id}>
                  <span className={css.label}>{job.label}</span>
                  <span className={css.meta}>
                    {t(JOB_STATUS_KEY[job.status])}
                    {job.detail !== undefined ? ` · ${job.detail}` : null}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>
    </div>
  )
}
