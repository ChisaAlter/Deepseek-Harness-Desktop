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
 * Billing-preferences store. `save` is replace-whole (the record is small;
 * the client edits one object). Load runs the shared semantic validator on
 * the prices: a record that fails validation is treated as default (logged),
 * never half-applied. Starts in memory mode; the domain can attach later
 * (`attachMedium`) without losing a save made meanwhile.
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
    /** Replace the whole record (validated; throws with the issues on refusal). */
    save(settings: BillingSettings): Promise<BillingSettings>;
    private fromRaw;
    private toRaw;
}
/** Open the billing domain over the facility; returns undefined (memory mode) on any failure. */
export declare function openBillingMedium(storageDomain: {
    open(spec: object): Promise<{
        global: BillingMedium;
    }>;
} | undefined, warn: (message: string) => void): Promise<BillingMedium | undefined>;
