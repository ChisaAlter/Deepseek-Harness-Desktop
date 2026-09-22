import type { Logger } from "pino";

import type { AgentManager, ManagedAgent } from "./agent-manager.js";

export const AGENT_SESSION_REAPER_DEFAULT_IDLE_MS = 30 * 60 * 1000;
export const AGENT_SESSION_REAPER_DEFAULT_INTERVAL_MS = 5 * 60 * 1000;

export interface AgentSessionReaperOptions {
  agentManager: Pick<AgentManager, "listAgents" | "closeAgent">;
  logger: Logger;
  /** Max idle time before a session is reaped. Defaults to 30 minutes. */
  idleTimeoutMs?: number;
  /** Sweep interval. Defaults to 5 minutes. */
  intervalMs?: number;
  /** Injected clock for tests. */
  now?: () => number;
  /** Injected scheduler for tests. */
  setIntervalFn?: typeof setInterval;
  clearIntervalFn?: typeof clearInterval;
}

/**
 * Periodically closes idle in-memory agent sessions to free provider child
 * processes (e.g. codex app-server). Agent records remain on disk and are
 * re-created on demand via ensureAgentLoaded.
 */
export class AgentSessionReaper {
  private readonly agentManager: AgentSessionReaperOptions["agentManager"];
  private readonly logger: Logger;
  private readonly idleTimeoutMs: number;
  private readonly intervalMs: number;
  private readonly now: () => number;
  private readonly setIntervalFn: typeof setInterval;
  private readonly clearIntervalFn: typeof clearInterval;
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(options: AgentSessionReaperOptions) {
    this.agentManager = options.agentManager;
    this.logger = options.logger;
    this.idleTimeoutMs = options.idleTimeoutMs ?? AGENT_SESSION_REAPER_DEFAULT_IDLE_MS;
    this.intervalMs = options.intervalMs ?? AGENT_SESSION_REAPER_DEFAULT_INTERVAL_MS;
    this.now = options.now ?? Date.now;
    this.setIntervalFn = options.setIntervalFn ?? setInterval;
    this.clearIntervalFn = options.clearIntervalFn ?? clearInterval;
  }

  start(): void {
    if (this.timer) {
      return;
    }
    this.timer = this.setIntervalFn(() => {
      void this.sweep().catch((error) => {
        this.logger.debug({ err: error }, "Agent session reaper sweep failed");
      });
    }, this.intervalMs);
    // Do not keep the process alive solely for the reaper.
    if (typeof this.timer === "object" && this.timer && "unref" in this.timer) {
      this.timer.unref();
    }
  }

  stop(): void {
    if (!this.timer) {
      return;
    }
    this.clearIntervalFn(this.timer);
    this.timer = null;
  }

  /**
   * Close agents that have been idle longer than the threshold and have no
   * active foreground turn. Safe to call concurrently; closeAgent failures are
   * logged and ignored.
   */
  async sweep(): Promise<string[]> {
    const now = this.now();
    const reaped: string[] = [];
    const agents = this.agentManager.listAgents();
    for (const agent of agents) {
      if (!shouldReapAgent(agent, now, this.idleTimeoutMs)) {
        continue;
      }
      try {
        await this.agentManager.closeAgent(agent.id);
        reaped.push(agent.id);
        this.logger.info(
          { agentId: agent.id, provider: agent.provider, idleTimeoutMs: this.idleTimeoutMs },
          "Reaped idle agent session",
        );
      } catch (error) {
        this.logger.debug({ err: error, agentId: agent.id }, "Failed to reap idle agent session");
      }
    }
    return reaped;
  }
}

export function shouldReapAgent(
  agent: Pick<ManagedAgent, "lifecycle" | "activeForegroundTurnId" | "updatedAt">,
  nowMs: number,
  idleTimeoutMs: number,
): boolean {
  if (agent.lifecycle === "running" || agent.lifecycle === "closed") {
    return false;
  }
  if (agent.activeForegroundTurnId) {
    return false;
  }
  const updatedAtMs =
    agent.updatedAt instanceof Date
      ? agent.updatedAt.getTime()
      : Date.parse(String(agent.updatedAt));
  if (!Number.isFinite(updatedAtMs)) {
    return false;
  }
  return nowMs - updatedAtMs >= idleTimeoutMs;
}
