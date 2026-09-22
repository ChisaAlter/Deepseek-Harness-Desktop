import type { Logger } from "pino";

import type { AgentSession } from "./agent-sdk-types.js";
import type { ManagedAgent } from "./agent-manager.js";
import { AgentStreamCoalescer } from "./agent-stream-coalescer.js";
import { AgentTimelineController } from "./agent-timeline-controller.js";
import { ForegroundRunState } from "./foreground-run-state.js";

type ActiveManagedAgent = Exclude<ManagedAgent, { lifecycle: "closed" }>;
type ClosedManagedAgent = Extract<ManagedAgent, { lifecycle: "closed" }>;

interface AgentSessionTeardownControllerOptions {
  clearGenerativeUi(agentId: string): void;
  closeReloadedSession(session: AgentSession, agentId: string): Promise<void>;
  coalescer: AgentStreamCoalescer;
  deleteAgent(agentId: string): void;
  deletePreviousStatus(agentId: string): void;
  /** Clear goal state when the agent is torn down (prevents goal store leak). */
  deleteGoal(agentId: string): void;
  emitState(agent: ManagedAgent, options?: { persist?: boolean }): void;
  foregroundRuns: ForegroundRunState;
  getAgent(agentId: string): ActiveManagedAgent;
  logger: Logger;
  persistSnapshot(agent: ManagedAgent): Promise<void>;
  timeline: AgentTimelineController;
}

/** Owns active session detachment and terminal agent closure resource cleanup. */
export class AgentSessionTeardownController {
  constructor(private readonly options: AgentSessionTeardownControllerOptions) {}

  async close(agentId: string): Promise<void> {
    const agent = this.options.getAgent(agentId);
    this.options.clearGenerativeUi(agentId);
    this.options.logger.trace(
      {
        agentId,
        provider: agent.provider,
        sessionId: agent.persistence?.sessionId ?? undefined,
        turnId: agent.activeForegroundTurnId ?? undefined,
        lifecycle: agent.lifecycle,
        activeForegroundTurnId: agent.activeForegroundTurnId,
        pendingPermissions: agent.pendingPermissions.size,
      },
      "agent.manager.close.start",
    );
    const closedAgent = this.prepareClosedAgent(agent, "agent closed");
    await agent.session.close();
    this.options.timeline.deleteMemory(agentId);
    await this.options.persistSnapshot(closedAgent);
    this.options.emitState(closedAgent, { persist: false });
    this.options.logger.trace(
      {
        agentId,
        provider: closedAgent.provider,
        sessionId: closedAgent.persistence?.sessionId ?? undefined,
      },
      "agent.manager.close.complete",
    );
  }

  async detachForReload(agent: ActiveManagedAgent): Promise<void> {
    this.options.coalescer.flushAndDiscard(agent.id);
    this.options.deleteAgent(agent.id);
    this.unsubscribeSession(agent);
    this.options.foregroundRuns.clearAgent(agent.id, agent);
    await this.options.closeReloadedSession(agent.session, agent.id);
  }

  private prepareClosedAgent(agent: ActiveManagedAgent, cancelReason: string): ClosedManagedAgent {
    this.options.coalescer.flushAndDiscard(agent.id);
    this.options.deleteAgent(agent.id);
    this.options.deletePreviousStatus(agent.id);
    this.options.deleteGoal(agent.id);
    this.unsubscribeSession(agent);
    this.options.foregroundRuns.cancelWaiters(agent, (turnId) => ({
      type: "turn_canceled",
      provider: agent.provider,
      reason: cancelReason,
      turnId,
    }));
    this.options.foregroundRuns.settlePendingRun(agent.id);
    return {
      ...agent,
      lifecycle: "closed",
      session: null,
      activeForegroundTurnId: null,
    };
  }

  private unsubscribeSession(agent: ActiveManagedAgent): void {
    if (!agent.unsubscribeSession) {
      return;
    }
    agent.unsubscribeSession();
    agent.unsubscribeSession = null;
  }
}
