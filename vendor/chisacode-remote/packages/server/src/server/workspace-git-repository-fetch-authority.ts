import type pino from "pino";

const BACKGROUND_GIT_FETCH_INTERVAL_MS = 180_000;

interface WorkspaceGitRepositoryFetchDependencies {
  runGitFetch: (cwd: string) => Promise<void>;
  refreshWorkspace: (cwd: string) => Promise<void>;
}

interface WorkspaceGitRepositoryFetchAuthorityOptions {
  logger: pino.Logger;
  deps: WorkspaceGitRepositoryFetchDependencies;
}

interface RepositoryFetchTarget {
  repoGitRoot: string;
  workspaceCwds: Set<string>;
  intervalId: NodeJS.Timeout | null;
  fetchInFlight: boolean;
  closed: boolean;
}

/**
 * Owns repository-scoped background fetch intervals and refresh fan-out across workspaces.
 */
export class WorkspaceGitRepositoryFetchAuthority {
  private readonly logger: pino.Logger;
  private readonly deps: WorkspaceGitRepositoryFetchDependencies;
  private readonly targets = new Map<string, RepositoryFetchTarget>();
  private disposed = false;

  constructor(options: WorkspaceGitRepositoryFetchAuthorityOptions) {
    this.logger = options.logger;
    this.deps = options.deps;
  }

  attachWorkspace(input: { repoGitRoot: string; cwd: string }): void {
    if (this.disposed) {
      return;
    }

    const existingTarget = this.targets.get(input.repoGitRoot);
    if (existingTarget) {
      existingTarget.workspaceCwds.add(input.cwd);
      return;
    }

    const target: RepositoryFetchTarget = {
      repoGitRoot: input.repoGitRoot,
      workspaceCwds: new Set([input.cwd]),
      intervalId: null,
      fetchInFlight: false,
      closed: false,
    };
    target.intervalId = setInterval(() => {
      void this.runFetch(target);
    }, BACKGROUND_GIT_FETCH_INTERVAL_MS);
    this.targets.set(input.repoGitRoot, target);
    void this.runFetch(target);
  }

  detachWorkspace(repoGitRoot: string, cwd: string): void {
    const target = this.targets.get(repoGitRoot);
    if (!target) {
      return;
    }

    target.workspaceCwds.delete(cwd);
    if (target.workspaceCwds.size > 0) {
      return;
    }

    this.closeTarget(target);
    if (this.targets.get(repoGitRoot) === target) {
      this.targets.delete(repoGitRoot);
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

  private async runFetch(target: RepositoryFetchTarget): Promise<void> {
    if (!this.isActiveTarget(target) || target.fetchInFlight) {
      return;
    }

    const cwd = target.workspaceCwds.values().next().value;
    if (!cwd) {
      return;
    }

    target.fetchInFlight = true;
    this.logger.debug({ repoGitRoot: target.repoGitRoot, cwd }, "Running background git fetch");

    try {
      await this.deps.runGitFetch(cwd);
    } catch (error) {
      this.logger.warn(
        { err: error, repoGitRoot: target.repoGitRoot, cwd },
        "Background git fetch failed",
      );
    } finally {
      target.fetchInFlight = false;
    }

    if (!this.isActiveTarget(target)) {
      return;
    }

    await Promise.all(
      Array.from(target.workspaceCwds, async (workspaceCwd) => {
        try {
          await this.deps.refreshWorkspace(workspaceCwd);
        } catch (error) {
          this.logger.warn(
            { err: error, repoGitRoot: target.repoGitRoot, cwd: workspaceCwd },
            "Failed to refresh workspace after background git fetch",
          );
        }
      }),
    );
  }

  private isActiveTarget(target: RepositoryFetchTarget): boolean {
    return (
      !this.disposed &&
      !target.closed &&
      target.workspaceCwds.size > 0 &&
      this.targets.get(target.repoGitRoot) === target
    );
  }

  private closeTarget(target: RepositoryFetchTarget): void {
    target.closed = true;
    if (target.intervalId) {
      clearInterval(target.intervalId);
      target.intervalId = null;
    }
    target.workspaceCwds.clear();
  }
}
