// @vitest-environment jsdom
/**
 * MessageFeedbackActions rendering and gestures: the rating buttons reflect the
 * shared view with the filled glyph for a recorded rating, Like records at once
 * and raises the acknowledgement only when a rating was recorded, Dislike opens
 * the Session's dialog unless it retracts a recorded Dislike, the Session's
 * feedback is read on first interaction rather than on mount, and a rejected
 * mutation surfaces inline without losing the authoritative state.
 */
import { useSyncExternalStore } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { zh as commonZh } from '@deepseek-ai/dsh-client-locale/src/locales/zh.ts'
import type { MessageId } from '@deepseek-ai/dsh-api-remotes/client'
import type {
  MessageFeedbackItem, MessageFeedbackRating, MessageFeedbackVersion,
} from '@deepseek-ai/dsh-message-feedback/types'
import { MessageFeedbackActions } from '../src/client/MessageFeedbackActions.tsx'
import type {
  MessageFeedbackActionResult, MessageFeedbackToggleResult, MessageFeedbackView,
} from '../src/client/controller.ts'
import { zh } from '../src/client/locales.ts'

afterEach(cleanup)

const MSG = 'm-1' as MessageId
const t = makeTranslate(zh, commonZh)

function item(overrides: Partial<MessageFeedbackItem> = {}): MessageFeedbackItem {
  return {
    messageId: MSG,
    rating: 'positive',
    version: 'v1' as MessageFeedbackVersion,
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  }
}

/** Render the controls over a fixed view and recording verbs. */
function mount(options: {
  current?: MessageFeedbackItem | undefined
  /** The controller's committed item when it differs from the rendered view (a cold row). */
  committed?: MessageFeedbackItem
  ensureResult?: MessageFeedbackActionResult
  toggleResult?: MessageFeedbackToggleResult
  status?: MessageFeedbackView['status']
} = {}) {
  const view: MessageFeedbackView = {
    status: options.status ?? 'ready',
    items: new Map(options.current === undefined ? [] : [[MSG, options.current]]),
    error: null,
  }
  const ensure = vi.fn(() => Promise.resolve<MessageFeedbackActionResult>(options.ensureResult ?? { ok: true }))
  // The controller owns record-vs-retract, so the double stands in for it:
  // matching the shown rating retracts, anything else records.
  const toggle = vi.fn((_id: MessageId, next: MessageFeedbackRating) =>
    Promise.resolve<MessageFeedbackToggleResult>(options.toggleResult
      ?? { ok: true, rating: options.current?.rating === next ? null : next }))
  const openDialog = vi.fn((_id: MessageId) => {})
  const acknowledge = vi.fn(() => {})
  const current = vi.fn((_id: MessageId) => options.committed ?? options.current)
  const useFeedback = (<T,>(select: (v: MessageFeedbackView) => T): T =>
    useSyncExternalStore(() => () => {}, () => select(view))) as never
  const props = { messageId: MSG, ensure, current, toggle, openDialog, acknowledge, useFeedback, t } as unknown as
    Parameters<typeof MessageFeedbackActions>[0]
  return { ...render(<MessageFeedbackActions {...props} />), ensure, toggle, openDialog, acknowledge }
}

describe('MessageFeedbackActions', () => {
  it('renders both rating buttons unpressed with no recorded feedback', () => {
    const ui = mount()

    expect(ui.getByLabelText(zh['action.like']).getAttribute('aria-pressed')).toBe('false')
    expect(ui.getByLabelText(zh['action.dislike']).getAttribute('aria-pressed')).toBe('false')
  })

  it('marks the recorded rating pressed, fills its glyph, and offers to retract it', () => {
    const ui = mount({ current: item({ rating: 'negative' }) })

    const dislike = ui.getByLabelText(zh['action.dislikeActive'])
    expect(dislike.getAttribute('aria-pressed')).toBe('true')
    expect(dislike.hasAttribute('data-active')).toBe(true)
    expect(ui.getByLabelText(zh['action.like']).getAttribute('aria-pressed')).toBe('false')
    expect(ui.getByLabelText(zh['action.like']).hasAttribute('data-active')).toBe(false)
  })

  it('reads the Session feedback on first interaction, once', () => {
    const ui = mount()
    const like = ui.getByLabelText(zh['action.like'])

    fireEvent.pointerEnter(like)
    fireEvent.pointerEnter(like)
    fireEvent.focus(ui.getByLabelText(zh['action.dislike']))

    expect(ui.ensure).toHaveBeenCalledTimes(1)
  })

  it('does not read the Session feedback on mount', () => {
    const ui = mount()

    expect(ui.ensure).not.toHaveBeenCalled()
  })

  it('records a Like at once and acknowledges it', async () => {
    const ui = mount()

    fireEvent.click(ui.getByLabelText(zh['action.like']))

    await waitFor(() => { expect(ui.toggle).toHaveBeenCalledWith(MSG, 'positive') })
    await waitFor(() => { expect(ui.acknowledge).toHaveBeenCalledTimes(1) })
    expect(ui.openDialog).not.toHaveBeenCalled()
  })

  it('retracts a recorded Like on click without acknowledging', async () => {
    const ui = mount({ current: item({ rating: 'positive' }) })

    fireEvent.click(ui.getByLabelText(zh['action.likeActive']))

    await waitFor(() => { expect(ui.toggle).toHaveBeenCalledWith(MSG, 'positive') })
    await waitFor(() => { expect(ui.getByLabelText(zh['action.likeActive']).hasAttribute('disabled')).toBe(false) })
    expect(ui.acknowledge).not.toHaveBeenCalled()
  })

  it('opens the dialog for a Dislike instead of recording it', async () => {
    const ui = mount()

    fireEvent.click(ui.getByLabelText(zh['action.dislike']))

    await waitFor(() => { expect(ui.openDialog).toHaveBeenCalledWith(MSG) })
    expect(ui.toggle).not.toHaveBeenCalled()
  })

  it('opens the dialog for a Dislike that replaces a recorded Like', async () => {
    const ui = mount({ current: item({ rating: 'positive' }) })

    fireEvent.click(ui.getByLabelText(zh['action.dislike']))

    await waitFor(() => { expect(ui.openDialog).toHaveBeenCalledWith(MSG) })
    expect(ui.toggle).not.toHaveBeenCalled()
  })

  it('opens the dialog for a Dislike when the seeding read fails, leaving the put to decide', async () => {
    const ui = mount({ ensureResult: { ok: false, error: { code: 'session-not-found', message: 'gone' } } })

    fireEvent.click(ui.getByLabelText(zh['action.dislike']))

    await waitFor(() => { expect(ui.openDialog).toHaveBeenCalledWith(MSG) })
    expect(ui.toggle).not.toHaveBeenCalled()
  })

  it('decides a Dislike from the committed item, so a cold row retracts a stored Dislike', async () => {
    const ui = mount({ committed: item({ rating: 'negative' }) })

    fireEvent.click(ui.getByLabelText(zh['action.dislike']))

    await waitFor(() => { expect(ui.toggle).toHaveBeenCalledWith(MSG, 'negative') })
    expect(ui.openDialog).not.toHaveBeenCalled()
  })

  it('retracts a recorded Dislike on click without the dialog', async () => {
    const ui = mount({ current: item({ rating: 'negative' }) })

    fireEvent.click(ui.getByLabelText(zh['action.dislikeActive']))

    await waitFor(() => { expect(ui.toggle).toHaveBeenCalledWith(MSG, 'negative') })
    expect(ui.openDialog).not.toHaveBeenCalled()
    expect(ui.acknowledge).not.toHaveBeenCalled()
  })

  it('reports a lost race with the conflict copy', async () => {
    const ui = mount({
      toggleResult: { ok: false, error: { code: 'version-conflict', message: 'feedback changed elsewhere' } },
    })

    fireEvent.click(ui.getByLabelText(zh['action.like']))

    await waitFor(() => { expect(ui.getByText(zh['error.conflict'])).toBeTruthy() })
    expect(ui.acknowledge).not.toHaveBeenCalled()
  })

  it('reports any other failure with the generic copy', async () => {
    const ui = mount({
      toggleResult: { ok: false, error: { code: 'target-not-found', message: 'no such message' } },
    })

    fireEvent.click(ui.getByLabelText(zh['action.like']))

    await waitFor(() => { expect(ui.getByText(zh['error.generic'])).toBeTruthy() })
  })

  it('reports a failed retraction of a recorded Dislike', async () => {
    const ui = mount({
      current: item({ rating: 'negative' }),
      toggleResult: { ok: false, error: { code: 'version-conflict', message: 'feedback changed elsewhere' } },
    })

    fireEvent.click(ui.getByLabelText(zh['action.dislikeActive']))

    await waitFor(() => { expect(ui.getByText(zh['error.conflict'])).toBeTruthy() })
  })

  it('publishes no state after the row unmounts mid-flight', async () => {
    let release = (): void => {}
    const gate = new Promise<MessageFeedbackToggleResult>((resolve) => {
      release = () => { resolve({ ok: false, error: { code: 'target-not-found', message: 'gone' } }) }
    })
    const view: MessageFeedbackView = { status: 'ready', items: new Map(), error: null }
    const useFeedback = (<T,>(select: (v: MessageFeedbackView) => T): T =>
      useSyncExternalStore(() => () => {}, () => select(view))) as never
    const props = {
      messageId: MSG,
      ensure: vi.fn(() => Promise.resolve<MessageFeedbackActionResult>({ ok: true })),
      toggle: vi.fn(() => gate),
      openDialog: vi.fn(),
      acknowledge: vi.fn(),
      useFeedback,
      t,
    } as unknown as Parameters<typeof MessageFeedbackActions>[0]
    const ui = render(<MessageFeedbackActions {...props} />)
    const errors: unknown[] = []
    const onError = (event: ErrorEvent): void => { errors.push(event.error) }
    window.addEventListener('error', onError)

    fireEvent.click(ui.getByLabelText(zh['action.like']))
    ui.unmount()
    release()
    await gate

    window.removeEventListener('error', onError)
    expect(errors).toEqual([])
  })

  it('publishes no state after the row unmounts before the seeding read settles', async () => {
    let release = (): void => {}
    const gate = new Promise<MessageFeedbackActionResult>((resolve) => { release = () => { resolve({ ok: true }) } })
    const view: MessageFeedbackView = { status: 'cold', items: new Map(), error: null }
    const useFeedback = (<T,>(select: (v: MessageFeedbackView) => T): T =>
      useSyncExternalStore(() => () => {}, () => select(view))) as never
    const openDialog = vi.fn()
    const props = {
      messageId: MSG,
      ensure: vi.fn(() => gate),
      current: () => undefined,
      toggle: vi.fn(),
      openDialog,
      acknowledge: vi.fn(),
      useFeedback,
      t,
    } as unknown as Parameters<typeof MessageFeedbackActions>[0]
    const ui = render(<MessageFeedbackActions {...props} />)
    const errors: unknown[] = []
    const onError = (event: ErrorEvent): void => { errors.push(event.error) }
    window.addEventListener('error', onError)

    fireEvent.click(ui.getByLabelText(zh['action.dislike']))
    ui.unmount()
    release()
    await gate

    window.removeEventListener('error', onError)
    expect(errors).toEqual([])
    expect(openDialog).not.toHaveBeenCalled()
  })

  it('publishes no state after the row unmounts mid-retraction', async () => {
    let release = (): void => {}
    const gate = new Promise<MessageFeedbackToggleResult>((resolve) => {
      release = () => { resolve({ ok: false, error: { code: 'target-not-found', message: 'gone' } }) }
    })
    const view: MessageFeedbackView = {
      status: 'ready', items: new Map([[MSG, item({ rating: 'negative' })]]), error: null,
    }
    const useFeedback = (<T,>(select: (v: MessageFeedbackView) => T): T =>
      useSyncExternalStore(() => () => {}, () => select(view))) as never
    const props = {
      messageId: MSG,
      ensure: vi.fn(() => Promise.resolve<MessageFeedbackActionResult>({ ok: true })),
      current: () => item({ rating: 'negative' }),
      toggle: vi.fn(() => gate),
      openDialog: vi.fn(),
      acknowledge: vi.fn(),
      useFeedback,
      t,
    } as unknown as Parameters<typeof MessageFeedbackActions>[0]
    const ui = render(<MessageFeedbackActions {...props} />)
    const errors: unknown[] = []
    const onError = (event: ErrorEvent): void => { errors.push(event.error) }
    window.addEventListener('error', onError)

    fireEvent.click(ui.getByLabelText(zh['action.dislikeActive']))
    // The retraction starts only after the seeding read settles; unmount
    // while that retraction is in flight.
    await waitFor(() => { expect(props.toggle).toHaveBeenCalledWith(MSG, 'negative') })
    ui.unmount()
    release()
    await gate

    window.removeEventListener('error', onError)
    expect(errors).toEqual([])
  })

  it('surfaces a failed list load next to the controls', () => {
    const ui = mount({ status: 'error' })

    expect(ui.getByText(zh['error.load'])).toBeTruthy()
  })

  it('prefers the action failure over the load notice', async () => {
    const ui = mount({
      status: 'error',
      toggleResult: { ok: false, error: { code: 'target-not-found', message: 'gone' } },
    })

    fireEvent.click(ui.getByLabelText(zh['action.like']))

    await waitFor(() => { expect(ui.getByText(zh['error.generic'])).toBeTruthy() })
    expect(ui.queryByText(zh['error.load'])).toBeNull()
  })
})
