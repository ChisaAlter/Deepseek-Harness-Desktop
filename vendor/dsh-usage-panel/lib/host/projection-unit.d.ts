import { applyEvent, initState, type UsagePanelState } from './projection.ts';
export declare const PROJECTION_STATE_VERSION = 2;
export declare const usagePanelProjectionDefinition: {
    key: string;
    stateVersion: number;
    stateSchema: import("zod").ZodObject<{
        totals: import("zod").ZodObject<{
            input: import("zod").ZodNumber;
            output: import("zod").ZodNumber;
            cacheRead: import("zod").ZodNumber;
            cacheWrite: import("zod").ZodNumber;
        }, import("zod/v4/core").$strip>;
        byModel: import("zod").ZodRecord<import("zod").ZodString, import("zod").ZodObject<{
            input: import("zod").ZodNumber;
            output: import("zod").ZodNumber;
            cacheRead: import("zod").ZodNumber;
            cacheWrite: import("zod").ZodNumber;
        }, import("zod/v4/core").$strip>>;
        byDay: import("zod").ZodRecord<import("zod").ZodString, import("zod").ZodRecord<import("zod").ZodString, import("zod").ZodObject<{
            input: import("zod").ZodNumber;
            output: import("zod").ZodNumber;
            cacheRead: import("zod").ZodNumber;
            cacheWrite: import("zod").ZodNumber;
        }, import("zod/v4/core").$strip>>>;
        byProvider: import("zod").ZodRecord<import("zod").ZodString, import("zod").ZodObject<{
            input: import("zod").ZodNumber;
            output: import("zod").ZodNumber;
            cacheRead: import("zod").ZodNumber;
            cacheWrite: import("zod").ZodNumber;
        }, import("zod/v4/core").$strip>>;
        costTotals: import("zod").ZodObject<{
            peak: import("zod").ZodObject<{
                input: import("zod").ZodNumber;
                output: import("zod").ZodNumber;
                cacheRead: import("zod").ZodNumber;
                cacheWrite: import("zod").ZodNumber;
            }, import("zod/v4/core").$strip>;
            offPeak: import("zod").ZodObject<{
                input: import("zod").ZodNumber;
                output: import("zod").ZodNumber;
                cacheRead: import("zod").ZodNumber;
                cacheWrite: import("zod").ZodNumber;
            }, import("zod/v4/core").$strip>;
        }, import("zod/v4/core").$strip>;
        costByModel: import("zod").ZodRecord<import("zod").ZodString, import("zod").ZodObject<{
            peak: import("zod").ZodObject<{
                input: import("zod").ZodNumber;
                output: import("zod").ZodNumber;
                cacheRead: import("zod").ZodNumber;
                cacheWrite: import("zod").ZodNumber;
            }, import("zod/v4/core").$strip>;
            offPeak: import("zod").ZodObject<{
                input: import("zod").ZodNumber;
                output: import("zod").ZodNumber;
                cacheRead: import("zod").ZodNumber;
                cacheWrite: import("zod").ZodNumber;
            }, import("zod/v4/core").$strip>;
        }, import("zod/v4/core").$strip>>;
        costByDay: import("zod").ZodRecord<import("zod").ZodString, import("zod").ZodRecord<import("zod").ZodString, import("zod").ZodObject<{
            peak: import("zod").ZodObject<{
                input: import("zod").ZodNumber;
                output: import("zod").ZodNumber;
                cacheRead: import("zod").ZodNumber;
                cacheWrite: import("zod").ZodNumber;
            }, import("zod/v4/core").$strip>;
            offPeak: import("zod").ZodObject<{
                input: import("zod").ZodNumber;
                output: import("zod").ZodNumber;
                cacheRead: import("zod").ZodNumber;
                cacheWrite: import("zod").ZodNumber;
            }, import("zod/v4/core").$strip>;
        }, import("zod/v4/core").$strip>>>;
        costByProvider: import("zod").ZodRecord<import("zod").ZodString, import("zod").ZodObject<{
            peak: import("zod").ZodObject<{
                input: import("zod").ZodNumber;
                output: import("zod").ZodNumber;
                cacheRead: import("zod").ZodNumber;
                cacheWrite: import("zod").ZodNumber;
            }, import("zod/v4/core").$strip>;
            offPeak: import("zod").ZodObject<{
                input: import("zod").ZodNumber;
                output: import("zod").ZodNumber;
                cacheRead: import("zod").ZodNumber;
                cacheWrite: import("zod").ZodNumber;
            }, import("zod/v4/core").$strip>;
        }, import("zod/v4/core").$strip>>;
        modelProviders: import("zod").ZodRecord<import("zod").ZodString, import("zod").ZodString>;
        retries: import("zod").ZodNumber;
        compactionTokens: import("zod").ZodNumber;
        firstTime: import("zod").ZodNullable<import("zod").ZodNumber>;
        lastTime: import("zod").ZodNullable<import("zod").ZodNumber>;
        seedEnd: import("zod").ZodNullable<import("zod").ZodNumber>;
        currentModel: import("zod").ZodString;
        currentProvider: import("zod").ZodString;
        stepStart: import("zod").ZodNullable<import("zod").ZodObject<{
            turn: import("zod").ZodNumber;
            step: import("zod").ZodNumber;
            ms: import("zod").ZodNumber;
        }, import("zod/v4/core").$strip>>;
        openStep: import("zod").ZodNullable<import("zod").ZodString>;
        steps: import("zod").ZodRecord<import("zod").ZodString, import("zod").ZodObject<{
            buckets: import("zod").ZodObject<{
                input: import("zod").ZodNumber;
                output: import("zod").ZodNumber;
                cacheRead: import("zod").ZodNumber;
                cacheWrite: import("zod").ZodNumber;
            }, import("zod/v4/core").$strip>;
            peak: import("zod").ZodBoolean;
            lastTime: import("zod").ZodNumber;
            model: import("zod").ZodString;
            provider: import("zod").ZodString;
            mode: import("zod").ZodEnum<{
                provisional: "provisional";
                authoritative: "authoritative";
            }>;
        }, import("zod/v4/core").$strip>>;
    }, import("zod/v4/core").$strip>;
    init: typeof initState;
    apply: typeof applyEvent;
    wire: {
        viewSchema: import("zod").ZodObject<{
            totals: import("zod").ZodObject<{
                input: import("zod").ZodNumber;
                output: import("zod").ZodNumber;
                cacheRead: import("zod").ZodNumber;
                cacheWrite: import("zod").ZodNumber;
            }, import("zod/v4/core").$strip>;
            byModel: import("zod").ZodRecord<import("zod").ZodString, import("zod").ZodObject<{
                input: import("zod").ZodNumber;
                output: import("zod").ZodNumber;
                cacheRead: import("zod").ZodNumber;
                cacheWrite: import("zod").ZodNumber;
            }, import("zod/v4/core").$strip>>;
            byDay: import("zod").ZodRecord<import("zod").ZodString, import("zod").ZodRecord<import("zod").ZodString, import("zod").ZodObject<{
                input: import("zod").ZodNumber;
                output: import("zod").ZodNumber;
                cacheRead: import("zod").ZodNumber;
                cacheWrite: import("zod").ZodNumber;
            }, import("zod/v4/core").$strip>>>;
            byProvider: import("zod").ZodRecord<import("zod").ZodString, import("zod").ZodObject<{
                input: import("zod").ZodNumber;
                output: import("zod").ZodNumber;
                cacheRead: import("zod").ZodNumber;
                cacheWrite: import("zod").ZodNumber;
            }, import("zod/v4/core").$strip>>;
            costTotals: import("zod").ZodObject<{
                peak: import("zod").ZodObject<{
                    input: import("zod").ZodNumber;
                    output: import("zod").ZodNumber;
                    cacheRead: import("zod").ZodNumber;
                    cacheWrite: import("zod").ZodNumber;
                }, import("zod/v4/core").$strip>;
                offPeak: import("zod").ZodObject<{
                    input: import("zod").ZodNumber;
                    output: import("zod").ZodNumber;
                    cacheRead: import("zod").ZodNumber;
                    cacheWrite: import("zod").ZodNumber;
                }, import("zod/v4/core").$strip>;
            }, import("zod/v4/core").$strip>;
            costByModel: import("zod").ZodRecord<import("zod").ZodString, import("zod").ZodObject<{
                peak: import("zod").ZodObject<{
                    input: import("zod").ZodNumber;
                    output: import("zod").ZodNumber;
                    cacheRead: import("zod").ZodNumber;
                    cacheWrite: import("zod").ZodNumber;
                }, import("zod/v4/core").$strip>;
                offPeak: import("zod").ZodObject<{
                    input: import("zod").ZodNumber;
                    output: import("zod").ZodNumber;
                    cacheRead: import("zod").ZodNumber;
                    cacheWrite: import("zod").ZodNumber;
                }, import("zod/v4/core").$strip>;
            }, import("zod/v4/core").$strip>>;
            costByDay: import("zod").ZodRecord<import("zod").ZodString, import("zod").ZodRecord<import("zod").ZodString, import("zod").ZodObject<{
                peak: import("zod").ZodObject<{
                    input: import("zod").ZodNumber;
                    output: import("zod").ZodNumber;
                    cacheRead: import("zod").ZodNumber;
                    cacheWrite: import("zod").ZodNumber;
                }, import("zod/v4/core").$strip>;
                offPeak: import("zod").ZodObject<{
                    input: import("zod").ZodNumber;
                    output: import("zod").ZodNumber;
                    cacheRead: import("zod").ZodNumber;
                    cacheWrite: import("zod").ZodNumber;
                }, import("zod/v4/core").$strip>;
            }, import("zod/v4/core").$strip>>>;
            costByProvider: import("zod").ZodRecord<import("zod").ZodString, import("zod").ZodObject<{
                peak: import("zod").ZodObject<{
                    input: import("zod").ZodNumber;
                    output: import("zod").ZodNumber;
                    cacheRead: import("zod").ZodNumber;
                    cacheWrite: import("zod").ZodNumber;
                }, import("zod/v4/core").$strip>;
                offPeak: import("zod").ZodObject<{
                    input: import("zod").ZodNumber;
                    output: import("zod").ZodNumber;
                    cacheRead: import("zod").ZodNumber;
                    cacheWrite: import("zod").ZodNumber;
                }, import("zod/v4/core").$strip>;
            }, import("zod/v4/core").$strip>>;
            modelProviders: import("zod").ZodRecord<import("zod").ZodString, import("zod").ZodString>;
            retries: import("zod").ZodNumber;
            compactionTokens: import("zod").ZodNumber;
            firstTime: import("zod").ZodNullable<import("zod").ZodNumber>;
            lastTime: import("zod").ZodNullable<import("zod").ZodNumber>;
            seedEnd: import("zod").ZodNullable<import("zod").ZodNumber>;
            currentModel: import("zod").ZodString;
            currentProvider: import("zod").ZodString;
            stepStart: import("zod").ZodNullable<import("zod").ZodObject<{
                turn: import("zod").ZodNumber;
                step: import("zod").ZodNumber;
                ms: import("zod").ZodNumber;
            }, import("zod/v4/core").$strip>>;
            openStep: import("zod").ZodNullable<import("zod").ZodString>;
            steps: import("zod").ZodRecord<import("zod").ZodString, import("zod").ZodObject<{
                buckets: import("zod").ZodObject<{
                    input: import("zod").ZodNumber;
                    output: import("zod").ZodNumber;
                    cacheRead: import("zod").ZodNumber;
                    cacheWrite: import("zod").ZodNumber;
                }, import("zod/v4/core").$strip>;
                peak: import("zod").ZodBoolean;
                lastTime: import("zod").ZodNumber;
                model: import("zod").ZodString;
                provider: import("zod").ZodString;
                mode: import("zod").ZodEnum<{
                    provisional: "provisional";
                    authoritative: "authoritative";
                }>;
            }, import("zod/v4/core").$strip>>;
        }, import("zod/v4/core").$strip>;
        view: (state: UsagePanelState) => {
            totals: {
                input: number;
                output: number;
                cacheRead: number;
                cacheWrite: number;
            };
            byModel: Record<string, {
                input: number;
                output: number;
                cacheRead: number;
                cacheWrite: number;
            }>;
            byDay: Record<string, Record<string, {
                input: number;
                output: number;
                cacheRead: number;
                cacheWrite: number;
            }>>;
            byProvider: Record<string, {
                input: number;
                output: number;
                cacheRead: number;
                cacheWrite: number;
            }>;
            costTotals: {
                peak: {
                    input: number;
                    output: number;
                    cacheRead: number;
                    cacheWrite: number;
                };
                offPeak: {
                    input: number;
                    output: number;
                    cacheRead: number;
                    cacheWrite: number;
                };
            };
            costByModel: Record<string, {
                peak: {
                    input: number;
                    output: number;
                    cacheRead: number;
                    cacheWrite: number;
                };
                offPeak: {
                    input: number;
                    output: number;
                    cacheRead: number;
                    cacheWrite: number;
                };
            }>;
            costByDay: Record<string, Record<string, {
                peak: {
                    input: number;
                    output: number;
                    cacheRead: number;
                    cacheWrite: number;
                };
                offPeak: {
                    input: number;
                    output: number;
                    cacheRead: number;
                    cacheWrite: number;
                };
            }>>;
            costByProvider: Record<string, {
                peak: {
                    input: number;
                    output: number;
                    cacheRead: number;
                    cacheWrite: number;
                };
                offPeak: {
                    input: number;
                    output: number;
                    cacheRead: number;
                    cacheWrite: number;
                };
            }>;
            modelProviders: Record<string, string>;
            retries: number;
            compactionTokens: number;
            firstTime: number | null;
            lastTime: number | null;
            seedEnd: number | null;
            currentModel: string;
            currentProvider: string;
            stepStart: {
                turn: number;
                step: number;
                ms: number;
            } | null;
            openStep: string | null;
            steps: Record<string, {
                buckets: {
                    input: number;
                    output: number;
                    cacheRead: number;
                    cacheWrite: number;
                };
                peak: boolean;
                lastTime: number;
                model: string;
                provider: string;
                mode: "provisional" | "authoritative";
            }>;
        };
    };
};
