import type pino from "pino";

import type {
  GitHubPullRequestStatusFacts,
  GitHubService,
  PullRequestMergeable,
} from "../services/github-service.js";
import type {
  CheckoutContext,
  CheckoutSnapshotFacts,
  getCheckoutShortstat,
  getCheckoutStatus,
  getPullRequestStatus,
} from "../utils/checkout-git.js";
import { resolveGitHubRemote, type GitHubRemoteIdentity } from "../utils/github-remote.js";
import type { WorkspaceGitRefreshRequest } from "./workspace-git-refresh-coordinator.js";

/**
 * Canonical Git and GitHub state projected for workspace consumers.
 */
export interface WorkspaceGitRuntimeSnapshot {
  cwd: string;
  git: {
    isGit: boolean;
    repoRoot: string | null;
    mainRepoRoot: string | null;
    currentBranch: string | null;
    remoteUrl: string | null;
    isChisaCodeOwnedWorktree: boolean;
    isDirty: boolean | null;
    baseRef: string | null;
    aheadBehind: { ahead: number; behind: number } | null;
    aheadOfOrigin: number | null;
    behindOfOrigin: number | null;
    hasRemote: boolean;
    diffStat: { additions: number; deletions: number } | null;
  };
  github: {
    featuresEnabled: boolean;
    pullRequest: {
      number?: number;
      repoOwner?: string;
      repoName?: string;
      url: string;
      title: string;
      state: string;
      baseRefName: string;
      headRefName: string;
      isMerged: boolean;
      isDraft?: boolean;
      mergeable?: PullRequestMergeable;
      checks?: Array<{
        name: string;
        status: "success" | "failure" | "pending" | "skipped" | "cancelled";
        url: string | null;
        workflow?: string;
        duration?: string;
      }>;
      checksStatus?: "none" | "pending" | "success" | "failure";
      reviewDecision?: "approved" | "changes_requested" | "pending" | null;
      github?: GitHubPullRequestStatusFacts;
    } | null;
    error: { message: string } | null;
  };
}

export interface WorkspaceGitSnapshotState {
  cwd: string;
  latestGit: WorkspaceGitRuntimeSnapshot["git"] | null;
  latestGithub: WorkspaceGitRuntimeSnapshot["github"] | null;
  latestSnapshot: WorkspaceGitRuntimeSnapshot | null;
  lastShellOutAtMs: number | null;
  cachedGitHubRemote: { remoteUrl: string; identity: GitHubRemoteIdentity | null } | null;
}

interface WorkspaceGitSnapshotMaterializerDependencies {
  getCheckoutStatus: typeof getCheckoutStatus;
  getCheckoutShortstat: typeof getCheckoutShortstat;
  getPullRequestStatus: typeof getPullRequestStatus;
  github: GitHubService;
  loadFacts: (
    cwd: string,
    context: CheckoutContext,
    options: { allowRecent: boolean },
  ) => Promise<CheckoutSnapshotFacts>;
  now: () => Date;
}

interface WorkspaceGitSnapshotMaterializerOptions {
  logger: pino.Logger;
  chisacodeHome: string;
  deps: WorkspaceGitSnapshotMaterializerDependencies;
}

interface WorkspaceGitHubPollTarget {
  remoteUrl: string;
  headRef: string;
}

/**
 * Materializes Git and GitHub runtime snapshots from checkout facts and provider state.
 */
export class WorkspaceGitSnapshotMaterializer {
  private readonly logger: pino.Logger;
  private readonly chisacodeHome: string;
  private readonly deps: WorkspaceGitSnapshotMaterializerDependencies;

  constructor(options: WorkspaceGitSnapshotMaterializerOptions) {
    this.logger = options.logger;
    this.chisacodeHome = options.chisacodeHome;
    this.deps = options.deps;
  }

  createState(cwd: string): WorkspaceGitSnapshotState {
    return {
      cwd,
      latestGit: null,
      latestGithub: null,
      latestSnapshot: null,
      lastShellOutAtMs: null,
      cachedGitHubRemote: null,
    };
  }

  async refresh(
    target: WorkspaceGitSnapshotState,
    request: WorkspaceGitRefreshRequest,
  ): Promise<WorkspaceGitRuntimeSnapshot> {
    const facts = await this.refreshGit(target, request);
    if (request.includeGitHub) {
      await this.refreshGitHub(target, request, facts);
    }
    return this.combine(target);
  }

  getGitHubPollTarget(target: WorkspaceGitSnapshotState): WorkspaceGitHubPollTarget | null {
    const git = target.latestGit;
    if (!git?.currentBranch || !git.remoteUrl) {
      return null;
    }

    const githubRemote = target.cachedGitHubRemote;
    if (!githubRemote || githubRemote.remoteUrl !== git.remoteUrl || !githubRemote.identity) {
      return null;
    }

    return { remoteUrl: git.remoteUrl, headRef: git.currentBranch };
  }

  applyGitHubStatus(
    target: WorkspaceGitSnapshotState,
    status: WorkspaceGitRuntimeSnapshot["github"]["pullRequest"],
  ): WorkspaceGitRuntimeSnapshot {
    target.latestGithub = {
      featuresEnabled: true,
      pullRequest: status,
      error: null,
    };
    return this.combine(target);
  }

  private async refreshGit(
    target: WorkspaceGitSnapshotState,
    request: WorkspaceGitRefreshRequest,
  ): Promise<CheckoutSnapshotFacts> {
    target.lastShellOutAtMs = this.deps.now().getTime();
    const previousPollKey = this.getGitHubPollKey(target);
    const context: CheckoutContext = { chisacodeHome: this.chisacodeHome, logger: this.logger };
    const facts = await this.deps.loadFacts(target.cwd, context, {
      allowRecent: !request.force || request.includeGitHub,
    });
    const checkoutContext: CheckoutContext = { ...context, facts };
    const checkoutStatus = await this.deps.getCheckoutStatus(target.cwd, checkoutContext);
    if (!checkoutStatus.isGit) {
      target.latestGit = buildNotGitSnapshot(target.cwd).git;
      target.cachedGitHubRemote = null;
      target.latestGithub = buildGitHubUnavailableSnapshot();
      return facts;
    }

    await this.resolveGitHubRemote(target, checkoutStatus.remoteUrl);
    const diffStat = await this.deps
      .getCheckoutShortstat(target.cwd, checkoutContext, { force: request.force })
      .catch(() => null);

    target.latestGit = {
      isGit: true,
      repoRoot: checkoutStatus.repoRoot,
      mainRepoRoot: checkoutStatus.mainRepoRoot,
      currentBranch: checkoutStatus.currentBranch,
      remoteUrl: checkoutStatus.remoteUrl,
      isChisaCodeOwnedWorktree: checkoutStatus.isChisaCodeOwnedWorktree,
      isDirty: checkoutStatus.isDirty,
      baseRef: checkoutStatus.baseRef,
      aheadBehind: checkoutStatus.aheadBehind,
      aheadOfOrigin: checkoutStatus.aheadOfOrigin,
      behindOfOrigin: checkoutStatus.behindOfOrigin,
      hasRemote: checkoutStatus.hasRemote,
      diffStat,
    };

    if (previousPollKey !== this.getGitHubPollKey(target)) {
      target.latestGithub = buildGitHubUnavailableSnapshot();
    }
    return facts;
  }

  private async resolveGitHubRemote(
    target: WorkspaceGitSnapshotState,
    remoteUrl: string | null,
  ): Promise<GitHubRemoteIdentity | null> {
    if (!remoteUrl) {
      target.cachedGitHubRemote = null;
      return null;
    }
    if (target.cachedGitHubRemote?.remoteUrl === remoteUrl) {
      return target.cachedGitHubRemote.identity;
    }
    const identity = await resolveGitHubRemote({ remoteUrl });
    target.cachedGitHubRemote = { remoteUrl, identity };
    return identity;
  }

  private async refreshGitHub(
    target: WorkspaceGitSnapshotState,
    request: WorkspaceGitRefreshRequest,
    facts: CheckoutSnapshotFacts,
  ): Promise<void> {
    const forceGitHub = request.force && request.includeGitHub;
    if (forceGitHub) {
      this.deps.github.invalidate({ cwd: target.cwd });
    }

    target.latestGithub = await this.loadGitHubSnapshot({
      cwd: target.cwd,
      githubRemote: target.cachedGitHubRemote?.identity ?? null,
      force: forceGitHub,
      reason: request.reason,
      facts,
    });
  }

  private async loadGitHubSnapshot(options: {
    cwd: string;
    githubRemote: GitHubRemoteIdentity | null;
    force?: boolean;
    reason?: string;
    facts?: CheckoutSnapshotFacts;
  }): Promise<WorkspaceGitRuntimeSnapshot["github"]> {
    if (!options.githubRemote) {
      return buildGitHubUnavailableSnapshot();
    }

    try {
      const isAuthenticated = await this.deps.github.isAuthenticated({ cwd: options.cwd });
      if (!isAuthenticated) {
        return buildGitHubUnavailableSnapshot();
      }
    } catch {
      return buildGitHubUnavailableSnapshot();
    }

    try {
      const result = await this.deps.getPullRequestStatus(
        options.cwd,
        this.deps.github,
        { force: options.force, reason: options.reason },
        { facts: options.facts },
      );
      return {
        featuresEnabled: true,
        pullRequest: result.status,
        error: null,
      };
    } catch (error) {
      return {
        featuresEnabled: true,
        pullRequest: null,
        error: { message: error instanceof Error ? error.message : String(error) },
      };
    }
  }

  private combine(target: WorkspaceGitSnapshotState): WorkspaceGitRuntimeSnapshot {
    if (!target.latestGit) {
      return target.latestSnapshot ?? buildNotGitSnapshot(target.cwd);
    }
    return {
      cwd: target.cwd,
      git: target.latestGit,
      github: target.latestGithub ?? buildGitHubUnavailableSnapshot(),
    };
  }

  private getGitHubPollKey(target: WorkspaceGitSnapshotState): string | null {
    const pollTarget = this.getGitHubPollTarget(target);
    return pollTarget ? JSON.stringify([pollTarget.remoteUrl, pollTarget.headRef]) : null;
  }
}

function buildNotGitSnapshot(cwd: string): WorkspaceGitRuntimeSnapshot {
  return {
    cwd,
    git: {
      isGit: false,
      repoRoot: null,
      mainRepoRoot: null,
      currentBranch: null,
      remoteUrl: null,
      isChisaCodeOwnedWorktree: false,
      isDirty: null,
      baseRef: null,
      aheadBehind: null,
      aheadOfOrigin: null,
      behindOfOrigin: null,
      hasRemote: false,
      diffStat: null,
    },
    github: buildGitHubUnavailableSnapshot(),
  };
}

function buildGitHubUnavailableSnapshot(): WorkspaceGitRuntimeSnapshot["github"] {
  return {
    featuresEnabled: false,
    pullRequest: null,
    error: null,
  };
}
