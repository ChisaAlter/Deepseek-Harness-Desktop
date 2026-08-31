/**
 * Latest-user-message edit control: a pencil in the user message's IconActions
 * row that asks the owning bubble to enter inline-edit mode. Only the newest
 * user message in the transcript arms the button; historical messages render
 * nothing here. The fork/resend transaction lives on the editor, not here.
 * After a cancelled edit the pencil consumes the store's focus-return request
 * so keyboard focus lands back on the control that opened the editor.
 * @module @deepseek-ai/dsh-client-ui-message-edit/client/MessageEditAction
 */

import { useCallback, useEffect, useId, useRef } from 'react'
import { IconEditOutline16, Tooltip } from '@deepseek-ai/dsh-client-ui-primitives'
import { joinedText } from './text.ts'
import type { MessageEditActionProps } from './slots.ts'
import css from './MessageEditAction.module.css'

/**
 * One message's edit control.
 * @param props - the addressed user message, startEdit, the session snapshot
 * hook, and the shared interaction store (focus-return handshake).
 * @returns the pencil action, or nothing when this is not the latest user message.
 */
export function MessageEditAction({ seq, content, startEdit, useSession, useChat, useStore, actions, t }: MessageEditActionProps) {
  const latest = useChat((snapshot) => {
    for (let index = snapshot.order.length - 1; index >= 0; index -= 1) {
      const candidate = snapshot.nodes.get(snapshot.order[index] ?? '')
      if (candidate?.kind !== 'user') continue
      return (candidate.data as { seq: number }).seq === seq
    }
    return false
  })
  const running = useSession(snapshot => snapshot.running)
  const returnFocus = useStore(state => state.returnFocusSeq === seq)
  const buttonRef = useRef<HTMLButtonElement | null>(null)
  const reasonId = useId()

  const textOnly = joinedText(content) !== null
  const unavailable = running || !textOnly
  const label = running
    ? t('action.running')
    : !textOnly
      ? t('action.unsupported')
      : t('action.edit')

  // Consume the editor's focus-return request one-shot. The clear also runs
  // when this pencil no longer renders (the message stopped being latest
  // mid-edit), so a stale request cannot leak onto a later, unrelated mount.
  useEffect(() => {
    if (!returnFocus) return
    actions.clearReturnFocus()
    buttonRef.current?.focus()
  }, [actions, returnFocus])

  const onEdit = useCallback(() => {
    if (unavailable) return
    startEdit()
  }, [startEdit, unavailable])

  if (!latest) return null
  return (
    <>
      <Tooltip label={label} side="bottom">
        {/* A native disabled button would drop the hover/focus events Tooltip needs. */}
        <button
          ref={buttonRef}
          type="button"
          className={css.action}
          aria-label={t('action.edit')}
          aria-disabled={unavailable || undefined}
          aria-describedby={unavailable ? reasonId : undefined}
          data-unavailable={unavailable || undefined}
          onClick={onEdit}
        >
          <IconEditOutline16 />
        </button>
      </Tooltip>
      {unavailable && <span id={reasonId} className={css.visuallyHidden}>{label}</span>}
    </>
  )
}
