import type { AggregatedAgent } from "@/hooks/use-aggregated-agents";

/**
 * Resolves the user's home directory for the managed-worktree check.
 *
 * Only web/Electron have process env access; native returns null and the
 * worktree check falls back to stripping (legacy behavior for project-internal
 * worktrees, which is still correct there).
 */
function resolveUserHome(): string | null {
  if (typeof process !== "undefined" && process.env?.USERPROFILE) {
    return process.env.USERPROFILE.replaceAll("\\", "/");
  }
  if (typeof process !== "undefined" && process.env?.HOME) {
    return process.env.HOME.replaceAll("\\", "/");
  }
  return null;
}

/**
 * Derives the project key for grouping agents.
 * For project-internal worktrees (`<project>/.chisacode/worktrees/...`), returns
 * the parent repo path. CHISACODE_HOME's own worktree root
 * (`<home>/.chisacode/worktrees/...`) is NOT project-internal: stripping it
 * yields the user's home directory, which is not a project, and would group
 * every such conversation under the home folder. Those paths are returned
 * unchanged so the sidebar's worktree-hash grouping resolves the real project.
 * For regular repos/directories, returns the cwd.
 * @param cwd The agent working directory to derive the key from
 * @param userHome Optional user home directory override (testing)
 * @returns The project grouping key
 */
export function deriveProjectKey(cwd: string, userHome?: string | null): string {
  const worktreeMarker = ".chisacode/worktrees/";
  const idx = cwd.indexOf(worktreeMarker);
  if (idx !== -1) {
    const parent = cwd.slice(0, idx).replace(/\/$/, "");
    const home = userHome !== undefined ? userHome : resolveUserHome();
    if (home && parent.replaceAll("\\", "/").toLowerCase() === home.toLowerCase()) {
      return cwd;
    }
    return parent;
  }
  return cwd;
}

/**
 * Produces a stable grouping key from a git remote URL.
 *
 * Waterfall:
 * - Prefer a GitHub key (normalizes SSH/HTTPS to the same key).
 * - Fallback to a generic host/path key (still normalized across SSH/HTTPS).
 * @param remoteUrl The git remote URL to normalize, if any
 * @returns The normalized remote project key, or null when the URL cannot be parsed
 */
export function deriveRemoteProjectKey(remoteUrl: string | null): string | null {
  if (!remoteUrl) {
    return null;
  }

  const trimmed = remoteUrl.trim();
  if (!trimmed) {
    return null;
  }

  // Support the common forms:
  // - git@github.com:owner/repo.git
  // - https://github.com/owner/repo(.git)
  // - ssh://git@github.com/owner/repo(.git)
  let host: string | null = null;
  let path: string | null = null;

  // SSH scp-like form: user@host:owner/repo(.git)
  const scpLike = trimmed.match(/^[^@]+@([^:]+):(.+)$/);
  if (scpLike) {
    host = scpLike[1] ?? null;
    path = scpLike[2] ?? null;
  } else if (trimmed.includes("://")) {
    try {
      const parsed = new URL(trimmed);
      host = parsed.hostname || null;
      path = parsed.pathname ? parsed.pathname.replace(/^\//, "") : null;
    } catch {
      // Fall through to best-effort parsing below.
    }
  }

  if (!host || !path) {
    return null;
  }

  let cleanedPath = cleanRemotePath(path);
  if (cleanedPath.endsWith(".git")) {
    cleanedPath = cleanedPath.slice(0, -4);
  }

  // Best-effort: owner/repo is the common case.
  // If the path is longer (e.g. groups/subgroups/repo), still keep it.
  if (!cleanedPath.includes("/")) {
    return null;
  }

  const cleanedHost = host.toLowerCase();

  // GitHub normalization: treat github.com as a special "well-known" host to
  // match the intended UX: group by repo even across different local worktrees.
  if (cleanedHost === "github.com") {
    return `remote:github.com/${cleanedPath.toLowerCase()}`;
  }

  return `remote:${cleanedHost}/${cleanedPath}`;
}

function cleanRemotePath(path: string): string {
  return path
    .trim()
    .replace(/[?#].*$/, "")
    .replace(/^\/+/, "")
    .replace(/\/+$/, "");
}

/**
 * Extracts the repo name from a git remote URL.
 * Examples:
 *   git@github.com:anthropics/claude-code.git -> anthropics/claude-code
 *   https://github.com/anthropics/claude-code.git -> anthropics/claude-code
 *   https://github.com/anthropics/claude-code -> anthropics/claude-code
 * @param remoteUrl The git remote URL to parse, if any
 * @returns The owner/repo path, or null when the URL cannot be parsed
 */
export function parseRepoNameFromRemoteUrl(remoteUrl: string | null): string | null {
  if (!remoteUrl) {
    return null;
  }

  let cleaned = remoteUrl.trim();

  // Handle SSH format: git@github.com:owner/repo.git
  if (cleaned.startsWith("git@")) {
    const colonIdx = cleaned.indexOf(":");
    if (colonIdx !== -1) {
      cleaned = cleanRemotePath(cleaned.slice(colonIdx + 1));
    }
  }
  // Handle HTTPS format: https://github.com/owner/repo.git
  else if (cleaned.includes("://")) {
    const urlPath = cleaned.split("://")[1];
    if (urlPath) {
      // Remove host (e.g., github.com/)
      const slashIdx = urlPath.indexOf("/");
      if (slashIdx !== -1) {
        cleaned = cleanRemotePath(urlPath.slice(slashIdx + 1));
      }
    }
  } else {
    cleaned = cleanRemotePath(cleaned);
  }

  // Remove .git suffix
  if (cleaned.endsWith(".git")) {
    cleaned = cleaned.slice(0, -4);
  }

  // Should be in format owner/repo now
  if (cleaned.includes("/")) {
    return cleaned;
  }

  return null;
}

/**
 * Extracts just the repo name (without owner) from a remote URL.
 * Examples:
 *   git@github.com:anthropics/claude-code.git -> claude-code
 * @param remoteUrl The git remote URL to parse, if any
 * @returns The repo name without its owner, or null when the URL cannot be parsed
 */
export function parseRepoShortNameFromRemoteUrl(remoteUrl: string | null): string | null {
  const fullName = parseRepoNameFromRemoteUrl(remoteUrl);
  if (!fullName) {
    return null;
  }
  const parts = fullName.split("/");
  return parts[parts.length - 1] || null;
}

/**
 * Extracts the project name from a path (last segment).
 * @param projectKey The project key or path to shorten
 * @returns The project display name
 */
export function deriveProjectName(projectKey: string): string {
  const githubRemotePrefix = "remote:github.com/";
  if (projectKey.startsWith(githubRemotePrefix)) {
    // Drop the owner prefix: "owner/repo" → "repo" (matches T3 short names).
    const remotePath = projectKey.slice(githubRemotePrefix.length);
    const slashIdx = remotePath.indexOf("/");
    if (slashIdx >= 0 && slashIdx < remotePath.length - 1) {
      return remotePath.slice(slashIdx + 1);
    }
    return remotePath || projectKey;
  }
  const segments = projectKey.split("/").filter(Boolean);
  return segments[segments.length - 1] || projectKey;
}

/**
 * Formats a project name for display in the UI.
 *
 * - GitHub remotes show the repo basename (owner/repo → repo)
 * - Other remotes show the remote path when possible
 * - Local projects prefer the provided projectName, then fallback to cwd tail
 * @param input The project key and the fallback project name
 * @returns The formatted project display name
 */
export function deriveProjectDisplayName(input: {
  projectKey: string;
  projectName: string;
}): string {
  const githubPrefix = "remote:github.com/";
  if (input.projectKey.startsWith(githubPrefix)) {
    // Drop the owner prefix: "owner/repo" → "repo" (matches T3 sidebar short names).
    const remotePath = input.projectKey.slice(githubPrefix.length);
    const slashIdx = remotePath.indexOf("/");
    if (slashIdx >= 0 && slashIdx < remotePath.length - 1) {
      return remotePath.slice(slashIdx + 1);
    }
    return remotePath;
  }

  if (input.projectKey.startsWith("remote:")) {
    const withoutPrefix = input.projectKey.slice("remote:".length);
    const slashIdx = withoutPrefix.indexOf("/");
    if (slashIdx >= 0) {
      const remotePath = withoutPrefix.slice(slashIdx + 1).trim();
      if (remotePath.length > 0) {
        return remotePath;
      }
    }
    return withoutPrefix;
  }

  const trimmedProjectName = input.projectName.trim();
  if (trimmedProjectName.length > 0) {
    return trimmedProjectName;
  }

  const normalized = input.projectKey.replace(/\\/g, "/").replace(/\/+$/, "");
  const segments = normalized.split("/").filter(Boolean);
  return segments[segments.length - 1] ?? input.projectKey;
}

/**
 * Determines the date group label for an agent based on lastActivityAt.
 * @param lastActivityAt The agent's last activity timestamp
 * @returns The localized date bucket label
 */
export function deriveDateGroup(lastActivityAt: Date): string {
  if (!Number.isFinite(lastActivityAt.getTime())) {
    return "更早";
  }
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const yesterday = new Date(today.getTime() - 24 * 60 * 60 * 1000);
  const activityDate = new Date(
    lastActivityAt.getFullYear(),
    lastActivityAt.getMonth(),
    lastActivityAt.getDate(),
  );

  if (activityDate.getTime() >= today.getTime()) {
    return "最近";
  }
  if (activityDate.getTime() >= yesterday.getTime()) {
    return "昨天";
  }

  const diffTime = today.getTime() - activityDate.getTime();
  const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));

  if (diffDays <= 7) {
    return "本周";
  }
  if (diffDays <= 30) {
    return "本月";
  }
  return "更早";
}

/** A group of active agents sharing a project, with activity counts for display */
export interface ProjectGroup {
  projectKey: string;
  projectName: string;
  agents: AggregatedAgent[];
  /** Number of truly active agents (running, needs input, or requires attention) */
  activeCount: number;
  /** Total agents before any limit was applied */
  totalCount: number;
}

/** A group of inactive agents bucketed under a date label */
export interface DateGroup {
  label: string;
  agents: AggregatedAgent[];
}

/** The result of grouping agents: active agents by project and inactive agents by date */
export interface GroupedAgents {
  activeGroups: ProjectGroup[];
  inactiveGroups: DateGroup[];
}

const ACTIVE_GRACE_PERIOD_MS = 2 * 24 * 60 * 60 * 1000; // 2 days (temporary for screenshots)

interface GroupAgentsOptions {
  /**
   * Optional function to read a remote URL for an agent.
   * If present and a remote URL is available, agents are grouped by remote.
   */
  getRemoteUrl?: (agent: AggregatedAgent) => string | null;
}

const MAX_INACTIVE_PER_PROJECT = 5;

/**
 * Groups agents into active (by project) and inactive (by date) sections.
 * Active = running, needs input, requires attention, or had activity within the grace period.
 *
 * Within each project group:
 * - All truly active agents (running/needs input/requires attention) are always shown
 * - Recently active (within grace period but not truly active) are limited to MAX_INACTIVE_PER_PROJECT
 */
function isAgentTrulyActive(agent: AggregatedAgent): boolean {
  return (
    agent.status === "running" || agent.requiresAttention || (agent.pendingPermissionCount ?? 0) > 0
  );
}

function partitionAgentsByActivity(
  agents: AggregatedAgent[],
  now: number,
): { activeAgents: AggregatedAgent[]; inactiveAgents: AggregatedAgent[] } {
  const activeAgents: AggregatedAgent[] = [];
  const inactiveAgents: AggregatedAgent[] = [];

  for (const agent of agents) {
    if (agent.archivedAt) {
      inactiveAgents.push(agent);
      continue;
    }

    const activityTime = getAgentActivityTime(agent);
    const isRecentlyActive = activityTime > 0 && now - activityTime < ACTIVE_GRACE_PERIOD_MS;
    if (isAgentTrulyActive(agent) || isRecentlyActive) {
      activeAgents.push(agent);
    } else {
      inactiveAgents.push(agent);
    }
  }

  return { activeAgents, inactiveAgents };
}

interface ProjectActivityBucket {
  trulyActive: AggregatedAgent[];
  recentlyActive: AggregatedAgent[];
}

function buildProjectActivityMap(
  activeAgents: AggregatedAgent[],
  options: GroupAgentsOptions | undefined,
): Map<string, ProjectActivityBucket> {
  const projectMap = new Map<string, ProjectActivityBucket>();
  for (const agent of activeAgents) {
    const remoteKey = deriveRemoteProjectKey(options?.getRemoteUrl?.(agent) ?? null);
    const projectKey = remoteKey ?? deriveProjectKey(agent.cwd);
    const existing = projectMap.get(projectKey) || { trulyActive: [], recentlyActive: [] };

    if (isAgentTrulyActive(agent)) {
      existing.trulyActive.push(agent);
    } else {
      existing.recentlyActive.push(agent);
    }

    projectMap.set(projectKey, existing);
  }
  return projectMap;
}

function getAgentActivityTime(agent: AggregatedAgent): number {
  const value = agent.lastActivityAt.getTime();
  return Number.isFinite(value) ? value : 0;
}

function byLastActivityDescending(a: AggregatedAgent, b: AggregatedAgent): number {
  return getAgentActivityTime(b) - getAgentActivityTime(a);
}

function buildActiveProjectGroups(projectMap: Map<string, ProjectActivityBucket>): ProjectGroup[] {
  const activeGroups: ProjectGroup[] = [];
  for (const [projectKey, { trulyActive, recentlyActive }] of projectMap) {
    trulyActive.sort(byLastActivityDescending);
    recentlyActive.sort(byLastActivityDescending);

    const limitedRecentlyActive = recentlyActive.slice(0, MAX_INACTIVE_PER_PROJECT);
    const combinedAgents = [...trulyActive, ...limitedRecentlyActive];
    combinedAgents.sort(byLastActivityDescending);

    activeGroups.push({
      projectKey,
      projectName: deriveProjectName(projectKey),
      agents: combinedAgents,
      activeCount: trulyActive.length,
      totalCount: trulyActive.length + recentlyActive.length,
    });
  }

  activeGroups.sort((a, b) => {
    const aRecent = a.agents[0] ? getAgentActivityTime(a.agents[0]) : 0;
    const bRecent = b.agents[0] ? getAgentActivityTime(b.agents[0]) : 0;
    return bRecent - aRecent;
  });

  return activeGroups;
}

function buildInactiveDateGroups(inactiveAgents: AggregatedAgent[]): DateGroup[] {
  const dateMap = new Map<string, AggregatedAgent[]>();
  for (const agent of inactiveAgents) {
    const dateLabel = deriveDateGroup(agent.lastActivityAt);
    const existing = dateMap.get(dateLabel) || [];
    existing.push(agent);
    dateMap.set(dateLabel, existing);
  }

  const dateOrder = ["最近", "昨天", "本周", "本月", "更早"];
  const inactiveGroups: DateGroup[] = [];
  for (const label of dateOrder) {
    const dateAgents = dateMap.get(label);
    if (dateAgents && dateAgents.length > 0) {
      dateAgents.sort(byLastActivityDescending);
      inactiveGroups.push({ label, agents: dateAgents });
    }
  }
  return inactiveGroups;
}

/**
 * Groups agents into active (by project) and inactive (by date) sections, limiting recently-active-but-idle
 * agents per project and sorting everything by most recent activity
 * @param agents The agents to group
 * @param options Optional callbacks such as a remote URL lookup used for remote-based grouping
 * @returns The grouped active and inactive agent sections
 */
export function groupAgents(
  agents: AggregatedAgent[],
  options?: GroupAgentsOptions,
): GroupedAgents {
  const { activeAgents, inactiveAgents } = partitionAgentsByActivity(agents, Date.now());
  const projectMap = buildProjectActivityMap(activeAgents, options);
  const activeGroups = buildActiveProjectGroups(projectMap);
  const inactiveGroups = buildInactiveDateGroups(inactiveAgents);
  return { activeGroups, inactiveGroups };
}
