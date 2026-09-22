import { resolve } from "node:path";

import { READ_ONLY_GIT_ENV, requireGitRepo } from "./checkout-git-repository.js";
import { runGitCommand } from "./run-git-command.js";

/** Error raised when merging a checkout branch into its base produces conflicts. */
export class MergeConflictError extends Error {
  readonly baseRef: string;
  readonly currentBranch: string;
  readonly conflictFiles: string[];

  constructor(options: { baseRef: string; currentBranch: string; conflictFiles: string[] }) {
    super(`Merge conflict while merging ${options.currentBranch} into ${options.baseRef}`);
    this.name = "MergeConflictError";
    this.baseRef = options.baseRef;
    this.currentBranch = options.currentBranch;
    this.conflictFiles = options.conflictFiles;
  }
}

/** Error raised when merging a checkout base into the current branch produces conflicts. */
export class MergeFromBaseConflictError extends Error {
  readonly baseRef: string;
  readonly currentBranch: string;
  readonly conflictFiles: string[];

  constructor(options: { baseRef: string; currentBranch: string; conflictFiles: string[] }) {
    super(
      `Merge conflict while merging ${options.baseRef} into ${options.currentBranch}. Please merge manually.`,
    );
    this.name = "MergeFromBaseConflictError";
    this.baseRef = options.baseRef;
    this.currentBranch = options.currentBranch;
    this.conflictFiles = options.conflictFiles;
  }
}

/** Options for merging the current checkout branch into its configured base. */
export interface MergeToBaseOptions {
  baseRef?: string;
  mode?: "merge" | "squash";
  commitMessage?: string;
}

/** Options for merging the configured base into the current checkout branch. */
export interface MergeFromBaseOptions {
  baseRef?: string;
  requireCleanTarget?: boolean;
}

interface BaseRefResolution {
  storedBaseRef: string | null;
  resolvedBaseRef: string | null;
}

interface CheckoutMergeDependencies<TContext> {
  getCurrentBranch(cwd: string): Promise<string | null>;
  getWorktreeRoot(cwd: string): Promise<string | null>;
  getWorktreePathForBranch(cwd: string, branchName: string): Promise<string | null>;
  resolveBaseRefForCwd(cwd: string, context: TContext | undefined): Promise<BaseRefResolution>;
  normalizeLocalBranchRefName(input: string): string;
  resolveMostAheadBaseRef(cwd: string, normalizedBaseRef: string): Promise<string>;
}

function getErrorStderr(error: Error): string {
  return "stderr" in error && typeof error.stderr === "string" ? error.stderr : "";
}

function getErrorStdout(error: Error): string {
  return "stdout" in error && typeof error.stdout === "string" ? error.stdout : "";
}

function getMergeErrorDetails(error: unknown): string {
  if (!(error instanceof Error)) {
    return String(error);
  }
  return `${error.message}\n${getErrorStderr(error)}\n${getErrorStdout(error)}`;
}

function parseStatusConflictFiles(status: string): string[] {
  return status
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => /^(UU|AA|DD|AU|UA|UD|DU)\s/.test(line))
    .map((line) => line.slice(3).trim());
}

async function collectMergeConflictFiles(cwd: string): Promise<string[]> {
  const [unmergedOutput, lsFilesOutput, statusOutput] = await Promise.all([
    runGitCommand(["diff", "--name-only", "--diff-filter=U"], { cwd }),
    runGitCommand(["ls-files", "-u"], { cwd }),
    runGitCommand(["status", "--porcelain"], { cwd }),
  ]);
  return [
    ...unmergedOutput.stdout
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean),
    ...lsFilesOutput.stdout
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => line.split("\t").at(-1) ?? ""),
    ...parseStatusConflictFiles(statusOutput.stdout),
  ].filter(Boolean);
}

async function detectAndThrowMergeConflict(
  cwd: string,
  error: unknown,
  createError: (conflictFiles: string[]) => Error,
): Promise<void> {
  let conflictFiles: string[];
  try {
    conflictFiles = await collectMergeConflictFiles(cwd);
  } catch {
    return;
  }

  const conflictDetected =
    conflictFiles.length > 0 ||
    /CONFLICT|Automatic merge failed/i.test(getMergeErrorDetails(error));
  if (!conflictDetected) {
    return;
  }

  try {
    await runGitCommand(["merge", "--abort"], { cwd, timeout: 120_000 });
  } catch {
    // The typed conflict remains the primary error even if cleanup is already complete.
  }
  throw createError(conflictFiles);
}

async function resolveMergeBaseRef<TContext>(
  cwd: string,
  requestedBaseRef: string | undefined,
  context: TContext | undefined,
  dependencies: CheckoutMergeDependencies<TContext>,
): Promise<string> {
  const { storedBaseRef, resolvedBaseRef } = await dependencies.resolveBaseRefForCwd(cwd, context);
  const baseRef = requestedBaseRef ?? resolvedBaseRef;
  if (!baseRef) {
    throw new Error("Unable to determine base branch for merge");
  }
  if (storedBaseRef && requestedBaseRef && requestedBaseRef !== storedBaseRef) {
    throw new Error(`Base ref mismatch: expected ${storedBaseRef}, got ${requestedBaseRef}`);
  }
  return dependencies.normalizeLocalBranchRefName(baseRef);
}

async function mergeCheckoutToBase<TContext>(
  cwd: string,
  options: MergeToBaseOptions,
  context: TContext | undefined,
  dependencies: CheckoutMergeDependencies<TContext>,
): Promise<string> {
  await requireGitRepo(cwd);
  const currentBranch = await dependencies.getCurrentBranch(cwd);
  const normalizedBaseRef = await resolveMergeBaseRef(cwd, options.baseRef, context, dependencies);
  if (!currentBranch) {
    throw new Error("Unable to determine current branch for merge");
  }

  const currentWorktreeRoot = (await dependencies.getWorktreeRoot(cwd)) ?? cwd;
  if (normalizedBaseRef === currentBranch) {
    return currentWorktreeRoot;
  }

  const baseWorktree = await dependencies.getWorktreePathForBranch(cwd, normalizedBaseRef);
  const operationCwd = baseWorktree ?? currentWorktreeRoot;
  const isSameCheckout = resolve(operationCwd) === resolve(currentWorktreeRoot);
  const originalBranch = await dependencies.getCurrentBranch(operationCwd);
  const mode = options.mode ?? "merge";
  try {
    await runGitCommand(["checkout", normalizedBaseRef], {
      cwd: operationCwd,
      timeout: 120_000,
    });
    if (mode === "squash") {
      await runGitCommand(["merge", "--squash", currentBranch], {
        cwd: operationCwd,
        timeout: 120_000,
      });
      const message =
        options.commitMessage ?? `Squash merge ${currentBranch} into ${normalizedBaseRef}`;
      await runGitCommand(["-c", "commit.gpgsign=false", "commit", "-m", message], {
        cwd: operationCwd,
        timeout: 120_000,
      });
    } else {
      await runGitCommand(["merge", currentBranch], { cwd: operationCwd, timeout: 120_000 });
    }
  } catch (error) {
    await detectAndThrowMergeConflict(
      operationCwd,
      error,
      (conflictFiles) =>
        new MergeConflictError({
          baseRef: normalizedBaseRef,
          currentBranch,
          conflictFiles,
        }),
    );
    throw error;
  } finally {
    if (isSameCheckout && originalBranch && originalBranch !== normalizedBaseRef) {
      try {
        await runGitCommand(["checkout", originalBranch], {
          cwd: operationCwd,
          timeout: 120_000,
        });
      } catch {
        // Preserve the merge result when best-effort checkout restoration fails.
      }
    }
  }
  return operationCwd;
}

async function mergeCheckoutFromBase<TContext>(
  cwd: string,
  options: MergeFromBaseOptions,
  context: TContext | undefined,
  dependencies: CheckoutMergeDependencies<TContext>,
): Promise<void> {
  await requireGitRepo(cwd);
  const currentBranch = await dependencies.getCurrentBranch(cwd);
  if (!currentBranch || currentBranch === "HEAD") {
    throw new Error("Unable to determine current branch for merge");
  }

  const normalizedBaseRef = await resolveMergeBaseRef(cwd, options.baseRef, context, dependencies);
  if (options.requireCleanTarget ?? true) {
    const { stdout } = await runGitCommand(["status", "--porcelain"], {
      cwd,
      envOverlay: READ_ONLY_GIT_ENV,
    });
    if (stdout.trim().length > 0) {
      throw new Error("Working directory has uncommitted changes.");
    }
  }

  const bestBaseRef = await dependencies.resolveMostAheadBaseRef(cwd, normalizedBaseRef);
  if (bestBaseRef === currentBranch) {
    return;
  }

  try {
    await runGitCommand(["merge", bestBaseRef], { cwd, timeout: 120_000 });
  } catch (error) {
    await detectAndThrowMergeConflict(
      cwd,
      error,
      (conflictFiles) =>
        new MergeFromBaseConflictError({
          baseRef: bestBaseRef,
          currentBranch,
          conflictFiles,
        }),
    );
    throw error;
  }
}

/** Checkout merge operations bound to base-ref and worktree resolvers. */
export interface CheckoutMergeAuthority<TContext> {
  toBase(cwd: string, options?: MergeToBaseOptions, context?: TContext): Promise<string>;
  fromBase(cwd: string, options?: MergeFromBaseOptions, context?: TContext): Promise<void>;
}

/**
 * Creates checkout merge operations with shared conflict detection and cleanup.
 * @param dependencies Checkout branch, base-ref, and worktree resolvers
 * @returns Bound merge-to-base and merge-from-base operations
 */
export function createCheckoutMergeAuthority<TContext>(
  dependencies: CheckoutMergeDependencies<TContext>,
): CheckoutMergeAuthority<TContext> {
  return {
    toBase: (cwd, options = {}, context) =>
      mergeCheckoutToBase(cwd, options, context, dependencies),
    fromBase: (cwd, options = {}, context) =>
      mergeCheckoutFromBase(cwd, options, context, dependencies),
  };
}
