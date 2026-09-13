import { z } from 'zod';
import { type BillingSettings } from '../shared/contract.ts';
/** Domain name (UNIT_NAME_RE: lowercase letters/digits/underscores only). */
export declare const BILLING_DOMAIN_NAME = "dsh_usage_panel_billing";
export declare const BILLING_DOMAIN_VERSION = 1;
/** Structural record schema at the durable boundary (semantic checks re-run on load). */
export declare const billingGlobalSchema: z.ZodObject<{
    prices: z.ZodRecord<z.ZodString, z.ZodObject<{
        inputCacheHit: z.ZodNumber;
        inputCacheMiss: z.ZodNumber;
        output: z.ZodNumber;
        idle: z.ZodOptional<z.ZodObject<{
            inputCacheHit: z.ZodNumber;
            inputCacheMiss: z.ZodNumber;
            output: z.ZodNumber;
        }, z.core.$strip>>;
        flat: z.ZodOptional<z.ZodBoolean>;
    }, z.core.$strip>>;
    stripVisible: z.ZodOptional<z.ZodBoolean>;
    peakHintVisible: z.ZodOptional<z.ZodBoolean>;
    peakValleyEnabled: z.ZodBoolean;
}, z.core.$strip>;
/** The durable face the store talks to: the domain global handle. */
export interface BillingMedium {
    get(): unknown;
    set(value: unknown): Promise<void>;
}
export type BillingStoreMode = 'durable' | 'memory';
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
export declare class BillingStore {
    private readonly warn;
    private cache;
    private medium;
    mode: BillingStoreMode;
    constructor(medium: BillingMedium | undefined, warn: (message: string) => void);
    /** Attach the durable medium after the async domain open (upgrades the mode). */
    attachMedium(medium: BillingMedium): void;
    /** Read the current record (cached per process; first read materializes). */
    load(): Promise<BillingSettings>;
    /**
     * Drop this domain's prices after they have been merged into the surviving
     * record. The record itself stays schema-valid (`prices: {}`); the legacy
     * fields of the retired composer strip are gone with it.
     */
    clearPrices(): Promise<void>;
    private fromRaw;
}
/** Open the legacy domain over the facility; returns undefined (memory mode) on any failure. */
export declare function openBillingMedium(storageDomain: {
    open(spec: object): Promise<{
        global: BillingMedium;
    }>;
} | undefined, warn: (message: string) => void): Promise<BillingMedium | undefined>;
