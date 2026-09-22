/** Durable crash-tail recognition for one recoverable interactive tool call. */

import type { ToolCallBlock } from '@deepseek-ai/dsh-llm'
import type { SessionEvent, SessionSeq } from '@deepseek-ai/dsh-session'

/** One already-recorded tool call that can safely re-enter its interaction gate. */
export interface PendingInteractionResumePlan {
  readonly turn: number
  readonly step: number
  readonly block: ToolCallBlock
  readonly callSeq: SessionSeq
}

interface InteractionState {
  callId: string
  terminal?: string
}

/**
 * Recognize a single open interactive call whose body has not gained a durable
 * result. Unanswered approvals/questions and answered questions are safe to
 * re-enter. A one-shot approval grant is never replayed because its body may
 * already have produced an external side effect.
 */
export function pendingInteractionResumePlan(
  events: readonly SessionEvent[],
): PendingInteractionResumePlan | undefined {
  let turn: number | undefined
  let step: number | undefined
  const blocks = new Map<string, ToolCallBlock>()
  const calls = new Map<string, SessionSeq>()
  const results = new Set<string>()
  const interactions = new Map<string, InteractionState>()

  for (const event of events) {
    const type = String(event.type)
    const data = event.data as unknown as Record<string, unknown>
    if (type === 'turn/start') {
      turn = Number(data.turn)
      step = undefined
      blocks.clear()
      calls.clear()
      results.clear()
      interactions.clear()
      continue
    }
    if (type === 'turn/end') {
      turn = undefined
      step = undefined
      blocks.clear()
      calls.clear()
      results.clear()
      interactions.clear()
      continue
    }
    if (type === 'step/start') {
      step = Number(data.step)
      blocks.clear()
      calls.clear()
      results.clear()
      interactions.clear()
      continue
    }
    if (type === 'step/end') {
      step = undefined
      blocks.clear()
      calls.clear()
      results.clear()
      interactions.clear()
      continue
    }
    if (turn === undefined || step === undefined) continue
    if (type === 'assistant/message') {
      const message = data.message as { content?: readonly ToolCallBlock[] } | undefined
      for (const block of message?.content ?? []) {
        if (block.type === 'tool-call') blocks.set(String(block.id), block)
      }
      continue
    }
    if (type === 'tool/call') {
      calls.set(String(data.callId), event.seq)
      continue
    }
    if (type === 'tool/result') {
      const message = data.message as { source?: { callId?: unknown } } | undefined
      if (message?.source?.callId !== undefined) results.add(String(message.source.callId))
      continue
    }
    if (type === 'approval/asked' || type === 'user-questions/asked') {
      if (data.callId !== undefined && data.id !== undefined) {
        interactions.set(String(data.id), { callId: String(data.callId) })
      }
      continue
    }
    if (type === 'approval/decided' || type === 'user-questions/answered') {
      const interaction = interactions.get(String(data.id))
      if (interaction !== undefined) {
        interaction.terminal = type === 'approval/decided'
          ? String(data.outcome ?? '')
          : String(data.outcome ?? 'answered')
      }
    }
  }

  if (turn === undefined || step === undefined) return undefined
  const unresolved = [...calls.keys()].filter(callId => !results.has(callId))
  if (unresolved.length !== 1) return undefined
  const callId = unresolved[0]
  if (callId === undefined) return undefined
  const interaction = [...interactions.values()].find(candidate => candidate.callId === callId)
  if (interaction === undefined) return undefined
  if (interaction.terminal === 'allowed-once') return undefined
  const block = blocks.get(callId)
  const callSeq = calls.get(callId)
  if (block === undefined || callSeq === undefined) return undefined
  // Every assistant-requested call must either have a result or be this exact
  // recorded call. Unknown siblings retain the ordinary conservative repair.
  for (const blockId of blocks.keys()) {
    if (blockId !== callId && !results.has(blockId)) return undefined
  }
  return { turn, step, block, callSeq }
}
