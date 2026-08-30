/** In-flight archived Session delete mutex visible to Workspace archive commands. */

import type { Context } from '@deepseek-ai/cordis'
import type { AgentHandle } from '@deepseek-ai/dsh-agent'
import type { SessionId } from '@deepseek-ai/dsh-session'

/** Session identities currently inside `session.delete`. */
export class SessionDeleteGate {
  private readonly ids = new Set<SessionId>()

  /**
   * @param sessionId - Session identity to probe.
   * @returns whether that identity is in an in-flight delete.
   */
  has(sessionId: SessionId): boolean {
    return this.ids.has(sessionId)
  }

  /**
   * @param ids - identities to mark as deleting.
   */
  add(ids: Iterable<SessionId>): void {
    for (const id of ids) this.ids.add(id)
  }

  /**
   * @param ids - identities to release from the mutex.
   */
  remove(ids: Iterable<SessionId>): void {
    for (const id of ids) this.ids.delete(id)
  }
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** In-flight `session.delete` identities; Workspace archive commands consult this. */
    sessionDeleteGate: SessionDeleteGate
  }
}

/**
 * Remember the live AgentHandle and wrap dispose so the map entry is dropped.
 * @param handles - SessionController-owned handle map.
 * @param sessionId - live session identity.
 * @param handle - factory create/resume handle.
 * @returns the wrapped handle stored in the map.
 */
export function retainAgentHandle(
  handles: Map<SessionId, AgentHandle>,
  sessionId: SessionId,
  handle: AgentHandle,
): AgentHandle {
  const existing = handles.get(sessionId)
  // Same live agent: keep the first wrapped dispose. A later resume handle
  // for that agent is not adopted (its dispose is not called from this map).
  if (existing !== undefined && existing.agent === handle.agent) return existing
  const originalDispose = handle.dispose.bind(handle)
  const wrapped: AgentHandle = {
    agent: handle.agent,
    dispose: async () => {
      try {
        await originalDispose()
      } finally {
        if (handles.get(sessionId) === wrapped) handles.delete(sessionId)
      }
    },
  }
  handles.set(sessionId, wrapped)
  return wrapped
}

/**
 * Wrap `ctx.agents.create` and `ctx.agents.resume` so delete can dispose idle owners.
 * @param ctx - Host context whose Agent factory is wrapped.
 * @param handles - map filled by retained create/resume handles.
 */
export function wrapAgentFactoryHandles(
  ctx: Context,
  handles: Map<SessionId, AgentHandle>,
): void {
  const nativeResume = ctx.agents.resume.bind(ctx.agents)
  ctx.agents.resume = (async (options) => {
    const handle = await nativeResume(options)
    retainAgentHandle(handles, options.resumeSessionId, handle)
    return handles.get(options.resumeSessionId) ?? handle
  }) as typeof ctx.agents.resume

  const nativeCreate = ctx.agents.create.bind(ctx.agents)
  ctx.agents.create = (async (options) => {
    const handle = await nativeCreate(options)
    retainAgentHandle(handles, options.sessionId, handle)
    return handles.get(options.sessionId) ?? handle
  }) as typeof ctx.agents.create
}
