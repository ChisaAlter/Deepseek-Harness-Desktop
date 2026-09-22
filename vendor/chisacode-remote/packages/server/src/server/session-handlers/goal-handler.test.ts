import { describe, expect, test, vi } from "vitest";

import { GoalHandler } from "./goal-handler.js";
import type { GoalStore } from "./goal-handler.js";
import type { GoalState } from "../goal-service.js";

function makeGoal(overrides: Partial<GoalState> = {}): GoalState {
  return {
    sessionId: "session-1",
    objective: "do the thing",
    status: "active",
    turnsUsed: 0,
    tokensUsed: 0,
    noProgressStreak: 0,
    limits: { maxTurns: 10 },
    lastReason: null,
    startedAt: 1000,
    updatedAt: 1000,
    ...overrides,
  };
}

function makeHandler(opts: { goalStore: Partial<GoalStore> }) {
  const emitted: unknown[] = [];
  const handler = new GoalHandler({
    sessionLogger: { error: vi.fn() },
    goalStore: opts.goalStore as GoalStore,
    emit: (message) => emitted.push(message),
  });
  return { handler, emitted };
}

describe("GoalHandler handleGoalCancelRequest", () => {
  test("cancels the goal AND aborts the in-flight agent run", async () => {
    const goal = makeGoal();
    const cancelGoal = vi
      .fn()
      .mockReturnValue({ ...goal, status: "paused", lastReason: "Cancelled by user" });
    const cancelAgentRun = vi.fn().mockResolvedValue(true);
    const { handler, emitted } = makeHandler({
      goalStore: { cancelGoal, cancelAgentRun },
    });

    await handler.handleGoalCancelRequest({
      type: "goal/cancel",
      requestId: "r1",
      agentId: "agent-1",
    } as never);

    expect(cancelGoal).toHaveBeenCalledWith("agent-1");
    // The in-flight continuation turn must be aborted, not just the goal status flipped.
    expect(cancelAgentRun).toHaveBeenCalledWith("agent-1");
    const response = emitted.find(
      (m) => (m as { type?: string }).type === "goal/cancel/response",
    ) as { payload: { error: string | null } };
    expect(response.payload.error).toBeNull();
  });

  test("returns an error when no goal exists", async () => {
    const cancelGoal = vi.fn().mockReturnValue(null);
    const cancelAgentRun = vi.fn().mockResolvedValue(false);
    const { handler, emitted } = makeHandler({
      goalStore: { cancelGoal, cancelAgentRun },
    });

    await handler.handleGoalCancelRequest({
      type: "goal/cancel",
      requestId: "r2",
      agentId: "agent-x",
    } as never);

    // No goal → no reason to touch the agent run.
    expect(cancelAgentRun).not.toHaveBeenCalled();
    const response = emitted.find(
      (m) => (m as { type?: string }).type === "goal/cancel/response",
    ) as { payload: { error: string | null } };
    expect(response.payload.error).toMatch(/No active goal/);
  });
});
