export interface WorkspaceGitRefreshRequest {
  force: boolean;
  includeGitHub: boolean;
  reason: string;
  notify: boolean;
}

interface QueuedWorkspaceGitRefresh {
  force: boolean;
  includeGitHub: boolean;
  reason: string;
  notify: boolean;
}

export type WorkspaceGitRefreshState<TSnapshot> =
  | {
      status: "idle";
    }
  | {
      status: "in-flight";
      promise: Promise<TSnapshot>;
      force: boolean;
      includeGitHub: boolean;
      queued: QueuedWorkspaceGitRefresh | null;
    };

export interface WorkspaceGitRefreshTarget<TSnapshot> {
  refreshState: WorkspaceGitRefreshState<TSnapshot>;
  latestSnapshot: TSnapshot | null;
  lastShellOutAtMs: number | null;
}

interface WorkspaceGitRefreshCoordinatorOptions<
  TSnapshot,
  TTarget extends WorkspaceGitRefreshTarget<TSnapshot>,
> {
  now: () => Date;
  minGapMs: number;
  refreshSnapshot: (target: TTarget, request: WorkspaceGitRefreshRequest) => Promise<TSnapshot>;
  rememberSnapshot: (
    target: TTarget,
    snapshot: TSnapshot,
    options: { notify: boolean; forceEmit: boolean },
  ) => void;
}

interface WorkspaceGitRefreshInput {
  force?: boolean;
  includeGitHub?: boolean;
  reason?: string;
}

/**
 * Coordinates snapshot refresh coalescing, capability upgrades, and internal throttling.
 */
export class WorkspaceGitRefreshCoordinator<
  TSnapshot,
  TTarget extends WorkspaceGitRefreshTarget<TSnapshot>,
> {
  private readonly now: () => Date;
  private readonly minGapMs: number;
  private readonly refreshSnapshot: WorkspaceGitRefreshCoordinatorOptions<
    TSnapshot,
    TTarget
  >["refreshSnapshot"];
  private readonly rememberSnapshot: WorkspaceGitRefreshCoordinatorOptions<
    TSnapshot,
    TTarget
  >["rememberSnapshot"];

  constructor(options: WorkspaceGitRefreshCoordinatorOptions<TSnapshot, TTarget>) {
    this.now = options.now;
    this.minGapMs = options.minGapMs;
    this.refreshSnapshot = options.refreshSnapshot;
    this.rememberSnapshot = options.rememberSnapshot;
  }

  normalizeRequest(
    options: WorkspaceGitRefreshInput | undefined,
    defaultReason: string,
    notify: boolean,
  ): WorkspaceGitRefreshRequest {
    if (options?.force && !options.reason) {
      throw new Error("WorkspaceGitService.getSnapshot force refresh requires a reason");
    }

    return {
      force: options?.force === true,
      includeGitHub: options?.includeGitHub ?? true,
      reason: options?.reason ?? defaultReason,
      notify,
    };
  }

  request(target: TTarget, request: WorkspaceGitRefreshRequest): Promise<TSnapshot> {
    const state = target.refreshState;
    if (state.status === "in-flight") {
      const needsForcedRefresh = request.force && !state.force;
      const needsGitHubRefresh = request.includeGitHub && !state.includeGitHub;
      if (needsForcedRefresh || needsGitHubRefresh) {
        state.queued = this.mergeQueuedRefresh(state.queued, request);
      }
      return state.promise;
    }

    const throttledSnapshot = this.getThrottledSnapshot(target);
    if (!request.force && throttledSnapshot !== null) {
      return Promise.resolve(throttledSnapshot);
    }

    const promise = this.runRefreshLoop(target, request).finally(() => {
      const currentState = target.refreshState;
      if (currentState.status === "in-flight" && currentState.promise === promise) {
        target.refreshState = { status: "idle" };
      }
    });
    target.refreshState = {
      status: "in-flight",
      promise,
      force: request.force,
      includeGitHub: request.includeGitHub,
      queued: null,
    };
    return promise;
  }

  private getThrottledSnapshot(target: TTarget): TSnapshot | null {
    if (target.latestSnapshot === null || target.lastShellOutAtMs === null) {
      return null;
    }
    const ageMs = this.now().getTime() - target.lastShellOutAtMs;
    return ageMs < this.minGapMs ? target.latestSnapshot : null;
  }

  private mergeQueuedRefresh(
    queued: QueuedWorkspaceGitRefresh | null,
    request: WorkspaceGitRefreshRequest,
  ): QueuedWorkspaceGitRefresh {
    if (!queued) {
      return { ...request };
    }

    const upgradesForce = request.force && !queued.force;
    const upgradesGitHub = request.includeGitHub && !queued.includeGitHub;
    return {
      force: queued.force || request.force,
      includeGitHub: queued.includeGitHub || request.includeGitHub,
      reason: upgradesForce || upgradesGitHub ? request.reason : queued.reason,
      notify: queued.notify || request.notify,
    };
  }

  private async runRefreshLoop(
    target: TTarget,
    initialRequest: WorkspaceGitRefreshRequest,
  ): Promise<TSnapshot> {
    let request = initialRequest;
    let snapshot!: TSnapshot;

    while (true) {
      snapshot = await this.refreshSnapshot(target, request);
      this.rememberSnapshot(target, snapshot, {
        notify: request.notify,
        forceEmit: request.force,
      });

      const state = target.refreshState;
      if (state.status !== "in-flight" || !state.queued) {
        return snapshot;
      }

      request = state.queued;
      state.queued = null;
      state.force = request.force;
      state.includeGitHub = request.includeGitHub;
    }
  }
}
