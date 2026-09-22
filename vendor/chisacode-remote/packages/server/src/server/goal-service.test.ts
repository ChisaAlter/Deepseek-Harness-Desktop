import { describe, expect, test } from "vitest";

import {
  buildCompletionSummary,
  buildContinuationPrompt,
  createGoalState,
  DEFAULT_GOAL_LIMITS,
  judgeTurn,
  TERMINAL_GOAL_STATUSES,
  type GoalState,
  type TurnOutcome,
} from "./goal-service.js";

const NOW = 1000000;

function activeGoal(overrides?: Partial<GoalState>): GoalState {
  return {
    sessionId: "s1",
    objective: "Fix the login bug",
    status: "active",
    limits: { ...DEFAULT_GOAL_LIMITS },
    turnsUsed: 0,
    tokensUsed: 0,
    noProgressStreak: 0,
    lastReason: null,
    startedAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

const toolTurn: TurnOutcome = { usedTools: true, tokensUsed: 1000 };
const emptyTurn: TurnOutcome = { usedTools: false, tokensUsed: 200 };

describe("createGoalState", () => {
  test("creates active goal with default limits", () => {
    const goal = createGoalState({ sessionId: "s1", objective: "test" }, NOW);
    expect(goal.status).toBe("active");
    expect(goal.limits.maxTurns).toBe(50);
    expect(goal.limits.budgetTokens).toBeNull();
    expect(goal.limits.noProgressLimit).toBe(5);
  });

  test("accepts custom limits", () => {
    const goal = createGoalState(
      { sessionId: "s1", objective: "test", limits: { maxTurns: 10 } },
      NOW,
    );
    expect(goal.limits.maxTurns).toBe(10);
    expect(goal.limits.noProgressLimit).toBe(5); // default preserved
  });
});

describe("judgeTurn", () => {
  test("continues when agent uses tools and no limits hit", () => {
    const { verdict, updated } = judgeTurn(activeGoal(), toolTurn, NOW + 1000);
    expect(verdict.action).toBe("continue");
    expect(updated.turnsUsed).toBe(1);
    expect(updated.tokensUsed).toBe(1000);
    expect(updated.noProgressStreak).toBe(0);
  });

  test("completes when agent signals completion", () => {
    const { verdict, updated } = judgeTurn(
      activeGoal(),
      { ...toolTurn, signaledComplete: true },
      NOW + 1000,
    );
    expect(verdict.action).toBe("complete");
    expect(updated.status).toBe("complete");
  });

  test("pauses after noProgressLimit consecutive empty turns", () => {
    let goal = activeGoal({ limits: { maxTurns: null, budgetTokens: null, noProgressLimit: 3 } });
    for (let i = 0; i < 2; i++) {
      const result = judgeTurn(goal, emptyTurn, NOW + i * 1000);
      expect(result.verdict.action).toBe("continue");
      goal = result.updated;
    }
    const { verdict, updated } = judgeTurn(goal, emptyTurn, NOW + 3000);
    expect(verdict.action).toBe("pause");
    expect(updated.status).toBe("paused");
    expect(updated.noProgressStreak).toBe(3);
  });

  test("resets noProgressStreak when tools are used", () => {
    let goal = activeGoal({ noProgressStreak: 4 });
    const { updated } = judgeTurn(goal, toolTurn, NOW + 1000);
    expect(updated.noProgressStreak).toBe(0);
  });

  test("stops at maxTurns", () => {
    const goal = activeGoal({
      turnsUsed: 49,
      limits: { maxTurns: 50, budgetTokens: null, noProgressLimit: null },
    });
    const { verdict, updated } = judgeTurn(goal, toolTurn, NOW + 1000);
    expect(verdict.action).toBe("budgetLimited");
    expect(updated.status).toBe("budgetLimited");
    expect(updated.turnsUsed).toBe(50);
  });

  test("stops at budgetTokens", () => {
    const goal = activeGoal({
      tokensUsed: 9900,
      limits: { maxTurns: null, budgetTokens: 10000, noProgressLimit: null },
    });
    const { verdict, updated } = judgeTurn(goal, { usedTools: true, tokensUsed: 200 }, NOW + 1000);
    expect(verdict.action).toBe("budgetLimited");
    expect(updated.tokensUsed).toBe(10100);
  });

  test("completion takes priority over budget", () => {
    const goal = activeGoal({
      tokensUsed: 99999,
      limits: { maxTurns: null, budgetTokens: 100, noProgressLimit: null },
    });
    const { verdict } = judgeTurn(
      goal,
      { usedTools: true, tokensUsed: 999, signaledComplete: true },
      NOW + 1000,
    );
    expect(verdict.action).toBe("complete");
  });
});

describe("buildContinuationPrompt", () => {
  test("includes objective and turn count", () => {
    const goal = activeGoal({ turnsUsed: 5, objective: "Refactor auth module" });
    const prompt = buildContinuationPrompt(goal);
    expect(prompt).toContain("turn 6");
    expect(prompt).toContain("Refactor auth module");
    expect(prompt).toContain("5/50");
  });
});

describe("buildCompletionSummary", () => {
  test("produces summary with elapsed time", () => {
    const goal = activeGoal({ turnsUsed: 10, tokensUsed: 50000, updatedAt: NOW + 60000 });
    const summary = buildCompletionSummary(goal);
    expect(summary.turnsUsed).toBe(10);
    expect(summary.tokensUsed).toBe(50000);
    expect(summary.elapsedMs).toBe(60000);
  });
});

describe("TERMINAL_GOAL_STATUSES", () => {
  test("includes complete and budgetLimited", () => {
    expect(TERMINAL_GOAL_STATUSES.has("complete")).toBe(true);
    expect(TERMINAL_GOAL_STATUSES.has("budgetLimited")).toBe(true);
    expect(TERMINAL_GOAL_STATUSES.has("active")).toBe(false);
    expect(TERMINAL_GOAL_STATUSES.has("paused")).toBe(false);
  });

  test("includes failed and cancelled terminal states", () => {
    // Agent crashes and user cancellations must be terminal so the continuation
    // loop stops and listGoals does not resurrect them.
    expect(TERMINAL_GOAL_STATUSES.has("failed")).toBe(true);
    expect(TERMINAL_GOAL_STATUSES.has("cancelled")).toBe(true);
  });
});
