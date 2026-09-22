import { watch } from "node:fs";
import { readdir } from "node:fs/promises";
import type pino from "pino";
import type { ProjectCheckoutLitePayload } from "@chisacode/protocol/messages";
import {
  type CheckoutDiffCompare,
  type CheckoutDiffResult,
  getCheckoutDiff,
  getCheckoutSnapshotFacts,
  getCheckoutShortstat,
  getCheckoutStatus,
  getPullRequestStatus,
  listBranchSuggestions,
  resolveRepositoryDefaultBranch,
  resolveBranchCheckout,
  resolveAbsoluteGitDir,
} from "../utils/checkout-git.js";
import { createGitHubService, type GitHubService } from "../services/github-service.js";
import { runGitCommand } from "../utils/run-git-command.js";
import { listChisaCodeWorktrees } from "../utils/worktree.js";
import {
  WorkspaceGitAuxiliaryReadAuthority,
  type WorkspaceGitBranchSuggestion,
  type WorkspaceGitBranchSuggestionsOptions,
  type WorkspaceGitBranchValidationResult,
  type WorkspaceGitReadOptions,
  type WorkspaceGitStashEntry,
  type WorkspaceGitStashListOptions,
  type WorkspaceGitWorktreeInfo,
} from "./workspace-git-auxiliary-read-authority.js";
import { WorkspaceGitCheckoutObservationAuthority } from "./workspace-git-checkout-observation-authority.js";
import {
  WorkspaceGitRefreshCoordinator,
  type WorkspaceGitRefreshRequest,
  type WorkspaceGitRefreshState,
} from "./workspace-git-refresh-coordinator.js";
import { WorkspaceGitHubPollBinding } from "./workspace-git-github-poll-binding.js";
import { WorkspaceGitRepositoryFetchAuthority } from "./workspace-git-repository-fetch-authority.js";
import {
  WorkspaceGitSnapshotMaterializer,
  type WorkspaceGitRuntimeSnapshot,
  type WorkspaceGitSnapshotState,
} from "./workspace-git-snapshot-materializer.js";
import { WorkspaceGitWorkingTreeObserver } from "./workspace-git-working-tree-observer.js";
import type { WorkspaceGitMetadata } from "./workspace-git-metadata.js";
import { checkoutLiteFromGitSnapshot, normalizeWorkspaceId } from "./workspace-registry-model.js";

const WORKSPACE_GIT_WATCH_DEBOUNCE_MS = 500;
export const WORKSPACE_GIT_SELF_HEAL_INTERVAL_MS = 60_000;

// Non-forced snapshot refresh triggers share this minimum gap to absorb watcher/self-heal bursts.
const WORKSPACE_GIT_INTERNAL_MIN_GAP_MS = 2_000;

export interface WorkspaceGitService {
  registerWorkspace(
    params: { cwd: string },
    listener: WorkspaceGitListener,
  ): WorkspaceGitSubscription;

  onSnapshotUpdated(listener: WorkspaceGitSnapshotUpdatedListener): WorkspaceGitSubscription;
  peekSnapshot(cwd: string): WorkspaceGitRuntimeSnapshot | null;
  getCheckout(cwd: string): Promise<ProjectCheckoutLitePayload>;
  getSnapshot(
    cwd: string,
    options?: WorkspaceGitSnapshotOptions,
  ): Promise<WorkspaceGitRuntimeSnapshot>;
  getCheckoutDiff(
    cwd: string,
    options: CheckoutDiffCompare,
    readOptions?: WorkspaceGitReadOptions,
  ): Promise<CheckoutDiffResult>;
  validateBranchRef(
    cwd: string,
    ref: string,
    options?: WorkspaceGitReadOptions,
  ): Promise<WorkspaceGitBranchValidationResult>;
  hasLocalBranch(cwd: string, branch: string, options?: WorkspaceGitReadOptions): Promise<boolean>;
  suggestBranchesForCwd(
    cwd: string,
    options?: WorkspaceGitBranchSuggestionsOptions,
    readOptions?: WorkspaceGitReadOptions,
  ): Promise<WorkspaceGitBranchSuggestion[]>;
  listStashes(
    cwd: string,
    options?: WorkspaceGitStashListOptions,
    readOptions?: WorkspaceGitReadOptions,
  ): Promise<WorkspaceGitStashEntry[]>;
  listWorktrees(
    cwdOrRepoRoot: string,
    options?: WorkspaceGitReadOptions,
  ): Promise<WorkspaceGitWorktreeInfo[]>;
  getWorkspaceGitMetadata(
    cwd: string,
    options?: WorkspaceGitReadOptions & { directoryName?: string },
  ): Promise<WorkspaceGitMetadata>;
  resolveRepoRoot(cwd: string, options?: WorkspaceGitReadOptions): Promise<string>;
  resolveDefaultBranch(cwdOrRepoRoot: string, options?: WorkspaceGitReadOptions): Promise<string>;
  resolveRepoRemoteUrl(cwd: string, options?: WorkspaceGitReadOptions): Promise<string | null>;
  refresh(cwd: string, options?: { priority?: "normal" | "high" }): Promise<void>;
  requestWorkingTreeWatch(
    cwd: string,
    onChange: () => void,
  ): Promise<{ repoRoot: string | null; unsubscribe: () => void }>;
  scheduleRefreshForCwd(cwd: string): void;
  dispose(): void;
}

export type {
  WorkspaceGitBranchSuggestion,
  WorkspaceGitBranchSuggestionsOptions,
  WorkspaceGitBranchValidationResult,
  WorkspaceGitReadOptions,
  WorkspaceGitStashEntry,
  WorkspaceGitStashListOptions,
  WorkspaceGitWorktreeInfo,
} from "./workspace-git-auxiliary-read-authority.js";
export type { WorkspaceGitRuntimeSnapshot } from "./workspace-git-snapshot-materializer.js";
export type WorkspaceGitListener = (snapshot: WorkspaceGitRuntimeSnapshot) => void;
export type WorkspaceGitSnapshotUpdatedListener = (snapshot: WorkspaceGitRuntimeSnapshot) => void;

export interface WorkspaceGitSubscription {
  unsubscribe: () => void;
}

export type WorkspaceGitSnapshotOptions =
  | {
      force?: false;
      includeGitHub?: boolean;
      reason?: string;
    }
  | {
      force: true;
      includeGitHub?: boolean;
      reason: string;
    };

interface WorkspaceGitServiceDependencies {
  watch: typeof watch;
  readdir: typeof readdir;
  getCheckoutSnapshotFacts: typeof getCheckoutSnapshotFacts;
  getCheckoutStatus: typeof getCheckoutStatus;
  getCheckoutShortstat: typeof getCheckoutShortstat;
  getCheckoutDiff: typeof getCheckoutDiff;
  getPullRequestStatus: typeof getPullRequestStatus;
  resolveBranchCheckout: typeof resolveBranchCheckout;
  resolveRepositoryDefaultBranch: typeof resolveRepositoryDefaultBranch;
  listBranchSuggestions: typeof listBranchSuggestions;
  listChisaCodeWorktrees: typeof listChisaCodeWorktrees;
  github: GitHubService;
  resolveAbsoluteGitDir: (cwd: string) => Promise<string | null>;
  runGitFetch: (cwd: string) => Promise<void>;
  runGitCommand: typeof runGitCommand;
  now: () => Date;
}

interface WorkspaceGitServiceOptions {
  logger: pino.Logger;
  chisacodeHome: string;
  deps?: Partial<WorkspaceGitServiceDependencies>;
}

interface WorkspaceGitTarget extends WorkspaceGitSnapshotState {
  listeners: Set<WorkspaceGitListener>;
  debounceTimer: NodeJS.Timeout | null;
  selfHealTimer: NodeJS.Timeout | null;
  refreshState: WorkspaceGitRefreshState<WorkspaceGitRuntimeSnapshot>;
  latestFingerprint: string | null;
  closed: boolean;
}

function buildDefaultWorkspaceGitServiceDeps(logger: pino.Logger): WorkspaceGitServiceDependencies {
  return {
    watch,
    readdir,
    getCheckoutSnapshotFacts,
    getCheckoutStatus,
    getCheckoutShortstat,
    getCheckoutDiff,
    getPullRequestStatus,
    resolveBranchCheckout,
    resolveRepositoryDefaultBranch,
    listBranchSuggestions,
    listChisaCodeWorktrees,
    github: createGitHubService({ logger }),
    resolveAbsoluteGitDir,
    runGitFetch,
    runGitCommand,
    now: () => new Date(),
  };
}

function resolveWorkspaceGitServiceDeps(
  deps: Partial<WorkspaceGitServiceDependencies> | undefined,
  logger: pino.Logger,
): WorkspaceGitServiceDependencies {
  return { ...buildDefaultWorkspaceGitServiceDeps(logger), ...deps };
}

export class WorkspaceGitServiceImpl implements WorkspaceGitService {
  private readonly logger: pino.Logger;
  private readonly chisacodeHome: string;
  private readonly deps: WorkspaceGitServiceDependencies;
  private readonly snapshotUpdatedListeners = new Set<WorkspaceGitSnapshotUpdatedListener>();
  private readonly workspaceTargets = new Map<string, WorkspaceGitTarget>();
  private readonly workingTreeObserver: WorkspaceGitWorkingTreeObserver;
  private readonly auxiliaryReadAuthority: WorkspaceGitAuxiliaryReadAuthority;
  private readonly checkoutObservation: WorkspaceGitCheckoutObservationAuthority;
  private readonly snapshotMaterializer: WorkspaceGitSnapshotMaterializer;
  private readonly refreshCoordinator: WorkspaceGitRefreshCoordinator<
    WorkspaceGitRuntimeSnapshot,
    WorkspaceGitTarget
  >;
  private readonly githubPollBinding: WorkspaceGitHubPollBinding;
  private readonly repositoryFetchAuthority: WorkspaceGitRepositoryFetchAuthority;
  constructor(options: WorkspaceGitServiceOptions) {
    this.logger = options.logger.child({ module: "workspace-git-service" });
    this.chisacodeHome = options.chisacodeHome;
    this.deps = resolveWorkspaceGitServiceDeps(options.deps, this.logger);
    this.auxiliaryReadAuthority = new WorkspaceGitAuxiliaryReadAuthority({
      chisacodeHome: this.chisacodeHome,
      deps: {
        getCheckoutDiff: this.deps.getCheckoutDiff,
        resolveBranchCheckout: this.deps.resolveBranchCheckout,
        resolveRepositoryDefaultBranch: this.deps.resolveRepositoryDefaultBranch,
        listBranchSuggestions: this.deps.listBranchSuggestions,
        listChisaCodeWorktrees: this.deps.listChisaCodeWorktrees,
        runGitCommand: this.deps.runGitCommand,
        getSnapshot: (cwd, readOptions) => this.getSnapshot(cwd, readOptions),
        now: this.deps.now,
      },
    });
    this.repositoryFetchAuthority = new WorkspaceGitRepositoryFetchAuthority({
      logger: this.logger,
      deps: {
        runGitFetch: this.deps.runGitFetch,
        refreshWorkspace: async (cwd) => {
          const target = this.workspaceTargets.get(cwd);
          if (!target) {
            return;
          }
          await this.refreshWorkspaceTarget(target, {
            force: false,
            includeGitHub: false,
            reason: "repo-fetch",
            notify: true,
          });
        },
      },
    });
    this.checkoutObservation = new WorkspaceGitCheckoutObservationAuthority({
      logger: this.logger,
      chisacodeHome: this.chisacodeHome,
      deps: {
        watch: this.deps.watch,
        getCheckoutSnapshotFacts: this.deps.getCheckoutSnapshotFacts,
        now: this.deps.now,
        hasLocalSnapshot: (cwd) => this.peekSnapshot(cwd) !== null,
      },
      repositoryFetchAuthority: this.repositoryFetchAuthority,
      scheduleRefresh: (cwd) => this.scheduleWorkspaceRefresh(cwd),
    });
    this.snapshotMaterializer = new WorkspaceGitSnapshotMaterializer({
      logger: this.logger,
      chisacodeHome: this.chisacodeHome,
      deps: {
        getCheckoutStatus: this.deps.getCheckoutStatus,
        getCheckoutShortstat: this.deps.getCheckoutShortstat,
        getPullRequestStatus: this.deps.getPullRequestStatus,
        github: this.deps.github,
        loadFacts: (cwd, context, loadOptions) =>
          this.checkoutObservation.loadFacts(cwd, context, loadOptions),
        now: this.deps.now,
      },
    });
    this.refreshCoordinator = new WorkspaceGitRefreshCoordinator({
      now: this.deps.now,
      minGapMs: WORKSPACE_GIT_INTERNAL_MIN_GAP_MS,
      refreshSnapshot: (target, request) => this.snapshotMaterializer.refresh(target, request),
      rememberSnapshot: (target, snapshot, rememberOptions) => {
        this.rememberSnapshot(target, snapshot, rememberOptions);
      },
    });
    this.githubPollBinding = new WorkspaceGitHubPollBinding({
      logger: this.logger,
      github: this.deps.github,
    });
    this.workingTreeObserver = new WorkspaceGitWorkingTreeObserver({
      logger: this.logger,
      deps: {
        watch: this.deps.watch,
        readdir: this.deps.readdir,
        resolveAbsoluteGitDir: this.deps.resolveAbsoluteGitDir,
        runGitCommand: this.deps.runGitCommand,
        now: this.deps.now,
      },
      scheduleRefreshForCwd: (cwd, refreshOptions) => {
        this.scheduleWorkspaceRefresh(cwd, refreshOptions);
      },
    });
  }

  registerWorkspace(
    params: { cwd: string },
    listener: WorkspaceGitListener,
  ): WorkspaceGitSubscription {
    const cwd = normalizeWorkspaceId(params.cwd);
    const target = this.ensureWorkspaceTarget(cwd);
    target.listeners.add(listener);
    if (target.listeners.size === 1) {
      this.startWorkspaceSubscriptionTimers(target);
    }
    if (!target.latestSnapshot) {
      this.scheduleInitialWorkspaceRefresh(target);
    }
    this.checkoutObservation.observe(cwd);

    return {
      unsubscribe: () => {
        this.removeWorkspaceListener(cwd, listener);
      },
    };
  }

  onSnapshotUpdated(listener: WorkspaceGitSnapshotUpdatedListener): WorkspaceGitSubscription {
    this.snapshotUpdatedListeners.add(listener);
    return {
      unsubscribe: () => {
        this.snapshotUpdatedListeners.delete(listener);
      },
    };
  }

  async getSnapshot(
    cwd: string,
    options?: WorkspaceGitSnapshotOptions,
  ): Promise<WorkspaceGitRuntimeSnapshot> {
    cwd = normalizeWorkspaceId(cwd);
    const request = this.refreshCoordinator.normalizeRequest(options, "getSnapshot", true);
    const target = this.ensureWorkspaceTarget(cwd);
    if (!request.force && target.latestSnapshot) {
      return target.latestSnapshot;
    }

    return this.refreshCoordinator.request(target, request);
  }

  async getCheckout(cwd: string): Promise<ProjectCheckoutLitePayload> {
    const normalizedCwd = normalizeWorkspaceId(cwd);
    try {
      const status = await this.deps.getCheckoutStatus(normalizedCwd, {
        chisacodeHome: this.chisacodeHome,
        logger: this.logger,
      });
      if (!status.isGit) {
        return checkoutLiteFromGitSnapshot(normalizedCwd, {
          isGit: false,
          currentBranch: null,
          remoteUrl: null,
          repoRoot: null,
          isChisaCodeOwnedWorktree: false,
          mainRepoRoot: null,
        });
      }
      return checkoutLiteFromGitSnapshot(normalizedCwd, {
        isGit: true,
        currentBranch: status.currentBranch,
        remoteUrl: status.remoteUrl,
        repoRoot: status.repoRoot,
        isChisaCodeOwnedWorktree: status.isChisaCodeOwnedWorktree,
        mainRepoRoot: status.mainRepoRoot,
      });
    } catch {
      return checkoutLiteFromGitSnapshot(normalizedCwd, {
        isGit: false,
        currentBranch: null,
        remoteUrl: null,
        repoRoot: null,
        isChisaCodeOwnedWorktree: false,
        mainRepoRoot: null,
      });
    }
  }

  peekSnapshot(cwd: string): WorkspaceGitRuntimeSnapshot | null {
    cwd = normalizeWorkspaceId(cwd);
    return this.workspaceTargets.get(cwd)?.latestSnapshot ?? null;
  }

  getCheckoutDiff(
    cwd: string,
    options: CheckoutDiffCompare,
    readOptions?: WorkspaceGitReadOptions,
  ): Promise<CheckoutDiffResult> {
    return this.auxiliaryReadAuthority.getCheckoutDiff(cwd, options, readOptions);
  }

  validateBranchRef(
    cwd: string,
    ref: string,
    options?: WorkspaceGitReadOptions,
  ): Promise<WorkspaceGitBranchValidationResult> {
    return this.auxiliaryReadAuthority.validateBranchRef(cwd, ref, options);
  }

  hasLocalBranch(cwd: string, branch: string, options?: WorkspaceGitReadOptions): Promise<boolean> {
    return this.auxiliaryReadAuthority.hasLocalBranch(cwd, branch, options);
  }

  suggestBranchesForCwd(
    cwd: string,
    options?: WorkspaceGitBranchSuggestionsOptions,
    readOptions?: WorkspaceGitReadOptions,
  ): Promise<WorkspaceGitBranchSuggestion[]> {
    return this.auxiliaryReadAuthority.suggestBranchesForCwd(cwd, options, readOptions);
  }

  listStashes(
    cwd: string,
    options?: WorkspaceGitStashListOptions,
    readOptions?: WorkspaceGitReadOptions,
  ): Promise<WorkspaceGitStashEntry[]> {
    return this.auxiliaryReadAuthority.listStashes(cwd, options, readOptions);
  }

  listWorktrees(
    cwdOrRepoRoot: string,
    options?: WorkspaceGitReadOptions,
  ): Promise<WorkspaceGitWorktreeInfo[]> {
    return this.auxiliaryReadAuthority.listWorktrees(cwdOrRepoRoot, options);
  }

  resolveRepoRoot(cwd: string, options?: WorkspaceGitReadOptions): Promise<string> {
    return this.auxiliaryReadAuthority.resolveRepoRoot(cwd, options);
  }

  resolveDefaultBranch(cwdOrRepoRoot: string, options?: WorkspaceGitReadOptions): Promise<string> {
    return this.auxiliaryReadAuthority.resolveDefaultBranch(cwdOrRepoRoot, options);
  }

  getWorkspaceGitMetadata(
    cwd: string,
    options?: WorkspaceGitReadOptions & { directoryName?: string },
  ): Promise<WorkspaceGitMetadata> {
    return this.auxiliaryReadAuthority.getWorkspaceGitMetadata(cwd, options);
  }

  resolveRepoRemoteUrl(cwd: string, options?: WorkspaceGitReadOptions): Promise<string | null> {
    return this.auxiliaryReadAuthority.resolveRepoRemoteUrl(cwd, options);
  }
  async refresh(cwd: string, _options?: { priority?: "normal" | "high" }): Promise<void> {
    cwd = normalizeWorkspaceId(cwd);
    const target = this.ensureWorkspaceTarget(cwd);
    await this.refreshWorkspaceTarget(target, {
      force: false,
      includeGitHub: false,
      reason: "refresh",
      notify: true,
    });
    this.checkoutObservation.ensureSetup(cwd);
  }

  requestWorkingTreeWatch(
    cwd: string,
    onChange: () => void,
  ): Promise<{ repoRoot: string | null; unsubscribe: () => void }> {
    return this.workingTreeObserver.requestWatch(cwd, onChange);
  }

  scheduleRefreshForCwd(cwd: string): void {
    cwd = normalizeWorkspaceId(cwd);
    const target = this.workspaceTargets.get(cwd);
    if (target) {
      this.scheduleWorkspaceRefresh(target);
    }
  }

  dispose(): void {
    for (const target of this.workspaceTargets.values()) {
      this.closeWorkspaceTarget(target);
    }
    this.workspaceTargets.clear();

    this.checkoutObservation.dispose();
    this.repositoryFetchAuthority.dispose();
    this.githubPollBinding.dispose();
    this.workingTreeObserver.dispose();
    this.snapshotUpdatedListeners.clear();
  }

  private ensureWorkspaceTarget(cwd: string): WorkspaceGitTarget {
    const existingTarget = this.workspaceTargets.get(cwd);
    if (existingTarget) {
      return existingTarget;
    }

    return this.createWorkspaceTarget(cwd);
  }

  private createWorkspaceTarget(cwd: string): WorkspaceGitTarget {
    const target: WorkspaceGitTarget = {
      ...this.snapshotMaterializer.createState(cwd),
      listeners: new Set(),
      debounceTimer: null,
      selfHealTimer: null,
      refreshState: { status: "idle" },
      latestFingerprint: null,
      closed: false,
    };

    this.workspaceTargets.set(cwd, target);
    return target;
  }

  private scheduleInitialWorkspaceRefresh(target: WorkspaceGitTarget): void {
    queueMicrotask(() => {
      if (!this.isActiveObservedWorkspaceTarget(target) || target.latestSnapshot) {
        return;
      }
      void this.refreshWorkspaceTarget(target, {
        force: false,
        includeGitHub: false,
        reason: "initial",
        notify: true,
      }).then(async () => {
        if (!this.isActiveObservedWorkspaceTarget(target)) {
          return;
        }
        await this.suggestBranchesForCwd(target.cwd, { limit: 20 }).catch(() => undefined);
        if (!this.isActiveObservedWorkspaceTarget(target)) {
          return;
        }
        this.checkoutObservation.attachFetchIfReady(target.cwd);
        return this.refreshWorkspaceTarget(target, {
          force: true,
          includeGitHub: true,
          reason: "initial-github",
          notify: true,
        });
      });
    });
  }

  private isActiveObservedWorkspaceTarget(target: WorkspaceGitTarget): boolean {
    return (
      !target.closed &&
      target.listeners.size > 0 &&
      this.workspaceTargets.get(target.cwd) === target
    );
  }

  private scheduleWorkspaceRefresh(
    targetOrCwd: WorkspaceGitTarget | string,
    options?: { force?: boolean; reason?: string },
  ): void {
    const target =
      typeof targetOrCwd === "string"
        ? this.workspaceTargets.get(normalizeWorkspaceId(targetOrCwd))
        : targetOrCwd;
    if (!target || target.closed || this.workspaceTargets.get(target.cwd) !== target) {
      return;
    }

    if (target.debounceTimer) {
      clearTimeout(target.debounceTimer);
    }

    target.debounceTimer = setTimeout(() => {
      if (target.closed || this.workspaceTargets.get(target.cwd) !== target) {
        return;
      }
      target.debounceTimer = null;
      void this.refreshWorkspaceTarget(target, {
        force: options?.force === true,
        includeGitHub: false,
        reason: options?.reason ?? "watch",
        notify: true,
      });
    }, WORKSPACE_GIT_WATCH_DEBOUNCE_MS);
  }

  private startWorkspaceSubscriptionTimers(target: WorkspaceGitTarget): void {
    if (!target.selfHealTimer) {
      target.selfHealTimer = setInterval(() => {
        this.checkoutObservation.ensureSetup(target.cwd);
        this.refreshWorkspaceTarget(target, {
          force: false,
          includeGitHub: false,
          reason: "self-heal-git",
          notify: true,
        }).catch((error) => {
          this.logger.warn(
            { err: error, cwd: target.cwd, reason: "self-heal-git" },
            "Failed to run workspace git self-heal refresh",
          );
        });
      }, WORKSPACE_GIT_SELF_HEAL_INTERVAL_MS);
    }

    this.updateGitHubPollForTarget(target);
  }

  private updateGitHubPollForTarget(target: WorkspaceGitTarget): void {
    const pollTarget =
      target.listeners.size > 0 ? this.snapshotMaterializer.getGitHubPollTarget(target) : null;
    const headRef = pollTarget?.headRef ?? null;

    this.githubPollBinding.sync({
      cwd: target.cwd,
      remoteUrl: pollTarget?.remoteUrl ?? null,
      headRef,
      onStatus: (status) => {
        if (!this.isActiveObservedWorkspaceTarget(target)) {
          return;
        }
        const snapshot = this.snapshotMaterializer.applyGitHubStatus(target, status);
        this.rememberSnapshot(target, snapshot, { notify: true, forceEmit: false });
      },
      onError: (error) => {
        this.logger.warn(
          { err: error, cwd: target.cwd, headRef, reason: "self-heal-github" },
          "Failed to run GitHub self-heal refresh",
        );
      },
    });
  }
  private async refreshWorkspaceTarget(
    target: WorkspaceGitTarget,
    request: WorkspaceGitRefreshRequest,
  ): Promise<void> {
    if (target.closed || this.workspaceTargets.get(target.cwd) !== target) {
      return;
    }
    try {
      await this.refreshCoordinator.request(target, request);
    } catch (error) {
      this.logger.warn(
        { err: error, cwd: target.cwd, reason: request.reason },
        "Failed to refresh workspace git snapshot",
      );
    }
  }

  private rememberSnapshot(
    target: WorkspaceGitTarget,
    snapshot: WorkspaceGitRuntimeSnapshot,
    options?: { forceEmit?: boolean; notify?: boolean },
  ): void {
    target.latestSnapshot = snapshot;
    if (target.listeners.size > 0) {
      this.updateGitHubPollForTarget(target);
    }
    const fingerprint = JSON.stringify(snapshot);
    const fingerprintMatches = target.latestFingerprint === fingerprint;
    if (fingerprintMatches && !options?.forceEmit) {
      return;
    }
    target.latestFingerprint = fingerprint;
    if (!options?.notify || target.listeners.size === 0) {
      return;
    }
    for (const listener of target.listeners) {
      try {
        listener(snapshot);
      } catch (error) {
        this.logger.warn({ err: error, cwd: snapshot.cwd }, "Workspace git listener threw");
      }
    }
    for (const listener of this.snapshotUpdatedListeners) {
      try {
        listener(snapshot);
      } catch (error) {
        this.logger.warn(
          { err: error, cwd: snapshot.cwd },
          "Workspace git snapshot listener threw",
        );
      }
    }
  }

  private removeWorkspaceListener(cwd: string, listener: WorkspaceGitListener): void {
    const target = this.workspaceTargets.get(cwd);
    if (!target) {
      return;
    }

    target.listeners.delete(listener);
    if (target.listeners.size > 0) {
      return;
    }

    this.removeWorkspaceTarget(target);
  }

  private removeWorkspaceTarget(target: WorkspaceGitTarget): void {
    this.closeWorkspaceTarget(target);
    this.workspaceTargets.delete(target.cwd);
  }

  private closeWorkspaceTarget(target: WorkspaceGitTarget): void {
    target.closed = true;
    if (target.debounceTimer) {
      clearTimeout(target.debounceTimer);
      target.debounceTimer = null;
    }
    if (target.selfHealTimer) {
      clearInterval(target.selfHealTimer);
      target.selfHealTimer = null;
    }
    this.githubPollBinding.remove(target.cwd);

    this.checkoutObservation.remove(target.cwd);
    target.listeners.clear();
  }
}

async function runGitFetch(cwd: string): Promise<void> {
  await runGitCommand(["fetch", "origin", "--prune"], {
    cwd,
    envOverlay: { GIT_TERMINAL_PROMPT: "0" },
    timeout: 120_000,
  });
}
