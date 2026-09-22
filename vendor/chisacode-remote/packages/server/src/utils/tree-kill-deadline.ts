/** Maximum wall-clock budget for one command-tree cleanup attempt. */
export const TREE_KILL_CLEANUP_TIMEOUT_MS = 8_000;

interface ProcessExitTarget {
  off?(event: "exit", listener: () => void): unknown;
  once?(event: "exit", listener: () => void): unknown;
}

class TreeKillCleanupTimeoutError extends Error {
  readonly code = "EXEC_COMMAND_KILL_TIMEOUT";

  constructor() {
    super("Command tree cleanup exceeded its absolute deadline");
    this.name = "TreeKillCleanupTimeoutError";
  }
}

/** Coordinates one absolute cleanup deadline across asynchronous tree-kill operations. */
export class TreeKillCleanupDeadline {
  private readonly controller = new AbortController();
  private readonly parentAbortListener: (() => void) | null;
  private readonly timeoutHandle: NodeJS.Timeout;
  readonly expiresAtMs: number;

  constructor(
    timeoutMs: number,
    private readonly now: () => number,
    private readonly parentSignal?: AbortSignal,
  ) {
    const boundedTimeoutMs = Math.max(0, timeoutMs);
    this.expiresAtMs = this.now() + boundedTimeoutMs;
    this.timeoutHandle = setTimeout(() => {
      this.abort(new TreeKillCleanupTimeoutError());
    }, boundedTimeoutMs);
    if (parentSignal) {
      this.parentAbortListener = () => {
        this.abort(parentSignal.reason ?? new TreeKillCleanupTimeoutError());
      };
      parentSignal.addEventListener("abort", this.parentAbortListener, { once: true });
      if (parentSignal.aborted) {
        this.parentAbortListener();
      }
    } else {
      this.parentAbortListener = null;
    }
  }

  get signal(): AbortSignal {
    return this.controller.signal;
  }

  remainingMs(): number {
    return Math.max(0, this.expiresAtMs - this.now());
  }

  run<T>(operation: (signal: AbortSignal) => Promise<T>): Promise<T> {
    if (this.signal.aborted) {
      return Promise.reject(this.signal.reason ?? new TreeKillCleanupTimeoutError());
    }
    return new Promise<T>((resolve, reject) => {
      let completed = false;
      const finish = (settle: () => void) => {
        if (completed) {
          return;
        }
        completed = true;
        this.signal.removeEventListener("abort", onAbort);
        settle();
      };
      const onAbort = () => {
        finish(() => reject(this.signal.reason ?? new TreeKillCleanupTimeoutError()));
      };
      this.signal.addEventListener("abort", onAbort, { once: true });
      let operationPromise: Promise<T>;
      try {
        operationPromise = operation(this.signal);
      } catch (error) {
        finish(() => reject(error));
        return;
      }
      void operationPromise.then(
        (value) => finish(() => resolve(value)),
        (error: unknown) => finish(() => reject(error)),
      );
    });
  }

  dispose(): void {
    clearTimeout(this.timeoutHandle);
    if (this.parentSignal && this.parentAbortListener) {
      this.parentSignal.removeEventListener("abort", this.parentAbortListener);
    }
  }

  private abort(reason: unknown): void {
    if (!this.signal.aborted) {
      this.controller.abort(reason);
    }
  }
}

/** Rethrows an operation failure when the shared cleanup deadline caused it. */
export function rethrowCleanupDeadline(error: unknown, deadline: TreeKillCleanupDeadline): void {
  if (deadline.signal.aborted) {
    throw error;
  }
}

/** Waits for the next process poll interval while honoring cleanup cancellation. */
export function waitForProcessPoll(delayMs: number, cleanupSignal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    let timer: NodeJS.Timeout | null = null;
    const finish = (settle: () => void) => {
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      cleanupSignal?.removeEventListener("abort", onAbort);
      settle();
    };
    const onAbort = () => {
      finish(() => reject(cleanupSignal?.reason ?? new TreeKillCleanupTimeoutError()));
    };
    cleanupSignal?.addEventListener("abort", onAbort, { once: true });
    timer = setTimeout(() => finish(resolve), delayMs);
    if (cleanupSignal?.aborted) {
      onAbort();
    }
  });
}

/** Waits for a child exit event until a phase timeout or the shared cleanup deadline. */
export function waitForExitOrTimeout(
  child: ProcessExitTarget,
  isExited: () => boolean,
  timeoutMs: number,
  deadline: TreeKillCleanupDeadline,
): Promise<boolean> {
  if (isExited()) {
    return Promise.resolve(true);
  }
  const boundedTimeoutMs = Math.min(Math.max(0, timeoutMs), deadline.remainingMs());
  return new Promise<boolean>((resolve, reject) => {
    let timer: NodeJS.Timeout | null = null;
    const finish = (settle: () => void) => {
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      child.off?.("exit", onExit);
      deadline.signal.removeEventListener("abort", onAbort);
      settle();
    };
    const onExit = () => finish(() => resolve(true));
    const onAbort = () => {
      finish(() => reject(deadline.signal.reason ?? new TreeKillCleanupTimeoutError()));
    };
    child.once?.("exit", onExit);
    deadline.signal.addEventListener("abort", onAbort, { once: true });
    timer = setTimeout(() => finish(() => resolve(isExited())), boundedTimeoutMs);
    if (deadline.signal.aborted) {
      onAbort();
    }
  });
}
