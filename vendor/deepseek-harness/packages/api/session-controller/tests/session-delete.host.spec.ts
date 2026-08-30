import { mkdirSync, mkdtempSync, realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import AgentRegistry, { Inbox } from '@deepseek-ai/dsh-agent'
import type { Agent, AgentFactory } from '@deepseek-ai/dsh-agent'
import SessionStore, { SessionId, SESSION_FORMAT_VERSION } from '@deepseek-ai/dsh-session'
import type { Session, SessionHeader } from '@deepseek-ai/dsh-session'
import Storage from '@deepseek-ai/dsh-storage'
import { DomainFacility } from '@deepseek-ai/dsh-storage-domain'
import { TypertRemoteFailure } from '@deepseek-ai/dsh-typert-protocol'
import WorkspaceRegistry from '@deepseek-ai/dsh-workspace'
import WorkspaceController from '../../workspace-controller/src/index.ts'
import SessionController from '../src/index.ts'
import { createSessionTestController, testSessionPersistence } from './test-remote.ts'
import { MemoryStorageBackend } from '../../../storage/storage-domain/tests/helpers/memory-backend.ts'

function expectFailure(error: unknown, code: string): void {
  expect(error).toBeInstanceOf(TypertRemoteFailure)
  expect((error as TypertRemoteFailure).failure.code).toBe(code)
}

async function expectRejected(operation: Promise<unknown>, code: string): Promise<void> {
  await expect(operation).rejects.toMatchObject({ failure: { code } })
}

/** In-memory persistence covering the Host delete list/load/locate/delete path. */
class MemorySessionPersistence {
  private readonly headers = new Map<string, SessionHeader>()
  failDelete?: (id: SessionId) => Error | undefined
  readonly deleted: SessionId[] = []

  list(): Promise<SessionHeader[]> {
    return Promise.resolve([...this.headers.values()])
  }

  create(header: SessionHeader): Promise<void> {
    this.headers.set(header.id, header)
    return Promise.resolve()
  }

  load(id: SessionId): Promise<{ meta: SessionHeader; events: never[] }> {
    const stored = this.headers.get(id)
    if (stored === undefined) return Promise.reject(new Error(`session "${id}" not found`))
    return Promise.resolve({ meta: stored, events: [] })
  }

  inspect(id: SessionId): Promise<{ meta: SessionHeader; events: never[] }> {
    return this.load(id)
  }

  locate(header: SessionHeader): { kind: 'memory'; path: string } | undefined {
    return this.headers.has(header.id) ? { kind: 'memory', path: `/memory/${header.id}` } : undefined
  }

  delete(id: SessionId): Promise<void> {
    const forced = this.failDelete?.(id)
    if (forced !== undefined) return Promise.reject(forced)
    if (!this.headers.has(id)) return Promise.reject(new Error(`session "${id}" not found`))
    this.headers.delete(id)
    this.deleted.push(id)
    return Promise.resolve()
  }
}

function persistHeader(
  over: Partial<SessionHeader> & Pick<SessionHeader, 'id'> & { cwd: string },
): SessionHeader {
  return { version: SESSION_FORMAT_VERSION, createdAt: 1, ...over }
}

function stubAgent(session: Session): Agent {
  return {
    id: session.id,
    options: {},
    session,
    inbox: new Inbox(session, { inserted: () => {}, discarded: () => {}, claimed: () => {} }),
    status: 'idle',
    ctx: new Context(),
    send: () => {},
    followup: () => {},
    steer: () => ({ outcome: Promise.resolve({ status: 'rejected' as const }) }),
    inject: () => {},
    cancel() {},
    runMaintenance: job => job(new AbortController().signal),
    whenIdle: () => Promise.resolve(),
  }
}

async function harness() {
  const root = realpathSync.native(mkdtempSync(join(tmpdir(), 'dsh-session-delete-')))
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(Storage)
  ctx.storage.backend.register('memory', new MemoryStorageBackend())
  const storageDomain = new DomainFacility(ctx, { backend: 'memory', routes: {} })
  ctx.storage.mount('domain', storageDomain)
  ctx.provide('storageDomain', storageDomain)
  const persist = new MemorySessionPersistence()
  Object.assign(persist, testSessionPersistence(ctx, persist as never))
  ctx.provide('sessionPersistence', persist as never)
  await ctx.plugin(WorkspaceRegistry)

  const factory: AgentFactory = {
    async createAgent(_ownerCtx, options) {
      const session = ctx.sessions.create(
        options.sessionId,
        options.meta === undefined ? {} : { meta: options.meta },
      )
      const agent = stubAgent(session)
      const unregister = ctx.agents.register(agent)
      return {
        agent,
        dispose: () => {
          unregister()
          return Promise.resolve()
        },
      }
    },
    async resume(_ownerCtx, options) {
      const live = ctx.agents.get(options.resumeSessionId)
      if (live !== undefined) {
        return { agent: live, dispose: () => Promise.resolve() }
      }
      let session = ctx.sessions.get(options.resumeSessionId)
      if (session === undefined) {
        const stored = (await persist.list()).find(header => header.id === options.resumeSessionId)
        session = ctx.sessions.create(
          options.resumeSessionId,
          stored?.cwd === undefined ? {} : { meta: { cwd: stored.cwd } },
        )
      }
      const agent = stubAgent(session)
      const unregister = ctx.agents.register(agent)
      return {
        agent,
        dispose: () => {
          unregister()
          return Promise.resolve()
        },
      }
    },
  }
  ctx.agents.setFactory(factory)
  ctx.provide('attachments', {} as never)
  const controller = createSessionTestController(ctx, {
    defaultModelSelection: () => ({ provider: 'test', model: 'test-model' }),
    cwd: root,
  })
  const workspace = new WorkspaceController(ctx)
  return { controller, workspace, ctx, persist, root }
}

function stageDir(root: string, name: string): string {
  const path = join(root, name)
  mkdirSync(path)
  return path
}

async function createArchived(
  h: Awaited<ReturnType<typeof harness>>,
  name: string,
): Promise<SessionId> {
  const created = await h.workspace.create({ path: stageDir(h.root, name) })
  const minted = await h.controller.create({ workspaceId: created.workspace.workspaceId })
  await h.persist.create(h.ctx.sessions.get(minted.sessionId)!.header)
  await h.workspace.archiveSession({ sessionId: minted.sessionId })
  return minted.sessionId
}

describe('session.delete', () => {
  it('refuses a known session that is not archived', async () => {
    const h = await harness()
    const created = await h.workspace.create({ path: stageDir(h.root, 'live') })
    const minted = await h.controller.create({ workspaceId: created.workspace.workspaceId })
    const sessionId = minted.sessionId
    await h.persist.create(h.ctx.sessions.get(sessionId)!.header)

    await expectRejected(h.controller.delete({ sessionId }), 'session-not-archived')
  })

  it('reports session-not-found for a ghost id', async () => {
    const h = await harness()
    await expectRejected(h.controller.delete({ sessionId: SessionId('session-ghost') }), 'session-not-found')
  })

  it('refuses when any agent in the deletable set is running and deletes nothing', async () => {
    const h = await harness()
    const sessionId = await createArchived(h, 'running')
    const agent = h.ctx.agents.get(sessionId)
    expect(agent).toBeDefined()
    ;(agent as { status: Agent['status'] }).status = 'running'

    await expectRejected(h.controller.delete({ sessionId }), 'session-running')
    expect(h.ctx.agents.get(sessionId)).toBeDefined()
    expect((await h.persist.list()).map(item => item.id)).toContain(sessionId)
    expect(h.ctx.workspaceRegistry.archivedSessionIds).toContain(sessionId)
  })

  it('deletes nested persist-only subagents even when the child is not archived, and leaves a fork child listed', async () => {
    const h = await harness()
    const childId = SessionId('session-delete-child')
    const grandId = SessionId('session-delete-grand')
    const forkId = SessionId('session-delete-fork')
    const botId = SessionId('session-delete-dshbot')
    const rootId = await createArchived(h, 'tree')
    await h.persist.create(persistHeader({
      id: childId, cwd: h.root, origin: 'subagent', parentSession: rootId,
    }))
    await h.persist.create(persistHeader({
      id: grandId, cwd: h.root, origin: 'subagent', parentSession: childId,
    }))
    await h.persist.create(persistHeader({ id: forkId, cwd: h.root, parentSession: rootId }))
    await h.persist.create(persistHeader({ id: botId, cwd: h.root, origin: 'dshbot', parentSession: rootId }))

    const removed: SessionId[] = []
    h.ctx.on('api-session/removed', (id: SessionId) => { removed.push(id) })

    const result = await h.controller.delete({ sessionId: rootId })
    expect(result.deletedSessionIds).toEqual(expect.arrayContaining([rootId, childId, grandId]))
    expect(result.deletedSessionIds).not.toContain(forkId)
    expect(result.deletedSessionIds).not.toContain(botId)
    expect(result.archivedSessionIds).not.toContain(rootId)
    expect(removed).toEqual(expect.arrayContaining([rootId, childId, grandId]))
    expect(removed).toHaveLength(3)
    expect(h.persist.deleted).toEqual([grandId, childId, rootId])
    expect((await h.persist.list()).map(item => item.id).sort()).toEqual([botId, forkId].sort())
    expect(h.ctx.workspaceRegistry.archivedSessionIds).not.toContain(rootId)
  })

  it('retains a handle from ctx.agents.resume so an idle archived live owner can delete', async () => {
    const h = await harness()
    const sessionId = SessionId('session-resume-retain')
    await h.persist.create(persistHeader({ id: sessionId, cwd: h.root }))
    await h.ctx.agents.resume({ resumeSessionId: sessionId })
    expect(h.ctx.agents.get(sessionId)).toBeDefined()
    expect(h.ctx.agents.get(sessionId)?.status).toBe('idle')
    await h.workspace.archiveSession({ sessionId })

    const result = await h.controller.delete({ sessionId })
    expect(result.deletedSessionIds).toEqual([sessionId])
    expect(h.ctx.agents.get(sessionId)).toBeUndefined()
    expect((await h.persist.list()).map(item => item.id)).not.toContain(sessionId)
  })

  it('fails the whole call when a live agent in the set has no retained handle', async () => {
    const h = await harness()
    const sessionId = SessionId('session-live-unowned')
    const session = h.ctx.sessions.create(sessionId, { meta: { cwd: h.root } })
    h.ctx.agents.register(stubAgent(session))
    await h.persist.create(session.header)
    await h.workspace.archiveSession({ sessionId })

    await expectRejected(h.controller.delete({ sessionId }), 'session-live-unowned')
    expect(h.ctx.agents.get(sessionId)).toBeDefined()
    expect((await h.persist.list()).map(item => item.id)).toContain(sessionId)
  })

  it('skips a persist id that is already gone and still commits unarchive', async () => {
    const h = await harness()
    const sessionId = await createArchived(h, 'resume')
    await h.persist.delete(sessionId)

    const result = await h.controller.delete({ sessionId })
    expect(result.deletedSessionIds).toEqual([sessionId])
    expect(result.archivedSessionIds).not.toContain(sessionId)
    expect(h.ctx.workspaceRegistry.archivedSessionIds).not.toContain(sessionId)
  })

  it('does not unarchive, detach, or publish when persist.delete fails and the log remains', async () => {
    const h = await harness()
    const sessionId = await createArchived(h, 'eperm')
    h.persist.failDelete = id => id === sessionId
      ? Object.assign(new Error('EPERM: disk full'), { code: 'EPERM' })
      : undefined

    const removed: SessionId[] = []
    h.ctx.on('api-session/removed', (id: SessionId) => { removed.push(id) })
    await expect(h.controller.delete({ sessionId })).rejects.toThrow(/EPERM: disk full/)
    expect(h.persist.deleted).toEqual([])
    expect((await h.persist.list()).map(item => item.id)).toContain(sessionId)
    expect(h.ctx.workspaceRegistry.archivedSessionIds).toContain(sessionId)
    expect(removed).toEqual([])
  })

  it('returns session-delete-partial when a child is gone but the root persist fails', async () => {
    const h = await harness()
    const childId = SessionId('session-partial-child')
    const rootId = await createArchived(h, 'partial')
    await h.persist.create(persistHeader({
      id: childId, cwd: h.root, origin: 'subagent', parentSession: rootId,
    }))
    h.persist.failDelete = id => id === rootId
      ? Object.assign(new Error('EPERM: root locked'), { code: 'EPERM' })
      : undefined

    const removed: SessionId[] = []
    h.ctx.on('api-session/removed', (id: SessionId) => { removed.push(id) })
    try {
      await h.controller.delete({ sessionId: rootId })
      expect.fail('expected session-delete-partial')
    } catch (error: unknown) {
      expectFailure(error, 'session-delete-partial')
      expect((error as TypertRemoteFailure).failure.details).toMatchObject({
        sessionId: rootId, deletedSessionIds: [childId],
      })
    }
    expect(removed).toEqual([childId])
    expect(h.persist.deleted).toEqual([childId])
    expect((await h.persist.list()).map(item => item.id)).toContain(rootId)
    expect(h.ctx.workspaceRegistry.archivedSessionIds).toContain(rootId)
  })

  it('retains a handle from ctx.agents.create so a live subagent child deletes with the root', async () => {
    const h = await harness()
    const childId = SessionId('session-create-retain-child')
    const rootId = await createArchived(h, 'create-retain')
    await h.ctx.agents.create({
      sessionId: childId,
      meta: { cwd: h.root, origin: 'subagent', parentSession: rootId },
    })
    await h.persist.create(h.ctx.sessions.get(childId)!.header)

    const result = await h.controller.delete({ sessionId: rootId })
    expect(result.deletedSessionIds).toEqual(expect.arrayContaining([rootId, childId]))
    expect(h.ctx.agents.get(rootId)).toBeUndefined()
    expect(h.ctx.agents.get(childId)).toBeUndefined()
    expect((await h.persist.list()).map(item => item.id)).toEqual([])
  })

  it('rejects unarchive while session.delete holds deletingIds', async () => {
    const h = await harness()
    const sessionId = await createArchived(h, 'mutex')

    let releaseGate!: () => void
    const gate = new Promise<void>(resolve => { releaseGate = resolve })
    let enteredPersist = false
    const originalDelete = h.persist.delete.bind(h.persist)
    h.persist.delete = async (id: SessionId) => {
      if (id === sessionId) {
        enteredPersist = true
        await gate
      }
      return originalDelete(id)
    }

    const deletePromise = h.controller.delete({ sessionId })
    for (let i = 0; i < 200 && !enteredPersist; i++) {
      await new Promise(resolve => setTimeout(resolve, 5))
    }
    expect(enteredPersist).toBe(true)

    await expectRejected(h.workspace.unarchiveSession({ sessionId }), 'session-delete-in-progress')
    expect(h.ctx.workspaceRegistry.archivedSessionIds).toContain(sessionId)

    releaseGate()
    const result = await deletePromise
    expect(result.deletedSessionIds).toEqual([sessionId])
    expect(h.ctx.workspaceRegistry.archivedSessionIds).not.toContain(sessionId)
  })

  it('rejects archive while session.delete holds deletingIds', async () => {
    const h = await harness()
    const sessionId = await createArchived(h, 'archive-mutex')

    let releaseGate!: () => void
    const gate = new Promise<void>(resolve => { releaseGate = resolve })
    let enteredPersist = false
    const originalDelete = h.persist.delete.bind(h.persist)
    h.persist.delete = async (id: SessionId) => {
      if (id === sessionId) {
        enteredPersist = true
        await gate
      }
      return originalDelete(id)
    }

    const deletePromise = h.controller.delete({ sessionId })
    for (let i = 0; i < 200 && !enteredPersist; i++) {
      await new Promise(resolve => setTimeout(resolve, 5))
    }
    expect(enteredPersist).toBe(true)

    await expectRejected(h.workspace.archiveSession({ sessionId }), 'session-delete-in-progress')
    releaseGate()
    await deletePromise
  })

  it('prunes archived ids whose durable log and live agent are both gone', async () => {
    const h = await harness()
    const ghostId = SessionId('session-archive-ghost')
    await h.persist.create(persistHeader({ id: ghostId, cwd: h.root }))
    await h.workspace.archiveSession({ sessionId: ghostId })
    await h.persist.delete(ghostId)
    const liveId = await createArchived(h, 'prune-live')

    const result = await h.controller.delete({ sessionId: liveId })
    expect(result.deletedSessionIds).toEqual([liveId])
    expect(result.archivedSessionIds).not.toContain(ghostId)
    expect(h.ctx.workspaceRegistry.archivedSessionIds).not.toContain(ghostId)
  })
})

export type { SessionController }

