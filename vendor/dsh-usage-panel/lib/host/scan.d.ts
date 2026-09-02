import type { SessionQueryEngine } from '@deepseek-ai/dsh-session-query';
import type { Overview } from '../shared/contract.ts';
import { type SessionAgg } from './aggregate.ts';
export interface ScanFallbackDeps {
    sq: SessionQueryEngine;
    providerNames: Record<string, string>;
    logFailure: (message: string) => void;
    /** Receive the full ranked session index for the paging endpoints. */
    storeIndex: (sessions: SessionAgg[]) => void;
    /** Receive the failed-session ids (repair candidates). */
    storeFailed: (ids: string[]) => void;
}
export declare function scanFallback(deps: ScanFallbackDeps, now: number): Promise<Overview>;
