// dsh-usage-panel · durable billing preferences (plugin-owned JSON).
//
// One record: user-edited prices and the global peak/valley pricing switch.
// Backed by the harness storage-domain facility
// (`ctx.storageDomain`, the same mechanism the projection cache uses): one
// global slot of our own domain, JSON backend beside workspace.json, atomic
// by the medium, zod schema at the durable boundary. When the facility is
// unavailable the store degrades to memory (fail-soft, logged once) —
// preferences then live for the process only, never silently pretending to
// be durable.
import { z } from 'zod'
import { parseSessionCostPrices } from '../shared/pricing.ts'
import { DEFAULT_BILLING_SETTINGS, type BillingSettings } from '../shared/contract.ts'
import type { SessionCostPrices } from '../shared/pricing.ts'

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

const emptyPrices: SessionCostPrices = {}

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
 * Billing-preferences store. `save` is replace-whole (the record is small;
 * the client edits one object). Load runs the shared semantic validator on
 * the prices: a record that fails validation is treated as default (logged),
 * never half-applied. Starts in memory mode; the domain can attach later
 * (`attachMedium`) without losing a save made meanwhile.
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
    // Keep an existing cache: a save made during the memory phase is the
    // user's data and must not silently vanish when the medium arrives.
  }

  /** Read the current record (cached per process; first read materializes). */
  async load(): Promise<BillingSettings> {
    if (this.cache !== null) return this.cache
    this.cache = this.fromRaw(this.medium?.get())
    return this.cache
  }

  /** Replace the whole record (validated; throws with the issues on refusal). */
  async save(settings: BillingSettings): Promise<BillingSettings> {
    this.toRaw(settings)
    if (this.medium !== undefined) {
      await this.medium.set(settings)
    }
    this.cache = settings
    return this.cache
  }

  private fromRaw(raw: unknown): BillingSettings {
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return initialRecord()
    const record = raw as Record<string, unknown>
    const parsed = parseSessionCostPrices(record.prices)
    // Legacy strip fields (stripVisible/peakHintVisible) are not carried over.
    if (!parsed.ok) {
      this.warn('stored prices failed validation, using defaults: ' + parsed.issues.join(' | '))
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

  private toRaw(settings: BillingSettings): void {
    if (typeof settings !== 'object' || settings === null || Array.isArray(settings)) {
      throw new Error('invalid billing settings: expected an object')
    }
    const parsed = parseSessionCostPrices(settings.prices)
    if (!parsed.ok) throw new Error('invalid prices: ' + parsed.issues.join(' | '))
    if (typeof settings.peakValleyEnabled !== 'boolean') {
      throw new Error('invalid billing settings: peakValleyEnabled must be a boolean')
    }
  }
}

/** Open the billing domain over the facility; returns undefined (memory mode) on any failure. */
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
        initial: { ...initialRecord(), prices: { ...emptyPrices } },
      },
      tables: {},
    })
    return domain.global
  } catch (error) {
    // Fail-soft: the store falls back to memory and the process logs once.
    warn('billing domain open failed; preferences are memory-only: ' + String((error as Error)?.message ?? error))
    return undefined
  }
}
