/** Agent-like source used when collecting working directory suggestions */
export interface AgentWorkingDirectorySource {
  cwd?: string | null;
  createdAt?: Date | null;
  lastActivityAt?: Date | null;
}

const MANAGED_WORKTREE_PATH_PATTERN = /(^|\/)\.(?:chisacode|chisacode)\/worktrees(\/|$)/;

/**
 * Collects unique agent working directories ordered by most recent activity
 * @param sources Iterable of agent cwd/activity sources
 * @returns Deduplicated cwd paths excluding managed ChisaCode worktrees
 */
export function collectAgentWorkingDirectorySuggestions(
  sources: Iterable<AgentWorkingDirectorySource>,
): string[] {
  const lastSeenByPath = new Map<string, number>();

  for (const source of sources) {
    const cwd = source.cwd?.trim();
    if (!cwd) {
      continue;
    }
    if (isChisaCodeOwnedWorktreePath(cwd)) {
      continue;
    }

    const timestamp = toEpochMs(source.lastActivityAt ?? source.createdAt);
    const previous = lastSeenByPath.get(cwd);
    if (previous === undefined || timestamp > previous) {
      lastSeenByPath.set(cwd, timestamp);
    }
  }

  return Array.from(lastSeenByPath.entries())
    .sort((left, right) => {
      const timeDiff = right[1] - left[1];
      if (timeDiff !== 0) {
        return timeDiff;
      }
      return left[0].localeCompare(right[0]);
    })
    .map(([cwd]) => cwd);
}

function isChisaCodeOwnedWorktreePath(cwd: string): boolean {
  return MANAGED_WORKTREE_PATH_PATTERN.test(cwd.replace(/\\/g, "/"));
}

function toEpochMs(date: Date | null | undefined): number {
  if (!(date instanceof Date)) {
    return 0;
  }
  const value = date.getTime();
  return Number.isFinite(value) ? value : 0;
}
