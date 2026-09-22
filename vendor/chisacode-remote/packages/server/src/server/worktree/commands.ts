import { realpath } from "node:fs/promises";
import { join } from "node:path";

import { getChisaCodeWorktreesRoot, isChisaCodeOwnedWorktreeCwd } from "../../utils/worktree.js";
import {
  archiveChisaCodeWorktree,
  type ArchiveChisaCodeWorktreeDependencies,
} from "../chisacode-worktree-archive-service.js";
import type {
  CreateChisaCodeWorktreeInput,
  CreateChisaCodeWorktreeResult,
} from "../chisacode-worktree-service.js";
import { toWorktreeWireError, type WorktreeWireError } from "../worktree-errors.js";
import { isSameOrDescendantPath } from "../path-utils.js";
import type { WorkspaceGitService, WorkspaceGitWorktreeInfo } from "../workspace-git-service.js";

export interface ListChisaCodeWorktreesCommandDependencies {
  workspaceGitService: Pick<WorkspaceGitService, "listWorktrees">;
}

export interface ListChisaCodeWorktreesCommandInput {
  cwd: string;
  reason?: string;
}

export async function listChisaCodeWorktreesCommand(
  dependencies: ListChisaCodeWorktreesCommandDependencies,
  input: ListChisaCodeWorktreesCommandInput,
): Promise<WorkspaceGitWorktreeInfo[]> {
  if (input.reason) {
    return dependencies.workspaceGitService.listWorktrees(input.cwd, { reason: input.reason });
  }
  return dependencies.workspaceGitService.listWorktrees(input.cwd);
}

type CreateChisaCodeWorktreeWorkflow<Result extends CreateChisaCodeWorktreeResult> = (
  input: CreateChisaCodeWorktreeInput,
) => Promise<Result>;

export interface CreateChisaCodeWorktreeCommandDependencies<
  Result extends CreateChisaCodeWorktreeResult = CreateChisaCodeWorktreeResult,
> {
  chisacodeHome?: string;
  createChisaCodeWorktreeWorkflow?: CreateChisaCodeWorktreeWorkflow<Result>;
}

export type CreateChisaCodeWorktreeCommandInput = Omit<
  CreateChisaCodeWorktreeInput,
  "chisacodeHome" | "runSetup"
> & {
  chisacodeHome?: string;
};

export type CreateChisaCodeWorktreeCommandResult<Result extends CreateChisaCodeWorktreeResult> =
  | {
      ok: true;
      createdWorktree: Result;
    }
  | {
      ok: false;
      error: WorktreeWireError;
      cause: unknown;
    };

export async function createChisaCodeWorktreeCommand<Result extends CreateChisaCodeWorktreeResult>(
  dependencies: CreateChisaCodeWorktreeCommandDependencies<Result>,
  input: CreateChisaCodeWorktreeCommandInput,
): Promise<CreateChisaCodeWorktreeCommandResult<Result>> {
  try {
    if (!dependencies.createChisaCodeWorktreeWorkflow) {
      throw new Error("ChisaCode worktree service is not configured");
    }

    const createdWorktree = await dependencies.createChisaCodeWorktreeWorkflow({
      ...input,
      runSetup: false,
      chisacodeHome: input.chisacodeHome ?? dependencies.chisacodeHome,
    });
    return { ok: true, createdWorktree };
  } catch (error) {
    return {
      ok: false,
      error: toWorktreeWireError(error),
      cause: error,
    };
  }
}

export interface ArchiveChisaCodeWorktreeCommandDependencies extends Omit<
  ArchiveChisaCodeWorktreeDependencies,
  "workspaceGitService"
> {
  workspaceGitService: Pick<WorkspaceGitService, "getSnapshot" | "listWorktrees">;
}

export interface ArchiveChisaCodeWorktreeCommandInput {
  requestId: string;
  repoRoot?: string | null;
  worktreePath?: string;
  worktreeSlug?: string;
  branchName?: string;
  /** Limits archive to the worktree containing this caller path when supplied. */
  allowedScopeRoot?: string | null;
}

export type ArchiveChisaCodeWorktreeCommandResult =
  | {
      ok: true;
      removedAgents: string[];
    }
  | {
      ok: false;
      code: "NOT_ALLOWED";
      message: string;
      removedAgents: [];
    };

export async function archiveChisaCodeWorktreeCommand(
  dependencies: ArchiveChisaCodeWorktreeCommandDependencies,
  input: ArchiveChisaCodeWorktreeCommandInput,
): Promise<ArchiveChisaCodeWorktreeCommandResult> {
  const resolvedTarget = await resolveArchiveTarget(dependencies, input);
  if (
    input.allowedScopeRoot &&
    !(await isArchiveTargetWithinScope(resolvedTarget.targetPath, input.allowedScopeRoot))
  ) {
    return {
      ok: false,
      code: "NOT_ALLOWED",
      message: "Worktree is outside the caller workspace scope",
      removedAgents: [],
    };
  }
  const ownership = await isChisaCodeOwnedWorktreeCwd(resolvedTarget.targetPath, {
    chisacodeHome: dependencies.chisacodeHome,
  });

  if (!ownership.allowed) {
    return {
      ok: false,
      code: "NOT_ALLOWED",
      message: "Worktree is not a ChisaCode-owned worktree",
      removedAgents: [],
    };
  }

  const repoRoot = ownership.repoRoot ?? resolvedTarget.repoRoot ?? null;
  const removedAgents = await archiveChisaCodeWorktree(dependencies, {
    targetPath: resolvedTarget.targetPath,
    repoRoot,
    worktreesRoot: ownership.worktreeRoot,
    requestId: input.requestId,
  });

  return {
    ok: true,
    removedAgents,
  };
}

async function isArchiveTargetWithinScope(targetPath: string, scopeRoot: string): Promise<boolean> {
  const [resolvedTargetPath, resolvedScopeRoot] = await Promise.all([
    resolvePathForScopeCheck(targetPath),
    resolvePathForScopeCheck(scopeRoot),
  ]);
  return isSameOrDescendantPath(resolvedTargetPath, resolvedScopeRoot);
}

async function resolvePathForScopeCheck(path: string): Promise<string> {
  try {
    return await realpath(path);
  } catch {
    return path;
  }
}

interface ResolvedArchiveTarget {
  targetPath: string;
  repoRoot: string | null;
}

async function resolveArchiveTarget(
  dependencies: ArchiveChisaCodeWorktreeCommandDependencies,
  input: ArchiveChisaCodeWorktreeCommandInput,
): Promise<ResolvedArchiveTarget> {
  const repoRoot = input.repoRoot ?? null;
  if (input.worktreePath) {
    return { targetPath: input.worktreePath, repoRoot };
  }

  if (input.worktreeSlug) {
    if (!repoRoot) {
      throw new Error("repoRoot is required when worktreeSlug is supplied");
    }
    return {
      targetPath: await resolveWorktreeSlugPath(dependencies, repoRoot, input.worktreeSlug),
      repoRoot,
    };
  }

  if (repoRoot && input.branchName) {
    const worktrees = await dependencies.workspaceGitService.listWorktrees(repoRoot);
    const match = worktrees.find((entry) => entry.branchName === input.branchName);
    if (!match) {
      throw new Error(`ChisaCode worktree not found for branch ${input.branchName}`);
    }
    return { targetPath: match.path, repoRoot };
  }

  throw new Error("worktreePath, worktreeSlug, or repoRoot+branchName is required");
}

async function resolveWorktreeSlugPath(
  dependencies: ArchiveChisaCodeWorktreeCommandDependencies,
  repoRoot: string,
  worktreeSlug: string,
): Promise<string> {
  const worktreesRoot = await getChisaCodeWorktreesRoot(repoRoot, dependencies.chisacodeHome);
  return join(worktreesRoot, worktreeSlug);
}
