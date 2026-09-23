import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { mountAgentLoopTestDependencies } from '@deepseek-ai/dsh-agent-loop-testkit'
import SessionStore, { SessionLogOffset, SessionSeq, SESSION_FORMAT_VERSION, SessionId } from '@deepseek-ai/dsh-session'
import type { SessionEvent, SessionHeader } from '@deepseek-ai/dsh-session'
import JsonlSessionPersistence from '@deepseek-ai/dsh-session-persistence-jsonl'
import { generationLogPath } from '../../../session/session-persistence-jsonl/src/format.ts'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import SessionProjectionCache from '@deepseek-ai/dsh-session-projection-cache'
import Storage from '@deepseek-ai/dsh-storage'
import {
  apply as storageJsonApply, Config as storageJsonConfig, inject as storageJsonInject, name as storageJsonName,
} from '@deepseek-ai/dsh-storage-json'
import {
  apply as storageDomainApply, Config as storageDomainConfig, inject as storageDomainInject, name as storageDomainName,
} from '@deepseek-ai/dsh-storage-domain'
import SubagentRuntime, {
  SUBAGENT_DESCRIPTOR_VERSION,
} from '@deepseek-ai/dsh-subagent'
import * as SubagentSpawn from '@deepseek-ai/dsh-subagent-spawn-in-process'
import * as SubagentFork from '@deepseek-ai/dsh-subagent-fork-in-process'
import { MockAdapter, textResponse } from '../../../core/agent-loop/tests/mock-adapter.ts'
import { TestSessionQuery } from './test-session-query.ts'
import { seedStoredSession } from './persistence-helpers.ts'

type Script = ConstructorParameters<typeof MockAdapter>[0]

const roots: string[] = []
const projectionCacheDisposers: Array<() => Promise<void>> = []
const persistenceDisposers: Array<() => Promise<void>> = []
const projCacheRoots: string[] = []

afterEach(async () => {
  await Promise.all(projectionCacheDisposers.splice(0).map(dispose => dispose()))
  await Promise.all(persistenceDisposers.splice(0).map(dispose => dispose()))
  for (const root of projCacheRoots.splice(0)) rmSync(root, { recursive: true, force: true })
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
})

/** Boot the continuable stack with real JSONL session persistence. */
async function setup(
  script: Script,
  options: { projectionCache?: boolean; compression?: 'none' | 'zstd' } = {},
) {
  const ctx = new Context()
  await mountAgentLoopTestDependencies(ctx)
  const root = mkdtempSync(join(tmpdir(), 'dsh-subagent-list-'))
  roots.push(root)
  const persistence = await ctx.plugin(JsonlSessionPersistence, {
    root,
    ...options.compression === undefined ? {} : { compression: options.compression },
  })
  persistenceDisposers.push(() => persistence.dispose())
  await ctx.plugin(AgentLoop, { agents: [] })
  if (options.projectionCache === true) {
    const root = mkdtempSync(join(tmpdir(), 'dsh-subagent-projcache-'))
    projCacheRoots.push(root)
    // The cache opens its domain through the storage stack; the json backend
    // lands it under this tmp root.
    await ctx.plugin(Storage)
    await ctx.plugin({ name: storageJsonName, inject: storageJsonInject, apply: storageJsonApply, Config: storageJsonConfig }, { root })
    await ctx.plugin({ name: storageDomainName, inject: storageDomainInject, apply: storageDomainApply, Config: storageDomainConfig }, { backend: 'json' })
    const cache = await ctx.plugin(SessionProjectionCache, { writeEveryEvents: 100, writeIntervalMs: 60_000 })
    projectionCacheDisposers.push(() => cache.dispose())
  }
  await ctx.plugin(TestSessionQuery)
  await ctx.plugin(SubagentRuntime)
  await ctx.plugin(SubagentSpawn, { providerName: 'spawn' })
  await ctx.plugin(SubagentFork, { providerName: 'fork' })
  ctx.llm.registerAdapter(['mock'], new MockAdapter(script))
  const loop = ctx.get('agentLoop')
  const parent = loop === undefined
    ? (() => {
      const session = ctx.sessions.create(SessionId('parent'))
      return { id: session.id, session } as Awaited<ReturnType<Context['agentLoop']['create']>>
    })()
    : await loop.create(SessionId('parent'), { provider: 'mock', model: 'mock' })
  return { ctx, parent, root }
}

const testSignal = new AbortController().signal

/** Start one continuable child through the real service path and await Activation release. */
async function startChild(
  ctx: Context,
  parent: Agent,
  label: string,
): Promise<SessionId> {
  const started = await ctx.subagents.startContinuable({
    provider: 'spawn',
    label,
    request: { prompt: [{ type: 'text', text: `task: ${label}` }], parent },
    signal: testSignal,
  })
  await vi.waitFor(() => {
    expect(ctx.agents.get(started.childId)).toBeUndefined()
  }, { timeout: 5_000 })
  return started.childId
}

/** Author one persisted child session directly against the persistence backend. */
async function authorChild(
  ctx: Context,
  id: string,
  header: Partial<SessionHeader>,
  events: SessionEvent[],
  inheritedEventCount?: number,
): Promise<SessionId> {
  const sessionId = SessionId(id)
  const committed = inheritedEventCount === undefined
    ? events
    : [
      ...events.slice(0, inheritedEventCount),
      {
        type: 'session/end-seed',
        seq: SessionSeq(inheritedEventCount),
        time: events[inheritedEventCount]?.time ?? events[inheritedEventCount - 1]?.time ?? 1,
        data: { inherited: true },
      } as SessionEvent,
      ...events.slice(inheritedEventCount),
    ].map((event, seq) => ({ ...event, seq: SessionSeq(seq) }))
  await seedStoredSession(ctx.sessionPersistence, {
    version: SESSION_FORMAT_VERSION,
    id: sessionId,
    createdAt: 1,
    isSeeded: inheritedEventCount !== undefined,
    ...header,
  }, committed, inheritedEventCount === undefined ? undefined : SessionLogOffset(inheritedEventCount))
  return sessionId
}

/** Minimal complete-turn child log with one descriptor payload. */
function childEvents(descriptor: unknown): SessionEvent[] {
  return [
    { type: 'turn/start', seq: SessionSeq(0), time: 1, data: { turn: 1, trigger: { kind: 'message', source: { kind: 'user' } } } },
    {
      type: 'user/message',
      seq: SessionSeq(1),
      time: 2,
      data: createUserMessage({ content: [{ type: 'text', text: 'work' }], source: { kind: 'user' } }),
      surfaceOp: 'append',
    },
    { type: 'subagent/descriptor', seq: SessionSeq(2), time: 3, data: descriptor },
    { type: 'turn/end', seq: SessionSeq(3), time: 4, data: { turn: 1, reason: { kind: 'completed' } } },
  ] as SessionEvent[]
}

function descriptorPayload(label: string, version = SUBAGENT_DESCRIPTOR_VERSION) {
  return { version, mode: 'continuable' as const, provider: 'spawn', label }
}

/**
 * Serve one cold session's point read (the open handle) with a transformed
 * header while the enumeration listing keeps reporting the stored original —
 * the re-published-lifecycle shape the sameLifecycle check exists for.
 */
function mutateStoredHeader(
  ctx: Context,
  target: SessionId,
  mutate: (meta: SessionHeader) => SessionHeader,
): void {
  const originalOpen = ctx.sessionPersistence.open.bind(ctx.sessionPersistence)
  ctx.sessionPersistence.open = async (sessionId, access, options) => {
    const handle = await originalOpen(sessionId, access, options)
    if (sessionId !== target) return handle
    return {
      id: handle.id,
      access: handle.access,
      header: mutate(handle.header),
      inheritedEventCount: handle.inheritedEventCount,
      read: (offset, length, readOptions) => handle.read(offset, length, readOptions),
      append: (events, appendOptions) => handle.append(events, appendOptions),
      flush: flushOptions => handle.flush(flushOptions),
      close: () => handle.close(),
      [Symbol.asyncDispose]: () => handle[Symbol.asyncDispose](),
    }
  }
}

describe('SubagentRuntime.listChildren', () => {
  it('lists historical children through a migrated parent while preserving V3 files', async () => {
    const { ctx, root } = await setup([], { compression: 'none' })
    const parent = SessionId('historical-parent')
    const child = SessionId('historical-child')
    const header = { type: 'session', version: 3, id: parent, createdAt: 1, isSeeded: false, delegationDepth: 0 }
    const source = [
      [header, []],
      [{ ...header, id: child, createdAt: 2, origin: 'subagent', parentSession: parent, delegationDepth: 1 }, [{
        type: 'subagent/descriptor', seq: 0, time: 2,
        data: { version: 3, mode: 'continuable', provider: 'spawn', label: 'historical child' },
      }]],
    ] as const
    const originals = source.map(([meta, events]) => {
      const path = generationLogPath(root, undefined, meta.id, 3, 'none')
      const content = [meta, ...events].map(row => JSON.stringify(row)).join('\n') + '\n'
      mkdirSync(dirname(path), { recursive: true })
      writeFileSync(path, content)
      return { path, content }
    })

    expect(await ctx.subagents.listChildren(parent)).toEqual([{
      id: child, createdAt: 2, mode: 'continuable', label: 'historical child',
    }])
    for (const { path, content } of originals) {
      expect(readFileSync(path, 'utf8')).toBe(content)
      expect(readdirSync(dirname(path))).toEqual(['session.v3.jsonl'])
    }
  })

  it('lists provider-established children from the parent catalog without a corpus or child read', async () => {
    const { ctx, parent } = await setup([textResponse('once'), textResponse('again')])
    const oneShot = await ctx.subagents.start('spawn', {
      prompt: [{ type: 'text', text: 'finish once' }],
      agentOptions: { model: 'child-model' },
      parent,
      signal: testSignal,
    })
    const oneShotId = oneShot.id
    await oneShot.result
    await oneShot.dispose()
    const continuableId = await startChild(ctx, parent, 'continuable child')
    const listSessions = vi.spyOn(ctx.sessionQuery, 'listSessions')
    const observeSession = vi.spyOn(ctx.sessionQuery, 'observeSession')

    const children = await ctx.subagents.listChildren(parent.id)
    expect(children.map(({ createdAt: _createdAt, ...child }) => child)).toEqual([
      { id: oneShotId, mode: 'one-shot' },
      { id: continuableId, label: 'continuable child', mode: 'continuable' },
    ])
    expect(children.every(child => Number.isFinite(child.createdAt))).toBe(true)
    expect(listSessions).not.toHaveBeenCalled()
    expect(observeSession).toHaveBeenCalledOnce()
  })

  it('releases its observation after reading the catalog view', async () => {
    const { ctx, parent } = await setup([])
    const childId = SessionId('cold-state-child')
    parent.session.append('subagent/catalog', {
      version: 0,
      childId,
      childCreatedAt: 3,
      mode: 'one-shot',
      label: 'state child',
    })
    using observed = await ctx.sessionQuery.observeSession(parent.id)
    const dispose = vi.fn()
    vi.spyOn(ctx.sessionQuery, 'observeSession').mockResolvedValue({
      ...observed,
      [Symbol.dispose]: dispose,
    })
    expect(await ctx.subagents.listChildren(parent.id)).toEqual([{
      id: childId, createdAt: 3, label: 'state child', mode: 'one-shot',
    }])
    expect(dispose).toHaveBeenCalledOnce()
  })

  it('releases the observation when its catalog projection is unavailable', async () => {
    const { ctx, parent } = await setup([])
    using observed = await ctx.sessionQuery.observeSession(parent.id, { projectionMode: 'none' })
    const dispose = vi.fn()
    vi.spyOn(ctx.sessionQuery, 'observeSession').mockResolvedValue({ ...observed, [Symbol.dispose]: dispose })
    await expect(ctx.subagents.listChildren(parent.id)).rejects.toMatchObject({
      code: 'SUBAGENT_CONTROL_PROJECTIONS_UNAVAILABLE',
    })
    expect(dispose).toHaveBeenCalledOnce()
  })

  it('forwards cancellation and preserves query failures', async () => {
    const { ctx, parent } = await setup([])
    const controller = new AbortController()
    controller.abort(new Error('cancel catalog'))
    await expect(ctx.subagents.listChildren(parent.id, controller.signal)).rejects.toMatchObject({
      code: 'SESSION_QUERY_ABORTED',
    })
    const failure = new Error('parent read failed')
    vi.spyOn(ctx.sessionQuery, 'observeSession').mockRejectedValue(failure)
    await expect(ctx.subagents.listChildren(parent.id)).rejects.toBe(failure)
  })

  it('ignores inherited fork facts and accepts facts in the fork own suffix', async () => {
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    await ctx.plugin(SessionProjectionRegistry)
    await ctx.plugin(TestSessionQuery)
    await ctx.plugin(SubagentRuntime)
    const ancestor = ctx.sessions.create(SessionId('catalog-ancestor'))
    ancestor.append('turn/start', { turn: 1 })
    ancestor.append('subagent/catalog', {
      version: 0,
      childId: SessionId('inherited-child'),
      childCreatedAt: 1,
      mode: 'one-shot',
    })
    ancestor.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
    const fork = ctx.sessions.fork(ancestor, undefined, SessionId('catalog-fork'))
    fork.append('subagent/catalog', {
      version: 0,
      childId: SessionId('own-child'),
      childCreatedAt: 2,
      mode: 'continuable',
      label: 'own',
    })

    expect(await ctx.subagents.listChildren(fork.id)).toEqual([{
      id: SessionId('own-child'), createdAt: 2, mode: 'continuable', label: 'own',
    }])
  })

  it('bounds chunk growth and ignores more than 1,000 unrelated Sessions', async () => {
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    await ctx.plugin(SessionProjectionRegistry)
    await ctx.plugin(TestSessionQuery)
    await ctx.plugin(SubagentRuntime)
    const parent = ctx.sessions.create(SessionId('chunk-parent'))
    for (let index = 0; index < 1_001; index += 1) {
      ctx.sessions.create(SessionId(`unrelated-${String(index).padStart(4, '0')}`))
    }
    for (let index = 0; index < 1_025; index += 1) {
      parent.append('subagent/catalog', {
        version: 0,
        childId: SessionId(`child-${String(index).padStart(3, '0')}`),
        childCreatedAt: index,
        mode: 'one-shot',
      })
    }
    const listSessions = vi.spyOn(ctx.sessionQuery, 'listSessions')
    const state = ctx.sessionProjections.stateOf(parent, 'subagentCatalog')
    const chunkLengths: number[] = []
    for (let chunk = state?.head; chunk !== undefined; chunk = chunk.previous) {
      chunkLengths.push(chunk.values.length)
    }
    expect(chunkLengths).toEqual([1, ...Array.from({ length: 16 }, () => 64)])
    const entries = await ctx.subagents.listChildren(parent.id)
    expect(listSessions).not.toHaveBeenCalled()
    expect(entries).toHaveLength(1_025)
    expect(entries.find(entry => entry.id === 'child-064')).toEqual({
      id: SessionId('child-064'), createdAt: 64, mode: 'one-shot',
    })
  })

  it('fails loud when the query service is unavailable', async () => {
    const withoutProjection = new Context()
    await withoutProjection.plugin(SessionStore)
    await withoutProjection.plugin(SubagentRuntime)
    const parent = withoutProjection.sessions.create(SessionId('parent'))
    await expect(withoutProjection.subagents.listChildren(parent.id)).rejects.toMatchObject({
      code: 'SUBAGENT_CONTROL_QUERY_UNAVAILABLE',
    })
  })


})
describe('SubagentRuntime.listDescendants', () => {
  it('flattens the complete tree in stable pre-order with verified parent and depth', async () => {
    const { ctx, parent } = await setup([])
    const childA = await authorChild(ctx, '00000000-0000-4000-8000-00000000aaa1', {
      parentSession: parent.id,
      createdAt: 1,
      origin: 'subagent',
    }, childEvents(descriptorPayload('branch a')))
    const grandchild = await authorChild(ctx, '00000000-0000-4000-8000-00000000aaa2', {
      parentSession: childA,
      createdAt: 2,
      origin: 'subagent',
    }, childEvents(descriptorPayload('under a')))
    const childB = await authorChild(ctx, '00000000-0000-4000-8000-00000000aaa3', {
      parentSession: parent.id,
      createdAt: 3,
      origin: 'subagent',
    }, childEvents(descriptorPayload('branch b')))

    const entries = await ctx.subagents.listDescendants(parent.id)
    expect(entries).toEqual([
      {
        kind: 'child', id: childA, label: 'branch a', mode: 'continuable',
        activity: 'inactive', hasChildren: true, parentId: parent.id, depth: 1,
      },
      {
        kind: 'child', id: grandchild, label: 'under a', mode: 'continuable',
        activity: 'inactive', hasChildren: false, parentId: childA, depth: 2,
      },
      {
        kind: 'child', id: childB, label: 'branch b', mode: 'continuable',
        activity: 'inactive', hasChildren: false, parentId: parent.id, depth: 1,
      },
    ])
  })

  it('returns an empty result when the root has no descendants', async () => {
    const { ctx, parent } = await setup([])
    await ctx.sessions.flush(parent.session)
    await expect(ctx.subagents.listDescendants(parent.id)).resolves.toEqual([])
  })

  it('omits a live creation-window candidate while continuing through its subtree', async () => {
    const { ctx, parent } = await setup([])
    const bareId = SessionId('live-creation-window')
    const bare = ctx.sessions.create(bareId, {
      meta: { createdAt: 1, parentSession: parent.id, origin: 'subagent' },
    })
    bare.append('turn/start', { turn: 1 })
    const below = await authorChild(ctx, '00000000-0000-4000-8000-00000000aaaf', {
      parentSession: bareId,
      createdAt: 2,
      origin: 'subagent',
    }, childEvents(descriptorPayload('below the creation window')))

    await expect(ctx.subagents.listDescendants(parent.id)).resolves.toEqual([{
      kind: 'child', id: below, label: 'below the creation window', mode: 'continuable',
      activity: 'inactive', hasChildren: false, parentId: bareId, depth: 2,
    }])
  })

  it('contains a corrupt parent cycle without revisiting the requested root', async () => {
    const { ctx } = await setup([])
    const rootId = SessionId('cycle-root')
    const nodeId = SessionId('cycle-node')
    await authorChild(ctx, rootId, {
      parentSession: nodeId,
      createdAt: 2,
    }, childEvents(descriptorPayload('ordinary cycle root')))
    await authorChild(ctx, nodeId, {
      parentSession: rootId,
      createdAt: 1,
      origin: 'subagent',
    }, childEvents(descriptorPayload('cycle child')))

    await expect(ctx.subagents.listDescendants(rootId)).resolves.toEqual([{
      kind: 'child', id: nodeId, label: 'cycle child', mode: 'continuable',
      activity: 'inactive', hasChildren: false, parentId: rootId, depth: 1,
    }])
  })


  it('walks a deeply nested ordinary-session chain without consuming the call stack', { timeout: 20_000 }, async () => {
    const { ctx, parent } = await setup([])
    const depth = 10_000
    let parentId = parent.id
    for (let level = 1; level < depth; level += 1) {
      const session = ctx.sessions.create(SessionId(`deep-ordinary-${level}`), {
        meta: { createdAt: level, parentSession: parentId },
      })
      parentId = session.id
    }
    const leafId = SessionId('deep-subagent-leaf')
    const leaf = ctx.sessions.create(leafId, {
      meta: { createdAt: depth, parentSession: parentId, origin: 'subagent' },
    })
    leaf.append('turn/start', { turn: 1 })
    leaf.append('subagent/descriptor', descriptorPayload('deep leaf'))

    await expect(ctx.subagents.listDescendants(parent.id)).resolves.toEqual([{
      kind: 'child', id: leafId, label: 'deep leaf', mode: 'continuable',
      activity: 'running', hasChildren: false, parentId, depth,
    }])
  })

  it('discovers continuable descendants below ordinary and one-shot intermediates', { timeout: 20_000 }, async () => {
    const { ctx, parent } = await setup([textResponse('one shot')])
    // An ordinary fork has no descriptor: omitted itself, subtree still walked.
    const fork = ctx.sessions.fork(parent.session, undefined, SessionId('plain-fork'))
    await ctx.sessions.flush(fork)
    const underFork = await authorChild(ctx, '00000000-0000-4000-8000-00000000bbb1', {
      parentSession: fork.header.id,
      createdAt: 2,
      origin: 'subagent',
    }, childEvents(descriptorPayload('under the fork')))
    // A real one-shot child, then a continuable authored below it.
    const oneShot = await ctx.subagents.start('spawn', {
      label: 'one-shot intermediate',
      prompt: [{ type: 'text', text: 'one-shot task' }],
      parent,
      signal: testSignal,
    })
    await oneShot.result
    await ctx.sessions.flush(oneShot.localAgent!.session)
    const oneShotId = oneShot.id
    await oneShot.dispose()
    const underOneShot = await authorChild(ctx, '00000000-0000-4000-8000-00000000bbb2', {
      parentSession: oneShotId,
      createdAt: 9_999_999_999_999,
      origin: 'subagent',
    }, childEvents(descriptorPayload('under the one-shot')))

    const entries = await ctx.subagents.listDescendants(parent.id)
    // The fork is absent (descriptor-less); the one-shot is present with its
    // mode so a caller can see the lineage it walked through.
    expect(entries.map(entry => entry.id)).not.toContain(fork.header.id)
    expect(entries).toContainEqual({
      kind: 'child', id: underFork, label: 'under the fork', mode: 'continuable',
      activity: 'inactive', hasChildren: false, parentId: fork.header.id, depth: 2,
    })
    expect(entries).toContainEqual(expect.objectContaining({
      kind: 'child', id: oneShotId, mode: 'one-shot', parentId: parent.id, depth: 1,
    }))
    expect(entries).toContainEqual({
      kind: 'child', id: underOneShot, label: 'under the one-shot', mode: 'continuable',
      activity: 'inactive', hasChildren: false, parentId: oneShotId, depth: 2,
    })
    // Pre-order: every child appears after its own parent entry.
    const position = new Map(entries.map((entry, index) => [entry.id, index]))
    expect(position.get(underOneShot)!).toBeGreaterThan(position.get(oneShotId)!)
  })

  it('diagnoses a settled descriptor-less node while walking its subtree', async () => {
    const { ctx, parent } = await setup([])
    // A settled origin-marked candidate without an identity is corrupt under
    // the projection contract, but its subtree remains independently visible.
    const bare = await authorChild(ctx, '00000000-0000-4000-8000-00000000eee1', {
      parentSession: parent.id,
      createdAt: 1,
      origin: 'subagent',
    }, [
      { type: 'turn/start', seq: SessionSeq(0), time: 1, data: { turn: 1, trigger: { kind: 'message', source: { kind: 'user' } } } },
      { type: 'turn/end', seq: SessionSeq(1), time: 2, data: { turn: 1, reason: { kind: 'completed' } } },
    ] as SessionEvent[])
    const below = await authorChild(ctx, '00000000-0000-4000-8000-00000000eee2', {
      parentSession: bare,
      createdAt: 2,
      origin: 'subagent',
    }, childEvents(descriptorPayload('below the bare node')))

    await expect(ctx.subagents.listDescendants(parent.id)).resolves.toEqual([
      { kind: 'diagnostic', id: bare, reason: 'corrupt', parentId: parent.id, depth: 1 },
      {
        kind: 'child', id: below, label: 'below the bare node', mode: 'continuable',
        activity: 'inactive', hasChildren: false, parentId: bare, depth: 2,
      },
    ])
  })

  it('keeps traversing below a corrupt intermediate and positions its diagnostic', async () => {
    const { ctx, parent } = await setup([])
    const corrupt = await authorChild(ctx, '00000000-0000-4000-8000-00000000ccc1', {
      parentSession: parent.id,
      createdAt: 1,
      origin: 'subagent',
    }, childEvents(descriptorPayload('unsupported descriptor', 999)))
    const below = await authorChild(ctx, '00000000-0000-4000-8000-00000000ccc2', {
      parentSession: corrupt,
      createdAt: 2,
      origin: 'subagent',
    }, childEvents(descriptorPayload('below the corrupt node')))

    const entries = await ctx.subagents.listDescendants(parent.id)
    expect(entries).toEqual([
      { kind: 'diagnostic', id: corrupt, reason: 'corrupt', parentId: parent.id, depth: 1 },
      {
        kind: 'child', id: below, label: 'below the corrupt node', mode: 'continuable',
        activity: 'inactive', hasChildren: false, parentId: corrupt, depth: 2,
      },
    ])
  })

  it('fails loud when descendant enumeration lacks the Session store or query service', async () => {
    const withoutStore = new Context()
    await withoutStore.plugin(SessionProjectionRegistry)
    await withoutStore.plugin(SubagentRuntime)
    await expect(withoutStore.subagents.listDescendants(SessionId('no-store-parent'))).rejects.toMatchObject({
      code: 'SUBAGENT_CONTROL_SESSION_STORE_UNAVAILABLE',
    })

    const withoutQuery = new Context()
    await withoutQuery.plugin(SessionStore)
    await withoutQuery.plugin(SessionProjectionRegistry)
    await withoutQuery.plugin(SubagentRuntime)
    await expect(withoutQuery.subagents.listDescendants(SessionId('no-query-parent'))).rejects.toMatchObject({
      code: 'SUBAGENT_CONTROL_QUERY_UNAVAILABLE',
    })
  })

  it('propagates a descendant corpus listing failure', async () => {
    const { ctx, parent } = await setup([])
    const failure = new Error('backend listing failed')
    vi.spyOn(ctx.sessionQuery, 'listSessions').mockRejectedValue(failure)
    await expect(ctx.subagents.listDescendants(parent.id)).rejects.toBe(failure)
  })

  it('maps an aborted descendant corpus listing to the stable cancellation error', async () => {
    const { ctx, parent } = await setup([])
    const controller = new AbortController()
    vi.spyOn(ctx.sessionQuery, 'listSessions').mockImplementation(() => {
      controller.abort()
      return Promise.reject(new Error('backend listing aborted'))
    })
    await expect(ctx.subagents.listDescendants(parent.id, controller.signal)).rejects.toMatchObject({
      code: 'CANCELLED',
    })
  })

  it('contains a live descendant projection failure and orders sibling ties by id', async () => {
    const { ctx, parent } = await setup([])
    const laterId = SessionId('live-projection-z')
    const earlierId = SessionId('live-projection-a')
    for (const id of [laterId, earlierId]) {
      const child = ctx.sessions.create(id, {
        meta: { parentSession: parent.id, origin: 'subagent', createdAt: 5 },
      })
      child.append('subagent/descriptor', descriptorPayload(String(id)))
    }
    const snapshot = ctx.sessionProjections.snapshot.bind(ctx.sessionProjections)
    vi.spyOn(ctx.sessionProjections, 'snapshot').mockImplementation((session, keys) => {
      if (session.id === laterId) throw new Error('projection failed')
      return snapshot(session, keys)
    })

    await expect(ctx.subagents.listDescendants(parent.id)).resolves.toEqual([
      {
        kind: 'child', id: earlierId, label: String(earlierId), mode: 'continuable',
        activity: 'running', hasChildren: false, parentId: parent.id, depth: 1,
      },
      { kind: 'diagnostic', id: laterId, reason: 'corrupt', parentId: parent.id, depth: 1 },
    ])
  })

  it('serves a valid own-suffix descendant identity from the projection cache', async () => {
    const { ctx, parent } = await setup([], { projectionCache: true })
    const childId = await authorChild(ctx, '00000000-0000-4000-8000-00000000ae01', {
      parentSession: parent.id,
      origin: 'subagent',
    }, childEvents(descriptorPayload('disk label')))
    ctx.sessionProjectionCache.cachedSnapshot = () => ({
      asOfSeq: SessionSeq(2),
      values: { subagent: { mode: 'one-shot', seq: SessionSeq(2) } },
    })
    const open = vi.spyOn(ctx.sessionPersistence, 'open')

    await expect(ctx.subagents.listDescendants(parent.id)).resolves.toEqual([{
      kind: 'child', id: childId, mode: 'one-shot', activity: 'inactive', hasChildren: false,
      parentId: parent.id, depth: 1,
    }])
    expect(open).not.toHaveBeenCalled()
  })

  it.each([
    ['absent', () => ({ asOfSeq: SessionSeq(0), values: {} })],
    ['null', () => ({ asOfSeq: SessionSeq(0), values: { subagent: null } })],
    ['inherited', () => ({
      asOfSeq: SessionSeq(1),
      values: { subagent: { mode: 'continuable' as const, label: 'ancestor', seq: SessionSeq(1) } },
    })],
  ])('falls back to the authoritative descendant fold for a %s cached identity', async (_name, cachedSnapshot) => {
    const { ctx, parent } = await setup([], { projectionCache: true })
    const childId = await authorChild(ctx, `cached-fallback-${_name}`, {
      parentSession: parent.id,
      origin: 'subagent',
    }, _name === 'inherited'
      ? [
        { type: 'turn/start', seq: SessionSeq(0), time: 1, data: { turn: 1 } },
        { type: 'turn/end', seq: SessionSeq(1), time: 2, data: { turn: 1, reason: { kind: 'completed' } } },
        { type: 'subagent/descriptor', seq: SessionSeq(2), time: 3, data: descriptorPayload('own label') },
      ] as SessionEvent[]
      : childEvents(descriptorPayload('own label')),
    _name === 'inherited' ? 2 : undefined)
    ctx.sessionProjectionCache.cachedSnapshot = cachedSnapshot
    const open = vi.spyOn(ctx.sessionPersistence, 'open')

    await expect(ctx.subagents.listDescendants(parent.id, testSignal)).resolves.toEqual([{
      kind: 'child', id: childId, label: 'own label', mode: 'continuable',
      activity: 'inactive', hasChildren: false, parentId: parent.id, depth: 1,
    }])
    expect(open).toHaveBeenCalledTimes(1)
  })

  it('falls back to the authoritative descendant fold when a cache read throws', async () => {
    const { ctx, parent } = await setup([], { projectionCache: true })
    const childId = await authorChild(ctx, 'cache-read-failure', {
      parentSession: parent.id,
      origin: 'subagent',
    }, childEvents(descriptorPayload('recovered')))
    ctx.sessionProjectionCache.cachedSnapshot = () => { throw new Error('poisoned cache row') }

    await expect(ctx.subagents.listDescendants(parent.id)).resolves.toEqual([{
      kind: 'child', id: childId, label: 'recovered', mode: 'continuable',
      activity: 'inactive', hasChildren: false, parentId: parent.id, depth: 1,
    }])
  })

  it.each([
    ['SESSION_QUERY_CORRUPT_SESSION', 'corrupt'],
    ['SESSION_QUERY_SOURCE_CONFLICT', 'corrupt'],
    ['OTHER', 'unavailable'],
  ] as const)('maps a %s cold descendant read failure to %s', async (code, reason) => {
    const { ctx, parent } = await setup([])
    const childId = await authorChild(ctx, `cold-failure-${code}`, {
      parentSession: parent.id,
      origin: 'subagent',
    }, childEvents(descriptorPayload('unreadable')))
    const failure = Object.assign(new Error('cold read failed'), { code })
    vi.spyOn(ctx.sessionQuery, 'observeSession').mockRejectedValue(failure)

    await expect(ctx.subagents.listDescendants(parent.id)).resolves.toEqual([{
      kind: 'diagnostic', id: childId, reason, parentId: parent.id, depth: 1,
    }])
  })

  it('maps a non-Error cold descendant rejection to unavailable', async () => {
    const { ctx, parent } = await setup([])
    const childId = await authorChild(ctx, 'cold-non-error-failure', {
      parentSession: parent.id,
      origin: 'subagent',
    }, childEvents(descriptorPayload('unreadable')))
    vi.spyOn(ctx.sessionQuery, 'observeSession').mockImplementation(() =>
      // A backend can violate the Error rejection convention at this durable boundary.
      // oxlint-disable-next-line typescript/prefer-promise-reject-errors -- exercises that non-Error boundary
      Promise.reject('cold read failed'))

    await expect(ctx.subagents.listDescendants(parent.id)).resolves.toEqual([{
      kind: 'diagnostic', id: childId, reason: 'unavailable', parentId: parent.id, depth: 1,
    }])
  })

  it('maps a cold descendant failure racing cancellation to cancellation', async () => {
    const { ctx, parent } = await setup([])
    await authorChild(ctx, 'cold-cancelled-failure', {
      parentSession: parent.id,
      origin: 'subagent',
    }, childEvents(descriptorPayload('cancelled')))
    const controller = new AbortController()
    vi.spyOn(ctx.sessionQuery, 'observeSession').mockImplementation(() => {
      controller.abort()
      return Promise.reject(new Error('cold read failed'))
    })

    await expect(ctx.subagents.listDescendants(parent.id, controller.signal)).rejects.toMatchObject({
      code: 'CANCELLED',
    })
  })

  it('maps cancellation after a successful cold descendant read to cancellation', async () => {
    const { ctx, parent } = await setup([])
    await authorChild(ctx, 'cold-cancelled-success', {
      parentSession: parent.id,
      origin: 'subagent',
    }, childEvents(descriptorPayload('cancelled')))
    const controller = new AbortController()
    const observe = ctx.sessionQuery.observeSession.bind(ctx.sessionQuery)
    vi.spyOn(ctx.sessionQuery, 'observeSession').mockImplementation(async (id, options) => {
      const observation = await observe(id, options)
      controller.abort()
      return observation
    })

    await expect(ctx.subagents.listDescendants(parent.id, controller.signal)).rejects.toMatchObject({
      code: 'CANCELLED',
    })
  })

  it('a pre-aborted signal stops the descendant scan before persistence reads', async () => {
    const { ctx, parent } = await setup([textResponse('done')])
    await startChild(ctx, parent, 'never read')
    const list = vi.spyOn(ctx.sessionPersistence, 'list')
    const controller = new AbortController()
    controller.abort()
    await expect(ctx.subagents.listDescendants(parent.id, controller.signal)).rejects.toThrow(
      expect.objectContaining({ code: 'CANCELLED' }) as Error,
    )
    expect(list).not.toHaveBeenCalled()
  })

  it('fails loud when the projection registry is not mounted', async () => {
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    await ctx.plugin(SubagentRuntime)
    await expect(ctx.subagents.listDescendants(SessionId('no-projections-root'))).rejects.toThrow(
      expect.objectContaining({ code: 'SUBAGENT_CONTROL_PROJECTIONS_UNAVAILABLE' }) as Error,
    )
  })
  it('verifies a cold candidate still belongs to its enumerated lifecycle', async () => {
    const { ctx, parent } = await setup([])
    const childId = await authorChild(ctx, '00000000-0000-4000-8000-00000000ddd1', {
      parentSession: parent.id,
      createdAt: 1,
      origin: 'subagent',
    }, childEvents(descriptorPayload('lineage checked')))
    // The exact read reports a different durable parent than enumeration did.
    mutateStoredHeader(ctx, childId, meta => ({ ...meta, parentSession: SessionId('someone-else') }))
    await expect(ctx.subagents.listDescendants(parent.id)).resolves.toEqual([
      { kind: 'diagnostic', id: childId, reason: 'corrupt', parentId: parent.id, depth: 1 },
    ])
  })

})
