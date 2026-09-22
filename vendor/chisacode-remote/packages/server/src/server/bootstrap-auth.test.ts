import { WebSocket } from "ws";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { assertWildcardAuth, parseListenString } from "./bootstrap.js";
import { createTestChisaCodeDaemon } from "./test-utils/chisacode-daemon.js";

const originalEnv = { ...process.env };
const CORRECT_PASSWORD_HASH = "$2b$12$OLxyuuP9uLK30Uzc4wQX0O6liuU/Q1t5P2b0Ebf36mULvpVK3DRZW";

function connectWebSocket(params: {
  port: number;
  protocol?: string;
}): Promise<{ ws: WebSocket; protocol: string }> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(
      `ws://127.0.0.1:${params.port}/ws`,
      params.protocol ? [params.protocol] : undefined,
    );
    ws.once("open", () => resolve({ ws, protocol: ws.protocol }));
    ws.once("error", reject);
  });
}

async function expectWebSocketCloses(params: {
  port: number;
  protocol?: string;
  code: number;
  reason: string;
}): Promise<void> {
  const { ws } = await connectWebSocket(params);
  await expect(
    new Promise<{ code: number; reason: string }>((resolve) => {
      ws.once("close", (code, reason) => {
        resolve({ code, reason: reason.toString() });
      });
    }),
  ).resolves.toEqual({
    code: params.code,
    reason: params.reason,
  });
}

describe("daemon bearer auth", () => {
  beforeEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    process.env = { ...originalEnv, CHISACODE_SUPERVISED: "0" };
  });

  test("leaves HTTP and WebSocket open when no password is configured", async () => {
    const daemonHandle = await createTestChisaCodeDaemon();
    try {
      const response = await fetch(`http://127.0.0.1:${daemonHandle.port}/api/status`);
      expect(response.status).toBe(200);

      const { ws, protocol } = await connectWebSocket({ port: daemonHandle.port });
      expect(protocol).toBe("");
      ws.close();
    } finally {
      await daemonHandle.close();
    }
  });

  test("requires Authorization bearer on protected HTTP routes when password is configured", async () => {
    const daemonHandle = await createTestChisaCodeDaemon({
      auth: { password: CORRECT_PASSWORD_HASH },
    });
    try {
      const missing = await fetch(`http://127.0.0.1:${daemonHandle.port}/api/files/download`);
      expect(missing.status).toBe(401);

      const wrong = await fetch(`http://127.0.0.1:${daemonHandle.port}/api/files/download`, {
        headers: { Authorization: "Bearer wrong-password" },
      });
      expect(wrong.status).toBe(401);

      const correct = await fetch(`http://127.0.0.1:${daemonHandle.port}/api/files/download`, {
        headers: { Authorization: "Bearer correct-password" },
      });
      expect(correct.status).toBe(400);
    } finally {
      await daemonHandle.close();
    }
  });

  test("bypasses bearer auth for preflight and liveness endpoints", async () => {
    const daemonHandle = await createTestChisaCodeDaemon({
      auth: { password: CORRECT_PASSWORD_HASH },
    });
    try {
      const preflight = await fetch(`http://127.0.0.1:${daemonHandle.port}/api/files/download`, {
        method: "OPTIONS",
        headers: { Origin: "https://app.chisacode.sh" },
      });
      expect(preflight.status).toBe(204);

      const health = await fetch(`http://127.0.0.1:${daemonHandle.port}/api/health`);
      expect(health.status).toBe(200);

      const source = await fetch(`http://127.0.0.1:${daemonHandle.port}/api/source`);
      expect(source.status).toBe(200);
      await expect(source.json()).resolves.toMatchObject({
        status: "source_info",
        license: "AGPL-3.0-or-later",
        repositoryUrl: "https://github.com/ChisaAlter/ChisaCode",
        originalProjectUrl: "https://github.com/getpaseo/paseo",
        correspondingSourceRequired: true,
      });

      const status = await fetch(`http://127.0.0.1:${daemonHandle.port}/api/status`);
      expect(status.status).toBe(401);
    } finally {
      await daemonHandle.close();
    }
  });

  test("closes WebSocket connections with readable auth failures when password is configured", async () => {
    const daemonHandle = await createTestChisaCodeDaemon({
      auth: { password: CORRECT_PASSWORD_HASH },
    });
    try {
      await expectWebSocketCloses({
        port: daemonHandle.port,
        code: 4401,
        reason: "Password required",
      });
      await expectWebSocketCloses({
        port: daemonHandle.port,
        protocol: "chisacode.bearer.wrong-password",
        code: 4401,
        reason: "Incorrect password",
      });

      const { ws, protocol } = await connectWebSocket({
        port: daemonHandle.port,
        protocol: "chisacode.bearer.correct-password",
      });
      expect(protocol).toBe("chisacode.bearer.correct-password");
      ws.close();
    } finally {
      await daemonHandle.close();
    }
  });
});

describe("assertWildcardAuth", () => {
  // Use parseListenString for formats it supports, and construct ListenTarget
  // directly for IPv6 (parseListenString's host:port split does not handle
  // bracketed IPv6 addresses).
  //
  // History: 95400d5bf introduced fail-closed semantics; d1dcd2d3c weakened
  // them to warn-only (root cause A/D). These tests restore fail-closed as the
  // default and verify the CHISACODE_ALLOW_WILDCARD_NO_AUTH opt-in escape hatch.

  const originalAllowFlag = process.env.CHISACODE_ALLOW_WILDCARD_NO_AUTH;
  afterEach(() => {
    if (originalAllowFlag === undefined) {
      delete process.env.CHISACODE_ALLOW_WILDCARD_NO_AUTH;
    } else {
      process.env.CHISACODE_ALLOW_WILDCARD_NO_AUTH = originalAllowFlag;
    }
  });

  test("allows loopback without password", () => {
    expect(() => assertWildcardAuth(parseListenString("127.0.0.1:6767"), undefined)).not.toThrow();
  });

  test("allows wildcard 0.0.0.0 with password", () => {
    expect(() =>
      assertWildcardAuth(parseListenString("0.0.0.0:6767"), { password: "hash" }),
    ).not.toThrow();
  });

  test("rejects 0.0.0.0 without password by default (fail-closed)", () => {
    delete process.env.CHISACODE_ALLOW_WILDCARD_NO_AUTH;
    expect(() => assertWildcardAuth(parseListenString("0.0.0.0:6767"), undefined)).toThrow(
      /exposes the daemon to the local network/,
    );
  });

  test("allows 0.0.0.0 without password when CHISACODE_ALLOW_WILDCARD_NO_AUTH=1 (opt-in)", () => {
    process.env.CHISACODE_ALLOW_WILDCARD_NO_AUTH = "1";
    expect(() => assertWildcardAuth(parseListenString("0.0.0.0:6767"), undefined)).not.toThrow();
  });

  test("rejects IPv6 :: wildcard without password by default (fail-closed)", () => {
    delete process.env.CHISACODE_ALLOW_WILDCARD_NO_AUTH;
    expect(() => assertWildcardAuth({ type: "tcp", host: "::", port: 6767 }, undefined)).toThrow(
      /exposes the daemon to the local network/,
    );
  });

  test("allows IPv6 :: wildcard without password when opt-in is set", () => {
    process.env.CHISACODE_ALLOW_WILDCARD_NO_AUTH = "1";
    expect(() =>
      assertWildcardAuth({ type: "tcp", host: "::", port: 6767 }, undefined),
    ).not.toThrow();
  });

  test("allows IPv6 :: wildcard with password", () => {
    expect(() =>
      assertWildcardAuth({ type: "tcp", host: "::", port: 6767 }, { password: "hash" }),
    ).not.toThrow();
  });

  test("allows unix socket without password", () => {
    expect(() =>
      assertWildcardAuth(parseListenString("unix:///tmp/chisacode/daemon.sock"), undefined),
    ).not.toThrow();
  });
});
