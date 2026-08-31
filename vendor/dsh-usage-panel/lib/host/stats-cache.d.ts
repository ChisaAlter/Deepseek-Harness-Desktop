import type { Overview } from '../shared/contract.ts';
export interface StatsWatermark {
    /** Corpus shape: session-record count + latest event time (coverage fields). */
    sessionsTotal: number;
    to: number | null;
}
export declare function statsCacheKey(watermark: StatsWatermark): string;
export interface StatsCache {
    get(key: string): Promise<Overview | null>;
    put(key: string, payload: Overview): Promise<void>;
    /** Session watermark ledger (persistent delta baseline). */
    ledgerGet(sessionId: string): Promise<number | null>;
    ledgerPut(sessionId: string, asOfSeq: number): Promise<void>;
    ledgerDelete(sessionId: string): Promise<void>;
    ledgerClear(): Promise<void>;
    ledgerCount(): Promise<number>;
    close(): void;
}
export interface StatsCache {
    get(key: string): Promise<Overview | null>;
    put(key: string, payload: Overview): Promise<void>;
    /** Session watermark ledger (persistent delta baseline). */
    ledgerGet(sessionId: string): Promise<number | null>;
    ledgerPut(sessionId: string, asOfSeq: number): Promise<void>;
    ledgerDelete(sessionId: string): Promise<void>;
    ledgerClear(): Promise<void>;
    ledgerCount(): Promise<number>;
    close(): void;
}
/**
 * Open the stats cache. `home` is the harness root; the db lands directly
 * under `<home>/dsh-usage-panel.sqlite` (the DSH home, per requirement).
 * Returns null when node:sqlite is unavailable — callers fall back to a
 * memory-only session.
 */
export declare function openStatsCache(home: string, warn: (message: string) => void): Promise<StatsCache | null>;
