// @vitest-environment jsdom
/**
 * MessageEditEditor as the editing-state bubble: mounting arms the composer
 * edit session through beginEdit with the joined text, the bubble shows the
 * original message with the editing hint, the in-place cancel requests focus
 * return and ends the session, a composer-side end (banner cancel / Escape /
 * successful fork-resend) restores the static bubble without a focus-return
 * request, a beginEdit refusal restores the bubble immediately, and
 * unmounting with the edit still live cancels the composer session.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render } from '@testing-library/react'
import { bindSnapshotSelector, makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import { zh as commonZh } from '@deepseek-ai/dsh-client-locale/src/locales/zh.ts'
import { MessageEditEditor } from '../src/client/MessageEditEditor.tsx'
import { createMessageEditStore } from '../src/client/stores.ts'
import type { MessageEditEditorProps } from '../src/client/slots.ts'
import { zh } from '../src/client/locales.ts'

afterEach(cleanup)

const t = makeTranslate(zh, commonZh)

/** The one InputState slice the bubble reads. */
interface InputLike { edit: { key: string } | undefined }

function mount(options: {
  seq?: number
  content: readonly unknown[]
  /** beginEdit verdict; true (accepted) unless the case refuses. */
  accept?: boolean
}) {
  const seq = options.seq ?? 7
  const accept = options.accept ?? true
  // A live stand-in for the composer's machine state: beginEdit publishes the
  // session, endEdit withdraws it, exactly as SessionInputShell would.
  const input = createSnapshotStore<InputLike>({ edit: undefined }, { flush: 'sync' })
  const beginEdit = vi.fn((s: number, _text: string) => {
    if (!accept) return false
    input.set({ edit: { key: `message-edit:${s}` } })
    return true
  })
  const endEdit = vi.fn((_s: number) => { input.set({ edit: undefined }) })
  const cancelEdit = vi.fn()
  const store = createMessageEditStore().create()
  const props = {
    seq,
    content: options.content as MessageEditEditorProps['content'],
    cancelEdit,
    beginEdit,
    endEdit,
    useInput: bindSnapshotSelector(input),
    actions: store.actions,
    t,
  } as unknown as MessageEditEditorProps
  return { ...render(<MessageEditEditor {...props} />), input, beginEdit, endEdit, cancelEdit, store }
}

const textBlock = (text: string) => ({ type: 'text' as const, text })

describe('MessageEditEditor', () => {
  it('arms the composer edit session on mount with the joined text', () => {
    const ui = mount({ content: [textBlock('part one '), textBlock('part two')] })
    expect(ui.beginEdit).toHaveBeenCalledExactlyOnceWith(7, 'part one part two')
    expect(ui.cancelEdit).not.toHaveBeenCalled()
  })

  it('shows the original message text and the editing hint', () => {
    const ui = mount({ content: [textBlock('hello world')] })
    expect(ui.getByText('hello world')).toBeTruthy()
    expect(ui.getByRole('status').textContent).toBe(zh['editor.editing'])
  })

  it('restores the static bubble immediately when beginEdit refuses', () => {
    const ui = mount({ content: [textBlock('hello')], accept: false })
    expect(ui.cancelEdit).toHaveBeenCalledTimes(1)
    // Nothing to end: the session never started, and no focus return is owed
    // (the refusal notice rides the composer's own channel).
    ui.unmount()
    expect(ui.endEdit).not.toHaveBeenCalled()
    expect(ui.store.getSnapshot().returnFocusSeq).toBeNull()
  })

  it('the bubble cancel requests focus return and ends the composer session', () => {
    const ui = mount({ content: [textBlock('hello')] })
    fireEvent.click(ui.getByRole('button', { name: zh['action.cancel'] }))
    expect(ui.store.getSnapshot().returnFocusSeq).toBe(7)
    expect(ui.endEdit).toHaveBeenCalledWith(7)
    // The end round-trips through the machine state, which restores the bubble.
    expect(ui.cancelEdit).toHaveBeenCalledTimes(1)
  })

  it('a composer-side end restores the bubble without a focus-return request', () => {
    const ui = mount({ content: [textBlock('hello')] })
    // Banner cancel, Escape, or a successful fork-resend: the machine state
    // drops the edit without this component's cancel being pressed.
    act(() => { ui.input.set({ edit: undefined }) })
    expect(ui.cancelEdit).toHaveBeenCalledTimes(1)
    expect(ui.store.getSnapshot().returnFocusSeq).toBeNull()
  })

  it('ignores a foreign edit session replacing this one', () => {
    const ui = mount({ content: [textBlock('hello')] })
    // Key mismatch reads as "not live" — the bubble restores rather than
    // claiming an edit that belongs to someone else.
    act(() => { ui.input.set({ edit: { key: 'other-plugin:1' } }) })
    expect(ui.cancelEdit).toHaveBeenCalledTimes(1)
  })

  it('unmounting with the edit still live cancels the composer session', () => {
    const ui = mount({ content: [textBlock('hello')] })
    ui.unmount()
    expect(ui.endEdit).toHaveBeenCalledWith(7)
  })

  it('arms with an empty seed when the message is not plain text', () => {
    const ui = mount({
      content: [{ type: 'text', text: 'caption' }, { type: 'image', attachment: { attachmentId: 'a' } }],
    })
    expect(ui.beginEdit).toHaveBeenCalledExactlyOnceWith(7, '')
  })
})
