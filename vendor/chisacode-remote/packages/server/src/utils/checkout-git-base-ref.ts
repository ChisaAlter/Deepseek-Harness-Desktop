import { READ_ONLY_GIT_ENV } from "./checkout-git-repository.js";
import {
  getChisaCodeWorktreeForCwd,
  readChisaCodeWorktreeBaseRef,
  type ChisaCodeWorktreeForCwd,
  type CheckoutWorktreeContext,
} from "./checkout-git-worktree-topology.js";
import { runGitCommand } from "./run-git-command.js";

type CheckoutBaseRefFacts =
  | { isGit: false }
  | {
      isGit: true;
      storedBaseRef: string | null;
      resolvedBaseRef: string | null;
    };

/** Context needed to reuse snapshot base-ref facts and trace Git reads. */
export interface CheckoutBaseRefContext extends CheckoutWorktreeContext {
  facts?: CheckoutBaseRefFacts | null;
}

/** Stored and effective base refs resolved for a checkout. */
export interface BaseRefResolution {
  storedBaseRef: string | null;
  resolvedBaseRef: string | null;
}

/**
 * Resolves the repository default branch from origin HEAD or local main/master fallbacks.
 * @param repoRoot Repository working directory
 * @returns Local branch name, origin tracking ref, or null when no default can be inferred
 */
export async function resolveRepositoryDefaultBranch(repoRoot: string): Promise<string | null> {
  try {
    const { stdout } = await runGitCommand(
      ["symbolic-ref", "--quiet", "refs/remotes/origin/HEAD"],
      {
        cwd: repoRoot,
        envOverlay: READ_ONLY_GIT_ENV,
      },
    );
    const ref = stdout.trim();
    if (ref) {
      const remoteShort = ref.replace(/^refs\/remotes\//, "");
      const localName = remoteShort.startsWith("origin/")
        ? remoteShort.slice("origin/".length)
        : remoteShort;
      try {
        await runGitCommand(["show-ref", "--verify", "--quiet", `refs/heads/${localName}`], {
          cwd: repoRoot,
          envOverlay: READ_ONLY_GIT_ENV,
        });
        return localName;
      } catch {
        return remoteShort;
      }
    }
  } catch {
    // Fall through to local branch discovery when origin HEAD is unavailable.
  }

  const { stdout } = await runGitCommand(["branch", "--format=%(refname:short)"], {
    cwd: repoRoot,
    envOverlay: READ_ONLY_GIT_ENV,
  });
  const branches = new Set(
    stdout
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0),
  );

  if (branches.has("main")) {
    return "main";
  }
  if (branches.has("master")) {
    return "master";
  }
  return null;
}

/**
 * Resolves stored worktree metadata and the effective base ref for a checkout.
 * @param cwd Repository working directory
 * @param context Optional cached base facts and ChisaCode home
 * @returns Stored and effective base refs
 */
export async function resolveBaseRefForCwd(
  cwd: string,
  context?: CheckoutBaseRefContext,
): Promise<BaseRefResolution> {
  if (context?.facts?.isGit) {
    return {
      storedBaseRef: context.facts.storedBaseRef,
      resolvedBaseRef: context.facts.resolvedBaseRef,
    };
  }
  const chisacodeWorktree = await getChisaCodeWorktreeForCwd(cwd, context);
  return resolveBaseRefForKnownWorktree(cwd, chisacodeWorktree);
}

/**
 * Resolves base refs from an already-inspected worktree ownership projection.
 * @param cwd Repository working directory
 * @param chisacodeWorktree Known managed-worktree ownership
 * @returns Stored and effective base refs
 */
export async function resolveBaseRefForKnownWorktree(
  cwd: string,
  chisacodeWorktree: ChisaCodeWorktreeForCwd,
): Promise<BaseRefResolution> {
  const storedBaseRef = chisacodeWorktree.isChisaCodeOwnedWorktree
    ? readChisaCodeWorktreeBaseRef(chisacodeWorktree.worktreeRoot)
    : null;
  return {
    storedBaseRef,
    resolvedBaseRef: storedBaseRef ?? (await resolveRepositoryDefaultBranch(cwd)),
  };
}

/** Returns only the effective base ref for consumers that do not need provenance. */
export async function getResolvedBaseRefForCwd(
  cwd: string,
  context?: CheckoutBaseRefContext,
): Promise<string | null> {
  if (context?.facts?.isGit) {
    return context.facts.resolvedBaseRef;
  }
  const { resolvedBaseRef } = await resolveBaseRefForCwd(cwd, context);
  return resolvedBaseRef;
}

/** Normalizes local, heads, and origin branch refs to a local branch name. */
export function normalizeLocalBranchRefName(input: string): string {
  if (input.startsWith("refs/remotes/origin/")) {
    return input.slice("refs/remotes/origin/".length);
  }
  if (input.startsWith("refs/heads/")) {
    return input.slice("refs/heads/".length);
  }
  if (input.startsWith("origin/")) {
    return input.slice("origin/".length);
  }
  return input;
}

interface ComparisonBaseRefName {
  localName: string;
  originRef: string;
}

function normalizeComparisonBaseRefName(input: string): ComparisonBaseRefName {
  const localName = normalizeLocalBranchRefName(input);
  return { localName, originRef: `origin/${localName}` };
}

/**
 * Checks whether a full Git ref exists without treating a missing ref as an error.
 * @param cwd Repository working directory
 * @param fullRef Full ref path such as `refs/heads/main`
 * @param context Optional trace logger
 * @returns True when the ref exists
 */
export async function doesGitRefExist(
  cwd: string,
  fullRef: string,
  context?: CheckoutBaseRefContext,
): Promise<boolean> {
  const result = await runGitCommand(["show-ref", "--verify", "--quiet", fullRef], {
    cwd,
    envOverlay: READ_ONLY_GIT_ENV,
    acceptExitCodes: [0, 1],
    logger: context?.logger,
  });
  return result.exitCode === 0;
}

/**
 * Selects origin when available, otherwise the local base branch.
 * @param cwd Repository working directory
 * @param baseRef Configured local or origin base ref
 * @param context Optional trace logger
 * @returns Existing comparison ref
 * @throws {Error} If neither local nor origin base refs exist
 */
export async function resolveBestComparisonBaseRef(
  cwd: string,
  baseRef: string,
  context?: CheckoutBaseRefContext,
): Promise<string> {
  const normalized = normalizeComparisonBaseRefName(baseRef);
  const [hasLocal, hasOrigin] = await Promise.all([
    doesGitRefExist(cwd, `refs/heads/${normalized.localName}`, context),
    doesGitRefExist(cwd, `refs/remotes/origin/${normalized.localName}`, context),
  ]);

  if (hasOrigin) {
    return normalized.originRef;
  }
  if (hasLocal) {
    return normalized.localName;
  }

  const refName =
    baseRef.startsWith("origin/") || baseRef.startsWith("refs/remotes/origin/")
      ? normalized.originRef
      : normalized.localName;
  throw new Error(`Base branch not found locally or on origin: ${refName}`);
}

/**
 * Selects whichever local/origin base ref contains more unique commits.
 * @param cwd Repository working directory
 * @param normalizedBaseRef Local branch name
 * @returns Local branch or origin tracking ref
 * @throws {Error} If neither ref exists
 */
export async function resolveMostAheadBaseRef(
  cwd: string,
  normalizedBaseRef: string,
): Promise<string> {
  const [hasLocal, hasOrigin] = await Promise.all([
    doesGitRefExist(cwd, `refs/heads/${normalizedBaseRef}`),
    doesGitRefExist(cwd, `refs/remotes/origin/${normalizedBaseRef}`),
  ]);

  if (hasLocal && !hasOrigin) {
    return normalizedBaseRef;
  }
  if (!hasLocal && hasOrigin) {
    return `origin/${normalizedBaseRef}`;
  }
  if (!hasLocal && !hasOrigin) {
    throw new Error(`Base branch not found locally or on origin: ${normalizedBaseRef}`);
  }

  const { stdout } = await runGitCommand(
    ["rev-list", "--left-right", "--count", `${normalizedBaseRef}...origin/${normalizedBaseRef}`],
    { cwd, envOverlay: READ_ONLY_GIT_ENV },
  );
  const [localOnlyRaw, originOnlyRaw] = stdout.trim().split(/\s+/);
  const localOnly = Number.parseInt(localOnlyRaw ?? "0", 10);
  const originOnly = Number.parseInt(originOnlyRaw ?? "0", 10);
  if (Number.isNaN(localOnly) || Number.isNaN(originOnly)) {
    return normalizedBaseRef;
  }
  return originOnly > localOnly ? `origin/${normalizedBaseRef}` : normalizedBaseRef;
}
