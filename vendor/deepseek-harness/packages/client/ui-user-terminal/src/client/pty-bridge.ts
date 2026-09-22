/** One PTY listener pair fans events to every live store handle. */
import type { TerminalShellInjected } from './shell.ts'
import type { TerminalSessionStoreHandle } from './stores.ts'
import { forgetConptyDeviceAttributes } from './conpty-da.ts'

type PtyStore = Pick<TerminalSessionStoreHandle, 'dispatchData' | 'dispatchExit'>

/**
 * Subscribe once to desktop PTY data/exit and fan out to the given stores.
 * Each store ignores ids it does not own. Drawer and surface must not subscribe themselves.
 * @param stores - drawer and surface handles, or one handle in tests.
 * @param pty - desktop PTY listener pair.
 * @returns disposer that drops both subscriptions.
 */
export function bindPtyListeners(
  stores: readonly PtyStore[],
  pty: Pick<TerminalShellInjected, 'onPtyData' | 'onPtyExit'>,
): () => void {
  const offData = pty.onPtyData((payload) => {
    for (const store of stores) store.dispatchData(payload.id, payload.data)
  })
  const offExit = pty.onPtyExit((payload) => {
    forgetConptyDeviceAttributes(payload.id)
    for (const store of stores) store.dispatchExit(payload.id)
  })
  return () => {
    offData()
    offExit()
  }
}
