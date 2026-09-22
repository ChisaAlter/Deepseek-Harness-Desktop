import { z } from 'zod';
import type { SessionEvent } from '@deepseek-ai/dsh-session';
import type { PhaseBuckets } from '../shared/cost.ts';
declare const bucketSchema: z.ZodObject<{
    input: z.ZodNumber;
    output: z.ZodNumber;
    cacheRead: z.ZodNumber;
    cacheWrite: z.ZodNumber;
}, z.core.$strip>;
declare const stepSchema: z.ZodObject<{
    buckets: z.ZodObject<{
        input: z.ZodNumber;
        output: z.ZodNumber;
        cacheRead: z.ZodNumber;
        cacheWrite: z.ZodNumber;
    }, z.core.$strip>;
    peak: z.ZodBoolean;
    lastTime: z.ZodNumber;
    model: z.ZodString;
    provider: z.ZodString;
    mode: z.ZodEnum<{
        provisional: "provisional";
        authoritative: "authoritative";
    }>;
}, z.core.$strip>;
export declare const usagePanelSchema: z.ZodObject<{
    totals: z.ZodObject<{
        input: z.ZodNumber;
        output: z.ZodNumber;
        cacheRead: z.ZodNumber;
        cacheWrite: z.ZodNumber;
    }, z.core.$strip>;
    byModel: z.ZodRecord<z.ZodString, z.ZodObject<{
        input: z.ZodNumber;
        output: z.ZodNumber;
        cacheRead: z.ZodNumber;
        cacheWrite: z.ZodNumber;
    }, z.core.$strip>>;
    byDay: z.ZodRecord<z.ZodString, z.ZodRecord<z.ZodString, z.ZodObject<{
        input: z.ZodNumber;
        output: z.ZodNumber;
        cacheRead: z.ZodNumber;
        cacheWrite: z.ZodNumber;
    }, z.core.$strip>>>;
    byProvider: z.ZodRecord<z.ZodString, z.ZodObject<{
        input: z.ZodNumber;
        output: z.ZodNumber;
        cacheRead: z.ZodNumber;
        cacheWrite: z.ZodNumber;
    }, z.core.$strip>>;
    costTotals: z.ZodObject<{
        peak: z.ZodObject<{
            input: z.ZodNumber;
            output: z.ZodNumber;
            cacheRead: z.ZodNumber;
            cacheWrite: z.ZodNumber;
        }, z.core.$strip>;
        offPeak: z.ZodObject<{
            input: z.ZodNumber;
            output: z.ZodNumber;
            cacheRead: z.ZodNumber;
            cacheWrite: z.ZodNumber;
        }, z.core.$strip>;
    }, z.core.$strip>;
    costByModel: z.ZodRecord<z.ZodString, z.ZodObject<{
        peak: z.ZodObject<{
            input: z.ZodNumber;
            output: z.ZodNumber;
            cacheRead: z.ZodNumber;
            cacheWrite: z.ZodNumber;
        }, z.core.$strip>;
        offPeak: z.ZodObject<{
            input: z.ZodNumber;
            output: z.ZodNumber;
            cacheRead: z.ZodNumber;
            cacheWrite: z.ZodNumber;
        }, z.core.$strip>;
    }, z.core.$strip>>;
    costByDay: z.ZodRecord<z.ZodString, z.ZodRecord<z.ZodString, z.ZodObject<{
        peak: z.ZodObject<{
            input: z.ZodNumber;
            output: z.ZodNumber;
            cacheRead: z.ZodNumber;
            cacheWrite: z.ZodNumber;
        }, z.core.$strip>;
        offPeak: z.ZodObject<{
            input: z.ZodNumber;
            output: z.ZodNumber;
            cacheRead: z.ZodNumber;
            cacheWrite: z.ZodNumber;
        }, z.core.$strip>;
    }, z.core.$strip>>>;
    costByProvider: z.ZodRecord<z.ZodString, z.ZodObject<{
        peak: z.ZodObject<{
            input: z.ZodNumber;
            output: z.ZodNumber;
            cacheRead: z.ZodNumber;
            cacheWrite: z.ZodNumber;
        }, z.core.$strip>;
        offPeak: z.ZodObject<{
            input: z.ZodNumber;
            output: z.ZodNumber;
            cacheRead: z.ZodNumber;
            cacheWrite: z.ZodNumber;
        }, z.core.$strip>;
    }, z.core.$strip>>;
    modelProviders: z.ZodRecord<z.ZodString, z.ZodString>;
    retries: z.ZodNumber;
    compactionTokens: z.ZodNumber;
    firstTime: z.ZodNullable<z.ZodNumber>;
    lastTime: z.ZodNullable<z.ZodNumber>;
    seedEnd: z.ZodNullable<z.ZodNumber>;
    currentModel: z.ZodString;
    currentProvider: z.ZodString;
    stepStart: z.ZodNullable<z.ZodObject<{
        turn: z.ZodNumber;
        step: z.ZodNumber;
        ms: z.ZodNumber;
    }, z.core.$strip>>;
    openStep: z.ZodNullable<z.ZodString>;
    steps: z.ZodRecord<z.ZodString, z.ZodObject<{
        buckets: z.ZodObject<{
            input: z.ZodNumber;
            output: z.ZodNumber;
            cacheRead: z.ZodNumber;
            cacheWrite: z.ZodNumber;
        }, z.core.$strip>;
        peak: z.ZodBoolean;
        lastTime: z.ZodNumber;
        model: z.ZodString;
        provider: z.ZodString;
        mode: z.ZodEnum<{
            provisional: "provisional";
            authoritative: "authoritative";
        }>;
    }, z.core.$strip>>;
}, z.core.$strip>;
export type Buckets = z.infer<typeof bucketSchema>;
export type StepState = z.infer<typeof stepSchema>;
export type UsagePanelState = z.infer<typeof usagePanelSchema>;
export declare const USAGE_PANEL_KEY = "usagePanel";
declare module '@deepseek-ai/dsh-session-projection/types' {
    interface SessionProjectionMap {
        usagePanel: UsagePanelState;
    }
    interface SessionProjectionStateMap {
        usagePanel: UsagePanelState;
    }
}
export declare function initState(): UsagePanelState;
/**
 * Pure transition: previous state + one committed session event → next state.
 * Returns the SAME reference for unrelated events (zero downstream work, per
 * the registry contract). State is plain JSON (persisted-cache precondition).
 */
export declare function applyEvent(state: UsagePanelState, event: SessionEvent): UsagePanelState;
/**
 * Fold a full event list from init (cold read path / tests). Two-pass: the
 * LAST session/end-seed marker in stored history is the seed boundary
 * (doc: "Locate the LAST one in stored history"), so it is located first and
 * preset — a single forward pass would count seed events that precede the
 * marker. The registry's own lazy cold fold is single-pass (init + apply),
 * where the unit self-arms: nothing is counted until a marker has been seen.
 */
export declare function foldEvents(events: readonly SessionEvent[]): UsagePanelState;
/** Sum a session's day buckets whose key >= cutoffKey (recent-30d window). */
export declare function recentOf(value: UsagePanelState, cutoffKey: string): {
    totals: Buckets;
    byModel: Record<string, Buckets>;
    costByModel: Record<string, PhaseBuckets>;
};
export {};
