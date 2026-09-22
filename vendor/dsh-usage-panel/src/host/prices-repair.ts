// dsh-usage-panel · one-time repair of the stored conversation price section.
//
// The retired 峰谷计价-OFF writer persisted `{ hit, miss, out, flat: true }` with
// NO `idle` column. The harness record has no `flat` field: it reads the three
// top-level numbers as the PEAK column and derives the off-peak charge as half
// of them whenever `idle` is absent — so a record written that way billed the
// user's single price at HALF outside peak hours.
//
// New writes cannot produce that shape any more (`prices-source.ts` repairs on
// the way out), but a record already stored in
// `ui-conversation.sessionCostPrices` keeps the defect until something rewrites
// it, so the section is repaired ONCE after startup. The gating is deliberately
// the legacy import's (see `legacy-billing-import.ts`), for the same reasons:
//
//  1. "the section is registered" — `settings.update` on an unregistered
//     namespace REJECTS rather than no-ops, and the harness `ui-conversation`
//     plugin may apply AFTER this one. A deferred attempt is therefore retried
//     (on a later `billing.get`), never assumed done.
//  2. WRITE FIRST, THEN DONE: a rejected write must not mark the repair done,
//     or the bad record would stay broken for the life of the process.
//  3. Nothing may escape into the RPC path: `attempt()` contains its failures,
//     logs the reason once (a deferral is not news on every read) and retries.
import { repairFlatEntries } from '../shared/pricing.ts'
import type { PricesSource } from './prices-source.ts'

export interface PricesRepairDeps {
  /** The same access the RPC write path uses; `save` repairs again on the way out. */
  prices: PricesSource
  /** Warning sink (the plugin's `tag` logger). */
  warn: (message: string) => void
  /** Informational sink for the completed repair. */
  log: (message: string) => void
}

export interface PricesRepair {
  /** Repair when the preconditions hold; never rejects, never throws. */
  attempt(): Promise<void>
  /** Whether the repair completed (or found nothing to do) in this process. */
  isDone(): boolean
}

/**
 * Build the one-time flat-record repair.
 * @param deps - the price access and its log sinks.
 * @returns the runner; `attempt()` is safe to call from the RPC path.
 */
export function createPricesRepair(deps: PricesRepairDeps): PricesRepair {
  const { prices, warn, log } = deps
  let done = false
  let inflight: Promise<void> | null = null
  // One warning per distinct reason: `attempt` runs on every `billing.get` and
  // a precondition that still does not hold is not news.
  let lastReason: string | null = null

  function warnOnce(reason: string): void {
    if (lastReason === reason) return
    lastReason = reason
    warn(reason)
  }

  async function run(): Promise<void> {
    try {
      if (!prices.isSectionRegistered()) {
        warnOnce('flat price repair deferred: the ui-conversation settings section is not registered yet')
        return
      }
      lastReason = null
      const repaired = repairFlatEntries(prices.snapshot())
      if (!repaired.changed) {
        // The section already bills one price in both columns (a fresh install,
        // or a write that repaired it on the way out): nothing to do, ever.
        done = true
        return
      }
      // WRITE FIRST: a rejected write must leave `done` false so the next
      // `billing.get` retries instead of reporting a repair that did not happen.
      await prices.save(repaired.prices)
      done = true
      log(
        'repaired the stored conversation prices: every 峰谷计价-OFF record gained the idle column, ' +
          'so both periods bill the entered price',
      )
    } catch (err) {
      warnOnce('flat price repair failed (retried on the next billing.get): ' + String((err as Error)?.message ?? err))
    }
  }

  return {
    isDone: () => done,
    attempt(): Promise<void> {
      if (done) return Promise.resolve()
      if (inflight !== null) return inflight
      // `run` contains its own failures, so this chain settles resolved.
      const running = run().finally(() => {
        inflight = null
      })
      inflight = running
      return running
    },
  }
}
