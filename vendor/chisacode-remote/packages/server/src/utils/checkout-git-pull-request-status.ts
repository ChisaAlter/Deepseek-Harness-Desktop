import { resolve } from "node:path";

import { TTLCache } from "@isaacs/ttlcache";

import {
  GitHubAuthenticationError,
  GitHubCliMissingError,
  GitHubCommandError,
  type GitHubPullRequestStatusFacts,
  type GitHubService,
  type PullRequestMergeable,
} from "../services/github-service.js";
import { requireGitRepo } from "./checkout-git-repository.js";

const DEFAULT_PULL_REQUEST_STATUS_CACHE_TTL_MS = 30_000;
const PULL_REQUEST_STATUS_CACHE_MAX = 1_000;

let pullRequestStatusCacheTtlMs = DEFAULT_PULL_REQUEST_STATUS_CACHE_TTL_MS;
let pullRequestStatusCache = createPullRequestStatusCache(pullRequestStatusCacheTtlMs);
const pullRequestStatusInFlight = new Map<string, Promise<PullRequestStatusResult>>();
const lastSuccessfulPullRequestStatus = new Map<string, PullRequestStatusResult>();

/** GitHub head branch identity used to find the pull request for a checkout. */
export interface PullRequestStatusLookupTarget {
  headRef: string;
  headRepositoryOwner?: string;
}

/** Pull request check projection returned to checkout consumers. */
export interface PullRequestCheck {
  name: string;
  status: "success" | "failure" | "pending" | "skipped" | "cancelled";
  url: string | null;
  workflow?: string;
  duration?: string;
}

/** Aggregate pull request check state. */
export type ChecksStatus = "none" | "pending" | "success" | "failure";

/** Aggregate pull request review decision. */
export type ReviewDecision = "approved" | "changes_requested" | "pending" | null;

/** Pull request status projection exposed by checkout APIs. */
export interface PullRequestStatus {
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
  checks?: PullRequestCheck[];
  checksStatus?: ChecksStatus;
  reviewDecision?: ReviewDecision;
  github?: GitHubPullRequestStatusFacts;
}

/** Pull request status plus GitHub feature availability for the checkout. */
export interface PullRequestStatusResult {
  status: PullRequestStatus | null;
  githubFeaturesEnabled: boolean;
}

interface PullRequestStatusReadOptions {
  force?: boolean;
  reason?: string;
}

type CheckoutPullRequestStatusFacts =
  | { isGit: false }
  | {
      isGit: true;
      currentBranch: string | null;
    };

interface CheckoutPullRequestStatusDependencies<TContext> {
  getFacts(context: TContext | undefined): CheckoutPullRequestStatusFacts | null | undefined;
  getCurrentBranch(cwd: string): Promise<string | null>;
  resolveLookupTarget(
    cwd: string,
    head: string,
    context: TContext | undefined,
  ): Promise<PullRequestStatusLookupTarget>;
}

function createPullRequestStatusCache(ttlMs: number) {
  return new TTLCache<string, PullRequestStatusResult>({
    ttl: ttlMs,
    max: PULL_REQUEST_STATUS_CACHE_MAX,
    checkAgeOnGet: true,
  });
}

function getPullRequestStatusCacheKey(cwd: string): string {
  return resolve(cwd);
}

function rememberPullRequestStatus(cacheKey: string, status: PullRequestStatusResult): void {
  lastSuccessfulPullRequestStatus.set(cacheKey, status);
  if (lastSuccessfulPullRequestStatus.size <= PULL_REQUEST_STATUS_CACHE_MAX) {
    return;
  }
  const oldest = lastSuccessfulPullRequestStatus.keys().next();
  if (!oldest.done) {
    lastSuccessfulPullRequestStatus.delete(oldest.value);
  }
}

function resetPullRequestStatusCache(): void {
  pullRequestStatusCache.clear();
  pullRequestStatusCache.cancelTimer();
  pullRequestStatusCacheTtlMs = DEFAULT_PULL_REQUEST_STATUS_CACHE_TTL_MS;
  pullRequestStatusCache = createPullRequestStatusCache(pullRequestStatusCacheTtlMs);
  pullRequestStatusInFlight.clear();
  lastSuccessfulPullRequestStatus.clear();
}

function setPullRequestStatusCacheTtl(ttlMs: number): void {
  pullRequestStatusCache.clear();
  pullRequestStatusCache.cancelTimer();
  pullRequestStatusCacheTtlMs = ttlMs;
  pullRequestStatusCache = createPullRequestStatusCache(ttlMs);
  pullRequestStatusInFlight.clear();
  lastSuccessfulPullRequestStatus.clear();
}

async function getPullRequestStatusUncached<TContext>(
  cwd: string,
  github: GitHubService,
  options: PullRequestStatusReadOptions | undefined,
  context: TContext | undefined,
  dependencies: CheckoutPullRequestStatusDependencies<TContext>,
): Promise<PullRequestStatusResult> {
  const facts = dependencies.getFacts(context);
  if (facts?.isGit === false) {
    return {
      status: null,
      githubFeaturesEnabled: false,
    };
  }
  if (!facts?.isGit) {
    await requireGitRepo(cwd);
  }
  const head = facts?.isGit ? facts.currentBranch : await dependencies.getCurrentBranch(cwd);
  if (!head) {
    return {
      status: null,
      githubFeaturesEnabled: false,
    };
  }

  try {
    const lookupTarget = await dependencies.resolveLookupTarget(cwd, head, context);
    if (options?.force) {
      const reason = options.reason;
      if (!reason) {
        throw new Error("Forced PR status read requires a reason");
      }
      const status = await github.getCurrentPullRequestStatus({
        cwd,
        ...lookupTarget,
        force: true,
        reason,
      });
      return {
        status,
        githubFeaturesEnabled: true,
      };
    }

    const status = await github.getCurrentPullRequestStatus({
      cwd,
      ...lookupTarget,
      reason: options?.reason,
    });
    return {
      status,
      githubFeaturesEnabled: true,
    };
  } catch (error) {
    if (error instanceof GitHubCliMissingError || error instanceof GitHubAuthenticationError) {
      return { status: null, githubFeaturesEnabled: false };
    }
    throw error;
  }
}

function getOrLoadPullRequestStatus<TContext>(
  cwd: string,
  github: GitHubService,
  options: PullRequestStatusReadOptions | undefined,
  context: TContext | undefined,
  dependencies: CheckoutPullRequestStatusDependencies<TContext>,
): Promise<PullRequestStatusResult> {
  const cacheKey = getPullRequestStatusCacheKey(cwd);
  if (!options?.force) {
    const cached = pullRequestStatusCache.get(cacheKey);
    if (cached) {
      return Promise.resolve(cached);
    }

    const existing = pullRequestStatusInFlight.get(cacheKey);
    if (existing) {
      return existing;
    }
  }

  const lookup = getPullRequestStatusUncached(cwd, github, options, context, dependencies)
    .then((status) => {
      pullRequestStatusCache.set(cacheKey, status);
      rememberPullRequestStatus(cacheKey, status);
      return status;
    })
    .catch((error) => {
      if (!options?.force && error instanceof GitHubCommandError) {
        const stale = lastSuccessfulPullRequestStatus.get(cacheKey);
        if (stale) {
          return stale;
        }
      }
      throw error;
    })
    .finally(() => {
      pullRequestStatusInFlight.delete(cacheKey);
    });

  pullRequestStatusInFlight.set(cacheKey, lookup);
  return lookup;
}

/** Checkout pull request status reads and cache controls bound to checkout fact resolvers. */
export interface CheckoutPullRequestStatusAuthority<TContext> {
  get(
    cwd: string,
    github: GitHubService,
    options?: PullRequestStatusReadOptions,
    context?: TContext,
  ): Promise<PullRequestStatusResult>;
  resetCacheForTests(): void;
  setCacheTtlForTests(ttlMs: number): void;
}

/**
 * Creates the cached checkout pull request status authority.
 * @param dependencies Checkout fact, branch, and lookup-target resolvers
 * @returns Bound pull request status and cache operations
 */
export function createCheckoutPullRequestStatusAuthority<TContext>(
  dependencies: CheckoutPullRequestStatusDependencies<TContext>,
): CheckoutPullRequestStatusAuthority<TContext> {
  return {
    get: (cwd, github, options, context) =>
      getOrLoadPullRequestStatus(cwd, github, options, context, dependencies),
    resetCacheForTests: resetPullRequestStatusCache,
    setCacheTtlForTests: setPullRequestStatusCacheTtl,
  };
}
