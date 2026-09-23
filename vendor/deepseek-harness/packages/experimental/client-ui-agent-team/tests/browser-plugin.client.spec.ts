import { Context, Service } from '@deepseek-ai/cordis'
import { describe, expect, it, vi } from 'vitest'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { SlotRegistry } from '@deepseek-ai/dsh-client-ui-renderer/client'
import type { TeamMemberView as TeamRosterMember } from '@deepseek-ai/dsh-experimental-agent-team/client'
import type {} from '@deepseek-ai/dsh-experimental-agent-team/remote'
import { RemoteError } from '@deepseek-ai/dsh-client-test-runtime'
import type { TypertRemoteContribution } from '@deepseek-ai/dsh-typert-protocol'
import { TeamAction, type TeamActionInjected } from '../src/client/TeamAction.tsx'
import { inject, mountAgentTeamUi } from '../src/client/mount.ts'
import { apply as nodeApply } from '../src/index.ts'

const SESSION = 'team-session' as SessionId
const CHILD = 'team-child' as SessionId
const REMOTE: TypertRemoteContribution = {
  package: '@deepseek-ai/dsh-experimental-agent-team',
  descriptors: [],
}

async function bench(options: {
  addressed?: boolean
  registrationFailure?: boolean
  remoteFailure?: boolean
  catalog?: 'missing' | 'empty'
} = {}) {
  const ctx = new Context()
  const calls: { method: string; args: unknown[] }[] = []
  const task = {
    id: 'task-1',
    revision: 1, subject: 'Task', description: 'Description', status: 'pending' as const,
    blockedBy: [], writeScopes: [], ready: true, writeScopeWarnings: [],
  }
  class RemoteService extends Service {
    readonly disposeMount = vi.fn(() => Promise.resolve())
    readonly mount = vi.fn((_contribution: unknown) => Promise.resolve(this.disposeMount))

    constructor(serviceCtx: Context) {
      super(serviceCtx, 'remote')
    }

    $mount(contribution: unknown): Promise<() => Promise<void>> {
      return this.mount(contribution)
    }
  }
  const remote = new RemoteService(ctx)
  const failure = {
    ok: false as const,
    error: new RemoteError('gateway/internal', 'offline', {}),
  }
  const view = {
    members: [{
      id: SESSION, name: 'lead', role: 'lead' as const, status: 'inactive' as const, diagnostics: [],
    }], tasks: [task],
  }
  ctx.provide('remote.agentTeams', {
    view: (...args: unknown[]) => {
      calls.push({ method: 'agentTeams/view', args })
      return Promise.resolve(options.remoteFailure
        ? failure
        : { ok: true as const, value: view })
    },
  })
  const navigation: unknown[] = []
  let mainSessionId = options.addressed === true ? CHILD : SESSION
  const projectionsBySession = options.catalog === 'missing'
    ? {}
    : {
      [SESSION]: { state: 'ready' as const, error: null, values: { subagentCatalog: options.catalog === 'empty' ? [] : [{ createdAt: 1, id: CHILD,
        mode: 'continuable' as const,
        label: 'worker' as const,
      }] } },
    }
  ctx.provide('sessions', {
    list: { getSnapshot: () => ({ projectionsBySession }) },
    binding: (id: SessionId) => options.addressed === true && id === CHILD
      ? { session: { getSnapshot: () => ({
        subagent: {
          address: {
            parentSessionId: SESSION,
            childSessionId: CHILD,
            mode: 'continuable' as const,
          },
        },
      }) } }
      : undefined,
    refreshProjections: (id: SessionId) => {
      navigation.push(['refresh', id])
      return Promise.resolve()
    },
    retainInfo: (id: SessionId) => ({
      getSnapshot: () => ({
        referenceCount: id === mainSessionId ? 1 : 0,
        retainedBy: id === mainSessionId ? { mainView: 1 } : {},
      }),
      subscribe: () => () => {},
    }),
  })
  ctx.provide('uiWorkspace', {
    openSession: (target: unknown) => { navigation.push(['open', target]) },
  } as never)
  ctx.provide('conversation', {})
  ctx.provide('locale', new LocaleRuntime(ctx))
  await ctx.plugin(SlotRegistry).await()
  const collapseHeader = ctx.slots.register({
    name: 'root',
    children: { 'conversation.session.header.actions': { kind: 'list', scope: 'session' } },
  } as never, () => null)
  if (options.registrationFailure === true) {
    vi.spyOn(ctx.slots, 'inject').mockImplementationOnce(() => { throw new Error('slot registration failed') })
  }
  const fiber = options.registrationFailure === true
    ? ctx.plugin({ apply() {} })
    : ctx.plugin({ inject: [...inject], apply: clientCtx => mountAgentTeamUi(clientCtx, REMOTE) })
  const activation: Promise<unknown> = options.registrationFailure === true
    ? mountAgentTeamUi(ctx, REMOTE).catch((error: unknown) => error)
    : fiber.await()
  if (options.registrationFailure !== true) {
    await activation
  } else {
    await fiber.await()
  }
  const entry = () => ctx.slots.entries('conversation.session.header.actions')
    .find(candidate => candidate.component === TeamAction)
  return {
    ctx,
    fiber,
    activation,
    calls,
    navigation,
    remote,
    entry,
    collapseHeader,
    select: (sessionId: SessionId) => { mainSessionId = sessionId },
  }
}

describe('ui-team browser plugin', () => {
  it('registers one disposable header action with a read-only RPC-backed task board', async () => {
    const b = await bench()
    expect(inject).toEqual(['sessions', 'uiWorkspace', 'remote', 'slots', 'locale'])
    expect(b.entry()).toMatchObject({
      options: { id: 'agent-team', order: 20 },
      locale: 'agent-team',
    })
    expect(b.remote.mount).toHaveBeenCalledOnce()
    expect(b.remote.mount).toHaveBeenCalledWith(REMOTE)
    const actions = (b.entry()!.inject as unknown as () => TeamActionInjected)()
    expect((await actions.load(SESSION)).ok).toBe(true)
    expect(b.calls).toEqual([{ method: 'agentTeams/view', args: [SESSION] }])

    actions.openTeammate(SESSION, {
      id: SESSION,
      name: 'lead',
      role: 'lead',
      status: 'inactive',
      diagnostics: [],
    })
    expect(b.navigation).toEqual([])

    await b.fiber.dispose()
    expect(b.entry()).toBeUndefined()
    expect(b.remote.disposeMount).toHaveBeenCalledOnce()
  })

  it('unmounts the Remote contribution when later Client registration fails', async () => {
    const b = await bench({ registrationFailure: true })
    await expect(b.activation).resolves.toMatchObject({ message: 'slot registration failed' })
    expect(b.remote.mount).toHaveBeenCalledOnce()
    expect(b.remote.disposeMount).toHaveBeenCalledOnce()
  })

  it('returns Remote carrier failures unchanged', async () => {
    const view = await bench({ remoteFailure: true })
    const viewActions = (view.entry()!.inject as unknown as () => TeamActionInjected)()
    await expect(viewActions.load(SESSION)).resolves.toMatchObject({
      ok: false,
      error: { code: 'gateway/internal', message: 'offline' },
    })

  })

  it('opens a continuable teammate address without refreshing the parent catalog', async () => {
    const b = await bench()
    const actions = (b.entry()!.inject as unknown as () => TeamActionInjected)()
    const member: TeamRosterMember = {
      id: CHILD,
      name: 'worker',
      role: 'teammate',
      status: 'inactive',
      diagnostics: [],
    }
    actions.openTeammate(SESSION, member)
    expect(b.navigation).toEqual([
      ['open', {
        parentSessionId: SESSION,
        childSessionId: CHILD,
        mode: 'continuable',
      }],
    ])
  })

  it('routes Team actions from an addressed teammate conversation back through its Lead', async () => {
    const b = await bench({ addressed: true })
    const actions = (b.entry()!.inject as unknown as () => TeamActionInjected)()
    await actions.load(CHILD)
    actions.openTeammate(CHILD, {
      id: CHILD,
      name: 'worker',
      role: 'teammate',
      status: 'inactive',
      diagnostics: [],
    })
    expect(b.calls[0]).toEqual({ method: 'agentTeams/view', args: [SESSION] })
    expect(b.navigation).toEqual([
      ['open', {
        parentSessionId: SESSION,
        childSessionId: CHILD,
        mode: 'continuable',
      }],
    ])
  })

  it('does not open a teammate from a conversation outside the main view', async () => {
    const b = await bench()
    const actions = (b.entry()!.inject as unknown as () => TeamActionInjected)()
    b.select('other-session' as SessionId)
    actions.openTeammate(SESSION, {
      id: CHILD,
      name: 'worker',
      role: 'teammate',
      status: 'inactive',
      diagnostics: [],
    })
    expect(b.navigation).toEqual([])
  })

  it('opens a teammate when the parent catalog is missing or empty', async () => {
    for (const catalog of ['missing', 'empty'] as const) {
      const b = await bench({ catalog })
      const actions = (b.entry()!.inject as unknown as () => TeamActionInjected)()
      actions.openTeammate(SESSION, {
        id: CHILD,
        name: 'worker',
        role: 'teammate',
        status: 'inactive',
        diagnostics: [],
      })
      expect(b.navigation).toEqual([
        ['open', { parentSessionId: SESSION, childSessionId: CHILD, mode: 'continuable' }],
      ])
      await b.fiber.dispose()
    }
  })

  it('re-registers after the conversation header slot is collapsed and declared again', async () => {
    const b = await bench()
    expect(b.entry()).toBeDefined()
    b.collapseHeader()
    expect(b.entry()).toBeUndefined()
    b.ctx.slots.register({
      name: 'root',
      children: { 'conversation.session.header.actions': { kind: 'list', scope: 'session' } },
    } as never, () => null)
    await Promise.resolve()
    expect(b.entry()).toBeDefined()
  })

  it('keeps the node half inert', () => {
    expect(() => { nodeApply() }).not.toThrow()
  })
})
