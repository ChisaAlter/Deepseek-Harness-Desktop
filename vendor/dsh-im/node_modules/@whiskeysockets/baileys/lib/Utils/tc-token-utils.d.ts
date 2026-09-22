import type { SignalKeyStoreWithTransaction } from '../Types/index.js';
import type { BinaryNode } from '../WABinary/index.js';
/** Sentinel key under `tctoken` store holding a JSON array of tracked storage JIDs for cross-session pruning. */
export declare const TC_TOKEN_INDEX_KEY = "__index";
/** Read the persisted tctoken JID index and return its entries (never contains the sentinel key itself). */
export declare function readTcTokenIndex(keys: SignalKeyStoreWithTransaction): Promise<string[]>;
/** Build a SignalDataSet fragment that writes the merged index (persisted ∪ added) under the sentinel key. */
export declare function buildMergedTcTokenIndexWrite(keys: SignalKeyStoreWithTransaction, addedJids: Iterable<string>): Promise<{
    [TC_TOKEN_INDEX_KEY]: {
        token: Buffer;
    };
}>;
export declare function isTcTokenExpired(timestamp: number | string | null | undefined): boolean;
export declare function shouldSendNewTcToken(senderTimestamp: number | undefined): boolean;
/** Resolve JID to LID for tctoken storage (WA Web stores under LID) */
export declare function resolveTcTokenJid(jid: string, getLIDForPN: (pn: string) => Promise<string | null>): Promise<string>;
/** Resolve target JID for issuing privacy token based on AB prop 14303 */
export declare function resolveIssuanceJid(jid: string, issueToLid: boolean, getLIDForPN: (pn: string) => Promise<string | null>, getPNForLID?: (lid: string) => Promise<string | null>): Promise<string>;
type TcTokenParams = {
    jid: string;
    baseContent?: BinaryNode[];
    authState: {
        keys: SignalKeyStoreWithTransaction;
    };
    getLIDForPN: (pn: string) => Promise<string | null>;
};
export declare function buildTcTokenFromJid({ authState, jid, baseContent, getLIDForPN }: TcTokenParams): Promise<BinaryNode[] | undefined>;
type StoreTcTokensParams = {
    result: BinaryNode;
    fallbackJid: string;
    keys: SignalKeyStoreWithTransaction;
    getLIDForPN: (pn: string) => Promise<string | null>;
    onNewJidStored?: (jid: string) => void;
};
export declare function storeTcTokensFromIqResult({ result, fallbackJid, keys, getLIDForPN, onNewJidStored }: StoreTcTokensParams): Promise<void>;
export {};
//# sourceMappingURL=tc-token-utils.d.ts.map