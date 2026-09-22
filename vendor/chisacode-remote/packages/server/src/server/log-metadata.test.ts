import { describe, expect, test } from "vitest";
import { summarizeUntrustedLogIdentifier } from "./log-metadata.js";

describe("summarizeUntrustedLogIdentifier", () => {
  test("returns a bounded deterministic summary without raw or control-character content", () => {
    const secret = `TASK10-LOG-SECRET\n\u0000${"x".repeat(100_000)}`;

    const first = summarizeUntrustedLogIdentifier(secret);
    const second = summarizeUntrustedLogIdentifier(secret);

    expect(first).toEqual(second);
    expect(first).toEqual({
      length: secret.length,
      fingerprint: expect.stringMatching(/^[a-f0-9]{16}$/),
    });
    expect(JSON.stringify(first)).not.toContain("TASK10-LOG-SECRET");
    expect(JSON.stringify(first).length).toBeLessThan(100);
  });

  test("hashes the complete UTF-8 identifier instead of only a shared prefix", () => {
    const prefix = "同".repeat(256);
    const first = `${prefix}suffix-a`;
    const second = `${prefix}suffix-b`;

    expect(first.length).toBe(second.length);
    expect(summarizeUntrustedLogIdentifier(first).fingerprint).not.toBe(
      summarizeUntrustedLogIdentifier(second).fingerprint,
    );
  });
});
