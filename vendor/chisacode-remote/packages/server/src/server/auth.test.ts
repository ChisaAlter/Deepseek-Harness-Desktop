import { describe, expect, test } from "vitest";

import {
  extractHttpBearerToken,
  extractWsBearerProtocol,
  extractWsBearerToken,
  hashDaemonPassword,
  isBearerTokenValidAsync,
  isBearerTokenValid,
  shouldBypassBearerAuth,
} from "./auth.js";

const CORRECT_PASSWORD_HASH = "$2b$12$OLxyuuP9uLK30Uzc4wQX0O6liuU/Q1t5P2b0Ebf36mULvpVK3DRZW";

describe("daemon bearer validator", () => {
  test("allows any token when no password is configured", () => {
    expect(isBearerTokenValid({ password: undefined, token: null })).toBe(true);
    expect(isBearerTokenValid({ password: undefined, token: "anything" })).toBe(true);
  });

  test("accepts the plaintext token against the bcrypt hash and rejects missing or wrong tokens", async () => {
    expect(
      await isBearerTokenValidAsync({ password: CORRECT_PASSWORD_HASH, token: "correct-password" }),
    ).toBe(true);
    expect(isBearerTokenValid({ password: CORRECT_PASSWORD_HASH, token: "correct-password" })).toBe(
      true,
    );
    expect(await isBearerTokenValidAsync({ password: CORRECT_PASSWORD_HASH, token: null })).toBe(
      false,
    );
    expect(await isBearerTokenValidAsync({ password: CORRECT_PASSWORD_HASH, token: "wrong" })).toBe(
      false,
    );
  });

  test("hashes a password into a bcrypt value", () => {
    const hash = hashDaemonPassword("correct-password");

    expect(hash).toMatch(/^\$2[aby]\$12\$/);
    expect(isBearerTokenValid({ password: hash, token: "correct-password" })).toBe(true);
  });

  test("extracts HTTP bearer tokens", () => {
    expect(extractHttpBearerToken("Bearer secret")).toBe("secret");
    expect(extractHttpBearerToken("Basic secret")).toBeNull();
    expect(extractHttpBearerToken(undefined)).toBeNull();
  });

  test("extracts WebSocket chisacode bearer subprotocol tokens", () => {
    const protocol = extractWsBearerProtocol("chat, chisacode.bearer.secret.with.dots");

    expect(protocol).toBe("chisacode.bearer.secret.with.dots");
    expect(extractWsBearerToken(protocol)).toBe("secret.with.dots");
    expect(extractWsBearerToken("chisacode.other.secret")).toBeNull();
  });

  test("rejects empty or over-long WebSocket bearer tokens without burning bcrypt", () => {
    // `chisacode.bearer.` (empty token segment) must return null so a peer
    // cannot spam subprotocol headers to amplify bcrypt CPU cost.
    expect(extractWsBearerToken("chisacode.bearer.")).toBeNull();
    // Over-long tokens (> 1024 chars) are rejected before bcrypt compare.
    const overLong = `chisacode.bearer.${"a".repeat(1025)}`;
    expect(extractWsBearerToken(overLong)).toBeNull();
    // A legitimate 1024-char token is still accepted.
    const bounded = `chisacode.bearer.${"a".repeat(1024)}`;
    expect(extractWsBearerToken(bounded)).toHaveLength(1024);
  });

  test("bypasses bearer auth on protected route prefixes too", () => {
    // Exact paths bypass.
    expect(shouldBypassBearerAuth("GET", "/api/health")).toBe(true);
    expect(shouldBypassBearerAuth("GET", "/api/source")).toBe(true);
    // Sub-paths bypass via prefix match, not just exact equality.
    expect(shouldBypassBearerAuth("GET", "/api/health/section")).toBe(true);
    expect(shouldBypassBearerAuth("GET", "/api/source/extra")).toBe(true);
    // Other paths require auth.
    expect(shouldBypassBearerAuth("GET", "/api/agents")).toBe(false);
    expect(shouldBypassBearerAuth("GET", "/api/healthother")).toBe(false);
    // OPTIONS always bypasses (CORS preflight).
    expect(shouldBypassBearerAuth("OPTIONS", "/api/agents")).toBe(true);
  });
});
