import { describe, expect, test, vi } from "vitest";

import { AgentHistoryController } from "./agent-history-controller.js";
import type { ManagedAgent } from "./agent-manager.js";
import type { AgentStreamEvent } from "./agent-sdk-types.js";
import { createTestLogger } from "../../test-utils/test-logger.js";

type ActiveAgent = Exclude<ManagedAgent, { lifecycle: "closed" }>;

function createAgent(overrides?: Partial<ActiveAgent>): ActiveAgent {
  const history: AgentStreamEvent[] = [
    {
      type: "timeline",
      provider: "codex",
      item: {
        type: "user_message",
        id: "u1",
        text: "hello",
      },
      timestamp: new Date().toISOString(),
    },
  ];

  return {
    id: "00000000-0000-4000-8000-000000000001",
    provider: "codex",
    lifecycle: "idle",
    historyPrimed: false,
    activeForegroundTurnId: null,
    session: {
      async *streamHistory() {
        for (const event of history) {
          yield event;
        }
      },
    },
    ...overrides,
  } as unknown as ActiveAgent;
}

describe("AgentHistoryController hydration state", () => {
  test("marks hydrating while seed is in flight and hydrated after completion", async () => {
    const agent = createAgent();
    let resolveGate: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      resolveGate = resolve;
    });

    const append = vi.fn();
    const controller = new AgentHistoryController({
      cancelAgentRun: async () => true,
      coalescer: {
        flushAndDiscard: vi.fn(),
      } as never,
      dispatchStream: vi.fn(),
      emitState: vi.fn(),
      foregroundRuns: {
        createPendingRun: () => ({ token: "t" }),
        hasPendingRun: () => false,
        settlePendingRun: vi.fn(),
      } as never,
      getAgent: () => agent,
      logger: createTestLogger(),
      persistSnapshot: async () => {},
      refreshRuntimeInfo: async () => {},
      timeline: {
        append,
        deleteCommitted: async () => {},
        resetMemory: vi.fn(),
        getEpoch: () => "epoch",
      } as never,
      touchUpdatedAt: () => new Date(),
    });

    // Intercept streamHistory so we can observe mid-hydration state.
    agent.session.streamHistory = async function* () {
      await gate;
      yield {
        type: "timeline",
        provider: "codex",
        item: { type: "user_message", id: "u1", text: "hello" },
        timestamp: new Date().toISOString(),
      } as AgentStreamEvent;
    } as never;

    const hydratePromise = controller.hydrate(agent.id);
    expect(controller.getHydrationState(agent.id)).toBe("hydrating");
    expect(agent.historyPrimed).toBe(false);

    resolveGate?.();
    await hydratePromise;

    expect(controller.getHydrationState(agent.id)).toBe("hydrated");
    expect(agent.historyPrimed).toBe(true);
    expect(append).toHaveBeenCalled();
  });

  test("still marks hydrated when streamHistory fails", async () => {
    const agent = createAgent();
    agent.session.streamHistory = async function* () {
      throw new Error("provider history unavailable");
      yield undefined as never;
    } as never;

    const controller = new AgentHistoryController({
      cancelAgentRun: async () => true,
      coalescer: { flushAndDiscard: vi.fn() } as never,
      dispatchStream: vi.fn(),
      emitState: vi.fn(),
      foregroundRuns: {
        createPendingRun: () => ({ token: "t" }),
        hasPendingRun: () => false,
        settlePendingRun: vi.fn(),
      } as never,
      getAgent: () => agent,
      logger: createTestLogger(),
      persistSnapshot: async () => {},
      refreshRuntimeInfo: async () => {},
      timeline: {
        append: vi.fn(),
        deleteCommitted: async () => {},
        resetMemory: vi.fn(),
        getEpoch: () => "epoch",
      } as never,
      touchUpdatedAt: () => new Date(),
    });

    await controller.hydrate(agent.id);
    expect(controller.getHydrationState(agent.id)).toBe("hydrated");
    expect(agent.historyPrimed).toBe(true);
  });
});
