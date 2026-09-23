/** One PTY listener pair fans events to every live store handle. */
import type { TerminalShellInjected } from './shell.ts'
import type { TerminalSessionStoreHandle } from './stores.ts'
import { forgetConptyDeviceAttributes } from './conpty-da.ts'

type PtyStore = Pick<TerminalSessionStoreHandle, 'dispatchData' | 'dispatchExit'>

/**
 * Subscribe once to desktop PTY data/exit and fan out to the given stores.
 * Each store ignores ids it does not own. Drawer and surface must not subscribe
 * themselves.
 *
 * Output frames carry a monotonic sequence number, and the main process pauses
 * the backend PTY once too many of those bytes are outstanding. The
 * acknowledgement must therefore mean "this frame is now in terminal session
 * state", not "the IPC message arrived": it is sent only after every store has
 * run, and only for the highest sequence a store actually stored. A frame no
 * store owns is deliberately left unacknowledged, which keeps the backend
 * paused instead of letting a queue grow for output nobody consumed.
 *
 * Acknowledgements are coalesced to one call per microtask, so a burst costs a
 * single round trip rather than one per frame.
 *
 * @param stores - drawer and surface handles, or one handle in tests.
 * @param pty - desktop PTY listener pair.
 * @returns disposer that drops both subscriptions.
 */
export function bindPtyListeners(
  stores: readonly PtyStore[],
  pty: Pick<TerminalShellInjected, 'onPtyData' | 'onPtyExit' | 'ptyAck'>,
): () => void {
  /** Highest sequence already acknowledged per PTY. */
  const acknowledged = new Map<string, number>()
  /** Highest sequence waiting to be acknowledged per PTY. */
  const pending = new Map<string, number>()
  let flushScheduled = false
  let disposed = false

  function flushAcknowledgements(): void {
    flushScheduled = false
    for (const [id, seq] of [...pending]) {
      pending.delete(id)
      if ((acknowledged.get(id) ?? 0) >= seq) continue
      acknowledged.set(id, seq)
      void pty.ptyAck(id, seq).catch(() => {
        // A failed acknowledgement must not poison later ones; the backend
        // simply stays paused until a later frame succeeds.
        acknowledged.delete(id)
      })
    }
  }

  function scheduleFlush(): void {
    if (flushScheduled) return
    flushScheduled = true
    queueMicrotask(() => {
      if (disposed) return
      flushAcknowledgements()
    })
  }

  const offData = pty.onPtyData((payload) => {
    let consumed = 0
    for (const store of stores) {
      const stored = store.dispatchData(payload.id, payload.data, payload.seq)
      if (stored > consumed) consumed = stored
    }
    if (consumed === 0) return
    if ((acknowledged.get(payload.id) ?? 0) >= consumed) return
    if ((pending.get(payload.id) ?? 0) >= consumed) return
    pending.set(payload.id, consumed)
    scheduleFlush()
  })
  const offExit = pty.onPtyExit((payload) => {
    forgetConptyDeviceAttributes(payload.id)
    acknowledged.delete(payload.id)
    pending.delete(payload.id)
    for (const store of stores) store.dispatchExit(payload.id)
  })
  return () => {
    disposed = true
    offData()
    offExit()
  }
}
