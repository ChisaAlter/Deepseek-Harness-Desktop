// dsh-usage-panel · bundle-internal billing preferences bus.
//
// One plugin, two UI surfaces: the composer cost strip (P5) and the usage
// panel's settings modal (P6). Both read/write the same durable record
// through this tiny pub/sub; the host JSON stays the single source, this bus
// only fans the latest snapshot out to in-bundle subscribers. Persistence is
// explicit: the caller owns the RPC (callBillingGet/callBillingSet); the bus
// itself never touches the network.
import type { BillingSettings } from '../shared/contract.ts'

let snapshot: BillingSettings | null = null
const listeners = new Set<(settings: BillingSettings) => void>()

export function publishBilling(settings: BillingSettings | null): void {
  snapshot = settings
  if (settings === null) return
  for (const listener of listeners) listener(settings)
}

/** Latest published snapshot (null = not loaded yet). */
export function currentBilling(): BillingSettings | null {
  return snapshot
}

/** Subscribe to snapshot changes; returns the disposer. */
export function subscribeBilling(listener: (settings: BillingSettings) => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}
