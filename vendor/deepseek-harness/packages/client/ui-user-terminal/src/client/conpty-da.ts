/**
 * ConPTY 1.22+ (node-pty `useConptyDll: true`) sends CSI c during handshake.
 * xterm's default answer is ESC [?1;2c via onData; PowerShell echoes that as
 * typed `[?1;2c`. ConPTY consumes ESC [?61;4c (VT level 61) instead.
 *
 * DSH destroys the xterm instance on pane unmount and replays the raw PTY
 * buffer, which still contains CSI c. A second answer after handshake is
 * stdin to PowerShell (`[?61;4c`). This adapter never enables the DLL and caches
 * xterm across remounts; this module answers DA1 at most once per PTY id.
 */

/** DA1 response ConPTY 1.22+ waits for. */
export const CONPTY_DA1_RESPONSE = '\x1b[?61;4c'

/** PTY ids whose handshake DA1 has already been written to stdin. */
const answeredSessions = new Set<string>()

/** xterm Terminal face used to intercept CSI c without the proposed parser flag. */
export type DeviceAttributesTerminal = {
  parser: {
    registerCsiHandler: (
      spec: { final: string },
      handler: (params: number[]) => boolean,
    ) => { dispose: () => void }
  }
}

/**
 * True when CSI c is a primary DA request (no params or Ps=0).
 * @param params - CSI parameters from xterm's parser.
 * @returns whether this request should get the ConPTY DA1 response.
 */
export function isPrimaryDeviceAttributesRequest(params: number[]): boolean {
  return params.length === 0 || (params.length === 1 && params[0] === 0)
}

/**
 * Drop the one-shot DA1 latch so a later PTY with the same id can handshake.
 * Call this from `onPtyExit`, not from xterm dispose (drawer remount).
 * @param sessionId - the PTY session id whose latch should clear.
 */
export function forgetConptyDeviceAttributes(sessionId: string): void {
  answeredSessions.delete(sessionId)
}

/**
 * Register a CSI c handler that answers ConPTY once per PTY id and swallows
 * xterm's ?1;2c. Replay of a buffered CSI c after handshake must not write.
 * @param term - the xterm instance whose parser should intercept DA1.
 * @param writeToPty - stdin write used for the DA1 response.
 * @param sessionId - PTY id that owns the one-shot latch.
 * @returns disposer for the CSI handler.
 */
export function attachConptyDeviceAttributes(
  term: DeviceAttributesTerminal,
  writeToPty: (bytes: string) => void,
  sessionId: string,
): { dispose: () => void } {
  return term.parser.registerCsiHandler({ final: 'c' }, (params) => {
    if (!isPrimaryDeviceAttributesRequest(params)) return false
    if (!answeredSessions.has(sessionId)) {
      answeredSessions.add(sessionId)
      writeToPty(CONPTY_DA1_RESPONSE)
    }
    return true
  })
}
