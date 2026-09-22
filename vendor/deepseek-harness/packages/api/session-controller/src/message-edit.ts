/** Same-session edit admission and replayable surface placement. */
import type { Context } from '@deepseek-ai/cordis'
import type { Session, SurfaceIntent } from '@deepseek-ai/dsh-session'
import { SessionSeq } from '@deepseek-ai/dsh-session'
import { RemoteError } from '@deepseek-ai/dsh-typert-protocol'
import { createUserMessage } from '@deepseek-ai/dsh-llm'

/**
 * Resolve the latest turn-opening human message and its current surface tail.
 * @param session - authoritative Session whose history is being revised.
 * @param messageSeq - requested user message sequence.
 * @returns the replaced turn and the surface operation for the revised prompt.
 */
export function resolveMessageEdit(session: Session, messageSeq: number): { turn: number; intent: SurfaceIntent } {
  try {
    SessionSeq(messageSeq)
  } catch {
    throw new RemoteError('gateway/bad-request', 'editMessageSeq must be a non-negative safe integer', {})
  }
  let turn: number | undefined
  let startSeq = 0
  let opening = false
  let latest: { seq: number; turn: number; startSeq: number } | undefined
  for (const event of session.snapshotEvents()) {
    if (event.type === 'turn/start') {
      turn = event.data.turn
      startSeq = event.seq
      opening = true
    } else if (event.type === 'user/message' && event.data.source.kind === 'user' && opening && turn !== undefined) {
      latest = { seq: event.seq, turn, startSeq }
      opening = false
    }
  }
  if (latest?.seq !== messageSeq) {
    throw new RemoteError('session/agent-busy', 'the edited message is no longer the latest user turn', { reason: 'EDIT_STALE' })
  }
  const target = session.eventAt(SessionSeq(messageSeq))
  if (target?.type !== 'user/message' || target.data.content.some(block => block.type !== 'text')) {
    throw new RemoteError('gateway/bad-request', 'only text user messages can be edited', {})
  }
  const nodes = session.surface.nodes
  const targetIndex = nodes.indexOf(SessionSeq(messageSeq))
  const end = nodes.at(-1)
  if (targetIndex === -1 || end === undefined) {
    throw new RemoteError('session/agent-busy', 'the edited message is no longer on the model surface', { reason: 'EDIT_COMPACTED' })
  }
  // Keep earlier-turn checkpoints even when they were emitted during this turn.
  let startIndex = targetIndex
  let start = SessionSeq(messageSeq)
  while (startIndex > 0) {
    const priorSeq = nodes[startIndex - 1]
    if (priorSeq === undefined || priorSeq < latest.startSeq) break
    const prior = session.eventAt(priorSeq)
    if (prior !== undefined && 'surfaceOp' in prior && prior.surfaceOp !== 'append') break
    // rc.1 moved the system prompt onto the surface: node 0 may be rewritten
    // only by a system/message over exactly that node, and the runtime-context
    // refresher rewrites its own system nodes — a user edit must stop above
    // either.
    if (prior?.type === 'system/message') break
    startIndex -= 1
    start = priorSeq
  }
  const shadowed = nodes.slice(startIndex)
  return {
    turn: latest.turn,
    intent: {
      surfaceOp: { op: 'replace', startSeq: start, endSeq: end },
      sourceEventSeqs: [...shadowed],
    },
  }
}

/**
 * Attach edit placement after other pre-step consumers finish admission.
 * @param ctx - Session Controller plugin context; registration follows its lifetime.
 */
export function installMessageEdits(ctx: Context): void {
  ctx.on('agent/pre-step', async ({ agent }, next) => {
    const decision = await next()
    if (decision.kind !== 'enter') return decision
    let surfaceIntents = decision.surfaceIntents
    const messages = [...decision.messages]
    for (const message of decision.messages) {
      const source = message.source
      if (source.kind !== 'user' || !('edit' in source)) continue
      const edit = resolveMessageEdit(agent.session, source.edit.messageSeq)
      surfaceIntents = { ...surfaceIntents, [message.id]: edit.intent }
      // Retain injected instructions whose session-local dedupe prevents reinjection.
      // Fresh snapshots replace older copies, but incremental file instructions accumulate.
      const refreshedPlugins = new Set(decision.messages.flatMap(candidate =>
        candidate.source.kind === 'plugin' ? [candidate.source.plugin] : []))
      const retained = (edit.intent.sourceEventSeqs ?? []).flatMap((seq) => {
        const event = agent.session.eventAt(seq)
        if (event?.type !== 'user/message' || event.data.source.kind !== 'plugin') return []
        const context = event.data.source
        if (context.form === 'notice' || context.form === 'relay' || context.form === 'recall') return []
        if (context.form !== 'instructions' && refreshedPlugins.has(context.plugin)) return []
        const copy = createUserMessage({ content: event.data.content, source: event.data.source })
        surfaceIntents = { ...surfaceIntents, [copy.id]: { surfaceOp: 'append', sourceEventSeqs: [seq] } }
        return [copy]
      })
      messages.splice(messages.indexOf(message) + 1, 0, ...retained)
    }
    return surfaceIntents === undefined || surfaceIntents === decision.surfaceIntents
      ? decision
      : { ...decision, messages, surfaceIntents }
  })
}
