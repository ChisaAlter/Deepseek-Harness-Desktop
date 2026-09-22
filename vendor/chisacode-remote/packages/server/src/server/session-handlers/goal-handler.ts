/**
 * GoalHandler — autonomous goal tracking RPC handler.
 *
 * Delegates goal state to the AgentManager, which owns the single goal store
 * read by the turn-completion loop (`evaluateGoalContinuation`). Keeping one
 * store means a goal set over RPC actually drives auto-continuation.
 */

import type { AgentManager } from "../agent/agent-manager.js";
import type { SessionInboundMessage } from "../messages.js";
import type { DisposableHandler } from "./session-context.js";
import { summarizeUntrustedLogIdentifier } from "../log-metadata.js";
import type { GoalState } from "../goal-service.js";

/** The subset of AgentManager the goal RPCs rely on. */
export type GoalStore = Pick<
  AgentManager,
  "setGoal" | "cancelGoal" | "getGoal" | "listGoals" | "cancelAgentRun"
>;

export interface GoalHandlerContext {
  readonly sessionLogger: { error(obj: unknown, msg: string): void };
  readonly goalStore: GoalStore;
  emit(message: unknown): void;
}

/** Handles goal RPC operations. */
export class GoalHandler implements DisposableHandler {
  private readonly context: GoalHandlerContext;

  constructor(context: GoalHandlerContext) {
    this.context = context;
  }

  dispose(): void {}

  private emitRpcError(request: { requestId: string; type: string }, error: unknown): void {
    const message = error instanceof Error ? error.message : "Goal request failed";
    this.context.sessionLogger.error(
      {
        requestType: request.type,
        requestId: summarizeUntrustedLogIdentifier(request.requestId),
        category: "goal",
        code: "goal_request_failed",
      },
      "Goal request failed",
    );
    this.context.emit({
      type: "rpc_error",
      payload: {
        requestId: request.requestId,
        requestType: request.type,
        error: message,
        code: "goal_request_failed",
      },
    });
  }

  async handleGoalSetRequest(
    request: Extract<SessionInboundMessage, { type: "goal/set" }>,
  ): Promise<void> {
    try {
      const goal = this.context.goalStore.setGoal(
        request.agentId,
        request.objective,
        request.limits,
      );
      this.context.emit({
        type: "goal/set/response",
        payload: {
          requestId: request.requestId,
          goal: serializeGoal(goal),
          error: null,
        },
      });
    } catch (error) {
      this.emitRpcError(request, error);
    }
  }

  async handleGoalCancelRequest(
    request: Extract<SessionInboundMessage, { type: "goal/cancel" }>,
  ): Promise<void> {
    try {
      const goal = this.context.goalStore.cancelGoal(request.agentId);
      if (goal) {
        // Abort any in-flight continuation turn so the agent actually stops
        // instead of running to completion and triggering another judged turn.
        // cancelAgentRun is best-effort: the agent may already be idle.
        try {
          await this.context.goalStore.cancelAgentRun(request.agentId);
        } catch {
          // Non-fatal — the goal status is already flipped to paused.
        }
      }
      this.context.emit({
        type: "goal/cancel/response",
        payload: {
          requestId: request.requestId,
          goal: goal ? serializeGoal(goal) : null,
          error: goal ? null : `No active goal for agent "${request.agentId}"`,
        },
      });
    } catch (error) {
      this.emitRpcError(request, error);
    }
  }

  async handleGoalInspectRequest(
    request: Extract<SessionInboundMessage, { type: "goal/inspect" }>,
  ): Promise<void> {
    try {
      const goal = this.context.goalStore.getGoal(request.agentId);
      this.context.emit({
        type: "goal/inspect/response",
        payload: {
          requestId: request.requestId,
          goal: goal ? serializeGoal(goal) : null,
          error: null,
        },
      });
    } catch (error) {
      this.emitRpcError(request, error);
    }
  }

  async handleGoalListRequest(
    request: Extract<SessionInboundMessage, { type: "goal/list" }>,
  ): Promise<void> {
    try {
      const goals = this.context.goalStore.listGoals();
      this.context.emit({
        type: "goal/list/response",
        payload: {
          requestId: request.requestId,
          goals: goals.map((g) => ({
            agentId: g.sessionId,
            objective: g.objective,
            status: g.status,
            turnsUsed: g.turnsUsed,
            tokensUsed: g.tokensUsed,
          })),
          error: null,
        },
      });
    } catch (error) {
      this.emitRpcError(request, error);
    }
  }
}

function serializeGoal(goal: GoalState) {
  return {
    agentId: goal.sessionId,
    objective: goal.objective,
    status: goal.status,
    limits: goal.limits,
    turnsUsed: goal.turnsUsed,
    tokensUsed: goal.tokensUsed,
    noProgressStreak: goal.noProgressStreak,
    lastReason: goal.lastReason,
    startedAt: new Date(goal.startedAt).toISOString(),
    updatedAt: new Date(goal.updatedAt).toISOString(),
  };
}
