/** Archived Session destruction: leftover cascade rules with `api-session/removed`. */

import type { Context } from '@deepseek-ai/cordis'
import type { AgentHandle } from '@deepseek-ai/dsh-agent'
import type { SessionHeader, SessionId } from '@deepseek-ai/dsh-session'
import { TypertRemoteFailure } from '@deepseek-ai/dsh-typert-protocol'
import type { SessionDeleteRequest, SessionDeleteValue } from './types.ts'

/**
 * Expand `{root}` with every persisted/live `origin === 'subagent'` header whose
 * parent is already in the set. Nested subagents are included; forks and `dshbot`
 * origins are not.
 * @param root - archived session named by the RPC.
 * @param headers - union of persisted and live headers.
 * @returns the closed deletable set.
 */
function collectDeletable(root: SessionId, headers: Iterable<SessionHeader>): Set<SessionId> {
  const deletable = new Set<SessionId>([root])
  let grew = true
  while (grew) {
    grew = false
    for (const header of headers) {
      if (deletable.has(header.id)) continue
      if (header.origin === 'subagent' && header.parentSession !== undefined && deletable.has(header.parentSession)) {
        deletable.add(header.id)
        grew = true
      }
    }
  }
  return deletable
}

/**
 * Order ids so children precede parents. A remaining id is a leaf when no other
 * remaining id names it as `parentSession`.
 * @param ids - deletable set.
 * @param headers - header lookup for parent links.
 * @returns leaf-to-root order.
 */
function persistDeleteOrder(ids: ReadonlySet<SessionId>, headers: Map<SessionId, SessionHeader>): SessionId[] {
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
 * resume). A failure that leaves the id listed is rethrown so the RPC cannot
 * unarchive, detach, or publish success.
 * @param persist - persistence service for this Host.
 * @param id - session to delete.
 */
async function persistDeleteOrResume(
  persist: { delete(id: SessionId): Promise<void>; list(): Promise<SessionHeader[]> },
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
 * Drop archive-set membership for ids with no durable log and no live
 * session. Persistence list faults fail closed (zero writes). Never calls
 * persist.delete — compensation only.
 * @param ctx - Host context with Workspace registry and optional persistence.
 */
async function pruneMissingArchived(ctx: Context): Promise<void> {
  const persist = ctx.get('sessionPersistence') as
    | { list(): Promise<SessionHeader[]> }
    | undefined
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

function fail(code: string, message: string, details: object): never {
  throw new TypertRemoteFailure({ code, message, details })
}

/**
 * Destroy one archived Session and nested subagent children.
 * @param ctx - Host context with Sessions, Agents, Workspace registry, and gate.
 * @param handles - retained create/resume handles for dispose.
 * @param request - archived Session identity.
 * @returns deleted identities and the resulting archive set.
 */
export async function deleteArchivedSession(
  ctx: Context,
  handles: Map<SessionId, AgentHandle>,
  request: SessionDeleteRequest,
): Promise<SessionDeleteValue> {
  const { sessionId } = request
  const persist = ctx.get('sessionPersistence') as
    | { delete(id: SessionId): Promise<void>; list(): Promise<SessionHeader[]> }
    | undefined
  const headers = new Map<SessionId, SessionHeader>()
  if (persist !== undefined) {
    for (const header of await persist.list()) headers.set(header.id, header)
  }
  for (const session of ctx.sessions.list()) headers.set(session.id, session.header)
  const archived = ctx.workspaceRegistry.archivedSessionIds
  if (!headers.has(sessionId) && !archived.includes(sessionId)) {
    fail('session-not-found', `session "${sessionId}" not found`, { sessionId })
  }
  if (!archived.includes(sessionId)) {
    fail('session-not-archived', `session "${sessionId}" is not archived`, { sessionId })
  }

  const deletable = collectDeletable(sessionId, headers.values())
  for (const id of deletable) {
    if (ctx.agents.get(id)?.status === 'running') {
      fail('session-running', `session "${id}" is running`, { sessionId: id })
    }
  }
  for (const id of deletable) {
    if (ctx.agents.get(id) !== undefined && !handles.has(id)) {
      fail(
        'session-live-unowned',
        `session "${id}" is live without a retained handle`,
        { sessionId: id },
      )
    }
  }

  const ordered = persistDeleteOrder(deletable, headers)
  ctx.sessionDeleteGate.add(deletable)
  try {
    // Re-check after acquiring deletingIds so a concurrent unarchive
    // that won the race before the mutex still fails closed.
    if (!ctx.workspaceRegistry.archivedSessionIds.includes(sessionId)) {
      fail('session-not-archived', `session "${sessionId}" is not archived`, { sessionId })
    }

    const gone: SessionId[] = []
    let firstError: unknown
    for (const id of ordered) {
      try {
        const handle = handles.get(id)
        if (handle !== undefined) await handle.dispose()
        if (persist !== undefined) await persistDeleteOrResume(persist, id)
        gone.push(id)
      } catch (error: unknown) {
        firstError = error
        break
      }
    }

    for (const id of gone) {
      ctx.emit('api-session/removed', id)
    }

    const rootGone = gone.includes(sessionId)
    if (rootGone) {
      let registryError: unknown
      try {
        await ctx.workspaceRegistry.unarchiveSession(sessionId)
      } catch (error: unknown) {
        registryError = error
      }
      try {
        for (const workspace of ctx.workspaceRegistry.list()) {
          for (const id of gone) await workspace.detachSession(id)
        }
      } catch (error: unknown) {
        registryError ??= error
      }
      await pruneMissingArchived(ctx)
      if (registryError !== undefined) {
        fail(
          'session-delete-incomplete',
          registryError instanceof Error
            ? registryError.message
            : `session delete incomplete for "${sessionId}"`,
          { sessionId, deletedSessionIds: [...gone] },
        )
      }
      return {
        deletedSessionIds: ordered,
        archivedSessionIds: [...ctx.workspaceRegistry.archivedSessionIds],
      }
    }

    for (const workspace of ctx.workspaceRegistry.list()) {
      for (const id of gone) await workspace.detachSession(id)
    }
    await pruneMissingArchived(ctx)
    if (gone.length === 0) {
      throw firstError instanceof Error ? firstError : new Error(String(firstError))
    }
    const cause = firstError instanceof Error ? firstError.message : String(firstError)
    fail(
      'session-delete-partial',
      `session delete partially applied for "${sessionId}": ${cause}`,
      { sessionId, deletedSessionIds: [...gone], cause },
    )
  } finally {
    ctx.sessionDeleteGate.remove(deletable)
  }
}
