import { realpathSync } from "node:fs";
import { basename, dirname, resolve } from "node:path";

import type { Logger } from "pino";

import { parseGitRevParsePath, resolveGitRevParsePath } from "./git-rev-parse-path.js";
import { READ_ONLY_GIT_ENV } from "./checkout-git-repository.js";
import { runGitCommand } from "./run-git-command.js";
import { isChisaCodeOwnedWorktreeCwd } from "./worktree.js";
import { readChisaCodeWorktreeMetadata } from "./worktree-metadata.js";

/** Context needed to resolve managed worktree ownership and trace Git reads. */
export interface CheckoutWorktreeContext {
  chisacodeHome?: string;
  logger?: Pick<Logger, "trace">;
}

/** Parsed entry from `git worktree list --porcelain`. */
export interface GitWorktreeEntry {
  path: string;
  branchRef?: string;
  isBare?: boolean;
}

/** Managed-worktree ownership projection for a checkout directory. */
export type ChisaCodeWorktreeForCwd =
  | { isChisaCodeOwnedWorktree: false }
  | { isChisaCodeOwnedWorktree: true; worktreeRoot: string };

/**
 * Resolves the root directory of the checkout containing a path.
 * @param cwd Directory inside the checkout
 * @param context Optional trace logger
 * @returns Checkout root, or null when the path is not in a Git worktree
 */
export async function getWorktreeRoot(
  cwd: string,
  context?: CheckoutWorktreeContext,
): Promise<string | null> {
  try {
    const { stdout } = await runGitCommand(["rev-parse", "--show-toplevel"], {
      cwd,
      envOverlay: READ_ONLY_GIT_ENV,
      logger: context?.logger,
    });
    return parseGitRevParsePath(stdout);
  } catch {
    return null;
  }
}

/**
 * Resolves the primary non-managed checkout for a repository.
 * @param cwd Directory inside the repository
 * @returns Main checkout root or bare repository root
 */
export async function getMainRepoRoot(cwd: string): Promise<string> {
  const { stdout: commonDirOut } = await runGitCommand(["rev-parse", "--git-common-dir"], {
    cwd,
    envOverlay: READ_ONLY_GIT_ENV,
  });
  return getMainRepoRootFromCommonDir(cwd, resolveGitRevParsePath(cwd, commonDirOut));
}

/** Check whether a path contains a managed worktrees segment (both `/` and `\`). */
export function isChisaCodeWorktreePath(path: string): boolean {
  return /[/\\]\.chisacode[/\\]worktrees[/\\]/.test(path);
}

/** True when `child` is strictly inside `parent` (handles both `/` and `\`). */
export function isDescendantPath(child: string, parent: string): boolean {
  let normalizedChild = child.replace(/\\/g, "/").replace(/\/+$/, "");
  let normalizedParent = parent.replace(/\\/g, "/").replace(/\/+$/, "");
  if (/^[A-Za-z]:/.test(normalizedChild) || /^[A-Za-z]:/.test(normalizedParent)) {
    normalizedChild = normalizedChild.toLowerCase();
    normalizedParent = normalizedParent.toLowerCase();
  }
  if (!normalizedChild.startsWith(normalizedParent)) return false;
  if (normalizedChild.length === normalizedParent.length) return false;
  return normalizedChild[normalizedParent.length] === "/";
}

/**
 * Parses Git's porcelain worktree listing into the fields checkout operations consume.
 * @param output Raw `git worktree list --porcelain` output
 * @returns Worktree path, branch ref, and bare markers in listing order
 */
export function parseWorktreeList(output: string): GitWorktreeEntry[] {
  const entries: GitWorktreeEntry[] = [];
  let current: GitWorktreeEntry | null = null;
  for (const line of output.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }
    if (trimmed.startsWith("worktree ")) {
      if (current) {
        entries.push(current);
      }
      current = { path: trimmed.slice("worktree ".length).trim() };
      continue;
    }
    if (current && trimmed.startsWith("branch ")) {
      current.branchRef = trimmed.slice("branch ".length).trim();
    }
    if (current && trimmed === "bare") {
      current.isBare = true;
    }
  }
  if (current) {
    entries.push(current);
  }
  return entries;
}

function isChisaCodeWorktreeListEntry(path: string, context?: CheckoutWorktreeContext): boolean {
  if (isChisaCodeWorktreePath(path)) {
    return true;
  }
  return context?.chisacodeHome
    ? isDescendantPath(path, resolve(context.chisacodeHome, "worktrees"))
    : false;
}

/**
 * Resolves the main checkout from an already-read Git common directory.
 * @param cwd Directory used to list repository worktrees
 * @param commonDir Resolved Git common directory
 * @param context Optional managed-worktree home and logger
 * @returns Main non-managed checkout or the bare repository root
 */
export async function getMainRepoRootFromCommonDir(
  cwd: string,
  commonDir: string | null,
  context?: CheckoutWorktreeContext,
): Promise<string> {
  if (!commonDir) {
    throw new Error("Not in a git repository");
  }
  const normalized = realpathSync(commonDir);

  if (basename(normalized) === ".git") {
    return dirname(normalized);
  }

  const { stdout: worktreeOut } = await runGitCommand(["worktree", "list", "--porcelain"], {
    cwd,
    envOverlay: READ_ONLY_GIT_ENV,
  });
  const worktrees = parseWorktreeList(worktreeOut);
  const nonBareNonChisaCode = worktrees.filter(
    (worktree) => !worktree.isBare && !isChisaCodeWorktreeListEntry(worktree.path, context),
  );
  const childrenOfBareRepo = nonBareNonChisaCode.filter((worktree) =>
    isDescendantPath(worktree.path, normalized),
  );
  const mainChild = childrenOfBareRepo.find((worktree) => basename(worktree.path) === "main");
  return (
    mainChild?.path ?? childrenOfBareRepo[0]?.path ?? nonBareNonChisaCode[0]?.path ?? normalized
  );
}

/**
 * Finds the checkout currently holding a local branch.
 * @param cwd Directory inside the repository
 * @param branchName Local branch name or full heads ref
 * @returns Worktree path, or null when the branch is not checked out
 */
export async function getWorktreePathForBranch(
  cwd: string,
  branchName: string,
): Promise<string | null> {
  try {
    const { stdout } = await runGitCommand(["worktree", "list", "--porcelain"], {
      cwd,
      envOverlay: READ_ONLY_GIT_ENV,
    });
    const entries = parseWorktreeList(stdout);
    const ref = branchName.startsWith("refs/heads/") ? branchName : `refs/heads/${branchName}`;
    return entries.find((entry) => entry.branchRef === ref)?.path ?? null;
  } catch {
    return null;
  }
}

/**
 * Resolves whether a checkout belongs to ChisaCode's managed worktree area.
 * @param cwd Directory inside the checkout
 * @param context Optional ChisaCode home and logger
 * @param knownWorktreeRoot Previously resolved checkout root
 * @returns Managed ownership and root projection
 */
export async function getChisaCodeWorktreeForCwd(
  cwd: string,
  context?: CheckoutWorktreeContext,
  knownWorktreeRoot?: string | null,
): Promise<ChisaCodeWorktreeForCwd> {
  if (!/[\\/]worktrees[\\/]/.test(cwd)) {
    return { isChisaCodeOwnedWorktree: false };
  }

  const ownership = await isChisaCodeOwnedWorktreeCwd(cwd, {
    chisacodeHome: context?.chisacodeHome,
  });
  if (!ownership.allowed) {
    return { isChisaCodeOwnedWorktree: false };
  }

  return {
    isChisaCodeOwnedWorktree: true,
    worktreeRoot: knownWorktreeRoot ?? (await getWorktreeRoot(cwd, context)) ?? cwd,
  };
}

/** Returns the configured base ref stored for a managed worktree. */
export function readChisaCodeWorktreeBaseRef(worktreeRoot: string): string | null {
  return readChisaCodeWorktreeMetadata(worktreeRoot)?.baseRefName ?? null;
}
