/**
 * Append a file mention into the current session composer draft.
 *
 * Mirror obligation: ui-files, ui-preview, and ui-user-terminal each carry a
 * copy of this module because client packages must not share a value export.
 * Any behavior change here must be applied to all three copies.
 */

import type { Context } from '@deepseek-ai/cordis'
/** Structural conversation face; ui-files must not value-import ui-conversation. */
interface ConversationDraftFace {
  input: {
    for: (actx: unknown) => {
      setDraft: (text: string) => void
      state: { getSnapshot: () => { draft: string } }
    }
  }
}

/** Session list face used only to resolve composer scope; optional on session-maybe fibers. */
interface SessionsDraftFace {
  scope: (sessionId: never) => unknown
}

/**
 * Append `text` to the session composer, separated by a space when a draft
 * already exists. Missing conversation or session scope is a no-op.
 * @param ctx - client root context.
 * @param sessionId - session whose composer to write.
 * @param text - fragment to append, already formatted (`\`@path\``).
 * @returns true when a draft write happened.
 */
export function appendToDraft(ctx: Context, sessionId: string, text: string): boolean {
  const conversation = ctx.get('conversation') as ConversationDraftFace | undefined
  if (conversation === undefined) return false
  const sessions = ctx.get('sessions') as SessionsDraftFace | undefined
  if (sessions === undefined) return false
  const scope = sessions.scope(sessionId as never)
  if (scope === undefined) return false
  const input = conversation.input.for(scope)
  const current = input.state.getSnapshot().draft
  input.setDraft(current.length === 0 ? text : `${current} ${text}`)
  return true
}
