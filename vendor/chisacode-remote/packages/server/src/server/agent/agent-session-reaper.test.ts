import { describe, expect, test, vi } from "vitest";

import {
  AgentSessionReaper,
  shouldReapAgent,
  AGENT_SESSION_REAPER_DEFAULT_IDLE_MS,
} from "./agent-session-reaper.js";
import type { ManagedAgent } from "./agent-manager.js";
import { createTestLogger } from "../../test-utils/test-logger.js";

function createAgent(
  overrides: Partial<
    Pick<ManagedAgent, "id" | "lifecycle" | "activeForegroundTurnId" | "updatedAt" | "provider">
  > = {},
): ManagedAgent {
  return {
    id: overrides.id ?? "00000000-0000-4000-8000-000000000001",
    provider: overrides.provider ?? "codex",
    lifecycle: overrides.lifecycle ?? "idle",
    activeForegroundTurnId: overrides.activeForegroundTurnId ?? null,
    updatedAt: overrides.updatedAt ?? new Date(0),
  } as ManagedAgent;
}

describe("shouldReapAgent", () => {
  const now = Date.parse("2026-08-09T12:00:00.000Z");
  const idleMs = AGENT_SESSION_REAPER_DEFAULT_IDLE_MS;

  test("reaps idle agents past the threshold", () => {
    expect(shouldReapAgent(createAgent({ updatedAt: new Date(now - idleMs) }), now, idleMs)).toBe(
      true,
    );
  });

  test("skips agents with an active foreground turn", () => {
    expect(
      shouldReapAgent(
        createAgent({
          lifecycle: "idle",
          activeForegroundTurnId: "turn-1",
          updatedAt: new Date(now - idleMs),
        }),
        now,
        idleMs,
      ),
    ).toBe(false);
  });

  test("skips running and closed agents", () => {
    expect(
      shouldReapAgent(
        createAgent({ lifecycle: "running", updatedAt: new Date(now - idleMs) }),
        now,
        idleMs,
      ),
    ).toBe(false);
    expect(
      shouldReapAgent(
        createAgent({ lifecycle: "closed", updatedAt: new Date(now - idleMs) }),
        now,
        idleMs,
      ),
    ).toBe(false);
  });

  test("skips agents newer than the threshold", () => {
    expect(
      shouldReapAgent(createAgent({ updatedAt: new Date(now - idleMs + 1) }), now, idleMs),
    ).toBe(false);
  });
});

describe("AgentSessionReaper", () => {
  test("closes only idle agents past the threshold", async () => {
    const now = Date.parse("2026-08-09T12:00:00.000Z");
    const idleMs = 1_000;
    const closeAgent = vi.fn(async () => undefined);
    const agents = [
      createAgent({
        id: "idle-old",
        lifecycle: "idle",
        updatedAt: new Date(now - idleMs),
      }),
      createAgent({
        id: "running",
        lifecycle: "running",
        updatedAt: new Date(now - idleMs),
      }),
      createAgent({
        id: "idle-fresh",
        lifecycle: "idle",
        updatedAt: new Date(now - idleMs + 1),
      }),
      createAgent({
        id: "active-turn",
        lifecycle: "idle",
        activeForegroundTurnId: "turn-1",
        updatedAt: new Date(now - idleMs),
      }),
    ];

    const reaper = new AgentSessionReaper({
      agentManager: {
        listAgents: () => agents,
        closeAgent,
      },
      logger: createTestLogger(),
      idleTimeoutMs: idleMs,
      now: () => now,
    });

    await expect(reaper.sweep()).resolves.toEqual(["idle-old"]);
    expect(closeAgent).toHaveBeenCalledTimes(1);
    expect(closeAgent).toHaveBeenCalledWith("idle-old");
  });

  test("continues after closeAgent failures", async () => {
    const now = Date.parse("2026-08-09T12:00:00.000Z");
    const closeAgent = vi
      .fn()
      .mockRejectedValueOnce(new Error("close failed"))
      .mockResolvedValueOnce(undefined);
    const reaper = new AgentSessionReaper({
      agentManager: {
        listAgents: () => [
          createAgent({ id: "a1", updatedAt: new Date(now - 10_000) }),
          createAgent({ id: "a2", updatedAt: new Date(now - 10_000) }),
        ],
        closeAgent,
      },
      logger: createTestLogger(),
      idleTimeoutMs: 1_000,
      now: () => now,
    });

    await expect(reaper.sweep()).resolves.toEqual(["a2"]);
    expect(closeAgent).toHaveBeenCalledTimes(2);
  });

  test("start schedules sweeps and stop clears the timer", async () => {
    const callbacks: Array<() => void> = [];
    const setIntervalFn = vi.fn((cb: () => void) => {
      callbacks.push(cb);
      return 1 as unknown as ReturnType<typeof setInterval>;
    });
    const clearIntervalFn = vi.fn();
    const closeAgent = vi.fn(async () => undefined);
    const reaper = new AgentSessionReaper({
      agentManager: {
        listAgents: () => [
          createAgent({
            id: "idle-old",
            updatedAt: new Date(0),
          }),
        ],
        closeAgent,
      },
      logger: createTestLogger(),
      idleTimeoutMs: 1,
      intervalMs: 5,
      now: () => 10_000,
      setIntervalFn: setIntervalFn as unknown as typeof setInterval,
      clearIntervalFn: clearIntervalFn as unknown as typeof clearInterval,
    });

    reaper.start();
    reaper.start(); // idempotent
    expect(setIntervalFn).toHaveBeenCalledTimes(1);
    expect(callbacks).toHaveLength(1);

    callbacks[0]?.();
    await vi.waitFor(() => {
      expect(closeAgent).toHaveBeenCalledWith("idle-old");
    });

    reaper.stop();
    expect(clearIntervalFn).toHaveBeenCalledWith(1);
  });

  test("deterministic long-idle clock: reaps only after full 30-minute threshold", async () => {
    let now = Date.parse("2026-08-09T12:00:00.000Z");
    const idleMs = AGENT_SESSION_REAPER_DEFAULT_IDLE_MS;
    const closeAgent = vi.fn(async () => undefined);
    const agent = createAgent({
      id: "long-idle",
      lifecycle: "idle",
      updatedAt: new Date(now),
    });
    const reaper = new AgentSessionReaper({
      agentManager: {
        listAgents: () => [agent],
        closeAgent,
      },
      logger: createTestLogger(),
      idleTimeoutMs: idleMs,
      now: () => now,
    });

    // Just under threshold: keep alive.
    now = Date.parse("2026-08-09T12:00:00.000Z") + idleMs - 1;
    await expect(reaper.sweep()).resolves.toEqual([]);
    expect(closeAgent).not.toHaveBeenCalled();

    // Exactly at threshold: reap.
    now = Date.parse("2026-08-09T12:00:00.000Z") + idleMs;
    await expect(reaper.sweep()).resolves.toEqual(["long-idle"]);
    expect(closeAgent).toHaveBeenCalledWith("long-idle");
  });
});
