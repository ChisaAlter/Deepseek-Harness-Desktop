import { resolve } from "path";
import { existsSync } from "fs";
import {
  createGitHubService,
  resolveGitHubRepo,
  type GitHubService,
} from "../services/github-service.js";
import { runGitCommand } from "./run-git-command.js";
import {
  doesGitRefExist,
  getResolvedBaseRefForCwd,
  normalizeLocalBranchRefName,
  resolveBaseRefForCwd,
  resolveBestComparisonBaseRef,
  resolveMostAheadBaseRef,
} from "./checkout-git-base-ref.js";
import {
  createCheckoutDiffReader,
  type CheckoutDiffCompare,
  type CheckoutDiffResult,
} from "./checkout-git-diff.js";
import {
  createCheckoutMergeAuthority,
  type MergeFromBaseOptions,
  type MergeToBaseOptions,
} from "./checkout-git-merge.js";
import {
  createCheckoutPullRequestStatusAuthority,
  type PullRequestStatusResult,
} from "./checkout-git-pull-request-status.js";
import {
  createCheckoutShortstatAuthority,
  type CheckoutShortstat,
} from "./checkout-git-shortstat.js";
import { requireGitRepo } from "./checkout-git-repository.js";
import {
  getCurrentBranch,
  hasOriginRemote,
  resolveAbsoluteGitDir,
  resolvePullRequestStatusLookupTarget,
  type CheckoutContext,
} from "./checkout-git-snapshot.js";
import { getWorktreePathForBranch, getWorktreeRoot } from "./checkout-git-worktree-topology.js";

export { resolveRepositoryDefaultBranch } from "./checkout-git-base-ref.js";
export { NotGitRepoError } from "./checkout-git-repository.js";
export {
  getCheckoutSnapshotFacts,
  getCheckoutStatus,
  getCurrentBranch,
  getOriginRemoteUrl,
  hasOriginRemote,
  resolveAbsoluteGitDir,
  type AheadBehind,
  type CheckoutContext,
  type CheckoutSnapshotFacts,
  type CheckoutStatus,
  type CheckoutStatusGit,
  type CheckoutStatusGitChisaCode,
  type CheckoutStatusGitNonChisaCode,
  type CheckoutStatusResult,
} from "./checkout-git-snapshot.js";
export {
  checkoutResolvedBranch,
  listBranchSuggestions,
  resolveBranchCheckout,
  type BranchCheckoutResolution,
  type BranchCheckoutSource,
  type BranchSuggestion,
  type CheckoutExistingBranchResult,
  type CheckoutResolvedBranchInput,
  type LocalBranchCheckoutResolution,
  type NotFoundBranchCheckoutResolution,
  type RemoteOnlyBranchCheckoutResolution,
} from "./checkout-git-branches.js";
export type { CheckoutDiffCompare, CheckoutDiffResult } from "./checkout-git-diff.js";
export {
  MergeConflictError,
  MergeFromBaseConflictError,
  type MergeFromBaseOptions,
  type MergeToBaseOptions,
} from "./checkout-git-merge.js";
export type {
  ChecksStatus,
  PullRequestCheck,
  PullRequestStatus,
  PullRequestStatusResult,
  ReviewDecision,
} from "./checkout-git-pull-request-status.js";
export type { CheckoutShortstat } from "./checkout-git-shortstat.js";
export {
  getMainRepoRoot,
  isChisaCodeWorktreePath,
  isDescendantPath,
  parseWorktreeList,
  type GitWorktreeEntry,
} from "./checkout-git-worktree-topology.js";
interface CheckoutReadCacheOptions {
  force?: boolean;
  reason?: string;
}
export async function localBranchExists(cwd: string, branchName: string): Promise<boolean> {
  return doesGitRefExist(cwd, `refs/heads/${branchName}`);
}

export async function renameCurrentBranch(
  cwd: string,
  newName: string,
): Promise<{ previousBranch: string | null; currentBranch: string | null }> {
  await requireGitRepo(cwd);

  const previousBranch = await getCurrentBranch(cwd);
  if (!previousBranch || previousBranch === "HEAD") {
    throw new Error("Cannot rename branch in detached HEAD state");
  }

  await runGitCommand(["branch", "-m", newName], {
    cwd,
    timeout: 120_000,
  });

  const currentBranch = await getCurrentBranch(cwd);
  return { previousBranch, currentBranch };
}

async function abortGitPullConflictState(cwd: string): Promise<void> {
  const gitDir = await resolveAbsoluteGitDir(cwd);
  if (!gitDir) {
    return;
  }

  const mergeHeadPath = resolve(gitDir, "MERGE_HEAD");
  const rebaseMergePath = resolve(gitDir, "rebase-merge");
  const rebaseApplyPath = resolve(gitDir, "rebase-apply");

  if (existsSync(mergeHeadPath)) {
    try {
      await runGitCommand(["merge", "--abort"], { cwd, timeout: 120_000 });
    } catch {
      // ignore
    }
  }

  if (existsSync(rebaseMergePath) || existsSync(rebaseApplyPath)) {
    try {
      await runGitCommand(["rebase", "--abort"], { cwd, timeout: 120_000 });
    } catch {
      // ignore
    }
  }
}

const checkoutShortstatAuthority = createCheckoutShortstatAuthority<CheckoutContext>({
  getFacts: (context) => context?.facts,
  getResolvedBaseRefForCwd,
  getCurrentBranch,
  resolveBestComparisonBaseRef: (cwd, baseRef) => resolveBestComparisonBaseRef(cwd, baseRef),
  doesGitRefExist: (cwd, fullRef) => doesGitRefExist(cwd, fullRef),
});

/** Resets checkout shortstat cache state for isolated tests. */
export function __resetCheckoutShortstatCacheForTests(): void {
  checkoutShortstatAuthority.resetCacheForTests();
}

/** Overrides checkout shortstat cache TTL for isolated tests. */
export function __setCheckoutShortstatCacheTtlForTests(ttlMs: number): void {
  checkoutShortstatAuthority.setCacheTtlForTests(ttlMs);
}

/**
 * Reads cached or fresh aggregate line changes for a checkout.
 * @param cwd Repository working directory
 * @param context Optional cached checkout facts and logger
 * @param options Cache control options
 * @returns Aggregate additions/deletions, or null when there is no comparison
 */
export async function getCheckoutShortstat(
  cwd: string,
  context?: CheckoutContext,
  options?: CheckoutReadCacheOptions,
): Promise<CheckoutShortstat | null> {
  return checkoutShortstatAuthority.get(cwd, context, options);
}

/** Returns the current cached shortstat without starting Git work. */
export function getCachedCheckoutShortstat(cwd: string): CheckoutShortstat | null | undefined {
  return checkoutShortstatAuthority.getCached(cwd);
}

/** Starts a best-effort shortstat warmup when no cached or in-flight value exists. */
export function warmCheckoutShortstatInBackground(
  cwd: string,
  context?: CheckoutContext,
  onComplete?: () => void,
): void {
  checkoutShortstatAuthority.warm(cwd, context, onComplete);
}
const checkoutDiffReader = createCheckoutDiffReader<CheckoutContext>({
  resolveBaseRefForCwd,
  resolveBestComparisonBaseRef: (cwd, baseRef) => resolveBestComparisonBaseRef(cwd, baseRef),
});

/**
 * Reads a bounded textual or structured diff for a checkout.
 * @param cwd Repository working directory
 * @param compare Comparison mode and rendering options
 * @param context Optional cached checkout facts and logger
 * @returns The bounded checkout diff projection
 * @throws {NotGitRepoError} If the directory is not inside a Git repository
 */
export async function getCheckoutDiff(
  cwd: string,
  compare: CheckoutDiffCompare,
  context?: CheckoutContext,
): Promise<CheckoutDiffResult> {
  return checkoutDiffReader(cwd, compare, context);
}
export async function commitChanges(
  cwd: string,
  options: { message: string; addAll?: boolean },
): Promise<void> {
  await requireGitRepo(cwd);
  if (options.addAll ?? true) {
    await runGitCommand(["add", "-A"], { cwd, timeout: 120_000 });
  }
  await runGitCommand(["-c", "commit.gpgsign=false", "commit", "-m", options.message], {
    cwd,
    timeout: 120_000,
  });
}

export async function commitAll(cwd: string, message: string): Promise<void> {
  await commitChanges(cwd, { message, addAll: true });
}

const checkoutMergeAuthority = createCheckoutMergeAuthority<CheckoutContext>({
  getCurrentBranch,
  getWorktreeRoot: (cwd) => getWorktreeRoot(cwd),
  getWorktreePathForBranch,
  resolveBaseRefForCwd,
  normalizeLocalBranchRefName,
  resolveMostAheadBaseRef,
});

/**
 * Merges the current checkout branch into its configured base branch.
 * @param cwd Repository working directory
 * @param options Merge mode, base override, and optional squash message
 * @param context Optional cached checkout facts and ChisaCode home
 * @returns The checkout directory mutated by the merge
 * @throws {MergeConflictError} If the merge produces conflicts
 */
export async function mergeToBase(
  cwd: string,
  options: MergeToBaseOptions = {},
  context?: CheckoutContext,
): Promise<string> {
  return checkoutMergeAuthority.toBase(cwd, options, context);
}

/**
 * Merges the configured base branch into the current checkout branch.
 * @param cwd Repository working directory
 * @param options Base override and clean-target policy
 * @param context Optional cached checkout facts and ChisaCode home
 * @throws {MergeFromBaseConflictError} If the merge produces conflicts
 */
export async function mergeFromBase(
  cwd: string,
  options: MergeFromBaseOptions = {},
  context?: CheckoutContext,
): Promise<void> {
  return checkoutMergeAuthority.fromBase(cwd, options, context);
}
export async function pullCurrentBranch(cwd: string, github?: GitHubService): Promise<void> {
  await requireGitRepo(cwd);
  const currentBranch = await getCurrentBranch(cwd);
  if (!currentBranch || currentBranch === "HEAD") {
    throw new Error("Unable to determine current branch for pull");
  }
  const hasRemote = await hasOriginRemote(cwd);
  if (!hasRemote) {
    throw new Error("Remote 'origin' is not configured.");
  }
  try {
    await runGitCommand(["pull"], { cwd, timeout: 120_000 });
    github?.invalidate({ cwd });
  } catch (error) {
    await abortGitPullConflictState(cwd);
    throw error;
  }
}

export async function pushCurrentBranch(cwd: string, github?: GitHubService): Promise<void> {
  await requireGitRepo(cwd);
  const currentBranch = await getCurrentBranch(cwd);
  if (!currentBranch || currentBranch === "HEAD") {
    throw new Error("Unable to determine current branch for push");
  }
  const hasRemote = await hasOriginRemote(cwd);
  if (!hasRemote) {
    throw new Error("Remote 'origin' is not configured.");
  }
  await runGitCommand(["push", "-u", "origin", currentBranch], { cwd, timeout: 120_000 });
  github?.invalidate({ cwd });
}

export interface CreatePullRequestOptions {
  title: string;
  body?: string;
  base?: string;
  head?: string;
  draft?: boolean;
}

export async function createPullRequest(
  cwd: string,
  options: CreatePullRequestOptions,
  github: GitHubService = createGitHubService(),
  context?: CheckoutContext,
): Promise<{ url: string; number: number }> {
  await requireGitRepo(cwd);
  const repo = await resolveGitHubRepo(cwd);
  if (!repo) {
    throw new Error("Unable to determine GitHub repo from git remote");
  }

  const head = options.head ?? (await getCurrentBranch(cwd));
  const { storedBaseRef, resolvedBaseRef } = await resolveBaseRefForCwd(cwd, context);
  const base = options.base ?? resolvedBaseRef;
  if (!head) {
    throw new Error("Unable to determine head branch for PR");
  }
  if (!base) {
    throw new Error("Unable to determine base branch for PR");
  }
  const normalizedBase = normalizeLocalBranchRefName(base);
  if (storedBaseRef && options.base && options.base !== storedBaseRef) {
    throw new Error(`Base ref mismatch: expected ${storedBaseRef}, got ${options.base}`);
  }

  await runGitCommand(["push", "-u", "origin", head], { cwd, timeout: 120_000 });

  const result = await github.createPullRequest({
    cwd,
    repo,
    title: options.title,
    body: options.body,
    head,
    base: normalizedBase,
  });
  github.invalidate({ cwd });
  return result;
}

const checkoutPullRequestStatusAuthority =
  createCheckoutPullRequestStatusAuthority<CheckoutContext>({
    getFacts: (context) => context?.facts,
    getCurrentBranch,
    resolveLookupTarget: resolvePullRequestStatusLookupTarget,
  });

/** Resets pull request status cache state for isolated tests. */
export function __resetPullRequestStatusCacheForTests(): void {
  checkoutPullRequestStatusAuthority.resetCacheForTests();
}

/** Overrides pull request status cache TTL for isolated tests. */
export function __setPullRequestStatusCacheTtlForTests(ttlMs: number): void {
  checkoutPullRequestStatusAuthority.setCacheTtlForTests(ttlMs);
}

/**
 * Reads cached or fresh pull request status for a checkout.
 * @param cwd Repository working directory
 * @param github GitHub service used for status lookup
 * @param options Cache control and observability options
 * @param context Optional cached checkout facts and logger
 * @returns Pull request status and GitHub feature availability
 */
export async function getPullRequestStatus(
  cwd: string,
  github: GitHubService = createGitHubService(),
  options?: CheckoutReadCacheOptions,
  context?: CheckoutContext,
): Promise<PullRequestStatusResult> {
  return checkoutPullRequestStatusAuthority.get(cwd, github, options, context);
}
