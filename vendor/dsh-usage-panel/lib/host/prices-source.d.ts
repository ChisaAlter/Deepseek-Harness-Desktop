import type { SessionCostPrices } from '../shared/pricing.ts';
import type { HostSettings } from './types.ts';
/** Settings namespace owned by the harness conversation plugin. */
export declare const CONVERSATION_SETTINGS_NS = "ui-conversation";
/** Field of that namespace carrying the user's per-model prices. */
export declare const SESSION_COST_PRICES_FIELD = "sessionCostPrices";
/** The plugin's price access: a synchronous snapshot plus the section write path. */
export interface PricesSource {
    /** Current prices; the first call reads the section, later calls serve the cache. */
    snapshot(): SessionCostPrices;
    /** Persist prices into the conversation section; rejects while it is unregistered. */
    save(prices: SessionCostPrices): Promise<void>;
    /** Adopt the resolved value carried by a `settings/updated` commit event. */
    adoptSection(section: unknown): void;
    /** Whether the conversation section exists (the precondition of every write). */
    isSectionRegistered(): boolean;
}
/**
 * Build the price access over the settings service.
 * @param settings - the `ctx.settings` face.
 * @param warn - sink for the validation and read warnings (the plugin's `tag` logger).
 * @returns the price access; every method is total except `save`, which rejects.
 */
export declare function createPricesSource(settings: HostSettings, warn: (message: string) => void): PricesSource;
