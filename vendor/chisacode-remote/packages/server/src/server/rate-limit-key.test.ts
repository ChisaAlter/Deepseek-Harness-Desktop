import type express from "express";
import { afterEach, describe, expect, test, vi } from "vitest";

import { isTrustForwardHeadersEnabled, rateLimitKey } from "./bootstrap.js";

describe("rate limit key selection", () => {
  const originalEnv = process.env.CHISACODE_TRUST_FORWARD_HEADERS;

  afterEach(() => {
    process.env.CHISACODE_TRUST_FORWARD_HEADERS = originalEnv;
    vi.restoreAllMocks();
  });

  function mockReq(headers: Record<string, string> = {}): express.Request {
    // Minimal stub satisfying the fields rateLimitKey actually reads.
    return {
      headers,
      ip: "127.0.0.1",
      socket: { remoteAddress: "127.0.0.1" },
    } as unknown as express.Request;
  }

  test("ignores client-supplied X-Forwarded-For by default (direct daemon)", () => {
    delete process.env.CHISACODE_TRUST_FORWARD_HEADERS;
    expect(isTrustForwardHeadersEnabled()).toBe(false);

    // A peer rotating XFF cannot forge fresh buckets — the socket address wins.
    const req = mockReq({ "x-forwarded-for": "203.0.113.7" });
    expect(rateLimitKey(req)).toBe("127.0.0.1");
  });

  test("honors X-Forwarded-For when opt-in flag is set (reverse proxy deployment)", () => {
    process.env.CHISACODE_TRUST_FORWARD_HEADERS = "1";
    expect(isTrustForwardHeadersEnabled()).toBe(true);

    const req = mockReq({ "x-forwarded-for": "203.0.113.7, 10.0.0.1" });
    // First XFF segment (trimmed) is the client identity under a trusted proxy.
    expect(rateLimitKey(req)).toBe("203.0.113.7");
  });

  test("falls back to socket address when XFF is absent even under opt-in", () => {
    process.env.CHISACODE_TRUST_FORWARD_HEADERS = "1";
    const req = mockReq({});
    expect(rateLimitKey(req)).toBe("127.0.0.1");
  });
});
