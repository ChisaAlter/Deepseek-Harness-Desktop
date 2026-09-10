/**
 * Service Definition for the user-questions capability seam (`ctx.userQuestions`): a UI-backed service for
 * pausing an agent tool call until the human answers a question. The model-
 * facing tool lives in `@deepseek-ai/dsh-tool-ask-user`; UI packages compose
 * answerers on the Agent-scoped Cordis waterfall.
 *
 * @module @deepseek-ai/dsh-user-questions
 */

import { randomUUID } from 'node:crypto'
import { Context, Service } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { HarnessError } from '@deepseek-ai/dsh-llm'
import { scopeTarget } from '@deepseek-ai/dsh-scope'
import { SessionSeq } from '@deepseek-ai/dsh-session'

declare module '@deepseek-ai/cordis' {
  interface Context {
    userQuestions: UserQuestionService
  }
}

import type {
  AskUserQuestionAnswer, AskUserQuestionRequestEvent, UserQuestionClaimResult,
  UserQuestionOutcome, UserQuestionRequestId as UserQuestionRequestIdType,
} from './types.ts'
import { UserQuestionRequestId } from './types.ts'

export type {
  AskUserQuestionAnswer, AskUserQuestionAnswerItem, AskUserQuestionIntent, AskUserQuestionItem,
  AskUserQuestionOption,
  UserQuestionClaimResult, UserQuestionOutcome, UserQuestionRequestId,
} from './types.ts'

/** Request for a human answer. */
export interface AskUserQuestionRequest extends AskUserQuestionRequestEvent {}

/** Stable error taxonomy for user-questions failures. */
export class UserQuestionError extends HarnessError {
  constructor(message: string, code: string, options?: ErrorOptions) {
    super(message, code, options)
    this.name = 'UserQuestionError'
  }
}

function abortedQuestion(cause?: unknown): UserQuestionError {
  return new UserQuestionError(
    'ask_user_question was aborted before the user answered',
    'ASK_ABORTED',
    cause === undefined ? undefined : { cause },
  )
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function restoreUserQuestionError(reason: unknown): unknown {
  if (reason instanceof UserQuestionError) return reason
  if (isRecord(reason)
    && reason.name === 'UserQuestionError'
    && typeof reason.message === 'string'
    && typeof reason.code === 'string') {
    return new UserQuestionError(reason.message, reason.code, { cause: reason })
  }
  return reason
}

type QuestionSession = Agent['session']

interface PendingQuestionRecord {
  id: UserQuestionRequestIdType
  callId: NonNullable<AskUserQuestionRequestEvent['callId']>
  questions: AskUserQuestionRequestEvent['questions']
  terminal?: {
    outcome: UserQuestionOutcome
    answer?: AskUserQuestionAnswer
    error?: { name: string; code: string; message: string }
  }
}

interface QuestionWaiter {
  promise: Promise<AskUserQuestionAnswer>
  resolve(answer: AskUserQuestionAnswer): void
  reject(error: unknown): void
}

function hasOpenTurn(session: QuestionSession): boolean {
  for (let seq = session.seq - 1; seq >= 0; seq -= 1) {
    const type = String(session.eventAt(SessionSeq(seq))?.type)
    if (type === 'turn/start') return true
    if (type === 'turn/end') return false
  }
  return false
}

function questionRecords(session: QuestionSession): PendingQuestionRecord[] {
  const records = new Map<string, PendingQuestionRecord>()
  for (let seq = 0; seq < session.seq; seq += 1) {
    const event = session.eventAt(SessionSeq(seq))
    if (event === undefined) continue
    const type = String(event.type)
    const data = event.data as unknown as Record<string, unknown>
    if (type === 'user-questions/asked') {
      records.set(String(data.id), {
        id: UserQuestionRequestId(String(data.id)),
        callId: data.callId as PendingQuestionRecord['callId'],
        questions: structuredClone(data.questions) as PendingQuestionRecord['questions'],
      })
    } else if (type === 'user-questions/answered') {
      const record = records.get(String(data.id))
      if (record !== undefined) {
        record.terminal = {
          outcome: String(data.outcome) as UserQuestionOutcome,
          ...(data.answer === undefined ? {} : { answer: structuredClone(data.answer) as AskUserQuestionAnswer }),
          ...(data.error === undefined ? {} : {
            error: structuredClone(data.error) as { name: string; code: string; message: string },
          }),
        }
      }
    }
  }
  return [...records.values()]
}

function terminalQuestionError(record: PendingQuestionRecord): UserQuestionError {
  const stored = record.terminal?.error
  return new UserQuestionError(
    stored?.message ?? (record.terminal?.outcome === 'cancelled'
      ? 'the user cancelled ask_user_question'
      : 'no user-questions answerer accepted the request'),
    stored?.code ?? (record.terminal?.outcome === 'cancelled' ? 'ASK_CANCELLED' : 'NO_PROVIDER'),
  )
}

/** `ctx.userQuestions`: validation plus the scoped answerer waterfall. */
export class UserQuestionService extends Service {
  private readonly waiters = new Map<string, QuestionWaiter>()

  constructor(ctx: Context) {
    super(ctx, 'userQuestions')
  }

  /**
   * Ask the scoped answerer waterfall and wait for the user's answer.
   *
   * When a caller supplies an agent, human interaction is valid only for the
   * exact live runtime root. Runtime ownership, not durable session lineage,
   * decides this boundary: an owned child has no human answerer and would
   * block forever, while a lineage-bearing session resumed as a new runtime
   * root may ask normally.
   *
   * @param request Questions, owner agent, and abort signal.
   * @returns The answer chosen or typed by the human.
   * @throws {UserQuestionError} code `ASK_ABORTED` when the supplied signal
   *   is already or becomes aborted, `CALLER_NOT_LIVE` when a supplied agent
   *   is not the registry's exact live instance, or `DELEGATED_CALLER` when
   *   that live agent is owned by another agent.
   */
  async ask(request: AskUserQuestionRequest): Promise<AskUserQuestionAnswer> {
    if (request.signal?.aborted) {
      throw abortedQuestion()
    }
    if (request.questions.length === 0) {
      throw new UserQuestionError('ask_user_question requires at least one question', 'EMPTY_QUESTIONS')
    }
    const agent = request.agent
    if (agent !== undefined) {
      const agents = this.ctx.get('agents')
      if (agents === undefined || agents.get(agent.id) !== agent) {
        throw new UserQuestionError(
          'human interaction requires the exact live calling agent when an agent is supplied',
          'CALLER_NOT_LIVE')
      }
      if (!agents.roots().includes(agent)) {
        throw new UserQuestionError(
          'human interaction is unavailable while the calling agent is owned by another live agent; '
          + "include the unresolved question or decision in the child agent's final result",
          'DELEGATED_CALLER')
      }
    }
    // A presentation intent asserts two things the types cannot: that the
    // named approve label is one of this question's own options, and that a
    // plan-review carries the plan it is a review of. A UI honouring the
    // intent answers with that label, and shows that detail as the plan, so
    // either gap would put a choice the asker never offered — or an approval of
    // something invisible — in front of the user. Caught at the asker, where
    // the mistake is, rather than in each UI.
    for (const question of request.questions) {
      const intent = question.intent
      if (intent === undefined) continue
      if (!(question.options ?? []).some(option => option.label === intent.approve)) {
        throw new UserQuestionError(
          `question ${question.id} declares intent ${intent.kind} whose approve label `
          + `${JSON.stringify(intent.approve)} names none of its options`,
          'BAD_INTENT')
      }
      if (question.detail === undefined) {
        throw new UserQuestionError(
          `question ${question.id} declares intent ${intent.kind} without the detail it reviews`,
          'BAD_INTENT')
      }
    }
    if (agent !== undefined && request.callId !== undefined) {
      return this.askDurable(agent, request)
    }
    const noAnswerer = () => Promise.reject(new UserQuestionError(
      'no user-questions answerer accepted the request',
      'NO_PROVIDER',
    ))
    try {
      return await (agent === undefined
        ? this.ctx.waterfall('user-questions/request', request, noAnswerer)
        : this.ctx.waterfall(
          scopeTarget(agent, agent),
          'user-questions/request',
          { ...request, agent },
          noAnswerer,
        ))
    } catch (error) {
      const restored = restoreUserQuestionError(error)
      if (restored instanceof UserQuestionError) throw restored
      if (request.signal?.aborted) {
        throw abortedQuestion(error)
      }
      throw restored
    }
  }

  /** Return unresolved durable questions from one Session log. */
  pending(session: QuestionSession): readonly PendingQuestionRecord[] {
    return questionRecords(session)
      .filter(record => record.terminal === undefined)
      .map(record => structuredClone(record))
  }

  /** Idempotently commit one human answer before releasing a live tool call. */
  respond(agent: Agent, requestId: UserQuestionRequestIdType, answer: AskUserQuestionAnswer): UserQuestionClaimResult {
    const record = questionRecords(agent.session).find(entry => entry.id === requestId)
    if (record === undefined) return { status: 'not-pending' }
    if (record.terminal !== undefined) {
      return {
        status: 'already-resolved',
        outcome: record.terminal.outcome,
        ...(record.terminal.answer === undefined ? {} : { answer: record.terminal.answer }),
      }
    }
    agent.session.append('user-questions/answered', { id: requestId, outcome: 'answered', answer })
    this.waiters.get(this.waiterKey(agent, requestId))?.resolve(answer)
    return { status: 'accepted', outcome: 'answered', answer }
  }

  /** Idempotently cancel one pending durable question. */
  cancel(agent: Agent, requestId: UserQuestionRequestIdType): UserQuestionClaimResult {
    return this.rejectPending(agent, requestId, 'cancelled', new UserQuestionError(
      'the user cancelled ask_user_question', 'ASK_CANCELLED'))
  }

  private rejectPending(
    agent: Agent,
    requestId: UserQuestionRequestIdType,
    outcome: Exclude<UserQuestionOutcome, 'answered'>,
    error: UserQuestionError,
  ): UserQuestionClaimResult {
    const record = questionRecords(agent.session).find(entry => entry.id === requestId)
    if (record === undefined) return { status: 'not-pending' }
    if (record.terminal !== undefined) {
      return { status: 'already-resolved', outcome: record.terminal.outcome,
        ...(record.terminal.answer === undefined ? {} : { answer: record.terminal.answer }) }
    }
    agent.session.append('user-questions/answered', {
      id: requestId,
      outcome,
      error: { name: error.name, code: error.code, message: error.message },
    })
    this.waiters.get(this.waiterKey(agent, requestId))?.reject(error)
    return { status: 'accepted', outcome }
  }

  private waiterKey(agent: Agent, requestId: UserQuestionRequestIdType): string {
    return `${String(agent.session.id)}\0${String(requestId)}`
  }

  private async askDurable(agent: Agent, request: AskUserQuestionRequest): Promise<AskUserQuestionAnswer> {
    if (!hasOpenTurn(agent.session)) {
      throw new UserQuestionError('ask_user_question durable request requires an open turn', 'OUTSIDE_TURN')
    }
    const callId = request.callId as NonNullable<AskUserQuestionRequestEvent['callId']>
    let record = questionRecords(agent.session).find(entry => entry.callId === callId)
    if (record?.terminal?.outcome === 'answered' && record.terminal.answer !== undefined) {
      return record.terminal.answer
    }
    if (record?.terminal !== undefined) throw terminalQuestionError(record)
    if (record === undefined) {
      const id = UserQuestionRequestId(randomUUID())
      agent.session.append('user-questions/asked', {
        id,
        callId,
        questions: structuredClone(request.questions),
      })
      record = { id, callId, questions: structuredClone(request.questions) }
    }
    const key = this.waiterKey(agent, record.id)
    const existing = this.waiters.get(key)
    if (existing !== undefined) return existing.promise
    const completion = Promise.withResolvers<AskUserQuestionAnswer>()
    const waiter: QuestionWaiter = {
      promise: completion.promise.finally(() => { this.waiters.delete(key) }),
      resolve: completion.resolve,
      reject: completion.reject,
    }
    this.waiters.set(key, waiter)
    const durableRequest: AskUserQuestionRequest = {
      ...request,
      questions: structuredClone(record.questions),
      requestId: record.id,
      callId,
      agent,
    }
    const noAnswerer = () => Promise.reject(new UserQuestionError(
      'no user-questions answerer accepted the request', 'NO_PROVIDER'))
    void Promise.resolve().then(() => this.ctx.waterfall(
      scopeTarget(agent, agent), 'user-questions/request', durableRequest, noAnswerer,
    )).then(
      (answer) => {
        try {
          this.respond(agent, record.id, answer)
        } catch (error: unknown) {
          waiter.reject(error)
        }
      },
      (reason: unknown) => {
        const error = restoreUserQuestionError(reason)
        try {
          if (request.signal?.aborted || error instanceof UserQuestionError && error.code === 'ASK_ABORTED') {
            this.rejectPending(agent, record.id, 'cancelled', abortedQuestion(reason))
          } else if (error instanceof UserQuestionError && error.code === 'ASK_CANCELLED') {
            this.rejectPending(agent, record.id, 'cancelled', error)
          } else if (error instanceof UserQuestionError && error.code === 'NO_PROVIDER') {
            this.rejectPending(agent, record.id, 'unavailable', error)
          }
        } catch (appendError: unknown) {
          waiter.reject(appendError)
        }
        // Other transport failures leave the durable request pending so a
        // reconnected Client or a resumed Host can answer the same id.
      },
    )
    if (request.signal !== undefined) {
      const abort = (): void => {
        this.rejectPending(agent, record.id, 'cancelled', abortedQuestion(request.signal?.reason))
      }
      request.signal.addEventListener('abort', abort, { once: true })
      void waiter.promise.finally(() => { request.signal?.removeEventListener('abort', abort) }).catch(() => {})
      if (request.signal.aborted) abort()
    }
    return waiter.promise
  }
}

export default UserQuestionService
