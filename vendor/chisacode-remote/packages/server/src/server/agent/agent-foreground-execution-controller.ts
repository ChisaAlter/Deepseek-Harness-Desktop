import type { Logger } from "pino";

import type {
  AgentPersistenceHandle,
  AgentPromptInput,
  AgentRunOptions,
  AgentStreamEvent,
} from "./agent-sdk-types.js";
import type { ManagedAgent } from "./agent-manager.js";
import { ForegroundRunState, type PendingForegroundRun } from "./foreground-run-state.js";

type ActiveManagedAgent = Exclude<ManagedAgent, { lifecycle: "closed" }>;

interface ForegroundLifecycleHooks {
  onStarted(): void;
  onStartFailed(error: unknown): void;
}

interface AgentForegroundExecutionControllerOptions {
  attachPersistenceCwd(
    handle: AgentPersistenceHandle | null,
    cwd: string,
  ): AgentPersistenceHandle | null;
  emitState(agent: ManagedAgent): void;
  foregroundRuns: ForegroundRunState;
  getAgent(agentId: string): ActiveManagedAgent;
  handleStreamEvent(agent: ActiveManagedAgent, event: AgentStreamEvent): Promise<unknown>;
  isTerminalEvent(event: AgentStreamEvent): boolean;
  logger: Logger;
  onAgentTerminal(agentId: string): void;
  refreshRuntimeInfo(agent: ActiveManagedAgent): Promise<void>;
  touchUpdatedAt(agent: ManagedAgent): Date;
  /**
   * Cancels an in-flight foreground turn: interrupts the provider session so
   * the underlying work actually stops, waits for the turn stream to settle,
   * and force-dispatches a terminal event (with the real turnId) if the
   * provider never responds. Wired to AgentRunControlController.cancel.
   */
  cancelRun(agentId: string): Promise<boolean>;
  /**
   * Stalls longer than this (no stream events) end the turn. Defaults to
   * FOREGROUND_TURN_INACTIVITY_TIMEOUT_MS. Deliberately generous: long tool
   * executions and slow providers legitimately go silent, and a false kill is
   * user-visible damage, while a true hang only costs bounded waiting time.
   */
  inactivityTimeoutMs?: number;
  /**
   * Maximum time a single tool call may stay `running` without any further
   * stream event before the turn is cancelled. Defaults to
   * FOREGROUND_TOOL_CALL_STALL_TIMEOUT_MS. Tighter than the inactivity window
   * so an ACP provider that emits a `tool_call(running)` and then never sends
   * a final `PromptResponse` (observed with Kimi/grok-via-Kimi) fails fast
   * instead of hanging for the full inactivity window.
   */
  toolCallStallTimeoutMs?: number;
}

/** Default stall window before an inactive foreground turn is cancelled. */
const FOREGROUND_TURN_INACTIVITY_TIMEOUT_MS = 10 * 60 * 1000;

/**
 * Default maximum time a single tool call may stay `running` without further
 * stream events before the turn is cancelled. Tighter than the inactivity
 * window so an ACP provider that emits `tool_call(running)` and then never
 * sends a final `PromptResponse` (observed with Kimi/grok-via-Kimi) fails
 * fast instead of hanging for the full inactivity window.
 */
const FOREGROUND_TOOL_CALL_STALL_TIMEOUT_MS = 3 * 60 * 1000;

/**
 * Events that mean "the turn is waiting on the user", not stalled: the user's
 * deliberation time is not provider inactivity, so the watchdog stands down.
 */
function isUserWaitEvent(event: AgentStreamEvent): boolean {
  return event.type === "permission_requested" || event.type === "attention_required";
}

/**
 * Returns the timeout window to use after observing `event`.
 *
 * - A `tool_call` / `tool_call_update` with status `running` tightens the
 *   watchdog to `toolCallStallTimeoutMs`: an ACP provider that starts a tool
 *   and then never sends a terminal `PromptResponse` (observed with
 *   Kimi/grok-via-Kimi) should fail fast, not hang for the full inactivity
 *   window.
 * - Any other event (assistant text, thinking, usage, a tool reaching
 *   `completed`/`failed`/`canceled`, etc.) restores the generous
 *   `inactivityTimeoutMs` window so legitimate long tool executions and slow
 *   providers are not falsely killed.
 */
function resolveWatchdogTimeoutMs(
  event: AgentStreamEvent,
  inactivityTimeoutMs: number,
  toolCallStallTimeoutMs: number,
): number {
  if (
    event.type === "timeline" &&
    event.item.type === "tool_call" &&
    event.item.status === "running"
  ) {
    return toolCallStallTimeoutMs;
  }
  return inactivityTimeoutMs;
}

/** Owns one foreground turn from start request through terminal finalization. */
export class AgentForegroundExecutionController {
  constructor(private readonly options: AgentForegroundExecutionControllerOptions) {}

  stream(
    agentId: string,
    prompt: AgentPromptInput,
    runOptions?: AgentRunOptions,
    lifecycleHooks?: ForegroundLifecycleHooks,
  ): AsyncGenerator<AgentStreamEvent> {
    const agent = this.options.getAgent(agentId);
    this.options.logger.trace(
      {
        agentId,
        provider: agent.provider,
        sessionId: agent.persistence?.sessionId ?? undefined,
        turnId: agent.activeForegroundTurnId ?? undefined,
        lifecycle: agent.lifecycle,
        activeForegroundTurnId: agent.activeForegroundTurnId,
        hasPendingForegroundRun: this.options.foregroundRuns.hasPendingRun(agentId),
        promptType: typeof prompt === "string" ? "string" : "structured",
        hasRunOptions: Boolean(runOptions),
      },
      "agent.manager.stream.request",
    );
    if (agent.activeForegroundTurnId || this.options.foregroundRuns.hasPendingRun(agentId)) {
      this.options.logger.trace(
        {
          agentId,
          provider: agent.provider,
          sessionId: agent.persistence?.sessionId ?? undefined,
          turnId: agent.activeForegroundTurnId ?? undefined,
          lifecycle: agent.lifecycle,
          hasPendingForegroundRun: this.options.foregroundRuns.hasPendingRun(agentId),
        },
        "agent.manager.stream.reject",
      );
      throw new Error(`Agent ${agentId} already has an active run`);
    }

    agent.pendingReplacement = false;
    agent.lastError = undefined;

    const pendingRun = this.options.foregroundRuns.createPendingRun(agentId);
    return this.forwardTurn(agent, prompt, runOptions, pendingRun, lifecycleHooks);
  }

  finalize(agent: ActiveManagedAgent, turnId?: string): void {
    if (turnId) {
      this.options.foregroundRuns.rememberFinalizedTurn(agent, turnId);
    }
    agent.activeForegroundTurnId = null;
    const terminalError = agent.lastError;
    const shouldHoldBusyForReplacement = agent.pendingReplacement && !terminalError;
    let nextLifecycle: "running" | "error" | "idle";
    if (shouldHoldBusyForReplacement) {
      nextLifecycle = "running";
    } else if (terminalError) {
      nextLifecycle = "error";
    } else {
      nextLifecycle = "idle";
    }
    agent.lifecycle = nextLifecycle;
    const persistenceHandle =
      agent.session.describePersistence() ??
      (agent.runtimeInfo?.sessionId
        ? {
            provider: agent.runtimeInfo.provider,
            sessionId: agent.runtimeInfo.sessionId,
          }
        : null);
    if (persistenceHandle) {
      agent.persistence = this.options.attachPersistenceCwd(persistenceHandle, agent.cwd);
    }
    this.options.logger.trace(
      {
        agentId: agent.id,
        provider: agent.provider,
        sessionId: agent.persistence?.sessionId ?? undefined,
        turnId,
        lifecycle: agent.lifecycle,
        terminalError,
        pendingReplacement: agent.pendingReplacement,
      },
      "agent.manager.finalize",
    );
    if (!shouldHoldBusyForReplacement) {
      this.options.touchUpdatedAt(agent);
      this.options.emitState(agent);
    }
  }

  private async *forwardTurn(
    agent: ActiveManagedAgent,
    prompt: AgentPromptInput,
    runOptions: AgentRunOptions | undefined,
    pendingRun: PendingForegroundRun,
    lifecycleHooks?: ForegroundLifecycleHooks,
  ): AsyncGenerator<AgentStreamEvent> {
    const agentId = agent.id;
    let turnId: string;
    let turnStream: ReturnType<ForegroundRunState["createTurnStream"]> | null = null;
    try {
      const result = await agent.session.startTurn(prompt, runOptions);
      turnId = result.turnId;
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : "Failed to start turn";
      await this.options.handleStreamEvent(agent, {
        type: "turn_failed",
        provider: agent.provider,
        error: errorMsg,
      });
      this.finalize(agent);
      this.options.foregroundRuns.settlePendingRun(agentId, pendingRun.token);
      lifecycleHooks?.onStartFailed(error);
      throw error;
    }

    pendingRun.started = true;
    agent.activeForegroundTurnId = turnId;
    agent.lifecycle = "running";
    this.options.touchUpdatedAt(agent);
    this.options.emitState(agent);
    lifecycleHooks?.onStarted();
    this.options.logger.trace(
      {
        agentId,
        provider: agent.provider,
        sessionId: agent.persistence?.sessionId ?? undefined,
        turnId,
        lifecycle: agent.lifecycle,
        activeForegroundTurnId: agent.activeForegroundTurnId,
      },
      "agent.manager.stream.start",
    );

    turnStream = this.options.foregroundRuns.createTurnStream(turnId);
    this.options.foregroundRuns.addWaiter(agent, turnStream.waiter);

    // Watchdog: if the provider stalls (no stream events for the inactivity
    // window), cancel the turn so the agent doesn't stay "running" forever.
    // Covers SDKs that silently hang (network timeout, unreachable upstream).
    // Cancellation goes through cancelRun (runControl.cancel), which interrupts
    // the provider session — no leaked subprocess/hung request — and dispatches
    // the terminal event with the real turnId, so the pipeline finalizes the
    // turn and clears activeForegroundTurnId. The old approach only unblocked
    // the client-side stream, leaving the agent permanently "already has an
    // active run".
    const timeoutMs = this.options.inactivityTimeoutMs ?? FOREGROUND_TURN_INACTIVITY_TIMEOUT_MS;
    const toolCallStallTimeoutMs =
      this.options.toolCallStallTimeoutMs ?? FOREGROUND_TOOL_CALL_STALL_TIMEOUT_MS;
    const timeoutError = `Agent turn timed out: no activity for ${Math.round(timeoutMs / 1000)} seconds`;
    let watchdogTimer: ReturnType<typeof setTimeout> | null = null;
    let watchdogFired = false;
    let currentWatchdogTimeoutMs = timeoutMs;
    const clearWatchdog = () => {
      if (watchdogTimer) {
        clearTimeout(watchdogTimer);
        watchdogTimer = null;
      }
    };
    const armWatchdog = (nextTimeoutMs = currentWatchdogTimeoutMs) => {
      if (watchdogFired) {
        return;
      }
      clearWatchdog();
      currentWatchdogTimeoutMs = nextTimeoutMs;
      watchdogTimer = setTimeout(() => {
        watchdogFired = true;
        const reason =
          currentWatchdogTimeoutMs === toolCallStallTimeoutMs &&
          currentWatchdogTimeoutMs < timeoutMs
            ? "tool_call_stall"
            : "inactivity";
        this.options.logger.warn(
          {
            agentId,
            turnId,
            provider: agent.provider,
            timeoutMs: currentWatchdogTimeoutMs,
            reason,
          },
          "agent.turn.inactivity_timeout",
        );
        void this.options.cancelRun(agentId).catch((error: unknown) => {
          // Cancellation could not reach the provider; fall back to unblocking
          // the turn stream and finalizing through the pipeline. The injected
          // events carry the turnId so finalizeForeground still runs.
          this.options.logger.error(
            { agentId, turnId, err: error },
            "agent.turn.inactivity_cancel_failed",
          );
          void this.options
            .handleStreamEvent(agent, {
              type: "turn_failed",
              provider: agent.provider,
              error: timeoutError,
              turnId: agent.activeForegroundTurnId ?? turnId,
            })
            .catch((handleError: unknown) => {
              this.options.logger.warn(
                { agentId, turnId, err: handleError },
                "agent.turn.inactivity_fallback_dispatch_failed",
              );
            });
          this.options.foregroundRuns.cancelWaiters(agent, (id) => ({
            type: "turn_failed",
            provider: agent.provider,
            error: timeoutError,
            turnId: id,
          }));
        });
      }, timeoutMs);
    };

    try {
      armWatchdog();
      for await (const event of turnStream.events(this.options.isTerminalEvent)) {
        // Waiting on the user (permission / attention) is not inactivity:
        // a long user deliberation must not kill a healthy turn.
        if (isUserWaitEvent(event)) {
          clearWatchdog();
        } else {
          armWatchdog(resolveWatchdogTimeoutMs(event, timeoutMs, toolCallStallTimeoutMs));
        }
        yield event;
      }
    } finally {
      clearWatchdog();
      if (turnStream) {
        this.options.foregroundRuns.deleteWaiter(agent, turnStream.waiter);
      }
      this.options.foregroundRuns.settlePendingRun(agentId, pendingRun.token);
      this.options.onAgentTerminal(agentId);
      if (!agent.activeForegroundTurnId) {
        await this.options.refreshRuntimeInfo(agent);
      }
    }
  }
}
