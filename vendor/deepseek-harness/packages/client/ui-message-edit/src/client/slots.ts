/**
 * The edit entry's injected face. The target
 * 'conversation.chat.user-actions' and 'conversation.chat.user-editor' slots
 * are declared and typed by ui-chat; this package only contributes
 * the entries, so no SlotMap merge lives here. The edit surface is the
 * session's own resident composer: `beginEdit` starts a composer edit
 * session (stash + seed + redirected submit) whose sink is the
 * fork-before/open/handoff transaction, and `endEdit` cancels it. The pencil
 * only calls the owner `startEdit` callback. Both entries declare the shared
 * interaction store (the focus-return handshake after a cancelled edit).
 * @module @deepseek-ai/dsh-client-ui-message-edit/client/slots
 */

import type {
  InjectFace, PropsLocale, PropsRuntime, PropsStore,
} from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-chat/client'
// Type-only: pulls this package's LocaleNamespaceMap merge (the 'messageEdit' seat).
import type {} from './locales.ts'
import type { createMessageEditStore } from './stores.ts'

/** The shared pencil/editor store share (focus-return handshake). */
type MessageEditStoreProps = PropsStore<ReturnType<typeof createMessageEditStore>>

/** Injected business face of the user-message edit entry. */
export interface MessageEditInjected {
  /**
   * Begin the composer edit session for the addressed message: the resident
   * composer stashes its draft, seeds the message text, and redirects its
   * submit to the fork-before/open/handoff transaction. A refusal (another
   * edit live, or an admission transaction in flight) notifies on the
   * composer and returns false — the caller restores the static bubble.
   * @param seq - the user message to replace (the fork cuts before its turn).
   * @param text - the message's plain text, verbatim (the draft seed).
   */
  beginEdit: (seq: number, text: string) => boolean
  /**
   * End this message's composer edit session, restoring the stashed draft.
   * No-op when the live edit belongs to another message or none is live.
   * @param seq - the addressed user message.
   */
  endEdit: (seq: number) => void
}

/** Full props of one user-message edit action. */
export type MessageEditActionProps =
  PropsRuntime<'conversation.chat.user-actions'>
  & MessageEditStoreProps
  & PropsLocale<'messageEdit'>

/** Full props of the editing-state bubble. */
export type MessageEditEditorProps =
  PropsRuntime<'conversation.chat.user-editor'>
  & MessageEditStoreProps
  & InjectFace<MessageEditInjected>
  & PropsLocale<'messageEdit'>
