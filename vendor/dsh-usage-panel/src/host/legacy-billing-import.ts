// dsh-usage-panel · one-time import of the RETIRED plugin-owned price record.
//
// Versions up to v0.3 (and a reverted attempt) persisted user prices in this
// plugin's own domain `dsh_usage_panel_billing`. The surviving record is the
// harness conversation settings section `ui-conversation.sessionCostPrices`
// (see `prices-source.ts`), so the legacy prices are merged into it ONCE and
// the legacy record is then cleared; after that this plugin never writes the
// domain again and `billing-store.ts` stays as its reader.
//
// The import is a chain of preconditions, and each one is a real trap:
//
//  1. "the section is registered" — `settings.update` on an unregistered
//     namespace REJECTS rather than no-ops, and the section is registered by
//     the harness `ui-conversation` plugin, which may apply after this one.
//     A failed attempt is therefore RETRIED (on a later `billing.get`), never
//     assumed done.
//  2. "the legacy domain is attached" — `BillingStore.load()` caches its first
//     result and `attachMedium` deliberately keeps an existing cache, so a read
//     taken before the domain opens would report "no prices" and complete the
//     import forever. The memory phase therefore skips WITHOUT reading.
//  3. WRITE FIRST, THEN CLEAR: clearing before a failed section write would
//     destroy the only copy of those prices.
//  4. Nothing may escape into the RPC path: `attempt()` resolves on every
//     failure and the reason is logged for the retry.
import { BILLING_DOMAIN_NAME, type BillingStoreMode } from './billing-store.ts'
import type { BillingSettings } from '../shared/contract.ts'
import type { SessionCostPrices } from '../shared/pricing.ts'
import type { PricesSource } from './prices-source.ts'

/**
 * Merge the retired record's prices into the conversation section's prices.
 * The SECTION wins on conflicts: a model the user already priced there keeps
 * that price, and only legacy-only keys are adopted.
 * @param legacy - prices read from the retired `dsh_usage_panel_billing` domain.
 * @param section - prices currently in `ui-conversation.sessionCostPrices`.
 * @returns the merged record (section keys first, then adopted legacy keys) and
 *   the legacy-only keys that were adopted.
 */
export function mergeLegacyPrices(
  legacy: SessionCostPrices,
  section: SessionCostPrices,
): { prices: SessionCostPrices; imported: string[] } {
  const prices: SessionCostPrices = { ...section }
  const imported: string[] = []
  for (const [key, value] of Object.entries(legacy)) {
    if (Object.hasOwn(section, key)) continue
    prices[key] = value
    imported.push(key)
  }
  return { prices, imported }
}

/** The legacy reader the import needs (BillingStore satisfies this structurally). */
export interface LegacyPriceReader {
  /** `memory` until the storage domain attaches; the import refuses to read then. */
  readonly mode: BillingStoreMode
  load(): Promise<BillingSettings>
  /** Drop this domain's prices after they reached the surviving record. */
  clearPrices(): Promise<void>
}

export interface LegacyImportDeps {
  store: LegacyPriceReader
  prices: PricesSource
  /** Warning sink (the plugin's `tag` logger). */
  warn: (message: string) => void
  /** Informational sink for the completed import. */
  log: (message: string) => void
}

export interface LegacyBillingImport {
  /** Run the import when its preconditions hold; never rejects, never throws. */
  attempt(): Promise<void>
  /** Whether the import completed in this process. */
  isDone(): boolean
}

/**
 * Build the one-time import.
 * @param deps - the legacy reader, the price access, and the log sinks.
 * @returns the runner; `attempt()` is safe to call from the RPC path.
 */
export function createLegacyBillingImport(deps: LegacyImportDeps): LegacyBillingImport {
  const { store, prices, warn, log } = deps
  let done = false
  let inflight: Promise<void> | null = null
  // One warning per distinct deferral/failure reason: `attempt` runs on every
  // `billing.get`, and a precondition that still does not hold is not news.
  let lastReason: string | null = null

  function warnOnce(reason: string): void {
    if (lastReason === reason) return
    lastReason = reason
    warn(reason)
  }

  async function run(): Promise<void> {
    try {
      if (store.mode !== 'durable') {
        // Do NOT read here: a memory-phase `load()` caches an empty record and
        // the medium keeps that cache, which would look like "nothing to import".
        warnOnce('legacy price import deferred: the plugin billing domain has not attached yet')
        return
      }
      if (!prices.isSectionRegistered()) {
        warnOnce('legacy price import deferred: the ui-conversation settings section is not registered yet')
        return
      }
      lastReason = null
      const legacy = await store.load()
      if (Object.keys(legacy.prices).length === 0) {
        // Nothing to carry over; the domain is left untouched (it holds no prices).
        done = true
        return
      }
      const { prices: merged, imported } = mergeLegacyPrices(legacy.prices, prices.snapshot())
      // WRITE FIRST: a rejected section write must leave the legacy record (the
      // only copy of those prices) intact for the retry.
      if (imported.length > 0) await prices.save(merged)
      await store.clearPrices()
      done = true
      log(
        'imported ' + imported.length + ' legacy price(s) from ' + BILLING_DOMAIN_NAME +
          ' into the conversation settings section; that domain is import-only from now on',
      )
    } catch (err) {
      // Reaching the RPC path with a rejection would break the settings modal
      // for a cleanup that is not the user's problem: report and retry instead.
      warnOnce('legacy price import failed (retried on the next billing.get): ' + String((err as Error)?.message ?? err))
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
