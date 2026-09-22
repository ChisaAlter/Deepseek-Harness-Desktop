import type pino from "pino";

import type { SessionOutboundMessage, WorkspaceDescriptorPayload } from "./messages.js";
import {
  buildCheckoutPrStatusPayloadFromSnapshot,
  buildCheckoutStatusPayloadFromSnapshot,
} from "./checkout/status-projection.js";
import type { WorkspaceGitWatchTarget } from "./session-internal-types.js";
import type { WorkspaceGitRuntimeSnapshot, WorkspaceGitService } from "./workspace-git-service.js";
import { normalizeWorkspaceId as normalizePersistedWorkspaceId } from "./workspace-registry-model.js";
import {
  removeWorkspaceGitSubscription as removeWorkspaceGitSubscriptionCore,
  workspaceGitDescriptorStateKey,
} from "./workspace-core.js";

interface WorkspaceGitObserverControllerOptions {
  workspaceGitService: WorkspaceGitService;
  sessionLogger: pino.Logger;
  emit(message: SessionOutboundMessage): void;
  emitWorkspaceUpdateForCwd(cwd: string): Promise<void>;
  onBranchChanged?: (
    workspaceId: string,
    oldBranch: string | null,
    newBranch: string | null,
  ) => void;
}

/** Owns per-session workspace Git subscriptions, descriptor dedupe, and snapshot fan-out. */
export class WorkspaceGitObserverController {
  private readonly workspaceGitService: WorkspaceGitService;
  private readonly sessionLogger: pino.Logger;
  private readonly emit: (message: SessionOutboundMessage) => void;
  private readonly emitWorkspaceUpdateForCwd: (cwd: string) => Promise<void>;
  private readonly onBranchChanged: WorkspaceGitObserverControllerOptions["onBranchChanged"];
  private readonly watchTargets = new Map<string, WorkspaceGitWatchTarget>();
  private readonly fetchSubscriptions = new Map<string, () => void>();
  private readonly subscriptions = new Map<string, () => void>();

  constructor(options: WorkspaceGitObserverControllerOptions) {
    this.workspaceGitService = options.workspaceGitService;
    this.sessionLogger = options.sessionLogger;
    this.emit = options.emit;
    this.emitWorkspaceUpdateForCwd = options.emitWorkspaceUpdateForCwd;
    this.onBranchChanged = options.onBranchChanged;
  }

  syncObservers(workspaces: Iterable<WorkspaceDescriptorPayload>): void {
    for (const workspace of workspaces) {
      this.syncObserver(workspace.workspaceDirectory, {
        isGit: workspace.projectKind === "git",
        workspaceId: workspace.id,
      });
      this.rememberDescriptorState(workspace.workspaceDirectory, workspace);
    }
  }

  syncObserver(cwd: string, options: { isGit: boolean; workspaceId: string }): void {
    const normalizedCwd = normalizePersistedWorkspaceId(cwd);
    if (!options.isGit) {
      this.removeSubscription(normalizedCwd);
      return;
    }
    if (this.subscriptions.has(normalizedCwd)) {
      return;
    }

    this.watchTargets.set(normalizedCwd, {
      cwd: normalizedCwd,
      workspaceId: options.workspaceId,
      watchers: [],
      debounceTimer: null,
      refreshPromise: null,
      refreshQueued: false,
      latestDescriptorStateKey: null,
      lastBranchName: null,
    });

    const subscription = this.workspaceGitService.registerWorkspace(
      { cwd: normalizedCwd },
      (snapshot) => {
        this.handleBranchSnapshot(normalizedCwd, snapshot.git.currentBranch ?? null);
        void this.emitWorkspaceUpdateForCwd(normalizedCwd);
        this.emitCheckoutStatusUpdate(normalizedCwd, snapshot);
      },
    );
    this.subscriptions.set(normalizedCwd, subscription.unsubscribe);
  }

  handleBranchSnapshot(cwd: string, branchName: string | null): void {
    const target = this.watchTargets.get(normalizePersistedWorkspaceId(cwd));
    if (!target) {
      return;
    }

    const previousBranchName = target.lastBranchName;
    if (branchName === previousBranchName) {
      return;
    }

    target.lastBranchName = branchName;
    this.onBranchChanged?.(target.workspaceId, previousBranchName, branchName);
  }

  shouldSkipDescriptorUpdate(
    workspaceId: string,
    workspace: WorkspaceDescriptorPayload | null,
  ): boolean {
    const target = this.watchTargets.get(workspaceId);
    if (!target) {
      return false;
    }
    const nextStateKey = workspaceGitDescriptorStateKey(workspace);
    if (target.latestDescriptorStateKey === nextStateKey) {
      return true;
    }
    target.latestDescriptorStateKey = nextStateKey;
    return false;
  }

  recordDescriptorUpdate(workspaceId: string, workspace: WorkspaceDescriptorPayload | null): void {
    const target = this.watchTargets.get(workspaceId);
    if (target && this.onBranchChanged) {
      const newBranchName = workspace?.name ?? null;
      if (newBranchName !== target.lastBranchName) {
        this.onBranchChanged(workspaceId, target.lastBranchName, newBranchName);
      }
    }
    this.rememberDescriptorState(workspaceId, workspace);
  }

  rememberDescriptorState(workspaceId: string, workspace: WorkspaceDescriptorPayload | null): void {
    const target = this.watchTargets.get(workspaceId);
    if (!target) {
      return;
    }
    target.latestDescriptorStateKey = workspaceGitDescriptorStateKey(workspace);
    target.lastBranchName = workspace?.name ?? null;
  }

  removeSubscription(cwd: string): void {
    removeWorkspaceGitSubscriptionCore(
      cwd,
      this.watchTargets,
      this.fetchSubscriptions,
      this.subscriptions,
    );
  }

  dispose(): void {
    const keys = new Set([
      ...this.watchTargets.keys(),
      ...this.fetchSubscriptions.keys(),
      ...this.subscriptions.keys(),
    ]);
    for (const cwd of keys) {
      try {
        this.removeSubscription(cwd);
      } catch (error) {
        this.sessionLogger.warn({ err: error, cwd }, "Failed to dispose workspace Git observer");
      }
    }
  }

  private emitCheckoutStatusUpdate(cwd: string, snapshot: WorkspaceGitRuntimeSnapshot): void {
    try {
      const requestId = `subscription:${cwd}`;
      this.emit({
        type: "checkout_status_update",
        payload: {
          ...buildCheckoutStatusPayloadFromSnapshot({ cwd, requestId, snapshot }),
          prStatus: buildCheckoutPrStatusPayloadFromSnapshot({ cwd, requestId, snapshot }),
        },
      });
    } catch (error) {
      this.sessionLogger.warn(
        { err: error, cwd },
        "Failed to emit workspace checkout status update",
      );
    }
  }
}
