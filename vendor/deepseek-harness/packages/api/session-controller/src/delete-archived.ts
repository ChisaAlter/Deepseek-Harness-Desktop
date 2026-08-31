/** Archived-root Session log destruction owned by the Session Controller. */

import type { Context } from '@deepseek-ai/cordis'
import type { SessionHeader, SessionId } from '@deepseek-ai/dsh-session'
import type { SessionPersistence } from '@deepseek-ai/dsh-session-persistence'
import { RemoteError } from '@deepseek-ai/dsh-typert-protocol'
import type { SessionLifecycle } from './lifecycle.ts'
import type { SessionDeleteRequest, SessionDeleteValue } from './types.ts'

/**
 * Collect `{root}` plus every persisted or live header with `origin === 'subagent'`
 * whose `parentSession` is already in the set.
 * @param root - archived request root.
 * @param headers - live and persisted headers.
 */
export function collectDeletable(root: SessionId, headers: Iterable<SessionHeader>): Set<SessionId> {
  const deletable = new Set<SessionId>([root])
  let grew = true
  while (grew) {
    grew = false
    for (const header of headers) {
      if (deletable.has(header.id)) continue
      if (header.origin === 'subagent' && header.parentSession !== undefined
        && deletable.has(header.parentSession)) {
        deletable.add(header.id)
        grew = true
      }
    }
  }
  return deletable
}

/**
 * Order ids so children precede parents. A remaining id is a leaf when no
 * other remaining id names it as `parentSession`.
 * @param ids - deletable set.
 * @param headers - header lookup for parent links.
 */
export function persistDeleteOrder(
  ids: ReadonlySet<SessionId>,
  headers: Map<SessionId, SessionHeader>,
): SessionId[] {
  const remaining = new Set(ids)
  const ordered: SessionId[] = []
  while (remaining.size > 0) {
    const leaves = [...remaining].filter(id => ![...remaining].some(other => headers.get(other)?.parentSession === id))
    const batch = leaves.length > 0 ? leaves : [[...remaining][0]!]
    for (const id of batch) {
      remaining.delete(id)
      ordered.push(id)
    }
  }
  return ordered
}

/**
 * Delete one persisted log. Skip only when the id is already gone (crash
 * resume). A failure that leaves the id listed is rethrown.
 */
async function persistDeleteOrResume(
  persist: Pick<SessionPersistence, 'delete' | 'list'>,
  id: SessionId,
): Promise<void> {
  try {
    await persist.delete(id)
  } catch (error) {
    let remaining = true
    try {
      remaining = (await persist.list()).some(header => header.id === id)
    } catch {
      // Listing also failed: the durable log may still be present.
    }
    if (remaining) throw error
  }
}

/**
 * Drop archive-set membership for ids with no durable log and no live session.
 * Persistence list faults fail closed (zero writes). Never calls persist.delete.
 */
export async function pruneMissingArchived(ctx: Context): Promise<void> {
  const persist = ctx.get('sessionPersistence')
  let listed: SessionHeader[]
  try {
    listed = persist === undefined ? [] : await persist.list()
  } catch {
    return
  }
  const known = new Set<SessionId>(listed.map(header => header.id))
  for (const session of ctx.sessions.list()) known.add(session.id)
  for (const id of [...ctx.workspaceRegistry.archivedSessionIds]) {
    if (known.has(id)) continue
    await ctx.workspaceRegistry.unarchiveSession(id)
  }
}

/** Host orchestration for `session.delete`. */
export class ArchivedSessionDelete {
  /**
   * @param ctx - Host context with sessions, agents, workspace registry, and persistence.
   * @param lifecycle - retained handles and deleting-id mutex.
   */
  constructor(
    private readonly ctx: Context,
    private readonly lifecycle: SessionLifecycle,
  ) {}

  /**
   * Destroy one archived root and its `origin === 'subagent'` descendants.
   * @param request - archived root identity.
   */
  async delete(request: SessionDeleteRequest): Promise<SessionDeleteValue> {
    const { sessionId } = request
    const persist = this.ctx.get('sessionPersistence')
    const headers = new Map<SessionId, SessionHeader>()
    if (persist !== undefined) {
      for (const header of await persist.list()) headers.set(header.id, header)
    }
    for (const session of this.ctx.sessions.list()) headers.set(session.id, session.header)
    const archived = this.ctx.workspaceRegistry.archivedSessionIds
    if (!headers.has(sessionId) && !archived.includes(sessionId)) {
      throw new RemoteError(
        'session/not-found',
        `session "${sessionId}" not found`,
        { sessionId },
      )
    }
    if (!archived.includes(sessionId)) {
      throw new RemoteError(
        'session-not-archived',
        `session "${sessionId}" is not archived`,
        { sessionId },
      )
    }

    const deletable = collectDeletable(sessionId, headers.values())
    for (const id of deletable) {
      if (this.ctx.agents.get(id)?.status === 'running') {
        throw new RemoteError(
          'session-running',
          `session "${id}" is running`,
          { sessionId: id },
        )
      }
    }
    for (const id of deletable) {
      if (this.ctx.agents.get(id) !== undefined && this.lifecycle.handleOf(id) === undefined) {
        throw new RemoteError(
          'session-live-unowned',
          `session "${id}" is live without a retained handle`,
          { sessionId: id },
        )
      }
    }

    const ordered = persistDeleteOrder(deletable, headers)
    for (const id of deletable) this.lifecycle.deletingIds.add(id)
    try {
      if (!this.ctx.workspaceRegistry.archivedSessionIds.includes(sessionId)) {
        throw new RemoteError(
          'session-not-archived',
          `session "${sessionId}" is not archived`,
          { sessionId },
        )
      }

      const gone: SessionId[] = []
      let firstError: unknown
      for (const id of ordered) {
        try {
          const handle = this.lifecycle.handleOf(id)
          if (handle !== undefined) await handle.dispose()
          if (persist !== undefined) await persistDeleteOrResume(persist, id)
          gone.push(id)
        } catch (error: unknown) {
          firstError = error
          break
        }
      }

      for (const id of gone) this.ctx.emit('api-session/deleted', id)

      const rootGone = gone.includes(sessionId)
      if (rootGone) {
        let registryError: unknown
        try {
          await this.ctx.workspaceRegistry.unarchiveSession(sessionId)
        } catch (error: unknown) {
          registryError = error
        }
        try {
          for (const workspace of this.ctx.workspaceRegistry.list()) {
            for (const id of gone) await workspace.detachSession(id)
          }
        } catch (error: unknown) {
          registryError ??= error
        }
        await pruneMissingArchived(this.ctx)
        if (registryError !== undefined) {
          throw new RemoteError(
            'session-delete-incomplete',
            registryError instanceof Error
              ? registryError.message
              : `session delete incomplete for "${sessionId}"`,
            { sessionId, deletedSessionIds: [...gone] },
          )
        }
        return {
          deletedSessionIds: ordered,
          archivedSessionIds: [...this.ctx.workspaceRegistry.archivedSessionIds],
        }
      }

      for (const workspace of this.ctx.workspaceRegistry.list()) {
        for (const id of gone) await workspace.detachSession(id)
      }
      await pruneMissingArchived(this.ctx)
      if (gone.length === 0) {
        throw firstError instanceof Error ? firstError : new Error(String(firstError))
      }
      const cause = firstError instanceof Error ? firstError.message : String(firstError)
      throw new RemoteError(
        'session-delete-partial',
        `session delete partially applied for "${sessionId}": ${cause}`,
        { sessionId, deletedSessionIds: [...gone], cause },
      )
    } finally {
      for (const id of deletable) this.lifecycle.deletingIds.delete(id)
    }
  }
}
