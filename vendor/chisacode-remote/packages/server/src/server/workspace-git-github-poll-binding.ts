import type pino from "pino";

import type { GitHubCurrentPullRequestStatus, GitHubService } from "../services/github-service.js";

interface WorkspaceGitHubPollBindingOptions {
  logger: pino.Logger;
  github: Pick<GitHubService, "invalidate" | "retainCurrentPullRequestStatusPoll">;
}

interface WorkspaceGitHubPollTarget {
  cwd: string;
  remoteUrl: string;
  headRef: string;
  subscription: { unsubscribe: () => void } | null;
  onStatus: (status: GitHubCurrentPullRequestStatus | null) => void;
  onError: (error: unknown) => void;
  closed: boolean;
}

/**
 * Binds each observed workspace to one GitHub PR poll target keyed by remote and branch.
 */
export class WorkspaceGitHubPollBinding {
  private readonly logger: pino.Logger;
  private readonly github: WorkspaceGitHubPollBindingOptions["github"];
  private readonly targets = new Map<string, WorkspaceGitHubPollTarget>();
  private disposed = false;

  constructor(options: WorkspaceGitHubPollBindingOptions) {
    this.logger = options.logger;
    this.github = options.github;
  }

  sync(input: {
    cwd: string;
    remoteUrl: string | null;
    headRef: string | null;
    onStatus: (status: GitHubCurrentPullRequestStatus | null) => void;
    onError: (error: unknown) => void;
  }): void {
    if (
      this.disposed ||
      !this.github.retainCurrentPullRequestStatusPoll ||
      !input.remoteUrl ||
      !input.headRef
    ) {
      this.remove(input.cwd);
      return;
    }

    const existingTarget = this.targets.get(input.cwd);
    if (
      existingTarget &&
      existingTarget.remoteUrl === input.remoteUrl &&
      existingTarget.headRef === input.headRef
    ) {
      existingTarget.onStatus = input.onStatus;
      existingTarget.onError = input.onError;
      return;
    }

    if (existingTarget) {
      const remoteChanged = existingTarget.remoteUrl !== input.remoteUrl;
      this.closeTarget(existingTarget);
      this.targets.delete(input.cwd);
      if (remoteChanged) {
        try {
          this.github.invalidate({ cwd: input.cwd });
        } catch (error) {
          this.logger.warn(
            { err: error, cwd: input.cwd, previousRemoteUrl: existingTarget.remoteUrl },
            "Failed to invalidate GitHub cache after workspace remote changed",
          );
        }
      }
    }

    const target: WorkspaceGitHubPollTarget = {
      cwd: input.cwd,
      remoteUrl: input.remoteUrl,
      headRef: input.headRef,
      subscription: null,
      onStatus: input.onStatus,
      onError: input.onError,
      closed: false,
    };
    this.targets.set(input.cwd, target);

    try {
      target.subscription = this.github.retainCurrentPullRequestStatusPoll({
        cwd: input.cwd,
        headRef: input.headRef,
        onStatus: (status) => {
          if (!this.isActiveTarget(target)) {
            return;
          }
          try {
            target.onStatus(status);
          } catch (error) {
            this.logger.warn(
              { err: error, cwd: target.cwd, remoteUrl: target.remoteUrl, headRef: target.headRef },
              "Workspace GitHub poll status handler threw",
            );
          }
        },
        onError: (error) => {
          if (!this.isActiveTarget(target)) {
            return;
          }
          try {
            target.onError(error);
          } catch (handlerError) {
            this.logger.warn(
              {
                err: handlerError,
                cwd: target.cwd,
                remoteUrl: target.remoteUrl,
                headRef: target.headRef,
              },
              "Workspace GitHub poll error handler threw",
            );
          }
        },
      });
    } catch (error) {
      this.closeTarget(target);
      if (this.targets.get(input.cwd) === target) {
        this.targets.delete(input.cwd);
      }
      this.logger.warn(
        { err: error, cwd: input.cwd, remoteUrl: input.remoteUrl, headRef: input.headRef },
        "Failed to retain workspace GitHub poll",
      );
    }
  }

  remove(cwd: string): void {
    const target = this.targets.get(cwd);
    if (!target) {
      return;
    }
    this.closeTarget(target);
    if (this.targets.get(cwd) === target) {
      this.targets.delete(cwd);
    }
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

  private isActiveTarget(target: WorkspaceGitHubPollTarget): boolean {
    return !this.disposed && !target.closed && this.targets.get(target.cwd) === target;
  }

  private closeTarget(target: WorkspaceGitHubPollTarget): void {
    target.closed = true;
    target.subscription?.unsubscribe();
    target.subscription = null;
  }
}
