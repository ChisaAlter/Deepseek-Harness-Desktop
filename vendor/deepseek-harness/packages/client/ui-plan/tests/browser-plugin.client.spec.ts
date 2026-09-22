/**
 * ui-plan browser half on a real SlotRegistry: the plugin occupies the
 * conversation-declared `conversation.input.plan` single seat with the active
 * plan status chip; the injected face executes /plan off and folds admission
 * outcomes into null (admitted) or a user-visible failure line; teardown
 * empties the seat (HMR safety).
 */
import { ConversationEventRegistry } from '@deepseek-ai/dsh-client-ui-conversation/client'
import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it, vi } from 'vitest'
import { SlotRegistry } from '@deepseek-ai/dsh-client-ui-renderer/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { RemoteError } from '@deepseek-ai/dsh-client-test-runtime'
import { PlanChip } from '../src/client/PlanModeControl.tsx'
import { PlanCards, PlanReviewOpen, type PlanOpenInjected, type PlanReviewOpenInjected } from '../src/client/PlanCard.tsx'
import { PlanPreview, PlanTitle } from '../src/client/PlanPreview.tsx'
import { submittedPlan } from '../src/client/plan.ts'
import type { PlanChipInjected } from '../src/client/index.ts'
import { apply, inject } from '../src/client/index.ts'
import { apply as nodeApply } from '../src/index.ts'

function providePreview(ctx: Context) {
  const events = new ConversationEventRegistry(ctx)
  ctx.provide('uiConversation', { events })
  const removeResources = vi.fn()
  const removeType = vi.fn()
  const registerType = vi.fn((_definition: Parameters<Context['sidebarRightTabs']['register']>[0]) => removeType)
  const openResourceIn = vi.fn<Context['sidebarRight']['openResourceIn']>()
  const subagentAddress = vi.fn<Context['sessions']['subagentAddress']>(() => undefined)
  ctx.provide('sessions', { subagentAddress })
  ctx.provide('resources', { register: vi.fn(() => removeResources) })
  ctx.provide('sidebarRightTabs', { register: registerType })
  ctx.provide('sidebarRight', { openResourceIn })
  ctx.provide('remote.session', {})
  return { events, removeResources, removeType, registerType, openResourceIn, subagentAddress }
}

const SID = 's-plan' as SessionId

async function bench() {
  const ctx = new Context()
  const preview = providePreview(ctx)
  await ctx.plugin(SlotRegistry).await()
  const slots = ctx.get('slots') as SlotRegistry
  slots.register({
    name: 'root',
    children: {
      'conversation.input.plan': { kind: 'single', scope: 'session' },
      'conversation.chat.turnTail': { kind: 'list', scope: 'session' },
      'conversation.plan-review.actions': { kind: 'list', scope: 'session' },
      'sidebar.right.pane.tab': { kind: 'keyed', scope: 'session' },
      'sidebar.right.pane.tab.title': { kind: 'keyed', scope: 'session' },
    },
  } as never, () => null)
  const execute = vi.fn((_sessionId: SessionId, _line: string) =>
    Promise.resolve({ ok: true, value: { commandId: 'c1', result: { kind: 'success' as const } } }))
  const commandsRemote = { execute }
  ctx.provide('remote', { commands: commandsRemote })
  ctx.provide('remote.commands', commandsRemote)
  ctx.provide('locale', new LocaleRuntime(ctx))
  return { ctx, slots, execute, ...preview }
}

describe('ui-plan browser apply', () => {
  it('declares every service it binds', () => {
    expect(inject).toEqual(['slots', 'remote', 'remote.commands', 'remote.session', 'sessions', 'locale', 'uiConversation', 'resources', 'sidebarRight', 'sidebarRightTabs'])
  })

  it('node-half apply is an intentional no-op', () => {
    expect(() => { nodeApply() }).not.toThrow()
  })

  it('waits until conversation declares the plan seat', async () => {
    const ctx = new Context()
    providePreview(ctx)
    await ctx.plugin(SlotRegistry).await()
    ctx.provide('remote', { commands: {} })
    ctx.provide('remote.commands', {})
    ctx.provide('locale', new LocaleRuntime(ctx))
    const fiber = ctx.plugin({ inject: [...inject], apply })
    await fiber.await()
    expect(ctx.slots.entries('conversation.input.plan')).toHaveLength(0)
    ctx.slots.register({
      name: 'root', children: { 'conversation.input.plan': { kind: 'single', scope: 'session' } },
    } as never, () => null)
    await Promise.resolve()
    expect(ctx.slots.entries('conversation.input.plan')).toHaveLength(1)
  })

  it('registers the chip, executes /plan off, and unregisters on teardown', async () => {
    const b = await bench()
    const fiber = b.ctx.plugin({ inject: [...inject], apply })
    await fiber.await()
    const entry = b.slots.entries('conversation.input.plan')[0]!
    expect(entry.component).toBe(PlanChip)
    const injected = (entry.inject as unknown as (id: SessionId) => PlanChipInjected)(SID)

    await expect(injected.exitPlanMode()).resolves.toBeNull()
    expect(b.execute).toHaveBeenLastCalledWith(SID, '/plan off', [])

    // Business failure folds to the composer-visible line: the generated method
    // reports the RPC failure in its error branch.
    b.execute.mockResolvedValueOnce({
      ok: false,
      error: new RemoteError('session/not-found', 'gone', { sessionId: SID }),
    } as never)
    await expect(injected.exitPlanMode()).resolves.toBe('gone (session/not-found)')

    // Unmatched admission (plan-mode not composed host-side) is also a failure line.
    b.execute.mockResolvedValueOnce({ ok: true, value: undefined } as never)
    await expect(injected.exitPlanMode()).resolves.toBe('unknown command: /plan off')

    expect(b.events.entries().map(entry => entry.kind)).toEqual(['submitted-plan'])
    await fiber.dispose()
    expect(b.events.entries()).toEqual([])
    expect(b.removeResources).toHaveBeenCalledOnce()
    expect(b.removeType).toHaveBeenCalledOnce()
    expect(b.slots.entries('conversation.input.plan')).toHaveLength(0)
  })
  it('binds both entry points to the same Session resource and removes the sidebar seats', async () => {
    const b = await bench()
    const fiber = b.ctx.plugin({ inject: [...inject], apply })
    try {
      await fiber.await()
      const removeFileEntry = b.slots.register({ name: 'conversation.chat.turnTail', id: 'test-file-deliveries' }, () => null)
      expect(b.slots.entries('conversation.chat.turnTail')).toHaveLength(2)
      removeFileEntry()
      const address = 'dsh-resource://plan/s-plan/call'
      const type = b.registerType.mock.calls[0]![0]
      expect(type.canOpen!(address)).toBe(true)
      expect(type.canOpen!('file:///plan.md')).toBe(false)
      expect(type.title(address)).toBeTruthy()
      const plan = submittedPlan({ type: 'tool/call', data: { callId: 'call', name: 'exit_plan_mode', arguments: '{"plan":"# Saved plan"}' } })!
      const card = b.slots.entries('conversation.chat.turnTail')[0]!
      expect(card.component).toBe(PlanCards)
      const injected = (card.inject as unknown as (sessionId: SessionId) => PlanOpenInjected)(SID)
      injected.openPlan(plan.callId)
      expect(b.openResourceIn).toHaveBeenLastCalledWith(SID, address)
      const review = b.slots.entries('conversation.plan-review.actions')[0]!
      expect(review.component).toBe(PlanReviewOpen)
      const reviewInjected = (review.inject as unknown as (sessionId: SessionId) => PlanReviewOpenInjected)(SID)
      const pending = { id: 'review', question: 'Approve?', plan: plan.markdown, callId: plan.callId, approve: { label: 'Approve' } }
      reviewInjected.openReview(pending, 'question:1')
      expect(b.openResourceIn).toHaveBeenLastCalledWith(SID, address)
      b.subagentAddress.mockReturnValue({ parentSessionId: 'parent' as SessionId, childSessionId: SID, mode: 'continuable' })
      injected.openPlan(plan.callId)
      expect(b.openResourceIn).toHaveBeenLastCalledWith(SID, 'dsh-resource://plan/subagent/parent/s-plan/continuable/call')
      reviewInjected.openReview(pending, 'question:1')
      expect(b.openResourceIn).toHaveBeenLastCalledWith(SID, 'dsh-resource://plan/subagent/parent/s-plan/continuable/call')
      const temporary = { id: 'review', question: 'Approve?', plan: '# Temporary\n\nComplete body', approve: { label: 'Approve' } }
      reviewInjected.openReview(temporary, 'question:2')
      const first = b.openResourceIn.mock.calls.at(-1)!
      expect(type.canOpen!(first[1])).toBe(true)
      expect(first).toEqual([SID, expect.stringMatching(/^dsh-resource:\/\/plan-review\/s-plan\//), {
        params: { planReview: { title: 'Temporary', markdown: temporary.plan } },
      }])
      reviewInjected.openReview(temporary, 'question:2')
      expect(b.openResourceIn).toHaveBeenLastCalledWith(...first)
      reviewInjected.openReview(temporary, 'question:3')
      expect(b.openResourceIn.mock.calls.at(-1)![1]).not.toBe(first[1])
      expect(b.slots.entries('sidebar.right.pane.tab')[0]!.component).toBe(PlanPreview)
      expect(b.slots.entries('sidebar.right.pane.tab.title')[0]!.component).toBe(PlanTitle)
      await fiber.dispose()
      expect(b.slots.entries('conversation.chat.turnTail')).toEqual([])
      expect(b.slots.entries('conversation.plan-review.actions')).toEqual([])
      expect(b.slots.entries('sidebar.right.pane.tab')).toEqual([])
      expect(b.slots.entries('sidebar.right.pane.tab.title')).toEqual([])
    } finally { await fiber.dispose() }
  })
})
