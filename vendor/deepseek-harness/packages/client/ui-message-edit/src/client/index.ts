/**
 * Message edit plugin, browser half: a pencil in the latest user message's
 * action strip that promotes the session's resident composer — the full
 * input, not a lookalike — into an edit session for that bubble. Confirm
 * rides the composer's own submit: the redirected sink re-checks the
 * latest-and-idle preconditions, forks a child session cut before the
 * message, opens it, and hands the revision (text and any attached images)
 * to the child's input. Failures return error outcomes, so the composer
 * keeps the draft armed and announces the reason on its own channel. Both
 * entries share one interaction store carrying the focus-return handshake
 * after a bubble-side cancel.
 * @module @deepseek-ai/dsh-client-ui-message-edit/client
 */

import type { Context } from '@deepseek-ai/cordis'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
// Type-only: pulls the ui-chat SlotMap merge (user-actions / user-editor).
import type { SessionInput } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-chat/client'
// Type-only: pulls the locale plugin's Context merge (ctx.locale).
import type {} from '@deepseek-ai/dsh-client-locale/client'
import { MessageEditAction } from './MessageEditAction.tsx'
import { MessageEditEditor } from './MessageEditEditor.tsx'
import { createMessageEditStore } from './stores.ts'
import { editKey } from './text.ts'
import type { MessageEditInjected } from './slots.ts'
import { en, zh } from './locales.ts'

export { MessageEditAction } from './MessageEditAction.tsx'
export type { MessageEditActionProps, MessageEditInjected } from './slots.ts'
export type { MessageEditKey } from './locales.ts'

/** Dictionary namespace owned by this plugin. */
const NS = 'messageEdit'

/**
 * The seq of the latest turn-opening, user-authored message in one event
 * window — the same row the pencil calls "latest". Plugin-injected context
 * (time notes, instructions, file-change reminders) also rides `user/message`
 * with a non-user source, and a steering message admitted into an already
 * open turn is user-authored but never opens one; neither makes the addressed
 * message stale, so both are skipped here.
 * @param entries - the source session's contiguous event window.
 * @returns the latest turn-opening user message seq, or undefined when none is loaded.
 */
export function latestTurnOpeningUserSeq(
  entries: readonly { readonly type: string; readonly event: { readonly type: string; readonly seq: number; readonly data?: unknown } }[],
): number | undefined {
  let latest: number | undefined
  let turnOpened = false
  for (const row of entries) {
    if (row.type !== 'event') continue
    const { event } = row
    if (event.type === 'turn/start') {
      turnOpened = false
      continue
    }
    if (event.type !== 'user/message' || turnOpened) continue
    const source = (event.data as { source?: { kind?: string } } | undefined)?.source
    if (source?.kind !== 'user') continue
    turnOpened = true
    latest = event.seq
  }
  return latest
}

/** Required services: the slot registry, sessions (fork/open/scope), the conversation input face, and the copy. */
export const inject = ['slots', 'sessions', 'conversation', 'locale']

/**
 * Client plugin body: the latest-user-message edit action and the composer
 * edit session driving the fork-resend transaction.
 * @param ctx - client root context.
 */
export function apply(ctx: Context): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-message-edit: dictionaries')

  const t = ctx.locale.bind(NS)

  // One shared handle for both entries: the editor writes the focus-return
  // request on cancel, the pencil consumes it (one instance per session).
  const store = createMessageEditStore()

  /** Resolve one session's input facade, failing loud on a dead scope. */
  const inputFor = (sessionId: SessionId): SessionInput => {
    const scope = ctx.sessions.scope(sessionId)
    if (scope === undefined) throw new Error(`message edit scope unavailable: ${sessionId}`)
    return ctx.conversation.input.for(scope)
  }

  ctx.slots.inject('conversation.chat.user-actions', () => ctx.slots.register({
    name: 'conversation.chat.user-actions',
    id: 'edit',
    order: 10,
    locale: NS,
    store,
  }, MessageEditAction))

  ctx.slots.inject('conversation.chat.user-editor', () => ctx.slots.register({
    name: 'conversation.chat.user-editor',
    locale: NS,
    store,
    inject: (sessionId): MessageEditInjected => ({
      beginEdit: (seq, text) => {
        const input = inputFor(sessionId)
        const started = input.beginEdit({
          key: editKey(seq),
          label: t('editor.banner'),
          seed: text,
          submit: async (revised, imageIds) => {
            // The entry preconditions must still hold at confirm: a cut
            // before an older seq silently drops the newer turns, and a
            // running source may still admit queued messages.
            const binding = ctx.sessions.binding(sessionId)
            if (binding !== undefined) {
              if (binding.session.getSnapshot().running) {
                return { kind: 'error', text: t('editor.hint.running') }
              }
              if (latestTurnOpeningUserSeq(binding.eventSource.getSnapshot().entries) !== seq) {
                return { kind: 'error', text: t('editor.hint.stale') }
              }
            }
            try {
              const childId = await ctx.sessions.fork({
                sessionId,
                beforeSeq: seq,
                increaseTitle: true,
              })
              const childScope = ctx.sessions.scope(childId)
              if (childScope === undefined) throw new Error(`message edit child scope unavailable: ${childId}`)
              ctx.sessions.open(childId)
              const child = ctx.conversation.input.for(childScope)
              // Browser-owned draft images survive the session move (the
              // carry-draft pattern); the child's own send consumes them.
              if (imageIds.length > 0) child.addImages(imageIds)
              child.setDraft(revised)
              child.submit()
              return { kind: 'success' }
            } catch {
              // Fork/open failure keeps the edit armed with the draft; the
              // localized reason rides the composer's notice channel.
              return { kind: 'error', text: t('error.generic') }
            }
          },
        })
        if (!started) input.notify('error', t('error.busy'))
        return started
      },
      endEdit: (seq) => {
        const input = inputFor(sessionId)
        if (input.state.getSnapshot().edit?.key === editKey(seq)) input.cancelEdit()
      },
    }),
  }, MessageEditEditor))
}
