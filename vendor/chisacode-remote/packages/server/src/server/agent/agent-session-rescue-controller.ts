import type { Logger } from "pino";

import type { AgentSession } from "./agent-sdk-types.js";

const RELOAD_SESSION_CLOSE_TIMEOUT_MS = 3_000;
const INTERRUPT_SESSION_TIMEOUT_MS = 2_000;

type TimeoutResult = "completed" | "timed_out";

interface TimeoutOptions {
  onLateError?: (error: unknown) => void;
  operation: Promise<void>;
  timeoutMs: number;
}

export interface AgentSessionRescueTimeouts {
  interruptSessionMs?: number;
  reloadSessionCloseMs?: number;
}

/** Owns bounded close and interrupt rescue behavior for provider sessions. */
export class AgentSessionRescueController {
  private readonly interruptSessionMs: number;
  private readonly reloadSessionCloseMs: number;

  constructor(
    private readonly logger: Logger,
    timeouts?: AgentSessionRescueTimeouts,
  ) {
    this.interruptSessionMs = timeouts?.interruptSessionMs ?? INTERRUPT_SESSION_TIMEOUT_MS;
    this.reloadSessionCloseMs = timeouts?.reloadSessionCloseMs ?? RELOAD_SESSION_CLOSE_TIMEOUT_MS;
  }

  async closeReloadedSession(session: AgentSession, agentId: string): Promise<void> {
    try {
      const result = await this.waitWithTimeout({
        operation: session.close(),
        timeoutMs: this.reloadSessionCloseMs,
        onLateError: (error) => {
          this.logger.warn(
            { err: error, agentId },
            "Previous session close failed after refresh timeout",
          );
        },
      });

      if (result === "timed_out") {
        this.logger.warn(
          { agentId, timeoutMs: this.reloadSessionCloseMs },
          "Timed out closing previous session during refresh",
        );
      }
    } catch (error) {
      this.logger.warn({ err: error, agentId }, "Failed to close previous session during refresh");
    }
  }

  async interruptSession(session: AgentSession, agentId: string): Promise<void> {
    try {
      const result = await this.waitWithTimeout({
        operation: session.interrupt(),
        timeoutMs: this.interruptSessionMs,
        onLateError: (error) => {
          this.logger.warn(
            { err: error, agentId },
            "Session interrupt failed after timeout during cancel",
          );
        },
      });

      if (result === "timed_out") {
        this.logger.warn(
          { agentId, timeoutMs: this.interruptSessionMs },
          "Timed out interrupting session during cancel",
        );
      }
    } catch (error) {
      this.logger.error({ err: error, agentId }, "Failed to interrupt session");
    }
  }

  private async waitWithTimeout(options: TimeoutOptions): Promise<TimeoutResult> {
    let didTimeOut = false;
    let timer: NodeJS.Timeout | null = null;
    const operation = options.operation
      .then((): TimeoutResult => "completed")
      .catch((error) => {
        if (didTimeOut) {
          options.onLateError?.(error);
          return "timed_out" as const;
        }
        throw error;
      });

    try {
      return await Promise.race([
        operation,
        new Promise<TimeoutResult>((resolvePromise) => {
          timer = setTimeout(() => {
            didTimeOut = true;
            resolvePromise("timed_out");
          }, options.timeoutMs);
        }),
      ]);
    } finally {
      if (timer) {
        clearTimeout(timer);
      }
    }
  }
}
