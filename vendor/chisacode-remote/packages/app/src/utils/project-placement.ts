import type { ProjectPlacementPayload } from "@chisacode/protocol/messages";
import { deriveProjectKey, deriveProjectName } from "@/utils/agent-grouping";

function normalizeWorkingDirectory(cwd: string): string {
  const trimmed = cwd.trim();
  return trimmed.length > 0 ? trimmed : ".";
}

/**
 * Derives a project placement payload from a working directory alone
 * @param cwd Working directory used to infer project key and name
 * @returns Placement with a non-git checkout snapshot for that cwd
 */
export function deriveProjectPlacementFromCwd(cwd: string): ProjectPlacementPayload {
  const normalizedCwd = normalizeWorkingDirectory(cwd);
  const projectKey = deriveProjectKey(normalizedCwd);

  return {
    projectKey,
    projectName: deriveProjectName(projectKey),
    checkout: {
      cwd: normalizedCwd,
      isGit: false,
      currentBranch: null,
      remoteUrl: null,
      worktreeRoot: null,
      isChisaCodeOwnedWorktree: false,
      mainRepoRoot: null,
    },
  };
}

/**
 * Resolves project placement, falling back to cwd-derived placement when missing
 * @param input Explicit placement from the server and the agent cwd fallback
 * @returns The provided placement, or a derived one from cwd
 */
export function resolveProjectPlacement(input: {
  projectPlacement: ProjectPlacementPayload | null | undefined;
  cwd: string;
}): ProjectPlacementPayload {
  return input.projectPlacement ?? deriveProjectPlacementFromCwd(input.cwd);
}
