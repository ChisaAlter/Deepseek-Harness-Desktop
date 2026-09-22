import type { Logger } from "pino";

import type {
  AgentPromptInput,
  AgentRunOptions,
  AgentSession,
  AgentStreamEvent,
} from "./agent-sdk-types.js";
import type { AgentManagerEvent, ManagedAgent, SubscribeOptions } from "./agent-manager.js";
import { ForegroundRunState } from "./foreground-run-state.js";

const CANCEL_PROPAGATION_TIMEOUT_MS = 2_000;

type ActiveManagedAgent = Exclude<ManagedAgent, { lifecycle: "closed" }>;

interface AgentRunControlControllerOptions {
  clearPendingPermissions(agent: ActiveManagedAgent): void;
  dispatchSessionEvent(agent: ActiveManagedAgent, event: AgentStreamEvent): Promise<void>;
  emitState(agent: ManagedAgent): void;
  findAgent(agentId: string): ActiveManagedAgent | null;
  foregroundRuns: ForegroundRunState;
  getAgent(agentId: string): ActiveManagedAgent;
  interruptSession(session: AgentSession, agentId: string): Promise<void>;
  logger: Logger;
  streamAgent(
    agentId: string,
    prompt: AgentPromptInput,
    options?: AgentRunOptions,
  ): AsyncGenerator<AgentStreamEvent>;
  subscribe(callback: (event: AgentManagerEvent) => void, options?: SubscribeOptions): () => void;
  touchUpdatedAt(agent: ManagedAgent): Date;
}

/** Owns foreground run replacement, interruption propagation, and cancellation cleanup. */
export class AgentRunControlController {
  constructor(private readonly options: AgentRunControlControllerOptions) {}

  replace(
    agentId: string,
    prompt: AgentPromptInput,
    runOptions?: AgentRunOptions,
  ): AsyncGenerator<AgentStreamEvent> {
    const snapshot = this.options.getAgent(agentId);
    if (
      snapshot.lifecycle !== "running" &&
      !snapshot.activeForegroundTurnId &&
      !this.options.foregroundRuns.hasPendingRun(agentId)
    ) {
      return this.options.streamAgent(agentId, prompt, runOptions);
    }

    snapshot.pendingReplacement = true;
    snapshot.lifecycle = "running";
    this.options.touchUpdatedAt(snapshot);
    this.options.emitState(snapshot);

    return this.forwardReplacement(agentId, prompt, runOptions);
  }

  async cancel(agentId: string): Promise<boolean> {
    const agent = this.options.getAgent(agentId);
    const pendingRun = this.options.foregroundRuns.getPendingRun(agentId);
    const foregroundTurnId = agent.activeForegroundTurnId;
    const hasForegroundTurn = Boolean(foregroundTurnId);
    const isAutonomousRunning = agent.lifecycle === "running" && !hasForegroundTurn && !pendingRun;

    if (!hasForegroundTurn && !isAutonomousRunning && !pendingRun) {
      return false;
    }

    // Never let an interrupt failure abort the cancellation: the turn must
    // still be force-canceled (and pending permissions cleared) so the agent
    // does not stay stuck "running".
    try {
      await this.options.interruptSession(agent.session, agentId);
    } catch (error) {
      this.options.logger.warn(
        { agentId, err: error },
        "cancelAgentRun: session interrupt failed, force-canceling",
      );
    }
    await this.waitForForegroundCancellation(agent, foregroundTurnId, pendingRun);
    await this.forceCancelStaleForegroundTurn(agent, foregroundTurnId);
    this.options.clearPendingPermissions(agent);
    return true;
  }

  private async *forwardReplacement(
    agentId: string,
    prompt: AgentPromptInput,
    runOptions: AgentRunOptions | undefined,
  ): AsyncGenerator<AgentStreamEvent> {
    try {
      await this.cancel(agentId);
      const nextRun = this.options.streamAgent(agentId, prompt, runOptions);
      for await (const event of nextRun) {
        yield event;
      }
    } catch (error) {
      const latest = this.options.findAgent(agentId);
      if (latest) {
        latest.pendingReplacement = false;
        if (!latest.activeForegroundTurnId && latest.lifecycle === "running") {
          (latest as ActiveManagedAgent).lifecycle = "idle";
          this.options.touchUpdatedAt(latest);
          this.options.emitState(latest);
        }
      }
      throw error;
    }
  }

  private async waitForForegroundCancellation(
    agent: ActiveManagedAgent,
    foregroundTurnId: string | null,
    pendingRun: ReturnType<ForegroundRunState["getPendingRun"]>,
  ): Promise<void> {
    if (foregroundTurnId) {
      const timeout = this.createPropagationTimeout();
      const waiter = Array.from(agent.foregroundTurnWaiters).find(
        (candidate) => candidate.turnId === foregroundTurnId,
      );
      if (waiter) {
        await Promise.race([waiter.settledPromise, timeout]);
      } else if (agent.activeForegroundTurnId === foregroundTurnId) {
        await Promise.race([this.waitForForegroundTurnClear(agent.id), timeout]);
      }
      if (pendingRun && !pendingRun.settled) {
        await Promise.race([pendingRun.settledPromise, timeout]);
      }
      return;
    }

    if (pendingRun) {
      await Promise.race([pendingRun.settledPromise, this.createPropagationTimeout()]);
    }
  }

  private waitForForegroundTurnClear(agentId: string): Promise<void> {
    return new Promise<void>((resolvePromise) => {
      const unsubscribe = this.options.subscribe(
        (event) => {
          if (
            event.type === "agent_state" &&
            event.agent.id === agentId &&
            !event.agent.activeForegroundTurnId
          ) {
            unsubscribe();
            resolvePromise();
          }
        },
        { agentId, replayState: false },
      );
    });
  }

  private async forceCancelStaleForegroundTurn(
    agent: ActiveManagedAgent,
    foregroundTurnId: string | null,
  ): Promise<void> {
    if (!foregroundTurnId || agent.activeForegroundTurnId !== foregroundTurnId) {
      return;
    }

    this.options.logger.warn(
      { agentId: agent.id, foregroundTurnId },
      "cancelAgentRun: foreground turn still active after timeout, force-canceling",
    );
    void this.options.dispatchSessionEvent(agent, {
      type: "turn_canceled",
      provider: agent.provider,
      reason: "interrupted",
      turnId: foregroundTurnId,
    });
    const staleRun = this.options.foregroundRuns.getPendingRun(agent.id);
    if (staleRun && !staleRun.settled) {
      // Bound the wait: if the settle chain breaks (a pipeline error after the
      // injected turn_canceled), an unbounded await would hang cancel() — and
      // with it replace() and the foreground watchdog — forever.
      await Promise.race([staleRun.settledPromise, this.createPropagationTimeout()]);
    }
  }

  private createPropagationTimeout(): Promise<void> {
    return new Promise<void>((resolvePromise) =>
      setTimeout(resolvePromise, CANCEL_PROPAGATION_TIMEOUT_MS),
    );
  }
}
