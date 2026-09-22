import { runGitCommand } from "./run-git-command.js";

/** Git environment overlay that prevents read operations from refreshing index locks. */
export const READ_ONLY_GIT_ENV = {
  GIT_OPTIONAL_LOCKS: "0",
} as const;

/** Error raised when a checkout operation requires a Git repository. */
export class NotGitRepoError extends Error {
  readonly cwd: string;
  readonly code = "NOT_GIT_REPO";

  constructor(cwd: string) {
    super(`Not a git repository: ${cwd}`);
    this.name = "NotGitRepoError";
    this.cwd = cwd;
  }
}

/**
 * Verifies that a directory belongs to a Git repository.
 * @param cwd Directory to inspect
 * @throws {NotGitRepoError} If the directory is not inside a Git repository
 */
export async function requireGitRepo(cwd: string): Promise<void> {
  try {
    await runGitCommand(["rev-parse", "--git-dir"], { cwd, envOverlay: READ_ONLY_GIT_ENV });
  } catch {
    throw new NotGitRepoError(cwd);
  }
}
