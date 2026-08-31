/** Session object lifecycle, event-window transport, commands, and resync behavior. */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { RemoteStreamError } from '@deepseek-ai/dsh-api-gateway/client'
import type { SessionEvent } from '@deepseek-ai/dsh-session/types'
import type { SessionId } from '@deepseek-ai/dsh-api-remotes/client'
import { Session, type SessionOptions } from '../src/client/sessions/session.ts'
import { FakeApiClient, deferred, err, fakeRemote, ok, remoteErr } from './fake-api.client.ts'
import { entries, ev, historyValue, plainTurn } from './event-script.client.ts'

const SID = 'fk-s1' as SessionId
const PARENT = 'fk-parent' as SessionId

afterEach(() => {
  vi.unstubAllGlobals()
})

function makeSession(
  api = new FakeApiClient(),
  options: SessionOptions = {},
): { api: FakeApiClient; session: Session } {
  return { api, session: new Session(SID, fakeRemote(api), options) }
}

function follow(
  api: FakeApiClient,
  event: SessionEvent,
): Promise<void> {
  return api.pushFollow(SID, {
    type: 'event',
    event: event as never,
  })
}

function windowEntries(session: Session) {
  return session.eventSource.getSnapshot().entries
}

function eventSeqs(session: Session): number[] {
  return windowEntries(session).map(entry => entry.event.seq)
}

function histResponse(events: SessionEvent[], hasMore = false) {
  return Promise.resolve(ok(historyValue(events, hasMore)))
}

describe('Session open', () => {
  it('keeps a bare Session blank until an authoritative lifecycle signal arrives', () => {
    const { session } = makeSession()
    expect(session.getSnapshot()).toMatchObject({ blank: true, promptAttempted: false, running: false })

    session.handleRunning(true)
    expect(session.getSnapshot()).toMatchObject({ blank: false, running: true })
  })

  it('installs the tail page: cold → loading → open with window and nodes in place', async () => {
    const { api, session } = makeSession()
    const page = plainTurn(10, 3, '问', '答')
    api.onHistory = () => histResponse(page, true)
    expect(session.getSnapshot().openState).toBe('cold')
    const opening = session.open()
    expect(session.getSnapshot().openState).toBe('loading')
    await opening
    const snapshot = session.getSnapshot()
    expect(snapshot.openState).toBe('open')
    expect(snapshot.hasMore).toBe(true)
    expect(eventSeqs(session)).toEqual([10, 11, 12, 13, 14, 15])
    expect(session.eventSource.getSnapshot().change).toMatchObject({ kind: 'replace' })
  })

  it('is idempotent: concurrent opens share one follow, reopening when open is a no-op', async () => {
    const { api, session } = makeSession()
    await Promise.all([session.open(), session.open()])
    await session.open()
    expect(api.callsOf('session.follow')).toHaveLength(1)
    expect(api.callsOf('session.history')).toEqual([])
  })

  it('lands an error result in openState=error with the RpcError kept', async () => {
    const { api, session } = makeSession()
    api.onHistory = () => Promise.resolve(err({ code: 'session-not-found', message: 'gone', details: { sessionId: SID } }))
    await session.open()
    const snapshot = session.getSnapshot()
    expect(snapshot.openState).toBe('error')
    expect(snapshot.openError?.code).toBe('session-not-found')
  })

  it('folds a transport throw into openState=error / internal', async () => {
    const { api, session } = makeSession()
    api.onHistory = () => Promise.reject(new Error('socket died'))
    await session.open()
    expect(session.getSnapshot().openState).toBe('error')
    expect(session.getSnapshot().openError).toMatchObject({ code: 'internal', message: 'socket died' })
  })

  it('stitches live frames arriving while history is pending, dropping the page overlap', async () => {
    const { api, session } = makeSession()
    const gate = deferred<Awaited<ReturnType<FakeApiClient['onHistory']>>>()
    api.onHistory = () => gate.promise
    const opening = session.open()
    // Three live frames land while the opening snapshot is pending; seq 15 overlaps its tail.
    const page = plainTurn(10, 0, '早', '安')
    const deliveries = [
      follow(api, ev.turnStart(15, 1)),
      follow(api, ev.user(16, '插进来的')),
    ]
    gate.resolve(ok({
      records: entries(page) as never[],
      hasMore: false,
      modelSelection: { provider: 'deepseek-official', model: 'deepseek-v4-flash' },
    }))
    await Promise.all([opening, ...deliveries])
    const seqs = eventSeqs(session)
    // Overlapping seq-15 frame (== page tail turn/end) was dropped; 16 appended once.
    expect(seqs).toEqual([10, 11, 12, 13, 14, 15, 16])
  })
})


describe('live event path', () => {
  async function opened(events: SessionEvent[] = plainTurn(0, 0, 'a', 'b')) {
    const { api, session } = makeSession()
    api.onHistory = () => histResponse(events)
    await session.open()
    return { api, session }
  }

  it('drops replayed frames at or below the window tail', async () => {
    const { api, session } = await opened()
    const before = session.eventSource.getSnapshot()
    await follow(api, ev.user(3, '重放'))
    expect(session.eventSource.getSnapshot()).toBe(before)
  })

  it('keeps the authoritative host blank bit across unrelated log events', async () => {
    const { api, session } = await opened([])
    session.handleBlank(true)
    await Promise.all([
      follow(api, ev.commandRun(0, 'cmd-perm', 'permission', ' danger-full-access')),
      follow(api, ev.commandDone(1, 'cmd-perm', 'success', 'preset danger-full-access')),
    ])
    const snapshot = session.getSnapshot()
    expect(eventSeqs(session)).toEqual([0, 1])
    expect(snapshot.blank).toBe(true)
  })

  it('repairs a seq gap by repulling the tail page instead of appending a hole', async () => {
    const { api, session } = await opened(plainTurn(0, 0, 'a', 'b')) // tail seq = 5
    const repaired = [...plainTurn(0, 0, 'a', 'b'), ...plainTurn(6, 1, 'c', 'd')]
    api.onHistory = () => histResponse(repaired)
    // seq 9 with tail 5 → gap; the event detours to the buffer and one history refetch fires.
    await follow(api, ev.assistant(9, 1, 'd'))
    await vi.waitFor(() => {
      expect(api.callsOf('session.history')).toHaveLength(1)
    })
    await vi.waitFor(() => {
      expect(eventSeqs(session)).toEqual(
        repaired.filter(event => event.seq <= 9).map(event => event.seq),
      )
    })
  })
})

describe('paging', () => {
  it('prepends an older page and keeps seq continuity', async () => {
    const older = plainTurn(0, 0, '旧问', '旧答')
    const newer = plainTurn(6, 1, '新问', '新答')
    const { api, session } = makeSession()
    api.onHistory = payload => payload.beforeSeq === undefined
      ? histResponse(newer, true)
      : histResponse(older, false)
    await session.open()
    await session.loadOlder()
    const snapshot = session.getSnapshot()
    expect(api.callsOf('session.follow')).toHaveLength(1)
    expect(api.callsOf('session.history')).toMatchObject([
      { sessionId: SID, throughSeq: 11, beforeSeq: 6 },
    ])
    expect(snapshot.hasMore).toBe(false)
    expect(eventSeqs(session)).toEqual([...older, ...newer].map(event => event.seq))
  })

  it('installs a page without interpreting business replacement metadata', async () => {
    const { api, session } = makeSession()
    api.onHistory = () => histResponse([
      ev.compactSummary(80, '窗外范围的摘要', 3, 40),
      ev.compactCheckpoint(81, 80, 3, 40),
      ev.user(82, '压缩后的新问题'),
    ], true)
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    try {
      await session.open()
      const snapshot = session.getSnapshot()
      expect(snapshot.openState).toBe('open')
      expect(eventSeqs(session)).toEqual([80, 81, 82])
      expect(errorSpy).not.toHaveBeenCalled()
    } finally {
      errorSpy.mockRestore()
    }
  })

  it('drops a discontinuous older page fail-soft (window unchanged, hasMore cleared)', async () => {
    const { api, session } = makeSession()
    api.onHistory = payload => payload.beforeSeq === undefined
      ? histResponse(plainTurn(10, 1, '新', '页'), true)
      : histResponse(plainTurn(0, 0, '断', '层'), true) // tail seq 5, but baseSeq is 10 → hole
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    try {
      await session.open()
      const windowBefore = session.eventSource.getSnapshot()
      await session.loadOlder()
      const snapshot = session.getSnapshot()
      expect(session.eventSource.getSnapshot().entries).toEqual(windowBefore.entries)
      expect(snapshot.hasMore).toBe(false)
    } finally {
      errorSpy.mockRestore()
    }
  })

  it('ignores loadOlder while one is in flight (single request)', async () => {
    const { api, session } = makeSession()
    api.onHistory = () => histResponse(plainTurn(6, 1, 'x', 'y'), true)
    await session.open()
    const gate = deferred<Awaited<ReturnType<FakeApiClient['onHistory']>>>()
    api.onHistory = () => gate.promise
    const first = session.loadOlder()
    const second = session.loadOlder()
    gate.resolve(ok({
      records: entries(plainTurn(0, 0, 'a', 'b')) as never[],
      hasMore: false,
      modelSelection: { provider: 'deepseek-official', model: 'deepseek-v4-flash' },
    }))
    await Promise.all([first, second])
    expect(api.callsOf('session.follow')).toHaveLength(1)
    expect(api.callsOf('session.history')).toHaveLength(1)
  })
})

describe('prompt and cancel errors', () => {
  it('routes an addressed child through non-activating history, continuation prompt, and interrupt only', async () => {
    const api = new FakeApiClient()
    const session = new Session(SID, fakeRemote(api), {
      address: { parentSessionId: PARENT, childSessionId: SID, mode: 'continuable' },
      parentAvailable: true,
    })
    await session.open()
    const prompted = await session.prompt([{ type: 'text', text: '继续' }], 'queue')
    const cancelled = await session.cancel()

    expect(prompted).toEqual({ ok: true, value: { accepted: true } })
    expect(cancelled).toEqual({ ok: true, value: { accepted: true } })
    expect(api.callsOf('session.follow')).toEqual([
      {
        address: {
          kind: 'subagent', parentSessionId: PARENT, childSessionId: SID, mode: 'continuable',
        },
        maxMessages: 50,
      },
    ])
    expect(api.callsOf('subagent.history')).toEqual([])
    expect(api.callsOf('subagents.prompt')).toEqual([
      {
        requestId: expect.any(String) as unknown as string,
        parentSessionId: PARENT, childSessionId: SID,
        mode: 'continuable',
        content: [{ type: 'text', text: '继续' }],
        clientTimeZone: new Intl.DateTimeFormat().resolvedOptions().timeZone,
      },
    ])
    expect(api.callsOf('subagents.interruptByParent')).toEqual([
      { childSessionId: SID, parentSessionId: PARENT, mode: 'continuable' },
    ])
    expect(api.callsOf('session.history')).toEqual([])
    expect(api.callsOf('session.prompt')).toEqual([])
    expect(api.callsOf('session.cancel')).toEqual([])
    // A successful interrupt leaves no stop error behind.
    expect(session.getSnapshot().promptError).toBeNull()
    expect(session.getSnapshot().subagent).toEqual({
      address: { parentSessionId: PARENT, childSessionId: SID, mode: 'continuable' },
      parentAvailable: true,
    })
  })

  it('lands an interrupt business failure in promptError with op=stop', async () => {
    const api = new FakeApiClient()
    api.onSubagentInterrupt = () => Promise.resolve(remoteErr({
      code: 'subagent-unauthorized', message: 'nope', details: { childSessionId: SID },
    }))
    const session = new Session(SID, fakeRemote(api), {
      address: { parentSessionId: PARENT, childSessionId: SID, mode: 'continuable' },
      parentAvailable: true,
    })
    await session.open()
    const cancelled = await session.cancel()
    expect(cancelled).toMatchObject({ ok: false, error: { code: 'subagent-unauthorized' } })
    expect(session.getSnapshot().promptError).toMatchObject({
      op: 'stop', error: { code: 'subagent-unauthorized' },
    })
  })

  it('keeps one-shot history readable without exposing prompt or cancel transport', async () => {
    const api = new FakeApiClient()
    const session = new Session(SID, fakeRemote(api), {
      address: { parentSessionId: PARENT, childSessionId: SID, mode: 'one-shot' },
    })
    await session.open()
    const prompted = await session.prompt([{ type: 'text', text: '继续' }], 'queue')
    const cancelled = await session.cancel()

    expect(prompted).toMatchObject({ ok: false, error: { code: 'subagent-not-resumable' } })
    expect(cancelled).toMatchObject({ ok: false, error: { code: 'subagent-delivery-unavailable' } })
    expect(api.callsOf('session.follow')).toEqual([
      {
        address: {
          kind: 'subagent', parentSessionId: PARENT, childSessionId: SID, mode: 'one-shot',
        },
        maxMessages: 50,
      },
    ])
    expect(api.callsOf('subagent.history')).toEqual([])
    expect(api.callsOf('subagents.prompt')).toEqual([])
    expect(api.callsOf('subagents.interruptByParent')).toEqual([])
    expect(api.callsOf('session.cancel')).toEqual([])
  })

  it('publishes the first-prompt lifecycle synchronously before the Remote settles', async () => {
    const { api, session } = makeSession()
    session.handleBlank(true)
    expect(session.getSnapshot()).toMatchObject({
      blank: true, promptAttempted: false, awaitingFirstTurn: false,
    })
    const inFlight = session.prompt([{ type: 'text', text: '要发的' }], 'queue')
    expect(session.getSnapshot()).toMatchObject({
      blank: true, promptAttempted: true, awaitingFirstTurn: true,
    })
    const result = await inFlight
    expect(result.ok).toBe(true)
    expect(session.getSnapshot()).toMatchObject({
      blank: false, promptAttempted: true, awaitingFirstTurn: true,
    })
    expect(api.callsOf('session.prompt')).toMatchObject([{
      sessionId: SID,
      mode: 'queue',
      content: [{ type: 'text', text: '要发的' }],
      clientTimeZone: new Intl.DateTimeFormat().resolvedOptions().timeZone,
    }])
    session.handleRunning(true)
    expect(session.getSnapshot()).toMatchObject({ running: true, awaitingFirstTurn: false })
  })

  it('keeps the attempted-first-prompt state when the Host rejects the prompt', async () => {
    const { api, session } = makeSession()
    session.handleBlank(true)
    api.onPrompt = () => Promise.resolve(err({ code: 'agent-busy', message: 'busy', details: { reason: 'x' } }))
    const result = await session.prompt([{ type: 'text', text: '失败的' }], 'queue')
    expect(result.ok).toBe(false)
    expect(session.getSnapshot().promptError).toMatchObject({ op: 'send', error: { code: 'agent-busy' } })
    expect(session.getSnapshot()).toMatchObject({
      blank: true, promptAttempted: true, awaitingFirstTurn: true,
    })
  })

  it('lands cancel failures in promptError with op=stop', async () => {
    const { api, session } = makeSession()
    api.onCancel = () => Promise.reject(new Error('cancel transport down'))
    const result = await session.cancel()
    expect(result.ok).toBe(false)
    expect(session.getSnapshot().promptError).toMatchObject({ op: 'stop', error: { code: 'internal' } })
  })

  it('reads session-authorized attachment bytes and keeps the opaque id on the wire', async () => {
    const { api, session } = makeSession()
    const result = await session.readAttachment('attachment-1' as never)
    expect(result).toEqual({
      ok: true,
      value: {
        attachment: { attachmentId: 'a', mediaType: 'image/png', bytes: 1, width: 1, height: 1 },
        data: Uint8Array.of(0),
      },
    })
    expect(api.callsOf('session.attachment')).toEqual([{
      sessionId: SID, attachmentId: 'attachment-1',
    }])
  })
})

describe('rename', () => {
  it('settles the title projection cell from the unary response (higher-seq-wins vs the push frame)', async () => {
    const { api, session } = makeSession()
    api.onRename = () => Promise.resolve(ok({ title: '正名', seq: 7 }))
    const result = await session.rename('  正名  ')
    expect(result).toMatchObject({ ok: true, value: { title: '正名', seq: 7 } })
    expect(api.callsOf('session.rename')).toMatchObject([{ sessionId: SID, title: '  正名  ' }])
    expect(session.projections.faceOf('title').getSnapshot()).toBe('正名')
    // A stale lower-seq apply (the push-frame path routes into this same
    // store) must not roll the settled value back.
    session.projections.apply('title', '旧名', 3)
    expect(session.projections.faceOf('title').getSnapshot()).toBe('正名')
  })

  it('returns the business error untouched and folds a transport throw to internal', async () => {
    const { api, session } = makeSession()
    api.onRename = () => Promise.resolve(err({
      code: 'title-invalid', message: 'empty', details: { sessionId: SID },
    } as never))
    const rejected = await session.rename('   ')
    expect(rejected).toMatchObject({ ok: false, error: { code: 'title-invalid' } })
    expect(session.projections.faceOf('title').getSnapshot()).toBeUndefined()
    api.onRename = () => Promise.reject(new Error('rename transport down'))
    const folded = await session.rename('x')
    expect(folded).toMatchObject({ ok: false, error: { code: 'internal' } })
  })
})

describe('remaining branches', () => {
  it('prompt transport throw folds to internal promptError', async () => {
    const { api, session } = makeSession()
    api.onPrompt = () => Promise.reject(new Error('prompt wire down'))
    const result = await session.prompt([{ type: 'text', text: 'x' }], 'queue')
    expect(result.ok).toBe(false)
    expect(session.getSnapshot().promptError).toMatchObject({ op: 'send', error: { code: 'internal', message: 'prompt wire down' } })
  })

  it('cancel business error also lands op=stop promptError', async () => {
    const { api, session } = makeSession()
    api.onCancel = () => Promise.resolve(err({ code: 'agent-busy', message: 'nope', details: { reason: 'r' } }))
    await session.cancel()
    expect(session.getSnapshot().promptError).toMatchObject({ op: 'stop', error: { code: 'agent-busy' } })
  })

  it('loadOlder guards: not-open/no-hasMore no-op, err result kept window, empty page updates hasMore, throw fail-soft', async () => {
    const { api, session } = makeSession()
    await session.loadOlder() // cold: no-op, zero calls
    expect(api.calls).toEqual([])
    api.onHistory = () => histResponse(plainTurn(6, 1, 'x', 'y'), true)
    await session.open()
    // err result: window unchanged
    api.onHistory = () => Promise.resolve(err({ code: 'internal', message: 'x', details: {} }))
    await session.loadOlder()
    expect(eventSeqs(session)).toHaveLength(6)
    expect(session.getSnapshot().hasMore).toBe(true)
    // empty page: hasMore adopts the response
    api.onHistory = () => histResponse([], false)
    await session.loadOlder()
    expect(session.getSnapshot().hasMore).toBe(false)
    // hasMore false now: further loadOlder is a guard no-op
    const calls = api.calls.length
    await session.loadOlder()
    expect(api.calls.length).toBe(calls)
    // throw path: fail-soft with console.error
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    try {
      await session.resync()
      api.onHistory = () => histResponse(plainTurn(6, 1, 'x', 'y'), true)
      await session.resync()
      api.onHistory = () => Promise.reject(new Error('page wire down'))
      await session.loadOlder()
      expect(errorSpy).toHaveBeenCalled()
      expect(session.getSnapshot().loadingOlder).toBe(false)
    } finally {
      errorSpy.mockRestore()
    }
  })

  it('subscribe delivers snapshot-change notifications and unsubscribes', async () => {
    const { api, session } = makeSession()
    api.onHistory = () => histResponse(plainTurn(0, 0, 'a', 'b'))
    let notified = 0
    const unsubscribe = session.subscribe(() => { notified++ })
    await session.open()
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(notified).toBeGreaterThan(0)
    const seen = notified
    unsubscribe()
    session.handleRunning(true) // any snapshot mutation; the listener must stay silent
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(notified).toBe(seen)
  })

  it('rejects an opening page that does not end at the opening cursor', async () => {
    const { api, session } = makeSession()
    let call = 0
    api.onHistory = () => {
      call++
      return histResponse(plainTurn(0, 0, 'a', 'b'))
    }
    api.followCursor = 11
    await session.open()
    expect(call).toBe(1)
    const snapshot = session.getSnapshot()
    expect(snapshot.openState).toBe('error')
    expect(snapshot.openError).toMatchObject({
      code: 'internal', message: 'session event stream page did not end at its requested cursor',
    })
    expect(eventSeqs(session)).toEqual([])
  })

  it('deduplicates repeated running flips and records removal', () => {
    const { session } = makeSession()
    const before = session.getSnapshot()
    session.handleRunning(false) // already false: dedup branch
    expect(session.getSnapshot()).toBe(before)
    session.handleRemoved()
    expect(session.getSnapshot().removed).toBe(true)
  })

  it('drops live events while cold/error (no window upkeep)', async () => {
    const { api, session } = makeSession()
    await follow(api, ev.user(0, '冷态帧'))
    expect(eventSeqs(session)).toEqual([])
    api.onHistory = () => Promise.resolve(err({ code: 'internal', message: 'x', details: {} }))
    await session.open()
    await follow(api, ev.user(0, '错态帧'))
    expect(eventSeqs(session)).toEqual([])
  })

  it('preserves a Host-reported failure that terminates the live source', async () => {
    const { api, session } = makeSession()
    api.onHistory = () => histResponse(plainTurn(0, 0, 'a', 'b'))
    await session.open()
    const failure = {
      code: 'session-not-found',
      message: 'session disappeared',
      details: { sessionId: SID },
    }

    api.failStreams(new RemoteStreamError(failure.code, failure.message, failure.details))
    await vi.waitFor(() => { expect(session.getSnapshot().openState).toBe('error') })

    expect(session.getSnapshot().openError).toEqual(failure)
  })

  it('coalesces queued gap frames behind one repair and exposes a failed repair', async () => {
    const { api, session } = makeSession()
    api.onHistory = () => histResponse(plainTurn(0, 0, 'a', 'b'))
    await session.open()
    const gate = deferred<Awaited<ReturnType<FakeApiClient['onHistory']>>>()
    let repairs = 0
    api.onHistory = () => {
      repairs++
      return gate.promise
    }
    const deliveries = Promise.all([
      follow(api, ev.user(9, '洞一')),
      follow(api, ev.user(10, '洞二')),
    ])
    await vi.waitFor(() => { expect(repairs).toBe(1) })
    gate.reject(new Error('repair wire down'))
    await deliveries
    await vi.waitFor(() => { expect(session.getSnapshot().openState).toBe('error') })
    expect(session.getSnapshot().openError).toMatchObject({ code: 'internal', message: 'repair wire down' })
    expect(eventSeqs(session)).toHaveLength(6)
  })

  it('doOpen transport throw of a stale generation is swallowed (generation guard in catch)', async () => {
    const { api, session } = makeSession()
    const stale = deferred<Awaited<ReturnType<FakeApiClient['onHistory']>>>()
    api.onHistory = () => stale.promise
    const opening = session.open()
    api.onHistory = () => histResponse(plainTurn(0, 0, 'a', 'b'))
    const resynced = session.resync()
    stale.reject(new Error('stale wire'))
    await Promise.all([opening, resynced])
    expect(session.getSnapshot().openState).toBe('open') // stale catch did not write error
  })

  it('drops a stale doOpen whose history resolved successfully after resync superseded it', async () => {
    const { api, session } = makeSession()
    const stale = deferred<Awaited<ReturnType<FakeApiClient['onHistory']>>>()
    api.onHistory = () => stale.promise
    const opening = session.open()
    api.onHistory = () => histResponse(plainTurn(6, 1, '新', '代'))
    const resynced = session.resync()
    stale.resolve(ok({
      records: entries(plainTurn(0, 0, '旧', '代')) as never[],
      hasMore: false,
      modelSelection: { provider: 'deepseek-official', model: 'stale' },
    })) // success, but its generation is gone
    await Promise.all([opening, resynced])
    expect(eventSeqs(session)).toEqual(plainTurn(6, 1, '新', '代').map(event => event.seq))
  })

  it('drops a gap repair superseded by a full resync while its pull was in flight', async () => {
    const { api, session } = makeSession()
    api.onHistory = () => histResponse(plainTurn(0, 0, 'a', 'b'))
    await session.open()
    const repairPull = deferred<Awaited<ReturnType<FakeApiClient['onHistory']>>>()
    api.onHistory = () => repairPull.promise
    const delivery = follow(api, ev.user(9, '洞'))
    await vi.waitFor(() => { expect(api.callsOf('session.history')).toHaveLength(1) })
    api.onHistory = () => histResponse(plainTurn(6, 1, 'c', 'd'))
    const resynced = session.resync() // bumps the generation
    repairPull.resolve(ok({
      records: entries(plainTurn(0, 0, '旧', '页')) as never[],
      hasMore: false,
      modelSelection: { provider: 'deepseek-official', model: 'stale' },
    })) // repair result: stale, dropped
    await Promise.all([delivery, resynced])
    expect(eventSeqs(session)).toEqual(plainTurn(6, 1, 'c', 'd').map(event => event.seq))
  })

  it('successful cancel leaves no promptError', async () => {
    const { api, session } = makeSession()
    api.onHistory = () => histResponse(plainTurn(0, 0, 'a', 'b'))
    await session.open()
    const result = await session.cancel()
    expect(result.ok).toBe(true)
    expect(session.getSnapshot().promptError).toBeNull()
  })

  it('dispose is a reserved no-op on resident instances', async () => {
    const { session } = makeSession()
    await expect(session.dispose()).resolves.toBeUndefined()
  })

  it('carries raw history and follow events through the event feed', async () => {
    const { api, session } = makeSession()
    const historyCall = ev.toolCall(6, 1, 'h1', 'bash', '{"cmd":"pwd"}')
    const historyResult = ev.toolResult(7, 1, 'h1', 'done')
    api.onHistory = () => Promise.resolve(ok({
      records: [
        ...entries(plainTurn(0, 0, 'a', 'b')),
        { type: 'event', event: historyCall },
        { type: 'event', event: historyResult },
      ] as never[],
      hasMore: false,
      modelSelection: { provider: 'deepseek-official', model: 'deepseek-v4-flash' },
    }))
    await session.open()
    expect(windowEntries(session).slice(-2)).toEqual([
      { type: 'event', event: historyCall },
      { type: 'event', event: historyResult },
    ])
    const liveCall = ev.toolCall(8, 2, 'l1', 'write', '{"file_path":"a.ts"}')
    await follow(api, liveCall)
    expect(windowEntries(session).at(-1)).toEqual({ type: 'event', event: liveCall })
    const liveResult = ev.toolResult(9, 2, 'l1', 'ok')
    await follow(api, liveResult)
    expect(windowEntries(session).at(-1)).toEqual({ type: 'event', event: liveResult })
  })
})

describe('resync', () => {
  it('keeps the old feed until the reconnect snapshot, then repairs queued live gaps', async () => {
    const { api, session } = makeSession()
    api.onHistory = () => histResponse(plainTurn(0, 0, '旧', '窗'))
    await session.open()
    const oldWindow = session.eventSource.getSnapshot()
    const replacement = deferred<Awaited<ReturnType<FakeApiClient['onHistory']>>>()
    api.followCursor = 15
    api.onHistory = () => replacement.promise
    const publications: ReturnType<Session['eventSource']['getSnapshot']>[] = []
    const off = session.eventSource.subscribe(() => {
      publications.push(session.eventSource.getSnapshot())
    })

    const syncing = session.resync()
    await vi.waitFor(() => { expect(api.callsOf('session.follow')).toHaveLength(2) })
    expect(session.eventSource.getSnapshot()).toBe(oldWindow)
    expect(publications).toEqual([])

    api.onHistory = () => histResponse([
      ...plainTurn(10, 2, '终', '页'),
      ev.user(16, '后到低位'),
      ev.user(17, '后到高位'),
    ])
    const liveDeliveries = Promise.all([
      follow(api, ev.user(17, '后到高位')),
      follow(api, ev.user(16, '后到低位')),
    ])
    expect(session.eventSource.getSnapshot()).toBe(oldWindow)
    replacement.resolve(ok({
      records: entries(plainTurn(10, 2, '终', '页')) as never[],
      hasMore: false,
      modelSelection: { provider: 'deepseek-official', model: 'deepseek-v4-flash' },
    }))
    await Promise.all([syncing, liveDeliveries])
    await vi.waitFor(() => {
      expect(eventSeqs(session)).toEqual([10, 11, 12, 13, 14, 15, 16, 17])
    })

    expect(publications).toHaveLength(2)
    expect(publications.map(snapshot => snapshot.change.kind)).toEqual(['replace', 'replace'])
    expect(publications[0]?.entries.map(entry => entry.event.seq)).toEqual([10, 11, 12, 13, 14, 15])
    expect(publications[1]?.entries.map(entry => entry.event.seq)).toEqual([10, 11, 12, 13, 14, 15, 16, 17])
    off()
  })

  it('rebuilds the window without clearing control state; cold instances no-op', async () => {
    const { api, session } = makeSession()
    api.onHistory = () => histResponse(plainTurn(0, 0, 'a', 'b'))
    await session.open()
    session.handleRunning(true)
    session.handleAgentError('still visible')
    api.onHistory = () => histResponse([...plainTurn(0, 0, 'a', 'b'), ...plainTurn(6, 1, 'c', 'd')])
    await session.resync()
    const snapshot = session.getSnapshot()
    expect(snapshot.openState).toBe('open')
    expect(snapshot.running).toBe(true)
    expect(snapshot.lastAgentError).toBe('still visible')
    expect(eventSeqs(session)).toHaveLength(12)

    const cold = makeSession()
    await cold.session.resync()
    expect(cold.api.calls).toEqual([]) // never opened: no traffic
  })

  it('drops a stale in-flight open superseded by resync (generation guard)', async () => {
    const { api, session } = makeSession()
    const stale = deferred<Awaited<ReturnType<FakeApiClient['onHistory']>>>()
    api.onHistory = () => stale.promise
    const firstOpen = session.open()
    api.onHistory = () => histResponse(plainTurn(6, 1, '新', '代'))
    const resynced = session.resync()
    stale.reject(new Error('dead connection')) // the doomed pre-disconnect request fails late
    await firstOpen
    await resynced
    const snapshot = session.getSnapshot()
    expect(snapshot.openState).toBe('open') // stale failure did not settle the fresh generation into error
    expect(eventSeqs(session)).toEqual(plainTurn(6, 1, '新', '代').map(event => event.seq))
  })

})

describe('snapshot ownership', () => {
  it('publishes event-window appends without changing an unrelated Session snapshot', async () => {
    const { api, session } = makeSession()
    api.onHistory = () => histResponse(plainTurn(0, 0, '稳', '定'))
    await session.open()
    const sessionBefore = session.getSnapshot()
    const windowBefore = session.eventSource.getSnapshot()
    const firstEntry = windowBefore.entries[0]
    await follow(api, ev.user(6, '追加'))
    const windowAfter = session.eventSource.getSnapshot()
    expect(session.getSnapshot()).toBe(sessionBefore)
    expect(windowAfter).not.toBe(windowBefore)
    expect(windowAfter.entries[0]).toBe(firstEntry)
    expect(windowAfter.change).toMatchObject({ kind: 'append' })
  })
})
