// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { ConversationNodeAssembler } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { SessionLiveEventEntry } from '@deepseek-ai/dsh-api-session-controller/client'
import type { ChatSnapshot } from '@deepseek-ai/dsh-client-ui-chat/client'
import { chatViewDefinition } from '../../ui-chat/src/client/conversation-nodes/chat-snapshot-builder.ts'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { en as commonEn } from '@deepseek-ai/dsh-client-locale/src/locales/en.ts'
import { en, zh } from '../src/client/locales.ts'
import { PlanCards, PlanReviewOpen } from '../src/client/PlanCard.tsx'
import { PlanPreview, PlanTitle } from '../src/client/PlanPreview.tsx'
import { planAddress, parsePlanAddress, submittedPlan } from '../src/client/plan.ts'
import { reviewPreviewAddress, isReviewPreviewAddress } from '../src/client/review-preview.ts'
import { planDefinition } from '../src/client/plan-definition.ts'
import { createPlanReviewStore } from '../src/client/review-store.ts'

afterEach(cleanup)
const markdown = '# Keep this plan\n\n## Goal\n\n- Review\n- Implement'
const call = { type: 'tool/call', seq: 12, data: { turn: 1, name: 'exit_plan_mode', callId: 'call:1', arguments: JSON.stringify({ plan: markdown }) } }
const plan = submittedPlan(call)!
const target = { session: { kind: 'session' as const, sessionId: 'session / 中文' as SessionId }, callId: plan.callId }
const t = makeTranslate(en, commonEn)

function planNode(data: typeof plan) {
  return { kind: 'submitted-plan', anchorSeq: 12, location: { kind: 'turn', turn: { turn: 1 } }, data }
}
function planHook(nodes: readonly unknown[]): Parameters<typeof PlanCards>[0]['useChat'] {
  return ((select: (snapshot: unknown) => unknown) => select({ nodes: { values: () => nodes } })) as Parameters<typeof PlanCards>[0]['useChat']
}

describe('submitted plan identity', () => {
  it('reads native, running PTC, and settled PTC calls', () => {
    expect(plan).toEqual({ callId: 'call:1', title: 'Keep this plan', markdown })
    for (const type of ['tool/ptc-dispatch-start', 'tool/ptc-dispatch']) {
      expect(submittedPlan({ type, data: { name: 'exit_plan_mode', subCallId: 'call:1', arguments: { plan: markdown } } })).toEqual(plan)
    }
  })
  it.each([
    { type: 'user/message', data: call.data },
    { type: 'tool/call', data: null },
    { type: 'tool/call', data: [] },
    { type: 'tool/call', data: { ...call.data, name: 'read' } },
    { type: 'tool/call', data: { ...call.data, callId: '' } },
    { type: 'tool/call', data: { ...call.data, arguments: {} } },
    { type: 'tool/call', data: { ...call.data, arguments: '{' } },
    { type: 'tool/call', data: { ...call.data, arguments: 'null' } },
    { type: 'tool/call', data: { ...call.data, arguments: '{"plan":42}' } },
    { type: 'tool/call', data: { ...call.data, arguments: '{"plan":"no title"}' } },
  ])('leaves malformed or unrelated input to its existing renderer: %j', (event) => {
    expect(submittedPlan(event)).toBeUndefined()
  })
  it('round-trips opaque identifiers and refuses malformed addresses', () => {
    expect(parsePlanAddress(planAddress(target))).toEqual(target)
    for (const mode of ['one-shot', 'continuable'] as const) {
      const child = { session: { kind: 'subagent' as const, parentSessionId: target.session.sessionId, childSessionId: 'child / 中文' as SessionId, mode }, callId: plan.callId }
      expect(parsePlanAddress(planAddress(child))).toEqual(child)
    }
    for (const address of ['file:///plan.md', 'dsh-resource://plan/s/c/extra', 'dsh-resource://plan/s/%XX', 'dsh-resource://plan/s/c?text=x',
      'dsh-resource://plan//c', 'dsh-resource://plan/subagent/p/c/invalid/call', 'dsh-resource://plan/subagent/p/c/one-shot']) {
      expect(parsePlanAddress(address)).toBeUndefined()
    }
  })
  it('keeps a settled PTC update correlated with its existing card', () => {
    expect(planDefinition.match(call as never)).toEqual({ id: plan.callId, role: 'start' })
    const event = { type: 'tool/ptc-dispatch', data: { name: 'exit_plan_mode', subCallId: plan.callId, arguments: { plan: markdown } } }
    expect(planDefinition.match(event as never)).toEqual({ id: plan.callId, role: 'update' })
    const context = { key: 'plan', id: plan.callId, state: plan, start: { event: { seq: 12 }, location: { kind: 'unresolved' } } }
    expect(planDefinition.buildViewNode!(context as never)).toMatchObject({ visibility: 'hidden', anchorSeq: 12, data: plan })
    expect(planDefinition.buildViewNode!({ ...context, state: undefined, start: undefined, matches: [] } as never)).toBeNull()
  })
  it('retains the submitted version and recovers a cropped PTC start from settlement', () => {
    expect(planDefinition.match({ type: 'user/message', data: {} } as never)).toBeNull()
    const state = planDefinition.start({} as never, { event: call } as never, {} as never)
    expect(state).toEqual(plan)
    expect(planDefinition.update({ state } as never, {} as never)).toBe(state)
    const settled = { event: { type: 'tool/ptc-dispatch', seq: 21, data: { name: 'exit_plan_mode', subCallId: plan.callId, arguments: { plan: markdown } } }, location: { kind: 'unresolved' } }
    expect(planDefinition.buildViewNode!({ key: 'plan', id: plan.callId, matches: [settled] } as never)).toMatchObject({ anchorSeq: 21, data: plan })
  })
})

it('projects native and PTC submissions into their resolved turns without duplicate cards', () => {
  const assembler = new ConversationNodeAssembler(
    { entries: () => [planDefinition], fallbackEntry: () => undefined },
    { entries: () => [chatViewDefinition] },
  )
  const events = [
    { type: 'turn/start', data: { turn: 1 } },
    { type: 'step/start', data: { turn: 1, step: 1 } },
    call,
    { type: 'tool/call', data: { turn: 1, step: 1, callId: 'root', name: 'run_code', arguments: '{}' } },
    { type: 'tool/ptc-dispatch-start', data: {
      rootCallId: 'root', parentCallId: 'root', subCallId: 'ptc', name: 'exit_plan_mode', arguments: { plan: markdown },
    } },
    { type: 'tool/ptc-dispatch', data: {
      rootCallId: 'root', parentCallId: 'root', subCallId: 'ptc', name: 'exit_plan_mode', arguments: { plan: markdown },
      isError: false, content: [],
    } },
    { type: 'turn/end', data: { turn: 1 } },
    { type: 'turn/start', data: { turn: 2 } },
    { ...call, data: { ...call.data, turn: 2, callId: 'next-turn' } },
    { type: 'turn/end', data: { turn: 2 } },
  ]
  const entries = events.map((event, index) => ({
    type: 'event', event: { ...event, seq: index + 1, time: index },
  })) as SessionLiveEventEntry[]
  assembler.replaceWindow(entries, false)
  assembler.activateTarget('chat')
  const snapshot = assembler.snapshot('chat') as ChatSnapshot
  expect(snapshot.order).toEqual([])
  expect(snapshot.nodes.values()).toHaveLength(3)
  const props = { turn: { turn: 1 }, useChat: (select: (snapshot: ChatSnapshot) => unknown) => select(snapshot),
    t, openPlan: vi.fn(),
  } as unknown as Parameters<typeof PlanCards>[0]
  const view = render(<PlanCards {...props} />)
  expect(view.container.querySelectorAll('[data-plan-card]')).toHaveLength(2)
  view.rerender(<PlanCards {...{ ...props, turn: { turn: 2 } } as unknown as Parameters<typeof PlanCards>[0]} />)
  expect(view.container.querySelector('[data-plan-card]')?.getAttribute('data-plan-card')).toBe('next-turn')
  assembler.replaceWindow(entries.filter((_, index) => index !== 4), true)
  expect((assembler.snapshot('chat') as ChatSnapshot).nodes.values()).toHaveLength(3)
})

describe('plan entry points and document', () => {
  it('opens the exact persistent card in either locale', () => {
    for (const dictionary of [en, zh]) {
      const openPlan = vi.fn()
      const props = { turn: { turn: 1 }, useChat: planHook([planNode(plan)]), seq: 30,
        t: makeTranslate(dictionary, commonEn), openPlan,
      } as unknown as Parameters<typeof PlanCards>[0]
      const view = render(<PlanCards {...props} />)
      expect(openPlan).not.toHaveBeenCalled()
      expect(screen.getByText(dictionary['preview.action'])).toBeTruthy()
      expect(screen.queryByText('Implement')).toBeNull()
      fireEvent.click(screen.getByRole('button'))
      expect(openPlan).toHaveBeenCalledWith(plan.callId)
      expect(screen.getByText(plan.title)).toBeTruthy()
      view.unmount()
    }
  })
  it('keeps only the current turn’s plans in invocation order', () => {
    const revised = { ...plan, callId: 'call:2' as typeof plan.callId, title: 'Second plan' }
    const nodes = [
      { ...planNode(revised), anchorSeq: 20 }, planNode(plan),
      { ...planNode(plan), location: { kind: 'turn', turn: { turn: 2 } } },
      { ...planNode(plan), location: { kind: 'unresolved' } },
      { ...planNode(plan), kind: 'tool-call' },
      { ...planNode({ ...revised, callId: 'call:3' as typeof plan.callId }),
        anchorSeq: 30, location: { kind: 'step', turn: { turn: 1 } },
      },
    ]
    const openPlan = vi.fn()
    const props = { turn: { turn: 1 }, useChat: planHook(nodes), t, openPlan } as unknown as Parameters<typeof PlanCards>[0]
    const view = render(<PlanCards {...props} />)
    expect(screen.getAllByRole('button').map(button => button.textContent)).toEqual([
      expect.stringContaining(plan.title), expect.stringContaining(revised.title), expect.stringContaining(revised.title),
    ])
    fireEvent.click(screen.getAllByRole('button')[1]!)
    expect(openPlan).toHaveBeenCalledWith('call:2')
    view.rerender(<PlanCards {...{ ...props, useChat: planHook([]) }} />)
    expect(view.container.innerHTML).toBe('')
  })
  it.each([true, false])('opens once, preserves manual closure, and reopens a review (logged: %s)', (logged) => {
    const openReview = vi.fn()
    const store = createPlanReviewStore().create()
    const review = { plan: markdown, ...(logged ? { callId: plan.callId } : {}) }
    const props = { review, requestKey: 'question:1', t, openReview, actions: store.actions,
      useStore: (select: (state: ReturnType<typeof store.getSnapshot>) => unknown) => select(store.getSnapshot()),
    } as unknown as Parameters<typeof PlanReviewOpen>[0]
    const first = render(<PlanReviewOpen {...props} />)
    expect(openReview).toHaveBeenCalledExactlyOnceWith(review, 'question:1')
    first.rerender(<PlanReviewOpen {...props} />)
    first.unmount()
    const second = render(<PlanReviewOpen {...props} />)
    expect(openReview).toHaveBeenCalledTimes(1)
    fireEvent.click(screen.getByRole('button', { name: 'Open plan in sidebar' }))
    expect(openReview).toHaveBeenCalledTimes(2)
    const revised = { plan: '# Revised', ...(logged ? { callId: 'call:2' } : {}) }
    second.rerender(<PlanReviewOpen {...{ ...props, review: revised, requestKey: 'question:2' } as unknown as Parameters<typeof PlanReviewOpen>[0]} />)
    expect(openReview).toHaveBeenLastCalledWith(revised, 'question:2')
    expect(openReview).toHaveBeenCalledTimes(3)
    second.unmount()
    const other = createPlanReviewStore().create()
    render(<PlanReviewOpen {...{ ...props, actions: other.actions,
      useStore: (select: (state: ReturnType<typeof other.getSnapshot>) => unknown) => select(other.getSnapshot()),
    } as unknown as Parameters<typeof PlanReviewOpen>[0]} />)
    expect(openReview).toHaveBeenCalledTimes(4)
  })
  it('renders temporary Markdown and reports expired navigation after reload', () => {
    const address = reviewPreviewAddress(target.session.sessionId, 'window:question:1')
    expect(isReviewPreviewAddress(address)).toBe(true)
    expect(isReviewPreviewAddress(planAddress(target))).toBe(false)
    const props = { t, useResource: () => ({ status: 'none' }),
      useTabInfo: () => ({ tab: { title: 'Plan', navigation: { address, params: { planReview: { title: plan.title, markdown } } } } }),
    }
    const view = render(<PlanPreview {...props as unknown as Parameters<typeof PlanPreview>[0]} />)
    expect(screen.getByRole('heading', { name: plan.title })).toBeTruthy()
    expect(screen.getByText('Implement')).toBeTruthy()
    view.rerender(<PlanTitle {...props as unknown as Parameters<typeof PlanTitle>[0]} />)
    expect(screen.getByText(plan.title)).toBeTruthy()
    view.rerender(<PlanPreview {...{ ...props,
      useTabInfo: () => ({ tab: { title: 'Plan', navigation: { address } } }),
    } as unknown as Parameters<typeof PlanPreview>[0]} />)
    expect(screen.getByRole('status').textContent).toBe(en['preview.expired'])
    view.rerender(<PlanTitle {...{ ...props,
      useTabInfo: () => ({ tab: { title: 'Plan', navigation: { address } } }),
    } as unknown as Parameters<typeof PlanTitle>[0]} />)
    expect(screen.getByText('Plan')).toBeTruthy()
    view.rerender(<PlanPreview {...{ ...props,
      useTabInfo: () => ({ tab: { title: 'Plan', navigation: { address, params: { line: 2 } } } }),
    } as unknown as Parameters<typeof PlanPreview>[0]} />)
    expect(screen.getByRole('status').textContent).toBe(en['preview.expired'])
  })
  it('shows restored Markdown and its heading as the tab title', () => {
    const props = {
      t, useTabInfo: () => ({ tab: { title: 'Plan', navigation: { address: planAddress(target) } } }),
      useResource: () => ({ status: 'live', value: plan }),
    }
    render(<PlanPreview {...props as unknown as Parameters<typeof PlanPreview>[0]} />)
    expect(screen.getByRole('heading', { name: plan.title })).toBeTruthy()
    expect(screen.getAllByRole('listitem')).toHaveLength(2)
    cleanup()
    render(<PlanTitle {...props as unknown as Parameters<typeof PlanTitle>[0]} />)
    expect(screen.getByText(plan.title)).toBeTruthy()
  })
  it('copies the complete Markdown and keeps a tab label while history loads', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    const clipboard = Object.getOwnPropertyDescriptor(navigator, 'clipboard')
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } })
    try {
      const props = { t, useTabInfo: () => ({ tab: { title: 'Plan', navigation: { address: planAddress(target) } } }), useResource: () => ({ status: 'live', value: plan }) }
      const view = render(<PlanPreview {...props as unknown as Parameters<typeof PlanPreview>[0]} />)
      fireEvent.click(screen.getByRole('button', { name: 'Copy' }))
      await Promise.resolve()
      expect(writeText).toHaveBeenCalledWith(markdown)
      view.rerender(<PlanTitle {...{ ...props, useResource: () => ({ status: 'loading' }) } as unknown as Parameters<typeof PlanTitle>[0]} />)
      expect(screen.getByText('Plan')).toBeTruthy()
    } finally {
      if (clipboard === undefined) Reflect.deleteProperty(navigator, 'clipboard')
      else Object.defineProperty(navigator, 'clipboard', clipboard)
    }
  })
  it.each([en, zh])('localizes plan failures and unavailable providers', (dictionary) => {
    const props = { t: makeTranslate(dictionary, commonEn),
      useTabInfo: () => ({ tab: { title: 'Plan', navigation: { address: planAddress(target) } } }),
    }
    const view = render(<PlanPreview {...{ ...props, useResource: () => ({ status: 'loading' }) } as unknown as Parameters<typeof PlanPreview>[0]} />)
    expect(screen.getByRole('status').textContent).toBe(dictionary['preview.loading'])
    view.rerender(<PlanPreview {...{ ...props, useResource: () => ({ status: 'none' }) } as unknown as Parameters<typeof PlanPreview>[0]} />)
    expect(screen.getByRole('status').textContent).toBe(dictionary['preview.unavailable'])
    for (const [code, message] of [
      ['plan/invalid-address', dictionary['preview.invalidAddress']],
      ['plan/unavailable', dictionary['preview.historyUnavailable']],
      ['plan/not-found', dictionary['preview.notFound']],
      ['plan/read-failed', 'connection lost'],
      ['session/not-found', 'connection lost'],
    ] as const) {
      view.rerender(<PlanPreview {...{ ...props, useResource: () => ({ status: 'failed', failure: { code, message: 'connection lost' } }) } as unknown as Parameters<typeof PlanPreview>[0]} />)
      expect(screen.getByRole('status').textContent).toBe(dictionary['preview.failed'] + message)
    }
  })
})
