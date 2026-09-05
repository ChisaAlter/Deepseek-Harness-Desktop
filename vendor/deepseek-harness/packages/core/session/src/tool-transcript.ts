/** Projection-only repair for malformed historical tool calls. */

import { freezeMessage, isValidToolCallIdentity } from '@deepseek-ai/dsh-llm'
import type { Message, ToolCallId } from '@deepseek-ai/dsh-llm'

/**
 * Remove invalid calls and their associated results without rewriting the log.
 * Valid call groups, including incomplete groups owned by live execution, stay untouched.
 * @param messages - surface-derived history.
 * @returns repaired frozen messages, preserving unchanged message identities.
 */
export function repairMalformedToolCalls(messages: readonly Message[]): Message[] {
  const out: Message[] = []
  let removed = new Set<ToolCallId>()
  for (const message of messages) {
    if (message.role === 'assistant') {
      removed = new Set(message.content.flatMap(block =>
        block.type === 'tool-call' && !isValidToolCallIdentity(block.id, block.name) ? [block.id] : []))
      if (removed.size > 0) {
        const content = message.content.filter(block => block.type !== 'tool-call' || !removed.has(block.id))
        if (content.length > 0) {
          const source = message.source
          out.push(freezeMessage({
            ...message, content,
            source: source.kind === 'model' ? { kind: 'model', provider: source.provider, model: source.model } : source,
          }))
        }
        continue
      }
    }
    if (message.source.kind === 'tool' && removed.has(message.source.callId)) continue
    out.push(message)
  }
  return out
}
