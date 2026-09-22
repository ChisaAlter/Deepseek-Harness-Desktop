import { type BillingStoreMode } from './billing-store.ts';
import type { BillingSettings } from '../shared/contract.ts';
import type { SessionCostPrices } from '../shared/pricing.ts';
import type { PricesSource } from './prices-source.ts';
/**
 * Merge the retired record's prices into the conversation section's prices.
 * The SECTION wins on conflicts: a model the user already priced there keeps
 * that price, and only legacy-only keys are adopted.
 * @param legacy - prices read from the retired `dsh_usage_panel_billing` domain.
 * @param section - prices currently in `ui-conversation.sessionCostPrices`.
 * @returns the merged record (section keys first, then adopted legacy keys) and
 *   the legacy-only keys that were adopted.
 */
export declare function mergeLegacyPrices(legacy: SessionCostPrices, section: SessionCostPrices): {
    prices: SessionCostPrices;
    imported: string[];
};
/** The legacy reader the import needs (BillingStore satisfies this structurally). */
export interface LegacyPriceReader {
    /** `memory` until the storage domain attaches; the import refuses to read then. */
    readonly mode: BillingStoreMode;
    load(): Promise<BillingSettings>;
    /** Drop this domain's prices after they reached the surviving record. */
    clearPrices(): Promise<void>;
}
export interface LegacyImportDeps {
    store: LegacyPriceReader;
    prices: PricesSource;
    /** Warning sink (the plugin's `tag` logger). */
    warn: (message: string) => void;
    /** Informational sink for the completed import. */
    log: (message: string) => void;
}
export interface LegacyBillingImport {
    /** Run the import when its preconditions hold; never rejects, never throws. */
    attempt(): Promise<void>;
    /** Whether the import completed in this process. */
    isDone(): boolean;
}
/**
 * Build the one-time import.
 * @param deps - the legacy reader, the price access, and the log sinks.
 * @returns the runner; `attempt()` is safe to call from the RPC path.
 */
export declare function createLegacyBillingImport(deps: LegacyImportDeps): LegacyBillingImport;
