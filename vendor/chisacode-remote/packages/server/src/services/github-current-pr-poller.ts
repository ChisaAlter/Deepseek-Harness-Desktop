import type { GitHubCurrentPullRequestStatus } from "./github-current-pr.js";

const DISPOSED_ERROR_MESSAGE = "GitHub current pull request poller is disposed";

interface GitHubPollSubscriber {
  onStatus?: (status: GitHubCurrentPullRequestStatus | null) => void;
  onError?: (error: unknown) => void;
}

interface GitHubPollTarget {
  key: string;
  cwd: string;
  headRef: string;
  timer: NodeJS.Timeout | null;
  latestStatus: GitHubCurrentPullRequestStatus | null;
  consecutiveErrors: number;
  subscribers: Set<GitHubPollSubscriber>;
}

export interface GitHubCurrentPullRequestPollerOptions {
  loadStatus: (options: {
    cwd: string;
    headRef: string;
    reason: "self-heal-github";
  }) => Promise<GitHubCurrentPullRequestStatus | null>;
  computeNextInterval: (
    status: GitHubCurrentPullRequestStatus | null,
    consecutiveErrors: number,
  ) => number;
  onSubscriberError?: (
    error: unknown,
    context: { phase: "status" | "error"; cwd: string; headRef: string },
  ) => void;
}

export class GitHubCurrentPullRequestPoller {
  private readonly options: GitHubCurrentPullRequestPollerOptions;
  private readonly targets = new Map<string, GitHubPollTarget>();
  private disposed = false;

  constructor(options: GitHubCurrentPullRequestPollerOptions) {
    this.options = options;
  }

  retain(options: {
    cwd: string;
    headRef: string;
    onStatus?: (status: GitHubCurrentPullRequestStatus | null) => void;
    onError?: (error: unknown) => void;
  }): { unsubscribe: () => void } {
    this.assertActive();
    const key = this.buildTargetKey(options);
    let target = this.targets.get(key);
    if (!target) {
      target = {
        key,
        cwd: options.cwd,
        headRef: options.headRef,
        timer: null,
        latestStatus: null,
        consecutiveErrors: 0,
        subscribers: new Set(),
      };
      this.targets.set(key, target);
    }

    const subscriber: GitHubPollSubscriber = {
      ...(options.onStatus ? { onStatus: options.onStatus } : {}),
      ...(options.onError ? { onError: options.onError } : {}),
    };
    const isNewlyRetained = target.subscribers.size === 0;
    target.subscribers.add(subscriber);
    if (isNewlyRetained) {
      this.scheduleAfter(target, 0);
    } else {
      this.schedule(target);
    }

    let unsubscribed = false;
    return {
      unsubscribe: () => {
        if (unsubscribed) {
          return;
        }
        unsubscribed = true;
        target.subscribers.delete(subscriber);
        if (target.subscribers.size > 0) {
          return;
        }
        this.closeTarget(target);
        this.targets.delete(key);
      },
    };
  }

  acceptStatus(update: {
    cwd: string;
    headRef: string;
    status: GitHubCurrentPullRequestStatus | null;
    notify: boolean;
  }): void {
    const target = this.targets.get(this.buildTargetKey(update));
    if (!target || !this.isActiveTarget(target)) {
      return;
    }

    target.latestStatus = update.status;
    target.consecutiveErrors = 0;
    if (update.notify) {
      this.notifyStatusSubscribers(target, update.status);
    }
    this.schedule(target);
  }

  dispose(): void {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    for (const target of this.targets.values()) {
      this.closeTarget(target);
    }
    this.targets.clear();
  }

  private schedule(target: GitHubPollTarget): void {
    this.scheduleAfter(
      target,
      this.options.computeNextInterval(target.latestStatus, target.consecutiveErrors),
    );
  }

  private scheduleAfter(target: GitHubPollTarget, delayMs: number): void {
    if (!this.isActiveTarget(target)) {
      return;
    }
    if (target.timer) {
      clearTimeout(target.timer);
    }

    target.timer = setTimeout(() => {
      target.timer = null;
      void this.runPoll(target);
    }, delayMs);
  }

  private async runPoll(target: GitHubPollTarget): Promise<void> {
    if (!this.isActiveTarget(target)) {
      return;
    }

    try {
      await this.options.loadStatus({
        cwd: target.cwd,
        headRef: target.headRef,
        reason: "self-heal-github",
      });
    } catch (error) {
      if (!this.isActiveTarget(target)) {
        return;
      }
      target.consecutiveErrors += 1;
      this.notifyErrorSubscribers(target, error);
      this.schedule(target);
    }
  }

  private notifyStatusSubscribers(
    target: GitHubPollTarget,
    status: GitHubCurrentPullRequestStatus | null,
  ): void {
    for (const subscriber of Array.from(target.subscribers)) {
      if (!subscriber.onStatus) {
        continue;
      }
      try {
        subscriber.onStatus(status);
      } catch (error) {
        this.reportSubscriberError(error, target, "status");
      }
    }
  }

  private notifyErrorSubscribers(target: GitHubPollTarget, error: unknown): void {
    for (const subscriber of Array.from(target.subscribers)) {
      if (!subscriber.onError) {
        continue;
      }
      try {
        subscriber.onError(error);
      } catch (subscriberError) {
        this.reportSubscriberError(subscriberError, target, "error");
      }
    }
  }

  private reportSubscriberError(
    error: unknown,
    target: GitHubPollTarget,
    phase: "status" | "error",
  ): void {
    try {
      this.options.onSubscriberError?.(error, {
        phase,
        cwd: target.cwd,
        headRef: target.headRef,
      });
    } catch {
      // Observer reporting must not become part of the poller's failure path.
    }
  }

  private closeTarget(target: GitHubPollTarget): void {
    if (target.timer) {
      clearTimeout(target.timer);
      target.timer = null;
    }
    target.subscribers.clear();
  }

  private isActiveTarget(target: GitHubPollTarget): boolean {
    return !this.disposed && target.subscribers.size > 0 && this.targets.get(target.key) === target;
  }

  private buildTargetKey(target: { cwd: string; headRef: string }): string {
    return JSON.stringify([target.cwd, target.headRef]);
  }

  private assertActive(): void {
    if (this.disposed) {
      throw new Error(DISPOSED_ERROR_MESSAGE);
    }
  }
}
