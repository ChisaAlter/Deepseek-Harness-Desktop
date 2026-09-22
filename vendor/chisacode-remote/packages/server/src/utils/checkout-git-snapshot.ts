import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import type { Logger } from "pino";

import { parseGitHubRepoFromRemote } from "../server/workspace-git-metadata.js";
import {
  normalizeLocalBranchRefName,
  resolveBaseRefForKnownWorktree,
  resolveBestComparisonBaseRef,
} from "./checkout-git-base-ref.js";
import type { PullRequestStatusLookupTarget } from "./checkout-git-pull-request-status.js";
import { READ_ONLY_GIT_ENV } from "./checkout-git-repository.js";
import {
  getChisaCodeWorktreeForCwd,
  getMainRepoRootFromCommonDir,
  getWorktreeRoot,
  type ChisaCodeWorktreeForCwd,
} from "./checkout-git-worktree-topology.js";
import { resolveGitRevParsePath } from "./git-rev-parse-path.js";
import { runGitCommand } from "./run-git-command.js";

const PULL_REQUEST_REMOTE_PREFIX = "chisacode-pr-";

function isManagedPullRequestRemote(remoteName: string | null | undefined): remoteName is string {
  return remoteName?.startsWith(PULL_REQUEST_REMOTE_PREFIX) === true;
}

/** Ahead and behind commit counts relative to a checkout base ref. */
export interface AheadBehind {
  ahead: number;
  behind: number;
}

/** Checkout status for a directory outside Git. */
export interface CheckoutStatus {
  isGit: false;
}

/** Git checkout status for a non-managed worktree. */
export interface CheckoutStatusGitNonChisaCode {
  isGit: true;
  repoRoot: string;
  mainRepoRoot: string | null;
  currentBranch: string | null;
  isDirty: boolean;
  baseRef: string | null;
  aheadBehind: AheadBehind | null;
  aheadOfOrigin: number | null;
  behindOfOrigin: number | null;
  hasRemote: boolean;
  remoteUrl: string | null;
  isChisaCodeOwnedWorktree: false;
}

/** Git checkout status for a ChisaCode-managed worktree. */
export interface CheckoutStatusGitChisaCode {
  isGit: true;
  repoRoot: string;
  mainRepoRoot: string;
  currentBranch: string | null;
  isDirty: boolean;
  baseRef: string;
  aheadBehind: AheadBehind | null;
  aheadOfOrigin: number | null;
  behindOfOrigin: number | null;
  hasRemote: boolean;
  remoteUrl: string | null;
  isChisaCodeOwnedWorktree: true;
}

/** Git checkout status projection. */
export type CheckoutStatusGit = CheckoutStatusGitNonChisaCode | CheckoutStatusGitChisaCode;

/** Checkout status for Git and non-Git directories. */
export type CheckoutStatusResult = CheckoutStatus | CheckoutStatusGit;

/** Passive facts shared across checkout status, diff, shortstat, and PR reads. */
export type CheckoutSnapshotFacts =
  | {
      isGit: false;
    }
  | {
      isGit: true;
      worktreeRoot: string;
      currentBranch: string | null;
      remoteUrl: string | null;
      absoluteGitDir: string | null;
      gitCommonDir: string | null;
      chisacodeWorktree: ChisaCodeWorktreeForCwd;
      storedBaseRef: string | null;
      resolvedBaseRef: string | null;
      mainRepoRoot: string | null;
      comparisonBaseRef: string | null;
      branchRemoteName: string | null;
      branchMergeRef: string | null;
      trackedOriginBranch: string | null;
      pullRequestLookupTarget: PullRequestStatusLookupTarget | null;
    };

/** Context for trace logging, managed ownership, and reusable checkout facts. */
export interface CheckoutContext {
  chisacodeHome?: string;
  logger?: Pick<Logger, "trace">;
  facts?: CheckoutSnapshotFacts | null;
}

function isGitError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }
  return /not a git repository/i.test(error.message) || /git repository/i.test(error.message);
}

async function getRebaseHeadBranch(cwd: string): Promise<string | null> {
  const paths = ["rebase-merge/head-name", "rebase-apply/head-name"];
  const results = await Promise.all(
    paths.map(async (path): Promise<string | null> => {
      try {
        const { stdout } = await runGitCommand(["rev-parse", "--git-path", path], {
          cwd,
          envOverlay: READ_ONLY_GIT_ENV,
        });
        const headName = (await readFile(resolve(cwd, stdout.trim()), "utf8")).trim();
        if (headName.startsWith("refs/heads/")) {
          return headName.slice("refs/heads/".length) || null;
        }
        return headName || null;
      } catch {
        return null;
      }
    }),
  );
  return results.find((result): result is string => result !== null) ?? null;
}

/**
 * Reads the current local branch, including an in-progress rebase head.
 * @param cwd Repository working directory
 * @returns Branch name, or null for unborn/non-Git directories
 */
export async function getCurrentBranch(cwd: string): Promise<string | null> {
  try {
    const { stdout } = await runGitCommand(["rev-parse", "--abbrev-ref", "HEAD"], {
      cwd,
      envOverlay: READ_ONLY_GIT_ENV,
    });
    const branch = stdout.trim();
    if (branch === "HEAD") {
      return await getRebaseHeadBranch(cwd);
    }
    return branch.length > 0 ? branch : null;
  } catch {
    return null;
  }
}

async function isWorkingTreeDirty(cwd: string, context?: CheckoutContext): Promise<boolean> {
  const { stdout } = await runGitCommand(["status", "--porcelain"], {
    cwd,
    envOverlay: READ_ONLY_GIT_ENV,
    logger: context?.logger,
  });
  return stdout.trim().length > 0;
}

/** Returns the origin remote URL without throwing when origin is absent. */
export async function getOriginRemoteUrl(cwd: string): Promise<string | null> {
  try {
    const { stdout } = await runGitCommand(["config", "--get", "remote.origin.url"], {
      cwd,
      envOverlay: READ_ONLY_GIT_ENV,
    });
    const url = stdout.trim();
    return url.length > 0 ? url : null;
  } catch {
    return null;
  }
}

/** Returns whether a checkout has an origin remote configured. */
export async function hasOriginRemote(cwd: string): Promise<boolean> {
  const url = await getOriginRemoteUrl(cwd);
  return url !== null;
}

async function getGitConfigValue(
  cwd: string,
  key: string,
  context?: CheckoutContext,
): Promise<string | null> {
  try {
    const { stdout } = await runGitCommand(["config", "--get", key], {
      cwd,
      envOverlay: READ_ONLY_GIT_ENV,
      logger: context?.logger,
    });
    const value = stdout.trim();
    return value.length > 0 ? value : null;
  } catch {
    return null;
  }
}

function parseBranchMergeHeadRef(mergeRef: string | null): string | null {
  const prefix = "refs/heads/";
  if (!mergeRef?.startsWith(prefix)) {
    return null;
  }
  const headRef = mergeRef.slice(prefix.length).trim();
  return headRef.length > 0 ? headRef : null;
}

/**
 * Resolves the branch and optional fork owner used for current-PR status lookup.
 * @param cwd Repository working directory
 * @param currentBranch Current checkout branch
 * @param context Optional reusable checkout facts
 * @returns GitHub head lookup target
 */
export async function resolvePullRequestStatusLookupTarget(
  cwd: string,
  currentBranch: string,
  context?: CheckoutContext,
): Promise<PullRequestStatusLookupTarget> {
  if (context?.facts?.isGit && context.facts.pullRequestLookupTarget) {
    return context.facts.pullRequestLookupTarget;
  }
  const remoteName = await getGitConfigValue(cwd, `branch.${currentBranch}.remote`);
  if (!isManagedPullRequestRemote(remoteName)) {
    return { headRef: currentBranch };
  }

  const mergeRef = await getGitConfigValue(cwd, `branch.${currentBranch}.merge`);
  const trackedHeadRef = parseBranchMergeHeadRef(mergeRef);
  if (!trackedHeadRef) {
    return { headRef: currentBranch };
  }

  const remoteUrl = await getGitConfigValue(cwd, `remote.${remoteName}.url`);
  const remoteRepo = remoteUrl ? parseGitHubRepoFromRemote(remoteUrl) : null;
  const headRepositoryOwner = remoteRepo?.split("/")[0];
  return {
    headRef: trackedHeadRef,
    ...(headRepositoryOwner ? { headRepositoryOwner } : {}),
  };
}

/** Returns the absolute Git directory for a checkout, or null outside Git. */
export async function resolveAbsoluteGitDir(cwd: string): Promise<string | null> {
  try {
    const { stdout } = await runGitCommand(["rev-parse", "--absolute-git-dir"], {
      cwd,
      envOverlay: READ_ONLY_GIT_ENV,
    });
    const gitDir = stdout.trim();
    return gitDir.length > 0 ? gitDir : null;
  } catch {
    return null;
  }
}

async function resolveGitCommonDir(cwd: string): Promise<string | null> {
  try {
    const { stdout } = await runGitCommand(["rev-parse", "--git-common-dir"], {
      cwd,
      envOverlay: READ_ONLY_GIT_ENV,
    });
    return resolveGitRevParsePath(cwd, stdout);
  } catch {
    return null;
  }
}

async function getAheadBehind(
  cwd: string,
  baseRef: string,
  currentBranch: string,
  context?: CheckoutContext,
): Promise<AheadBehind | null> {
  const normalizedBaseRef = normalizeLocalBranchRefName(baseRef);
  if (!normalizedBaseRef || !currentBranch || normalizedBaseRef === currentBranch) {
    return null;
  }
  const comparisonBaseRef =
    context?.facts?.isGit && context.facts.resolvedBaseRef === baseRef
      ? context.facts.comparisonBaseRef
      : await resolveBestComparisonBaseRef(cwd, baseRef, context);
  if (!comparisonBaseRef) {
    return null;
  }
  const { stdout } = await runGitCommand(
    ["rev-list", "--left-right", "--count", `${comparisonBaseRef}...${currentBranch}`],
    { cwd, envOverlay: READ_ONLY_GIT_ENV, logger: context?.logger },
  );
  const [behindRaw, aheadRaw] = stdout.trim().split(/\s+/);
  const behind = Number.parseInt(behindRaw ?? "0", 10);
  const ahead = Number.parseInt(aheadRaw ?? "0", 10);
  if (Number.isNaN(behind) || Number.isNaN(ahead)) {
    return null;
  }
  return { ahead, behind };
}

async function getTrackedOriginBranch(
  cwd: string,
  currentBranch: string,
  context?: CheckoutContext,
): Promise<string | null> {
  if (context?.facts?.isGit && context.facts.currentBranch === currentBranch) {
    return context.facts.trackedOriginBranch;
  }
  const remoteName = await getGitConfigValue(cwd, `branch.${currentBranch}.remote`, context);
  if (remoteName !== "origin") {
    return null;
  }
  const mergeRef = await getGitConfigValue(cwd, `branch.${currentBranch}.merge`, context);
  return parseBranchMergeHeadRef(mergeRef);
}

async function getAheadOfOrigin(
  cwd: string,
  currentBranch: string,
  baseRef: string | null,
  context?: CheckoutContext,
): Promise<number | null> {
  if (!currentBranch) {
    return null;
  }
  const trackedOriginBranch = await getTrackedOriginBranch(cwd, currentBranch, context);
  const originBranch = trackedOriginBranch ?? currentBranch;
  try {
    const { stdout } = await runGitCommand(
      ["rev-list", "--count", `origin/${originBranch}..${currentBranch}`],
      { cwd, envOverlay: READ_ONLY_GIT_ENV, logger: context?.logger },
    );
    const count = Number.parseInt(stdout.trim(), 10);
    return Number.isNaN(count) ? null : count;
  } catch {
    if (trackedOriginBranch) {
      return null;
    }
    if (!baseRef || normalizeLocalBranchRefName(baseRef) === currentBranch) {
      return null;
    }
    try {
      const comparisonBaseRef = await resolveBestComparisonBaseRef(cwd, baseRef, context);
      const { stdout } = await runGitCommand(
        ["rev-list", "--count", `${comparisonBaseRef}..${currentBranch}`],
        { cwd, envOverlay: READ_ONLY_GIT_ENV, logger: context?.logger },
      );
      const count = Number.parseInt(stdout.trim(), 10);
      return Number.isNaN(count) ? null : count;
    } catch {
      return null;
    }
  }
}

async function getBehindOfOrigin(
  cwd: string,
  currentBranch: string,
  context?: CheckoutContext,
): Promise<number | null> {
  if (!currentBranch) {
    return null;
  }
  try {
    const { stdout } = await runGitCommand(
      ["rev-list", "--count", `${currentBranch}..origin/${currentBranch}`],
      { cwd, envOverlay: READ_ONLY_GIT_ENV, logger: context?.logger },
    );
    const count = Number.parseInt(stdout.trim(), 10);
    return Number.isNaN(count) ? null : count;
  } catch {
    return null;
  }
}

interface CheckoutInspectionContext {
  worktreeRoot: string;
  currentBranch: string | null;
  remoteUrl: string | null;
  absoluteGitDir: string | null;
  gitCommonDir: string | null;
  chisacodeWorktree: ChisaCodeWorktreeForCwd;
}

async function inspectCheckoutContext(
  cwd: string,
  context?: CheckoutContext,
): Promise<CheckoutInspectionContext | null> {
  try {
    const root = await getWorktreeRoot(cwd, context);
    if (!root) {
      return null;
    }

    const [currentBranch, remoteUrl, absoluteGitDir, gitCommonDir, chisacodeWorktree] =
      await Promise.all([
        getCurrentBranch(cwd),
        getOriginRemoteUrl(cwd),
        resolveAbsoluteGitDir(cwd),
        resolveGitCommonDir(cwd),
        getChisaCodeWorktreeForCwd(cwd, context, root),
      ]);

    return {
      worktreeRoot: root,
      currentBranch,
      remoteUrl,
      absoluteGitDir,
      gitCommonDir,
      chisacodeWorktree,
    };
  } catch (error) {
    if (isGitError(error)) {
      return null;
    }
    throw error;
  }
}

function buildPullRequestLookupTargetFromBranchConfig(input: {
  currentBranch: string;
  branchRemoteName: string | null;
  branchMergeRef: string | null;
  branchRemoteUrl: string | null;
}): PullRequestStatusLookupTarget {
  if (!isManagedPullRequestRemote(input.branchRemoteName)) {
    return { headRef: input.currentBranch };
  }

  const trackedHeadRef = parseBranchMergeHeadRef(input.branchMergeRef);
  if (!trackedHeadRef) {
    return { headRef: input.currentBranch };
  }

  const remoteRepo = input.branchRemoteUrl
    ? parseGitHubRepoFromRemote(input.branchRemoteUrl)
    : null;
  const headRepositoryOwner = remoteRepo?.split("/")[0];
  return {
    headRef: trackedHeadRef,
    ...(headRepositoryOwner ? { headRepositoryOwner } : {}),
  };
}

/**
 * Reads reusable passive checkout facts without computing dirty or ahead/behind status.
 * @param cwd Repository working directory
 * @param context Optional reusable facts, logger, and ChisaCode home
 * @returns Passive checkout facts
 */
export async function getCheckoutSnapshotFacts(
  cwd: string,
  context?: CheckoutContext,
): Promise<CheckoutSnapshotFacts> {
  if (context?.facts) {
    return context.facts;
  }

  const inspected = await inspectCheckoutContext(cwd, context);
  if (!inspected) {
    return { isGit: false };
  }

  const { storedBaseRef, resolvedBaseRef } = await resolveBaseRefForKnownWorktree(
    cwd,
    inspected.chisacodeWorktree,
  );
  const mainRepoRoot = await getMainRepoRootFromCommonDir(
    cwd,
    inspected.gitCommonDir,
    context,
  ).catch(() => null);
  let comparisonBaseRef: string | null = null;
  if (
    resolvedBaseRef &&
    inspected.currentBranch &&
    normalizeLocalBranchRefName(resolvedBaseRef) !== inspected.currentBranch
  ) {
    comparisonBaseRef = await resolveBestComparisonBaseRef(cwd, resolvedBaseRef, context).catch(
      () => null,
    );
  }

  let branchRemoteName: string | null = null;
  let branchMergeRef: string | null = null;
  let branchRemoteUrl: string | null = null;
  if (inspected.remoteUrl && inspected.currentBranch) {
    branchRemoteName = await getGitConfigValue(
      cwd,
      `branch.${inspected.currentBranch}.remote`,
      context,
    );
    if (branchRemoteName) {
      branchMergeRef = await getGitConfigValue(
        cwd,
        `branch.${inspected.currentBranch}.merge`,
        context,
      );
      if (isManagedPullRequestRemote(branchRemoteName)) {
        branchRemoteUrl = await getGitConfigValue(cwd, `remote.${branchRemoteName}.url`, context);
      }
    }
  }
  const trackedOriginBranch =
    branchRemoteName === "origin" ? parseBranchMergeHeadRef(branchMergeRef) : null;
  const pullRequestLookupTarget = inspected.currentBranch
    ? buildPullRequestLookupTargetFromBranchConfig({
        currentBranch: inspected.currentBranch,
        branchRemoteName,
        branchMergeRef,
        branchRemoteUrl,
      })
    : null;

  return {
    isGit: true,
    worktreeRoot: inspected.worktreeRoot,
    currentBranch: inspected.currentBranch,
    remoteUrl: inspected.remoteUrl,
    absoluteGitDir: inspected.absoluteGitDir,
    gitCommonDir: inspected.gitCommonDir,
    chisacodeWorktree: inspected.chisacodeWorktree,
    storedBaseRef,
    resolvedBaseRef,
    mainRepoRoot,
    comparisonBaseRef,
    branchRemoteName,
    branchMergeRef,
    trackedOriginBranch,
    pullRequestLookupTarget,
  };
}

/**
 * Projects checkout facts into user-facing Git status and divergence counts.
 * @param cwd Repository working directory
 * @param context Optional reusable facts, logger, and ChisaCode home
 * @returns Checkout status projection
 */
export async function getCheckoutStatus(
  cwd: string,
  context?: CheckoutContext,
): Promise<CheckoutStatusResult> {
  const facts = await getCheckoutSnapshotFacts(cwd, context);
  if (!facts.isGit) {
    return { isGit: false };
  }

  const worktreeRoot = facts.worktreeRoot;
  const currentBranch = facts.currentBranch;
  const remoteUrl = facts.remoteUrl;
  const chisacodeWorktree = facts.chisacodeWorktree;
  const isDirty = await isWorkingTreeDirty(cwd, context);
  const hasRemote = remoteUrl !== null;
  const baseRef = facts.resolvedBaseRef;
  const mainRepoRoot = facts.mainRepoRoot;
  const factsContext: CheckoutContext = { ...context, facts };
  const [aheadBehind, aheadOfOrigin, behindOfOrigin] = await Promise.all([
    baseRef && currentBranch
      ? getAheadBehind(cwd, baseRef, currentBranch, factsContext)
      : Promise.resolve(null),
    hasRemote && currentBranch
      ? getAheadOfOrigin(cwd, currentBranch, baseRef, factsContext)
      : Promise.resolve(null),
    hasRemote && currentBranch
      ? getBehindOfOrigin(cwd, currentBranch, factsContext)
      : Promise.resolve(null),
  ]);

  if (chisacodeWorktree.isChisaCodeOwnedWorktree && baseRef) {
    return {
      isGit: true,
      repoRoot: worktreeRoot,
      mainRepoRoot: mainRepoRoot ?? worktreeRoot,
      currentBranch,
      isDirty,
      baseRef,
      aheadBehind,
      aheadOfOrigin,
      behindOfOrigin,
      hasRemote,
      remoteUrl,
      isChisaCodeOwnedWorktree: true,
    };
  }

  return {
    isGit: true,
    repoRoot: worktreeRoot,
    mainRepoRoot:
      mainRepoRoot && resolve(mainRepoRoot) !== resolve(worktreeRoot) ? mainRepoRoot : null,
    currentBranch,
    isDirty,
    baseRef,
    aheadBehind,
    aheadOfOrigin,
    behindOfOrigin,
    hasRemote,
    remoteUrl,
    isChisaCodeOwnedWorktree: false,
  };
}
