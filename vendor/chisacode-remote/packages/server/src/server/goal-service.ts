/**
 * Goal Service — autonomous goal tracking with safety guardrails.
 *
 * Lets users set an objective for an agent and have it run autonomously
 * until completion, with three safety guardrails: maxTurns, budgetTokens,
 * and noProgressLimit (consecutive empty turns). The daemon judges each
 * turn result and decides whether to continue, pause, or stop.
 *
 * Design adapted from Cindy's goal-host/ (Apache-2.0).
 */

// ── Types ──────────────────────────────────────────────────────────────────

export type GoalStatus =
  | "active"
  | "paused"
  | "blocked"
  | "complete"
  | "budgetLimited"
  | "failed"
  | "cancelled";

export const TERMINAL_GOAL_STATUSES: ReadonlySet<GoalStatus> = new Set([
  "complete",
  "budgetLimited",
  "failed",
  "cancelled",
]);

/** Safety guardrail limits. All nullable (null = no limit). */
export interface GoalLimits {
  /** Maximum continuation turns. */
  maxTurns: number | null;
  /** Maximum total tokens (input + output). */
  budgetTokens: number | null;
  /** Maximum consecutive turns with no tool use (empty turns). */
  noProgressLimit: number | null;
}

export interface GoalState {
  sessionId: string;
  objective: string;
  status: GoalStatus;
  limits: GoalLimits;
  /** Continuation turns used so far. */
  turnsUsed: number;
  /** Total tokens consumed. */
  tokensUsed: number;
  /** Consecutive turns with no tool_use. */
  noProgressStreak: number;
  /** Last verdict reason (for UI display). */
  lastReason: string | null;
  startedAt: number;
  updatedAt: number;
}

/** Input to set or replace a goal. */
export interface SetGoalInput {
  sessionId: string;
  objective: string;
  limits?: Partial<GoalLimits>;
}

/** Turn outcome reported by the agent response loop. */
export interface TurnOutcome {
  /** Whether the agent used any tools during this turn. */
  usedTools: boolean;
  /** Tokens consumed this turn. */
  tokensUsed: number;
  /** Whether the agent signaled task completion. */
  signaledComplete?: boolean;
}

/** Verdict after judging a turn. */
export interface GoalVerdict {
  action: "continue" | "pause" | "complete" | "budgetLimited";
  reason: string;
}

/** Completion summary persisted in the conversation. */
export interface GoalCompletionSummary {
  turnsUsed: number;
  tokensUsed: number;
  elapsedMs: number;
  reason: string | null;
}

/** Result of judging whether a goal's objective has been met. */
export interface GoalCompletionJudgment {
  complete: boolean;
  reason: string;
}

/**
 * Judges whether an active goal's objective has already been met, so the
 * continuation loop can stop instead of spending another turn. Returns `null`
 * when no judgment could be produced (treated as "not complete — keep going").
 */
export type GoalCompletionJudge = (input: {
  agentId: string;
  objective: string;
  recentOutput: string;
}) => Promise<GoalCompletionJudgment | null>;

// ── Default limits ─────────────────────────────────────────────────────────

export const DEFAULT_GOAL_LIMITS: GoalLimits = {
  maxTurns: 50,
  budgetTokens: null,
  noProgressLimit: 5,
};

// ── Goal state management ──────────────────────────────────────────────────

/** Create a new goal state from input. */
export function createGoalState(input: SetGoalInput, now: number): GoalState {
  return {
    sessionId: input.sessionId,
    objective: input.objective,
    status: "active",
    limits: {
      maxTurns: input.limits?.maxTurns ?? DEFAULT_GOAL_LIMITS.maxTurns,
      budgetTokens: input.limits?.budgetTokens ?? DEFAULT_GOAL_LIMITS.budgetTokens,
      noProgressLimit: input.limits?.noProgressLimit ?? DEFAULT_GOAL_LIMITS.noProgressLimit,
    },
    turnsUsed: 0,
    tokensUsed: 0,
    noProgressStreak: 0,
    lastReason: null,
    startedAt: now,
    updatedAt: now,
  };
}

/**
 * Judge a turn outcome and decide the next action.
 *
 * Priority: complete > budgetLimited > noProgress > maxTurns > continue.
 * Returns the verdict and the updated goal state.
 */
export function judgeTurn(
  goal: GoalState,
  outcome: TurnOutcome,
  now: number,
): { verdict: GoalVerdict; updated: GoalState } {
  const updated: GoalState = {
    ...goal,
    turnsUsed: goal.turnsUsed + 1,
    tokensUsed: goal.tokensUsed + outcome.tokensUsed,
    noProgressStreak: outcome.usedTools ? 0 : goal.noProgressStreak + 1,
    updatedAt: now,
  };

  // 1. Agent signaled completion
  if (outcome.signaledComplete) {
    updated.status = "complete";
    updated.lastReason = "Agent signaled task completion";
    return {
      verdict: { action: "complete", reason: updated.lastReason },
      updated,
    };
  }

  // 2. Token budget exceeded
  if (updated.limits.budgetTokens !== null && updated.tokensUsed >= updated.limits.budgetTokens) {
    updated.status = "budgetLimited";
    updated.lastReason = `Token budget exhausted (${updated.tokensUsed}/${updated.limits.budgetTokens})`;
    return {
      verdict: { action: "budgetLimited", reason: updated.lastReason },
      updated,
    };
  }

  // 3. No progress (consecutive empty turns)
  if (
    updated.limits.noProgressLimit !== null &&
    updated.noProgressStreak >= updated.limits.noProgressLimit
  ) {
    updated.status = "paused";
    updated.lastReason = `No progress for ${updated.noProgressStreak} consecutive turns`;
    return {
      verdict: { action: "pause", reason: updated.lastReason },
      updated,
    };
  }

  // 4. Max turns reached
  if (updated.limits.maxTurns !== null && updated.turnsUsed >= updated.limits.maxTurns) {
    updated.status = "budgetLimited";
    updated.lastReason = `Turn limit reached (${updated.turnsUsed}/${updated.limits.maxTurns})`;
    return {
      verdict: { action: "budgetLimited", reason: updated.lastReason },
      updated,
    };
  }

  // 5. Continue
  updated.status = "active";
  return {
    verdict: { action: "continue", reason: "Goal still in progress" },
    updated,
  };
}

/** Build the continuation prompt injected as the next user message. */
export function buildContinuationPrompt(goal: GoalState): string {
  const parts = [
    `[Goal continuation — turn ${goal.turnsUsed + 1}]`,
    `Objective: ${goal.objective}`,
  ];
  if (goal.limits.maxTurns !== null) {
    parts.push(`Turns used: ${goal.turnsUsed}/${goal.limits.maxTurns}`);
  }
  if (goal.limits.budgetTokens) {
    parts.push(`Tokens used: ${goal.tokensUsed}/${goal.limits.budgetTokens}`);
  }
  parts.push("Continue working toward the objective. Report when complete.");
  return parts.join("\n");
}

/** Build the completion summary for persistence. */
export function buildCompletionSummary(goal: GoalState): GoalCompletionSummary {
  return {
    turnsUsed: goal.turnsUsed,
    tokensUsed: goal.tokensUsed,
    elapsedMs: goal.updatedAt - goal.startedAt,
    reason: goal.lastReason,
  };
}
