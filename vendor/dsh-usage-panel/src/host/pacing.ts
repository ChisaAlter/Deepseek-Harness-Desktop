// dsh-usage-panel · cooperative pacing for large-corpus scans.
//
// Cold reads can fold a session log synchronously inside the framework's
// `coldSnapshot` (a version-mismatched row restores from seq 0). Iterating a
// large corpus in one straight line therefore blocks the host event loop
// between sessions long enough to stall the GUI. Scans yield to the loop
// between batches so the host stays responsive while a cold migration runs;
// the framework's own per-session fold remains the granularity.
const BATCH_SIZE = 5
const PROGRESS_EVERY = 200

/** Yield to the event loop once (macrotask), letting pending I/O and timers run. */
export function yieldLoop(): Promise<void> {
  return new Promise((resolve) => {
    setImmediate(resolve)
  })
}

/** Progress log counter for a scan loop ("scanned N of M sessions"). */
export function scanPacer(
  log: (message: string) => void,
): { beat: (index: number, total: number) => Promise<void> } {
  return {
    async beat(index: number, total: number): Promise<void> {
      if (index % BATCH_SIZE === 0) await yieldLoop()
      if (index % PROGRESS_EVERY === 0 || index === total) {
        log(`scan progress: ${index}/${total} sessions processed`)
      }
    },
  }
}

/**
 * Bound a promise with a timeout: settles with the original value when the
 * source wins, rejects `label + ' timed out'` on expiry. The late source
 * settlement is swallowed (no unhandled rejection), and the timer is cleared
 * on the fast path — safe to use for per-provider adapter calls that may hang
 * on a dead endpoint.
 */
export function withTimeout<T>(source: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(label + ' timed out'))
    }, ms)
    source.then(
      (value) => {
        clearTimeout(timer)
        resolve(value)
      },
      (err) => {
        clearTimeout(timer)
        reject(err)
      },
    )
  })
}
