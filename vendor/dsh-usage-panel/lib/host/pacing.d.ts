/** Yield to the event loop once (macrotask), letting pending I/O and timers run. */
export declare function yieldLoop(): Promise<void>;
/** Progress log counter for a scan loop ("scanned N of M sessions"). */
export declare function scanPacer(log: (message: string) => void): {
    beat: (index: number, total: number) => Promise<void>;
};
/**
 * Bound a promise with a timeout: settles with the original value when the
 * source wins, rejects `label + ' timed out'` on expiry. The late source
 * settlement is swallowed (no unhandled rejection), and the timer is cleared
 * on the fast path — safe to use for per-provider adapter calls that may hang
 * on a dead endpoint.
 */
export declare function withTimeout<T>(source: Promise<T>, ms: number, label: string): Promise<T>;
