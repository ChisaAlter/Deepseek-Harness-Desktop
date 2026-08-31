/** Retained Agent handles and the in-flight delete mutex for Session destruction. */

import type { Context } from '@deepseek-ai/cordis'
import type { AgentHandle } from '@deepseek-ai/dsh-agent'
import type { SessionId } from '@deepseek-ai/dsh-session'

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Present while the Session Controller owns live Agent handles. */
    sessionLifecycle?: SessionLifecycle
  }
}

/** Wraps `ctx.agents.create` / `resume` so `session.delete` can dispose live owners. */
export class SessionLifecycle {
  /** Session ids currently inside `session.delete` orchestration. */
  readonly deletingIds = new Set<SessionId>()
  private readonly handles = new Map<SessionId, AgentHandle>()

  /** @param ctx - Host context whose Agent registry is wrapped. */
  constructor(ctx: Context) {
    const registry = ctx.agents
    const create = registry.create.bind(registry)
    const resume = registry.resume.bind(registry)
    registry.create = async (options) => this.retainHandle(await create(options))
    registry.resume = async (options) => this.retainHandle(await resume(options))
    ctx.provide('sessionLifecycle', this)
  }

  /**
   * Remember one successful create/resume handle. Idempotent when the mapped
   * agent is already that live instance.
   * @param handle - factory-returned Agent handle.
   * @returns the same handle, with dispose clearing this map.
   */
  retainHandle(handle: AgentHandle): AgentHandle {
    const id = handle.agent.id
    const existing = this.handles.get(id)
    if (existing?.agent === handle.agent) return existing
    const dispose = handle.dispose.bind(handle)
    const wrapped: AgentHandle = {
      agent: handle.agent,
      dispose: async () => {
        try {
          await dispose()
        } finally {
          if (this.handles.get(id) === wrapped) this.handles.delete(id)
        }
      },
    }
    this.handles.set(id, wrapped)
    return wrapped
  }

  /**
   * The retained handle for one Session, if this process created or resumed it.
   * @param id - Session identity.
   */
  handleOf(id: SessionId): AgentHandle | undefined {
    return this.handles.get(id)
  }
}
