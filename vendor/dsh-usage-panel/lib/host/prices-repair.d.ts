import type { PricesSource } from './prices-source.ts';
export interface PricesRepairDeps {
    /** The same access the RPC write path uses; `save` repairs again on the way out. */
    prices: PricesSource;
    /** Warning sink (the plugin's `tag` logger). */
    warn: (message: string) => void;
    /** Informational sink for the completed repair. */
    log: (message: string) => void;
}
export interface PricesRepair {
    /** Repair when the preconditions hold; never rejects, never throws. */
    attempt(): Promise<void>;
    /** Whether the repair completed (or found nothing to do) in this process. */
    isDone(): boolean;
}
/**
 * Build the one-time flat-record repair.
 * @param deps - the price access and its log sinks.
 * @returns the runner; `attempt()` is safe to call from the RPC path.
 */
export declare function createPricesRepair(deps: PricesRepairDeps): PricesRepair;
