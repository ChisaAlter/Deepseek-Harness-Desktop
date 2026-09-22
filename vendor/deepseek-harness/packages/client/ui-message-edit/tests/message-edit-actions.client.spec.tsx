// @vitest-environment jsdom
/**
 * MessageEditAction rendering and gestures: the pencil renders only on the
 * newest user message, stays unavailable while the session runs or the message
 * carries non-text blocks, calls the owner startEdit callback on click, and
 * consumes the store's focus-return request after a cancelled edit.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render } from '@testing-library/react'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { zh as commonZh } from '@deepseek-ai/dsh-client-locale/src/locales/zh.ts'
import type { ConversationNode } from '@deepseek-ai/dsh-client-ui-conversation/client'
import { MessageEditAction } from '../src/client/MessageEditAction.tsx'
import { createMessageEditStore } from '../src/client/stores.ts'
import type { MessageEditActionProps } from '../src/client/slots.ts'
import { zh } from '../src/client/locales.ts'

afterEach(cleanup)

const t = makeTranslate(zh, commonZh)

interface SnapshotLike {
  readonly nodes: readonly ConversationNode[]
  readonly running: boolean
}

function snapshot(nodes: readonly ConversationNode[], running = false): SnapshotLike {
  return { nodes, running }
}

/** Chat target shape MessageEditAction reads: keyed nodes plus render order. */
function chatFromLegacy(nodes: readonly ConversationNode[]) {
  const order = nodes.map((_, index) => `n${String(index)}`)
  const byKey = new Map(order.map((key, index) => {
    const node = nodes[index]!
    return [key, { kind: node.kind, data: { seq: node.seq } }] as const
  }))
  return {
    order,
    nodes: {
      get: (key: string) => byKey.get(key),
      values: () => [...byKey.values()],
    },
  }
}

function mount(options: {
  seq: number
  content: readonly unknown[]
  snapshot?: SnapshotLike
  returnFocusSeq?: number
}) {
  const startEdit = vi.fn()
  const store = createMessageEditStore().create()
  if (options.returnFocusSeq !== undefined) store.actions.requestReturnFocus(options.returnFocusSeq)
  const session = options.snapshot ?? snapshot([{ kind: 'user', seq: options.seq, time: 1, content: [], source: null }])
  const chat = chatFromLegacy(session.nodes)
  const useSession = (<T,>(select: (s: SnapshotLike) => T): T => select(session)) as never
  const useChat = (<T,>(select: (s: typeof chat) => T): T => select(chat)) as never
  const useStore = (<T,>(select: (s: ReturnType<typeof store.getSnapshot>) => T): T =>
    select(store.getSnapshot())) as never
  const props = {
    seq: options.seq,
    content: options.content as MessageEditActionProps['content'],
    startEdit,
    useSession,
    useChat,
    useStore,
    actions: store.actions,
    t,
  } as unknown as MessageEditActionProps
  return { ...render(<MessageEditAction {...props} />), startEdit, store }
}

const textBlock = (text: string) => ({ type: 'text' as const, text })

describe('MessageEditAction', () => {
  it('renders nothing for a user message that is not the newest in the transcript', () => {
    const ui = mount({
      seq: 1,
      content: [textBlock('old')],
      snapshot: snapshot([
        { kind: 'user', seq: 1, time: 1, content: [textBlock('old')], source: null },
        { kind: 'assistant', seq: 2, time: 2, turn: 1, step: 1, blocks: [{ kind: 'text', text: 'answer' }] },
        { kind: 'user', seq: 3, time: 3, content: [textBlock('newest')], source: null },
      ]),
    })
    expect(ui.queryByRole('button', { name: zh['action.edit'] })).toBeNull()
  })

  it('renders the pencil on the newest user message even when an assistant answer follows nothing else', () => {
    const ui = mount({
      seq: 3,
      content: [textBlock('newest')],
      snapshot: snapshot([
        { kind: 'user', seq: 1, time: 1, content: [textBlock('old')], source: null },
        { kind: 'assistant', seq: 2, time: 2, turn: 1, step: 1, blocks: [{ kind: 'text', text: 'answer' }] },
        { kind: 'user', seq: 3, time: 3, content: [textBlock('newest')], source: null },
      ]),
    })
    expect(ui.getByRole('button', { name: zh['action.edit'] })).toBeTruthy()
  })

  it('enters inline-edit mode on click without forking', () => {
    const ui = mount({ seq: 1, content: [textBlock('hello')] })
    fireEvent.click(ui.getByRole('button', { name: zh['action.edit'] }))
    expect(ui.startEdit).toHaveBeenCalledTimes(1)
  })

  it('stays unavailable while the session is running', () => {
    const ui = mount({
      seq: 1,
      content: [textBlock('hello')],
      snapshot: snapshot([{ kind: 'user', seq: 1, time: 1, content: [textBlock('hello')], source: null }], true),
    })
    const button = ui.getByRole('button', { name: zh['action.edit'] })
    expect(button.getAttribute('aria-disabled')).toBe('true')
    fireEvent.click(button)
    expect(ui.startEdit).not.toHaveBeenCalled()
  })

  it('stays unavailable for a message with non-text content and explains why', () => {
    const ui = mount({
      seq: 1,
      content: [{ type: 'text', text: 'caption' }, { type: 'image', attachment: { attachmentId: 'a' } }],
    })
    const button = ui.getByRole('button', { name: zh['action.edit'] })
    expect(button.getAttribute('aria-disabled')).toBe('true')
    fireEvent.click(button)
    expect(ui.startEdit).not.toHaveBeenCalled()
  })

  it('takes focus and clears the request after a cancelled edit', () => {
    const ui = mount({ seq: 1, content: [textBlock('hello')], returnFocusSeq: 1 })
    expect(document.activeElement).toBe(ui.getByRole('button', { name: zh['action.edit'] }))
    expect(ui.store.getSnapshot().returnFocusSeq).toBeNull()
  })

  it('leaves another message\'s focus-return request alone', () => {
    const ui = mount({ seq: 1, content: [textBlock('hello')], returnFocusSeq: 5 })
    expect(document.activeElement).not.toBe(ui.getByRole('button', { name: zh['action.edit'] }))
    expect(ui.store.getSnapshot().returnFocusSeq).toBe(5)
  })

  it('consumes a stale focus-return request even when the pencil no longer renders', () => {
    const ui = mount({
      seq: 1,
      content: [textBlock('old')],
      returnFocusSeq: 1,
      snapshot: snapshot([
        { kind: 'user', seq: 1, time: 1, content: [textBlock('old')], source: null },
        { kind: 'user', seq: 3, time: 3, content: [textBlock('newest')], source: null },
      ]),
    })
    expect(ui.queryByRole('button', { name: zh['action.edit'] })).toBeNull()
    expect(ui.store.getSnapshot().returnFocusSeq).toBeNull()
  })
})
