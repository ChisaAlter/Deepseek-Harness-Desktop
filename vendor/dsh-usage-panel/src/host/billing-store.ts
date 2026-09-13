// dsh-usage-panel · the RETIRED billing record, kept as a legacy reader only.
//
// Older versions (up to v0.3, and a reverted attempt) persisted user prices in
// this plugin's own storage domain `dsh_usage_panel_billing`; the surviving
// record is the harness conversation settings section
// (`ui-conversation.sessionCostPrices`, see `prices-source.ts`). Nothing writes
// this domain any more: `legacy-billing-import.ts` reads it once, merges its
// prices into the section (the section wins on conflicts) and then clears the
// prices through {@link BillingStore.clearPrices}. Delete this module and the
// domain open in the host entry point once no installation can still carry the
// old record.
//
// Backed by the harness storage-domain facility (`ctx.storageDomain`, the same
// mechanism the projection cache uses): one global slot of our own domain, JSON
// backend beside workspace.json, atomic by the medium, zod schema at the
// durable boundary. The domain opens ASYNCHRONOUSLY after `apply` — the store
// starts in memory mode and `attachMedium` upgrades it without losing what the
// memory phase cached.
import { z } from 'zod'
import { parseSessionCostPrices } from '../shared/pricing.ts'
import { DEFAULT_BILLING_SETTINGS, type BillingSettings } from '../shared/contract.ts'

/** Domain name (UNIT_NAME_RE: lowercase letters/digits/underscores only). */
export const BILLING_DOMAIN_NAME = 'dsh_usage_panel_billing'
export const BILLING_DOMAIN_VERSION = 1

const priceValueSchema = z.object({
  inputCacheHit: z.number(),
  inputCacheMiss: z.number(),
  output: z.number(),
  idle: z
    .object({
      inputCacheHit: z.number(),
      inputCacheMiss: z.number(),
      output: z.number(),
    })
    .optional(),
  flat: z.boolean().optional(),
})

/** Structural record schema at the durable boundary (semantic checks re-run on load). */
export const billingGlobalSchema = z.object({
  prices: z.record(z.string(), priceValueSchema),
  // Legacy v0.3 fields of the retired composer cost strip: a record written
  // by that version still carries them; they parse and are ignored.
  stripVisible: z.boolean().optional(),
  peakHintVisible: z.boolean().optional(),
  peakValleyEnabled: z.boolean(),
})

/** The durable face the store talks to: the domain global handle. */
export interface BillingMedium {
  get(): unknown
  set(value: unknown): Promise<void>
}

export type BillingStoreMode = 'durable' | 'memory'

function initialRecord(): BillingSettings {
  return {
    prices: {},
    peakValleyEnabled: DEFAULT_BILLING_SETTINGS.peakValleyEnabled,
  }
}

/**
 * Legacy-record reader. `load` runs the shared semantic validator on the
 * prices: a record that fails validation is treated as default (logged), never
 * half-applied. Starts in memory mode; the domain can attach later
 * (`attachMedium`) without losing what the memory phase cached.
 *
 * The memory phase is why the one-time import must gate on {@link mode}: `load`
 * caches its first result (an empty record before the medium attaches), and a
 * reader that cached "no prices" would mark the import complete forever.
 */
export class BillingStore {
  private cache: BillingSettings | null = null
  private medium: BillingMedium | undefined
  mode: BillingStoreMode

  constructor(
    medium: BillingMedium | undefined,
    private readonly warn: (message: string) => void,
  ) {
    this.medium = medium
    this.mode = medium === undefined ? 'memory' : 'durable'
  }

  /** Attach the durable medium after the async domain open (upgrades the mode). */
  attachMedium(medium: BillingMedium): void {
    this.medium = medium
    this.mode = 'durable'
    // Keep an existing cache: a record read during the memory phase is not
    // replaced by a re-read, which is exactly why the import gates on `mode`.
  }

  /** Read the current record (cached per process; first read materializes). */
  async load(): Promise<BillingSettings> {
    if (this.cache !== null) return this.cache
    this.cache = this.fromRaw(this.medium?.get())
    return this.cache
  }

  /**
   * Drop this domain's prices after they have been merged into the surviving
   * record. The record itself stays schema-valid (`prices: {}`); the legacy
   * fields of the retired composer strip are gone with it.
   */
  async clearPrices(): Promise<void> {
    const cleared: BillingSettings = { prices: {}, peakValleyEnabled: DEFAULT_BILLING_SETTINGS.peakValleyEnabled }
    if (this.medium !== undefined) await this.medium.set(cleared)
    this.cache = cleared
  }

  private fromRaw(raw: unknown): BillingSettings {
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return initialRecord()
    const record = raw as Record<string, unknown>
    const parsed = parseSessionCostPrices(record.prices)
    // Legacy strip fields (stripVisible/peakHintVisible) are not carried over.
    if (!parsed.ok) {
      this.warn('stored legacy prices failed validation, using defaults: ' + parsed.issues.join(' | '))
      return {
        prices: {},
        peakValleyEnabled: record.peakValleyEnabled === false ? false : true,
      }
    }
    return {
      prices: parsed.prices,
      peakValleyEnabled: record.peakValleyEnabled === false ? false : true,
    }
  }
}

/** Open the legacy domain over the facility; returns undefined (memory mode) on any failure. */
export async function openBillingMedium(
  storageDomain:
    | { open(spec: object): Promise<{ global: BillingMedium }> }
    | undefined,
  warn: (message: string) => void,
): Promise<BillingMedium | undefined> {
  if (storageDomain === undefined) return undefined
  try {
    const domain = await storageDomain.open({
      name: BILLING_DOMAIN_NAME,
      version: BILLING_DOMAIN_VERSION,
      global: {
        schema: billingGlobalSchema,
        initial: { ...initialRecord(), prices: {} },
      },
      tables: {},
    })
    return domain.global
  } catch (error) {
    // Fail-soft: the store stays in memory mode, which keeps the legacy import
    // deferred (never reading a record it cannot see) and logs once.
    warn('legacy billing domain open failed; the one-time price import is deferred: ' + String((error as Error)?.message ?? error))
    return undefined
  }
}
