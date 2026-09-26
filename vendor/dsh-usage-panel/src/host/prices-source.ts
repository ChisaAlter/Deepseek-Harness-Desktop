// dsh-usage-panel · the ONE price record: the harness conversation section.
//
// User prices live in `ui-conversation.sessionCostPrices` — the same section
// the harness composer cost strip reprices from, which is why the record does
// not move and this plugin's 计费设置 window writes it instead of a domain of
// its own. This module is the plugin's only read/write path to that record:
//
// - reads are SYNCHRONOUS (`snapshot`) over an internally cached value, because
//   the host-side cost ranking prices a page of sessions per request;
// - the cache is kept fresh from the `settings/document-updated` commit event,
//   so an edit made anywhere (this modal, the harness, another window)
//   reprices the next ranking without a reload;
// - the section is registered by the harness `ui-conversation` plugin, which
//   may apply AFTER this plugin: until a read succeeds the snapshot re-checks
//   cheaply, and `save` rejects (settings.update throws for an unregistered
//   namespace — it never no-ops) instead of pretending to have stored anything.
//
// Validation is the shared `parseSessionCostPrices`: a record that fails it is
// ignored as a whole (logged once per distinct issue set) rather than applied
// half-way. Every WRITE additionally passes through `repairFlatEntries`, which
// gives a `flat: true` entry the explicit `idle` column it needs to bill the
// user's single price in both periods (the harness halves an absent idle
// column), so that shape cannot be reintroduced by any writer.
import { parseSessionCostPrices, repairFlatEntries } from '../shared/pricing.ts'
import type { SessionCostPrices } from '../shared/pricing.ts'
import type { HostSettings } from './types.ts'

/** Settings namespace owned by the harness conversation plugin. */
export const CONVERSATION_SETTINGS_NS = 'ui-conversation'

/** Field of that namespace carrying the user's per-model prices. */
export const SESSION_COST_PRICES_FIELD = 'sessionCostPrices'

/** The plugin's price access: a synchronous snapshot plus the section write path. */
export interface PricesSource {
  /** Current prices; the first call reads the section, later calls serve the cache. */
  snapshot(): SessionCostPrices
  /** Persist prices into the conversation section; rejects while it is unregistered. */
  save(prices: SessionCostPrices): Promise<void>
  /** Re-read the section after a `settings/document-updated` commit event. */
  refresh(): void
  /** Whether the conversation section exists (the precondition of every write). */
  isSectionRegistered(): boolean
}

/**
 * Build the price access over the settings service.
 * @param settings - the `ctx.settings` face.
 * @param warn - sink for the validation and read warnings (the plugin's `tag` logger).
 * @returns the price access; every method is total except `save`, which rejects.
 */
export function createPricesSource(settings: HostSettings, warn: (message: string) => void): PricesSource {
  let cached: SessionCostPrices = {}
  // False until one read observed a REGISTERED section: an unregistered read is
  // not evidence that the user has no prices, so it must not freeze the cache.
  let observed = false
  // One warning per distinct message: a corrupt record is re-parsed on every
  // refresh and must not flood the log.
  let lastWarning: string | null = null

  function warnOnce(message: string): void {
    if (lastWarning === message) return
    lastWarning = message
    warn(message)
  }

  /** Prices carried by one resolved section value; `null` when it is not an object. */
  function pricesOf(section: unknown): SessionCostPrices | null {
    if (typeof section !== 'object' || section === null || Array.isArray(section)) return null
    const raw = (section as Record<string, unknown>)[SESSION_COST_PRICES_FIELD]
    if (raw === undefined || raw === null) return {}
    const parsed = parseSessionCostPrices(raw)
    if (!parsed.ok) {
      warnOnce(
        'stored ' + CONVERSATION_SETTINGS_NS + '.' + SESSION_COST_PRICES_FIELD +
          ' failed validation, ignoring it: ' + parsed.issues.join(' | '),
      )
      return {}
    }
    return parsed.prices
  }

  /** Read + cache the section; false while the namespace is unregistered. */
  function readSection(): boolean {
    let section: unknown
    try {
      section = settings.describe().find((entry) => entry.ns === CONVERSATION_SETTINGS_NS)?.value
    } catch (err) {
      // A service that throws on read is indistinguishable from an absent
      // section for this caller; the write path surfaces the real error.
      warnOnce('settings read failed: ' + String((err as Error)?.message ?? err))
      return false
    }
    const prices = section === undefined ? null : pricesOf(section)
    if (prices === null) return false
    cached = prices
    observed = true
    return true
  }

  return {
    isSectionRegistered(): boolean {
      // Reuses the read: it is a synchronous map lookup over a small object and
      // keeps one definition of "registered" (get returned a section).
      return readSection()
    },

    snapshot(): SessionCostPrices {
      if (!observed) readSection()
      return cached
    },

    refresh(): void {
      readSection()
    },

    async save(prices: SessionCostPrices): Promise<void> {
      // Repair BEFORE validating: a `flat: true` entry without an `idle` column
      // is the retired shape that billed the user's single price at half in
      // off-peak hours (the harness treats the top-level triple as the PEAK
      // column). Repairing here makes that shape unrepresentable in the stored
      // section, whatever wrote it. Reads need no repair: `resolveModelPrice`
      // bills a flat entry's triple in both periods by definition.
      const { prices: repaired } = repairFlatEntries(prices)
      const parsed = parseSessionCostPrices(repaired)
      if (!parsed.ok) throw new Error('invalid prices: ' + parsed.issues.join(' | '))
      // Rejects while `ui-conversation` is unregistered — the caller (the RPC
      // handler) reports it; nothing is cached as if it had been stored.
      await settings.update(CONVERSATION_SETTINGS_NS, { [SESSION_COST_PRICES_FIELD]: parsed.prices })
      // The committed section, not our argument, is authoritative: a schema or
      // a concurrent writer may have shaped it differently.
      if (!readSection()) {
        cached = parsed.prices
        observed = true
      }
    },
  }
}
