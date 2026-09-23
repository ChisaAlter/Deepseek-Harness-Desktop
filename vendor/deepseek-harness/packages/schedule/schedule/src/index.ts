/**
 * Agent-scoped durable one-shot and fixed-rate reminders over the session event log.
 * @module @deepseek-ai/dsh-schedule
 */

import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { SessionId } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-session-persistence'
// Type-only: resolves ctx.sessionProjections for the optional projection child.
import type {} from '@deepseek-ai/dsh-session-projection'
// Type-only: the Workspace registry's archive-admission events this plugin answers.
import type { SessionActivity } from '@deepseek-ai/dsh-workspace'
import { flushSchedulePersistence } from './persistence.ts'
import { scheduleProjectionDefinition } from './projection.ts'
import { ScheduleRuntime } from './runtime.ts'
import { registerScheduleTools } from './tools.ts'
import { runScheduleTransaction } from './transaction.ts'
import type { ScheduleRecord } from './types.ts'

export type * from './types.ts'
export {
  SCHEDULE_CHANGE_VERSION,
  MIN_EVERY_INTERVAL_SECONDS,
  ScheduleId,
  ScheduleInputError,
  ScheduleLogError,
  allocateScheduleId,
  createAfterScheduleRecord,
  createAtScheduleRecord,
  createEveryScheduleRecord,
  decodeScheduleChange,
  foldScheduleEvents,
  renderReminderFraming,
  renderEveryReminderBatchFraming,
  resolveEveryOccurrence,
  scheduleView,
} from './domain.ts'
export { registerScheduleTools } from './tools.ts'

/** Cordis function-plugin name. */
export const name = 'schedule'
/** Services required before future root agents can receive Schedule. */
export const inject = ['agents', 'sessions', 'tools', 'sessionPersistence']

type OwnerCleanup = () => void | Promise<void>

interface OwnedRuntime {
  readonly runtime: ScheduleRuntime
  readonly cleanup: OwnerCleanup
}

/**
 * Install Schedule only for root agents published after this plugin loads,
 * and answer the Workspace registry's archive admission for every session
 * this plugin owns a runtime for. The owner answers from its own fold of the
 * live log, so a session without a live agent or without an owned runtime
 * — nothing armed that could fire — reports nothing and has nothing to stop.
 * Active reminders count as activity. A stop request is a management delete
 * in the agent's transaction queue, serialized with the tools and the
 * owner's due transaction: it awaits the shared persistence barrier before
 * reading the fold, appends the same durable `schedule/change` delete the
 * `schedule_delete` tool records for every active reminder, and awaits a
 * second barrier after the appends. A failed barrier rejects the stop, which
 * the registry logs, leaving the reminders for the archived-session gate to
 * block when they fire.
 */
export function apply(ctx: Context): void {
  ctx.inject(['sessionProjections'], (projectionCtx) => {
    projectionCtx.sessionProjections.register(scheduleProjectionDefinition)
  })

  const runtimes = new Map<Agent, OwnedRuntime>()
  let stopping = false
  /** The owned runtime's active records for a session id; none without a live agent or an owned runtime. */
  const activeReminders = (sessionId: SessionId): { agent: Agent; active: readonly ScheduleRecord[] } | undefined => {
    const agent = ctx.agents.get(sessionId)
    const active = agent === undefined ? undefined : runtimes.get(agent)?.runtime.activeRecords()
    return agent === undefined || active === undefined ? undefined : { agent, active }
  }

  ctx.effect(() => {
    const stopActivity = ctx.on('workspace/session-activity', async ({ sessionId }, next) => {
      const reminders = activeReminders(sessionId)
      const rest = await next()
      if (reminders === undefined || reminders.active.length === 0) return rest
      const own: SessionActivity = {
        kind: 'schedule',
        items: reminders.active.map(record => ({ id: record.id, label: record.prompt })),
      }
      return [own, ...rest]
    })
    const stopStop = ctx.on('workspace/session-stop', async ({ sessionId }) => {
      const owned = activeReminders(sessionId)
      if (owned === undefined) return
      const { agent } = owned
      await runScheduleTransaction(agent, async () => {
        await flushSchedulePersistence(ctx, agent.session)
        const active = activeReminders(sessionId)?.active ?? []
        if (active.length === 0) return
        for (const record of active) {
          agent.session.append('schedule/change', { version: 1, operation: 'delete', id: record.id })
        }
        runtimes.get(agent)?.runtime.requestDrive()
        await flushSchedulePersistence(ctx, agent.session)
      })
    })
    return () => {
      stopStop()
      stopActivity()
    }
  }, 'schedule.archiveAdmission()')

  ctx.effect(() => {
    const stopCreated = ctx.on('agent/created', ({ agent }) => {
      if (stopping || runtimes.has(agent) || !ctx.agents.roots().includes(agent)) return
      const runtime = new ScheduleRuntime(ctx, agent)
      const cleanup: OwnerCleanup = agent.ctx.effect(() => {
        const disposeTools = registerScheduleTools(ctx, agent.ctx, agent, () => { runtime.requestDrive() })
        const stopStatus = agent.ctx.on('agent/status', ({ status }) => {
          // oxlint-disable-next-line typescript/no-deprecated -- Existing Session history read; migration deferred.
          if (status === 'idle' && agent.session.snapshotEvents().some(event => event.type === 'schedule/change')) {
            runtime.requestDrive()
          }
        })
        runtime.start()
        return async () => {
          stopStatus()
          disposeTools()
          try {
            await runtime.dispose()
          } finally {
            if (runtimes.get(agent)?.cleanup === cleanup) runtimes.delete(agent)
          }
        }
      }, 'schedule.runtime()')
      runtimes.set(agent, { runtime, cleanup })
    })

    return async () => {
      stopping = true
      stopCreated()
      const owned = [...runtimes.values()]
      runtimes.clear()
      await Promise.allSettled(owned.map(({ cleanup }) => Promise.resolve(cleanup())))
    }
  }, 'schedule.lifecycle()')
}
