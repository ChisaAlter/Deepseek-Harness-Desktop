// Test-local programmable Remote fake (NOT the fixture: fixture is a demo
// data source on a real clock; behavior tests need per-case responses and
// deferred-controlled timing). Session streams are hand pumps: pushFollow/pushControl.
import type {
  MessageId,
  RpcError, RpcResponse, SessionId, SessionSearchItem,
  SubagentCatalog, SubagentInterruptReceipt, SubagentPromptReceipt,
  WorkspaceId, WorkspaceView,
} from '@deepseek-ai/dsh-api-remotes/client'
import type {
  SessionAddress,
  SessionControlBaseline,
  SessionControlFrame,
  SessionFollowFrame,
  SessionFollowRequest,
  SessionPage,
  SessionPageRequest,
  SessionProjectionBaseline,
  SessionSelectModelRequest,
  SessionSelectModelValue,
} from '@deepseek-ai/dsh-api-session-controller/types'
import type { WorkspaceRemote } from '@deepseek-ai/dsh-api-workspace-controller/client'
import type { WorkspaceFollowFrame } from '@deepseek-ai/dsh-api-workspace-controller/types'
import type { RemoteFailure, RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
import {
  RemoteStream,
  RemoteStreamError,
  type RemoteStreamOptions,
} from '@deepseek-ai/dsh-api-gateway/client'
import { RpcId } from '@deepseek-ai/dsh-client-connection/client'
import type { SessionRemotes } from '../src/client/sessions/remotes.ts'
import { historyRecordLastSeq } from '../src/client/sessions/history-records.ts'

const AVAILABLE_STREAM_CONNECTION = {
  generation: {
    getSnapshot: () => ({ id: 1, host: { home: '/h' } }),
    subscribe: () => () => {},
  },
}

/** Programmable-default workspace row (branded id, ISO-ish times). */
function fakeWorkspace(id: string, over: Partial<WorkspaceView> = {}): WorkspaceView {
  return {
    workspaceId: id as WorkspaceId,
    path: '/f/ws',
    title: 'ws',
    sessionIds: [],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...over,
  }
}

function addressSessionId(address: SessionAddress): SessionId {
  return address.kind === 'session' ? address.sessionId : address.childSessionId
}

export interface Deferred<T> {
  promise: Promise<T>
  resolve(value: T): void
  reject(error: unknown): void
}

/** Test-held settlement: the case decides when an RPC lands (history-pending injections etc.). */
export function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

let nextRpc = 0

export function ok<T>(value: T): RpcResponse<T> {
  return { rpcId: RpcId(`fake-${nextRpc++}`), result: { ok: true, value } }
}

export function err<T>(error: RpcError): RpcResponse<T> {
  return { rpcId: RpcId(`fake-${nextRpc++}`), result: { ok: false, error } }
}

/** Successful generated Remote result for programmable domain fakes. */
export function remoteOk<T>(value: T): RemoteResult<T> {
  return { ok: true, value }
}

/**
 * Failed generated Remote result carrying an owner's own failure vocabulary,
 * which the carrier's closed RPC code set does not contain.
 * @param error - the owner-declared failure.
 * @returns the failure branch of a Remote result.
 */
export function remoteErr<T>(error: RemoteFailure): RemoteResult<T> {
  return { ok: false, error }
}

type ValueStreamItem<F> =
  | { kind: 'frame'; value: F; delivered?: () => void }
  | { kind: 'end' }
  | { kind: 'fail'; error: unknown }

interface ValueStreamConn<F> {
  feed(item: ValueStreamItem<F>): void
}

interface OpenValueStream<F> {
  readonly values: AsyncGenerator<F>
  dispose(): void
}

/**
 * Commands Remote double: the generated face delivers the carrier's outcome, so
 * a test that programs nothing sees an empty catalog and an unmatched line.
 * @returns the Remote namespaces the session cluster calls.
 */
export type RuntimeRemotes = SessionRemotes & { readonly workspace: WorkspaceRemote }

export function fakeRemote(api = new FakeApiClient()): RuntimeRemotes {
  return api.sessionRemotes()
}

export class FakeApiClient {
  /** Chronological call record: [method, payload]. */
  readonly calls: { method: string; payload: unknown }[] = []
  /** Session ids in physical follow-generation opening order. */
  readonly followStarts: SessionId[] = []

  // Programmable slots (defaults answer OK-empty); reassign per case.
  onList: (payload: unknown) => Promise<RpcResponse<{ items: never[] }>> = () => Promise.resolve(ok({ items: [] }))
  onSearch: (payload: unknown) => Promise<RpcResponse<{ items: SessionSearchItem[]; hasMore: boolean }>> =
    () => Promise.resolve(ok({ items: [], hasMore: false }))
  onCreate: (payload: unknown) => Promise<RpcResponse<{ sessionId: SessionId }>> = () => Promise.resolve(ok({ sessionId: 'fk-new' as SessionId }))
  onSelectModel: (payload: SessionSelectModelRequest) => Promise<RpcResponse<SessionSelectModelValue>> =
    payload => Promise.resolve(ok({
      selected: {
        provider: payload.provider,
        model: payload.model,
        ...(payload.reasoningEffort === undefined
          ? {}
          : { reasoningEffort: payload.reasoningEffort }),
      },
    }))
  onRename: (payload: unknown) => Promise<RpcResponse<{ title: string; seq: number }>> = () => Promise.resolve(ok({ title: 'fk-renamed', seq: 0 }))
  onFork: (payload: unknown) => Promise<RpcResponse<{ sessionId: SessionId }>> = () => Promise.resolve(ok({ sessionId: 'fk-fork' as SessionId }))
  onHistory: (payload: { sessionId: SessionId; throughSeq?: number; beforeSeq?: number; maxMessages?: number })
  => Promise<RpcResponse<SessionPage & { readonly projections?: SessionProjectionBaseline }>> =
    () => Promise.resolve(ok({ records: [], hasMore: false }))

  onPrompt: (payload: unknown) => Promise<RpcResponse<{ accepted: true }>> = () => Promise.resolve(ok({ accepted: true as const }))
  onAttachment: (payload: unknown) => Promise<RpcResponse<{ attachment: { attachmentId: never; mediaType: 'image/png'; bytes: number; width: number; height: number }; data: string }>> =
    () => Promise.resolve(ok({ attachment: { attachmentId: 'a' as never, mediaType: 'image/png', bytes: 1, width: 1, height: 1 }, data: 'AA==' }))
  onUpdateQueue: (payload: unknown) => Promise<RpcResponse<{ accepted: true }>> = () => Promise.resolve(ok({ accepted: true as const }))
  onCancel: (payload: unknown) => Promise<RpcResponse<{ accepted: true }>> = () => Promise.resolve(ok({ accepted: true as const }))
  onOpenWorkspacePath: (payload: unknown) => Promise<RemoteResult<{ opened: true }>> =
    () => Promise.resolve(remoteOk({ opened: true as const }))

  private readonly followConns = new Map<SessionId, ValueStreamConn<SessionFollowFrame>[]>()
  private readonly controlConns: ValueStreamConn<SessionControlFrame>[] = []
  private readonly workspaceConns: ValueStreamConn<WorkspaceFollowFrame>[] = []
  /** Optional Host opening cursor override for stale-page and reconnect tests. */
  followCursor: number | undefined
  controlBaseline: SessionControlBaseline = {
    queues: {},
    jobs: {},
    projections: {},
  }
  workspaceBaseline: Extract<WorkspaceFollowFrame, { type: 'baseline' }>['value'] = {
    items: [],
    archivedSessionIds: [],
  }
  lastSearchSignal: AbortSignal | undefined

  onSubagentList: (payload: unknown) => Promise<RemoteResult<SubagentCatalog>>
    = () => Promise.resolve(remoteOk({ entries: [], parentAvailable: true }))
  onSubagentPrompt: (payload: unknown) => Promise<RemoteResult<SubagentPromptReceipt>>
    = () => Promise.resolve(remoteOk({ messageId: 'fake-message' as MessageId }))

  onSubagentInterrupt: (payload: unknown) => Promise<RemoteResult<SubagentInterruptReceipt>>
    = () => Promise.resolve(remoteOk({ accepted: true as const }))

  onWorkspaceCreate: (payload: unknown) => Promise<RemoteResult<{ workspace: WorkspaceView; created: boolean }>> =
    () => Promise.resolve(remoteOk({ workspace: fakeWorkspace('fk-ws'), created: true }))

  onWorkspaceRename: (payload: unknown) => Promise<RemoteResult<{ workspace: WorkspaceView }>> =
    () => Promise.resolve(remoteOk({ workspace: fakeWorkspace('fk-ws') }))

  onWorkspaceDelete: (payload: unknown) => Promise<RemoteResult<{ deleted: true }>> =
    () => Promise.resolve(remoteOk({ deleted: true }))

  onWorkspaceInsertBefore: (payload: unknown) => Promise<RemoteResult<{ workspaceIds: WorkspaceId[] }>> =
    () => Promise.resolve(remoteOk({ workspaceIds: [] }))

  onWorkspaceInsertSessionBefore: (payload: unknown) => Promise<RemoteResult<{ workspace: WorkspaceView }>> =
    () => Promise.resolve(remoteOk({ workspace: fakeWorkspace('fk-ws') }))

  onWorkspaceArchiveSession: (payload: unknown) => Promise<RemoteResult<{ archivedSessionIds: SessionId[] }>> =
    payload => Promise.resolve(remoteOk({ archivedSessionIds: [(payload as { sessionId: SessionId }).sessionId] }))

  /** Remote namespaces bound to this fake's programmable unary slots and stream pumps. */
  sessionRemotes(): RuntimeRemotes {
    return {
      $stream: <Item>(options: RemoteStreamOptions<Item>) => (
        new RemoteStream(AVAILABLE_STREAM_CONNECTION, options)
      ),
      commands: {
        execute: () => Promise.resolve({ ok: true, value: undefined }),
      },
      session: {
        canOpenWorkspacePath: () => Promise.resolve(remoteOk(true)),
        list: payload => this.remoteResult('session.list', payload, this.onList(payload)),
        modelCatalog: () => Promise.resolve({
          ok: true,
          value: {
            default: { provider: 'fixture', model: 'fixture' },
            routableProviders: [],
            groups: [],
            failures: [],
          },
        }),
        search: (payload, signal) => {
          this.lastSearchSignal = signal
          return this.remoteResult('session.search', payload, this.onSearch(payload))
        },
        create: payload => this.remoteResult('session.create', payload, this.onCreate(payload)),
        selectModel: payload => this.remoteResult(
          'session.selectModel',
          payload,
          this.onSelectModel(payload),
        ),
        rename: payload => this.remoteResult('session.rename', payload, this.onRename(payload)),
        fork: payload => this.remoteResult('session.fork', payload, this.onFork(payload)),
        prompt: payload => this.remoteResult('session.prompt', payload, this.onPrompt(payload)),
        attachment: payload => this.remoteResult('session.attachment', payload, this.onAttachment(payload)),
        updateQueue: payload => this.remoteResult('session.updateQueue', payload, this.onUpdateQueue(payload)),
        cancel: payload => this.remoteResult('session.cancel', payload, this.onCancel(payload)),
        openWorkspacePath: payload => this.record(
          'session.openWorkspacePath',
          payload,
          this.onOpenWorkspacePath(payload),
        ),
        page: request => this.page(request),
        follow: (request, signal) => this.openFollow(request, signal),
        control: signal => this.openControl(signal),
      },
      subagents: {
        list: parentSessionId => this.record(
          'subagents.list',
          parentSessionId,
          this.onSubagentList(parentSessionId),
        ),
        prompt: request => this.record('subagents.prompt', request, this.onSubagentPrompt(request)),
        interruptByParent: (childSessionId, parentSessionId, mode) => this.record(
          'subagents.interruptByParent',
          { childSessionId, parentSessionId, mode },
          this.onSubagentInterrupt({ childSessionId, parentSessionId, mode }),
        ),
      },
      workspace: {
        create: payload => this.record('workspace.create', payload, this.onWorkspaceCreate(payload)),
        rename: payload => this.record('workspace.rename', payload, this.onWorkspaceRename(payload)),
        delete: payload => this.record('workspace.delete', payload, this.onWorkspaceDelete(payload)),
        insertBefore: payload => this.record(
          'workspace.insertBefore',
          payload,
          this.onWorkspaceInsertBefore(payload),
        ),
        insertSessionBefore: payload => this.record(
          'workspace.insertSessionBefore',
          payload,
          this.onWorkspaceInsertSessionBefore(payload),
        ),
        archiveSession: payload => this.record(
          'workspace.archiveSession',
          payload,
          this.onWorkspaceArchiveSession(payload),
        ),
        follow: signal => this.openWorkspace(signal),
      },
    }
  }

  /** Push one live Session event to every follower of that Session. */
  async pushFollow(
    sessionId: SessionId,
    frame: Extract<SessionFollowFrame, { type: 'event' }>,
  ): Promise<void> {
    await Promise.all([...(this.followConns.get(sessionId) ?? [])].map(conn => new Promise<void>((resolve) => {
      conn.feed({ kind: 'frame', value: frame, delivered: resolve })
    })))
  }

  /** Push one Host-wide control update. */
  pushControl(frame: Exclude<SessionControlFrame, { type: 'baseline' }>): void {
    for (const conn of [...this.controlConns]) conn.feed({ kind: 'frame', value: frame })
  }

  /** Push one Workspace projection increment. */
  pushWorkspace(frame: Exclude<WorkspaceFollowFrame, { type: 'baseline' }>): void {
    for (const conn of [...this.workspaceConns]) conn.feed({ kind: 'frame', value: frame })
  }

  /** End (clean close) or fail (throw) every open stream — reconnect-path material. */
  endStreams(): void {
    for (const conns of this.followConns.values()) {
      for (const conn of [...conns]) conn.feed({ kind: 'end' })
    }
    for (const conn of [...this.controlConns]) conn.feed({ kind: 'end' })
    for (const conn of [...this.workspaceConns]) conn.feed({ kind: 'end' })
  }

  failStreams(error: unknown): void {
    for (const conns of this.followConns.values()) {
      for (const conn of [...conns]) conn.feed({ kind: 'fail', error })
    }
    for (const conn of [...this.controlConns]) conn.feed({ kind: 'fail', error })
    for (const conn of [...this.workspaceConns]) conn.feed({ kind: 'fail', error })
  }

  callsOf(method: string): unknown[] {
    return this.calls.filter(c => c.method === method).map(c => c.payload)
  }

  /** Number of currently attached journal generations for one Session. */
  activeFollows(sessionId: SessionId): number {
    return this.followConns.get(sessionId)?.length ?? 0
  }

  private record<T>(method: string, payload: unknown, response: Promise<T>): Promise<T> {
    this.calls.push({ method, payload })
    return response
  }

  private async remoteResult<T>(
    method: string,
    payload: unknown,
    response: Promise<RpcResponse<T>>,
  ): Promise<RemoteResult<T>> {
    return (await this.record(method, payload, response)).result
  }

  private page(request: SessionPageRequest): Promise<RemoteResult<SessionPage>> {
    return this.fetchPage(request)
  }

  private async fetchPage(
    request: SessionPageRequest,
    response?: Promise<RpcResponse<SessionPage>>,
  ): Promise<RemoteResult<SessionPage>> {
    const sessionId = addressSessionId(request.address)
    const payload = request.address.kind === 'session'
      ? {
        sessionId,
        throughSeq: request.throughSeq,
        ...request.beforeSeq === undefined ? {} : { beforeSeq: request.beforeSeq },
        ...request.maxMessages === undefined ? {} : { maxMessages: request.maxMessages },
      }
      : {
        parentSessionId: request.address.parentSessionId,
        childSessionId: request.address.childSessionId,
        mode: request.address.mode,
        throughSeq: request.throughSeq,
        ...request.beforeSeq === undefined ? {} : { beforeSeq: request.beforeSeq },
        ...request.maxMessages === undefined ? {} : { maxMessages: request.maxMessages },
      }
    const method = request.address.kind === 'session' ? 'session.history' : 'subagent.history'
    const result = await this.remoteResult(method, payload, response ?? this.onHistory({
      sessionId,
      throughSeq: request.throughSeq,
      ...request.beforeSeq === undefined ? {} : { beforeSeq: request.beforeSeq },
      ...request.maxMessages === undefined ? {} : { maxMessages: request.maxMessages },
    }))
    if (!result.ok) return result
    return {
      ok: true,
      value: {
        ...result.value,
        records: result.value.records
          .filter(record => historyRecordLastSeq(record) <= request.throughSeq),
      },
    }
  }

  private async *openFollow(
    request: SessionFollowRequest,
    signal: AbortSignal = new AbortController().signal,
  ): AsyncGenerator<SessionFollowFrame> {
    const sessionId = addressSessionId(request.address)
    this.followStarts.push(sessionId)
    this.calls.push({ method: 'session.follow', payload: request })
    const conns = this.followConns.get(sessionId) ?? []
    if (!this.followConns.has(sessionId)) this.followConns.set(sessionId, conns)
    const stream = this.openValueStream(conns, signal)
    try {
      const response = await this.onHistory({
        sessionId,
        maxMessages: request.maxMessages ?? 50,
      })
      if (!response.result.ok) {
        throw new RemoteStreamError(
          response.result.error.code,
          response.result.error.message,
          response.result.error.details,
        )
      }
      const page = response.result.value
      const tail = page.records.at(-1)
      const cursor = this.followCursor ?? (tail === undefined ? -1 : historyRecordLastSeq(tail))
      yield {
        type: 'snapshot',
        header: {
          version: 0,
          id: sessionId,
          createdAt: 0,
          ...(request.address.kind === 'subagent'
            ? { origin: 'subagent' as const, parentSession: request.address.parentSessionId }
            : {}),
        },
        cursor,
        records: page.records.filter(record => historyRecordLastSeq(record) <= cursor),
        hasMore: page.hasMore,
        projections: page.projections ?? { asOfSeq: cursor, values: {} },
      }
      yield* stream.values
    } finally {
      stream.dispose()
    }
  }

  private async *openControl(
    signal: AbortSignal = new AbortController().signal,
  ): AsyncGenerator<SessionControlFrame> {
    const stream = this.openValueStream(this.controlConns, signal)
    try {
      yield { type: 'baseline', value: this.controlBaseline }
      yield* stream.values
    } finally {
      stream.dispose()
    }
  }

  private async *openWorkspace(
    signal: AbortSignal = new AbortController().signal,
  ): AsyncGenerator<WorkspaceFollowFrame> {
    const stream = this.openValueStream(this.workspaceConns, signal)
    try {
      yield { type: 'baseline', value: this.workspaceBaseline }
      yield* stream.values
    } finally {
      stream.dispose()
    }
  }

  private openValueStream<F>(
    registry: ValueStreamConn<F>[],
    signal: AbortSignal,
  ): OpenValueStream<F> {
    const inbox: ValueStreamItem<F>[] = []
    let wake: (() => void) | null = null
    let inFlightDelivered: (() => void) | undefined
    let disposed = false
    const conn: ValueStreamConn<F> = {
      feed: (item) => {
        inbox.push(item)
        wake?.()
      },
    }
    registry.push(conn)
    const dispose = (): void => {
      if (disposed) return
      disposed = true
      inFlightDelivered?.()
      for (const item of inbox) {
        if (item.kind === 'frame') item.delivered?.()
      }
      const index = registry.indexOf(conn)
      if (index >= 0) registry.splice(index, 1)
      wake?.()
    }
    const values = (async function* (): AsyncGenerator<F> {
      try {
        while (!signal.aborted && !disposed) {
          while (inbox.length > 0) {
            const item = inbox.shift() as ValueStreamItem<F>
            if (item.kind === 'end') return
            if (item.kind === 'fail') throw item.error
            inFlightDelivered = item.delivered
            yield item.value
            inFlightDelivered?.()
            inFlightDelivered = undefined
          }
          await new Promise<void>((resolve) => {
            wake = resolve
            signal.addEventListener('abort', () => { resolve() }, { once: true })
          })
          wake = null
        }
      } finally {
        dispose()
      }
    })()
    return { values, dispose }
  }

}
