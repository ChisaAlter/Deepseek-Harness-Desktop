import { describe, expect, it } from 'vitest'
import { ToolCallId, createMessage, createToolResultMessage } from '@deepseek-ai/dsh-llm'
import { SessionSeq, type SessionEvent } from '@deepseek-ai/dsh-session'
import { ApprovalRequestId } from '../../../interaction/user-approval/src/types.ts'
import { UserQuestionRequestId } from '../../../interaction/user-questions/src/types.ts'
import { pendingInteractionResumePlan } from '../src/pending-interaction-recovery.ts'

function openInteractionEvents(kind: 'approval' | 'question'): SessionEvent[] {
  const callId = ToolCallId('interactive-call')
  return [
    { type: 'turn/start', seq: SessionSeq(0), time: 1, data: { turn: 4 } },
    { type: 'step/start', seq: SessionSeq(1), time: 2, data: { turn: 4, step: 2 } },
    { type: 'assistant/message', seq: SessionSeq(2), time: 3, surfaceOp: 'append', data: {
      turn: 4,
      step: 2,
      stream: [],
      message: createMessage({
        role: 'assistant',
        content: [{ type: 'tool-call', id: callId, name: 'interactive_tool', arguments: '{"value":1}' }],
        source: { kind: 'model', provider: 'mock', model: 'mock' },
      }),
    } },
    { type: 'tool/call', seq: SessionSeq(3), time: 4, data: {
      turn: 4, step: 2, callId, name: 'interactive_tool', arguments: '{"value":1}',
    } },
    kind === 'approval'
      ? { type: 'approval/asked', seq: SessionSeq(4), time: 5, data: {
        id: ApprovalRequestId('approval-1'), callId, toolName: 'interactive_tool', reason: 'test',
      } }
      : { type: 'user-questions/asked', seq: SessionSeq(4), time: 5, data: {
        id: UserQuestionRequestId('question-1'), callId, questions: [{ id: 'confirm', question: 'Continue?' }],
      } },
  ] as SessionEvent[]
}

describe('pendingInteractionResumePlan', () => {
  it.each(['approval', 'question'] as const)('recovers one unresolved %s call at its original boundary', (kind) => {
    expect(pendingInteractionResumePlan(openInteractionEvents(kind))).toMatchObject({
      turn: 4,
      step: 2,
      callSeq: 3,
      block: { id: 'interactive-call', name: 'interactive_tool', arguments: '{"value":1}' },
    })
  })

  it('re-enters an answered question so its pure stored answer can become the original tool result', () => {
    const events = openInteractionEvents('question')
    events.push({ type: 'user-questions/answered', seq: SessionSeq(5), time: 6, data: {
      id: UserQuestionRequestId('question-1'), outcome: 'answered', answer: { answers: [{ id: 'confirm', selected: ['yes'] }] },
    } })
    expect(pendingInteractionResumePlan(events)?.callSeq).toBe(3)
  })

  it('never replays a call after an allowed-once approval because its side effect may already have happened', () => {
    const events = openInteractionEvents('approval')
    events.push({ type: 'approval/decided', seq: SessionSeq(5), time: 6, data: {
      id: ApprovalRequestId('approval-1'), outcome: 'allowed-once',
    } })
    expect(pendingInteractionResumePlan(events)).toBeUndefined()
  })

  it('rejects ambiguous recovery when another assistant call is unresolved', () => {
    const events = openInteractionEvents('question')
    const assistant = events[2]
    if (assistant?.type !== 'assistant/message') throw new Error('fixture assistant event missing')
    assistant.data.message = createMessage({
      role: 'assistant',
      content: [
        { type: 'tool-call', id: ToolCallId('interactive-call'), name: 'interactive_tool', arguments: '{"value":1}' },
        { type: 'tool-call', id: ToolCallId('sibling-call'), name: 'read_only_tool', arguments: '{}' },
      ],
      source: { kind: 'model', provider: 'mock', model: 'mock' },
    })
    expect(pendingInteractionResumePlan(events)).toBeUndefined()
  })

  it('allows a sibling that already has a durable result', () => {
    const events = openInteractionEvents('question')
    const assistant = events[2]
    if (assistant?.type !== 'assistant/message') throw new Error('fixture assistant event missing')
    assistant.data.message = createMessage({
      role: 'assistant',
      content: [
        { type: 'tool-call', id: ToolCallId('sibling-call'), name: 'read_only_tool', arguments: '{}' },
        { type: 'tool-call', id: ToolCallId('interactive-call'), name: 'interactive_tool', arguments: '{"value":1}' },
      ],
      source: { kind: 'model', provider: 'mock', model: 'mock' },
    })
    events.splice(4, 0,
      { type: 'tool/call', seq: SessionSeq(4), time: 4, data: {
        turn: 4, step: 2, callId: ToolCallId('sibling-call'), name: 'read_only_tool', arguments: '{}',
      } },
      { type: 'tool/result', seq: SessionSeq(5), time: 4, sourceEventSeqs: [SessionSeq(4)], data: {
        turn: 4,
        step: 2,
        message: createToolResultMessage({
          callId: ToolCallId('sibling-call'), content: [{ type: 'text', text: 'done' }], isError: false,
        }),
      } },
    )
    expect(pendingInteractionResumePlan(events)?.block.id).toBe('interactive-call')
  })
})
