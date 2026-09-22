import { createHash } from "node:crypto";

export interface UntrustedLogIdentifierSummary {
  length: number;
  fingerprint: string;
}

/**
 * Summarizes an untrusted identifier without retaining raw text or control characters.
 * @param value Untrusted identifier to summarize
 * @returns Fixed-size length and fingerprint metadata
 */
export function summarizeUntrustedLogIdentifier(value: string): UntrustedLogIdentifierSummary {
  const fingerprint = createHash("sha256").update(value, "utf8").digest("hex").slice(0, 16);
  return { length: value.length, fingerprint };
}
