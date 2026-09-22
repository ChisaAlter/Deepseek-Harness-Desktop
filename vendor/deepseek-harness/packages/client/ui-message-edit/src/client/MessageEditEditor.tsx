/**
 * Editing-state bubble for one finalized user message. The edit surface is
 * the session's resident composer — the full input (draft machine,
 * decorations, attachments, IME, keyboard policy) — promoted into the edit
 * transaction through the composer edit session; this occupant only marks
 * the addressed bubble, arms the session on mount, and offers the in-place
 * cancel. Confirm rides the composer's own submit: the redirected sink
 * replaces this turn within the current Session. The composer's banner cancel / Escape and this
 * bubble's cancel both end the session; only the bubble's cancel returns
 * focus to the pencil (the composer paths keep focus in the composer).
 * @module @deepseek-ai/dsh-client-ui-message-edit/client/MessageEditEditor
 */

import { useCallback, useEffect, useRef } from 'react'
import { Button } from '@deepseek-ai/dsh-client-ui-primitives'
import { editKey, joinedText } from './text.ts'
import type { MessageEditEditorProps } from './slots.ts'
import css from './MessageEditEditor.module.css'

/**
 * One message's editing-state bubble.
 * @param props - the addressed user message, cancelEdit, the beginEdit /
 * endEdit verbs, the input state hook, and the shared interaction store.
 * @returns the editing-marked bubble row.
 */
export function MessageEditEditor({
  seq, content, cancelEdit, beginEdit, endEdit, useInput, actions, t,
}: MessageEditEditorProps) {
  const key = editKey(seq)
  const live = useInput(state => state.edit?.key === key)
  // Rising-edge latch: the arm effect publishes the edit AFTER the first
  // render, so a bare `!live` would read the pre-arm snapshot and cancel a
  // healthy mount.
  const wasLive = useRef(false)

  // Arm on mount. A refusal (another edit live, admission in flight)
  // restores the static bubble immediately — the refusal notice rides the
  // composer's own channel.
  useEffect(() => {
    if (!beginEdit(seq, joinedText(content) ?? '')) {
      cancelEdit()
      return
    }
    // Unmounting with the edit still live (session switch, view teardown)
    // cancels it, so the composer never keeps editing a bubble that is gone.
    return () => { endEdit(seq) }
  }, [])

  // The composer side ended the edit — banner cancel, Escape, or a
  // successful resend: restore the static bubble without stealing the
  // composer's focus.
  useEffect(() => {
    if (live) {
      wasLive.current = true
      return
    }
    if (wasLive.current) cancelEdit()
  }, [cancelEdit, live])

  const onCancel = useCallback(() => {
    // Ask the remounted pencil to take focus before the bubble swap removes
    // this row (the editor and the pencil never coexist in the DOM).
    actions.requestReturnFocus(seq)
    endEdit(seq)
  }, [actions, endEdit, seq])

  return (
    <div className={css.row} data-message-editing>
      <div className={css.stack}>
        <div className={css.bubble}>{joinedText(content) ?? ''}</div>
      </div>
      <div className={css.actions}>
        <span className={css.hint} role="status">{t('editor.editing')}</span>
        <Button variant="ghost" size="sm" onClick={onCancel}>
          {t('action.cancel')}
        </Button>
      </div>
    </div>
  )
}
