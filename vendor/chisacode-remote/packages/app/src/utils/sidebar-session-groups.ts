import type { AggregatedAgent } from "@/hooks/use-aggregated-agents";

/** A group of agent sessions shown under one workspace heading in the sidebar. */
export interface SidebarSessionGroup {
  key: string;
  label: string;
  cwd: string | null;
  projectKey: string | null;
  agents: AggregatedAgent[];
  newestActivityAt: Date;
  /** Newest creation time in the group; used for T3-style stable ordering. */
  newestCreatedAt: Date;
}

/** Group key reserved for the synthetic pinned-agents group in the sidebar. */
export const PINNED_SIDEBAR_SESSION_GROUP_KEY = "__pinned__";

/**
 * Reconciles a persisted ordering against the keys that currently exist.
 *
 * T3 Sidebar V2 puts newly discovered rows on top and never lets activity
 * reshuffle existing rows. New keys are therefore prepended, not appended.
 * @param storedOrder The previously persisted key order
 * @param currentKeys The keys that exist now
 * @returns The stored order filtered to existing keys, with new keys prepended
 */
export function reconcileSidebarSessionOrder(
  storedOrder: readonly string[],
  currentKeys: readonly string[],
): string[] {
  const currentKeySet = new Set(currentKeys);
  const resolved = storedOrder.filter((key) => currentKeySet.has(key));
  const resolvedKeySet = new Set(resolved);
  const newKeys: string[] = [];
  for (const key of currentKeys) {
    if (!resolvedKeySet.has(key)) {
      newKeys.push(key);
      resolvedKeySet.add(key);
    }
  }
  // Newest-first default: put newly discovered keys ahead of the preserved order.
  return [...newKeys, ...resolved];
}

function orderItemsByKeys<T>(
  items: T[],
  keys: readonly string[],
  getKey: (item: T) => string,
): T[] {
  const itemByKey = new Map(items.map((item) => [getKey(item), item] as const));
  const ordered: T[] = [];
  for (const key of reconcileSidebarSessionOrder(keys, items.map(getKey))) {
    const item = itemByKey.get(key);
    if (item) {
      ordered.push(item);
    }
  }
  return ordered;
}

/**
 * Applies a stable, user-controlled order to sidebar groups and their agents, keeping pinned groups first.
 * @param groups The session groups to order
 * @param input The persisted group order, per-group agent order, and optionally pinned group keys
 * @returns A new array of groups with stable ordering applied to both groups and agents
 */
export function applyStableSidebarSessionOrder<T extends SidebarSessionGroup>(
  groups: T[],
  input: {
    groupOrder: readonly string[];
    agentOrderByGroup: Readonly<Record<string, readonly string[]>>;
    pinnedGroupKeys?: ReadonlySet<string>;
  },
): T[] {
  const pinnedGroup = groups.find((group) => group.key === PINNED_SIDEBAR_SESSION_GROUP_KEY);
  const workspaceGroups = groups.filter((group) => group.key !== PINNED_SIDEBAR_SESSION_GROUP_KEY);
  const orderedWorkspaceGroups = orderItemsByKeys(
    workspaceGroups,
    input.groupOrder,
    (group) => group.key,
  );
  const pinnedGroupKeys = input.pinnedGroupKeys ?? new Set<string>();
  const pinnedWorkspaceGroups = orderedWorkspaceGroups.filter((group) =>
    pinnedGroupKeys.has(group.key),
  );
  const unpinnedWorkspaceGroups = orderedWorkspaceGroups.filter(
    (group) => !pinnedGroupKeys.has(group.key),
  );
  const orderedGroups = pinnedGroup
    ? [pinnedGroup, ...pinnedWorkspaceGroups, ...unpinnedWorkspaceGroups]
    : [...pinnedWorkspaceGroups, ...unpinnedWorkspaceGroups];

  const result: T[] = [];
  for (const group of orderedGroups) {
    result.push({
      ...group,
      agents: orderItemsByKeys(
        group.agents,
        input.agentOrderByGroup[group.key] ?? [],
        (agent) => agent.id,
      ),
    });
  }
  return result;
}

const WINDOWS_DRIVE_PREFIX = /^[a-z]:/i;
const WINDOWS_SEPARATOR = "\\";
const POSIX_SEPARATOR = "/";
const MANAGED_WORKTREE_PATH_PATTERN =
  /(?:^|\/)(?:\.?chisacode(?:-[^/]+)?\/)?worktrees\/([a-z0-9]+)\/([^/]+)/i;

function trimTrailingSeparators(value: string): string {
  let end = value.length;
  while (end > 1) {
    const char = value[end - 1];
    if (char !== POSIX_SEPARATOR && char !== WINDOWS_SEPARATOR) {
      break;
    }
    if (end === 3 && WINDOWS_DRIVE_PREFIX.test(value.slice(0, 2))) {
      break;
    }
    end -= 1;
  }
  return value.slice(0, end);
}

/**
 * Normalizes an agent working directory into a stable group key.
 * @param cwd The agent working directory
 * @returns A lowercased, separator-normalized key, or "__unknown__" when the cwd is blank
 */
export function normalizeAgentCwdGroupKey(cwd: string | null | undefined): string {
  const trimmed = cwd?.trim() ?? "";
  if (!trimmed) {
    return "__unknown__";
  }
  const normalizedSeparators = trimmed.replaceAll(WINDOWS_SEPARATOR, POSIX_SEPARATOR);
  return trimTrailingSeparators(normalizedSeparators).toLocaleLowerCase();
}

/**
 * Derives a human-readable group label from an agent working directory.
 * @param cwd The agent working directory
 * @param fallbackLabel The label to use when the cwd is blank
 * @returns The last path segment, or the fallback label when the cwd is blank
 */
export function getAgentCwdGroupLabel(
  cwd: string | null | undefined,
  fallbackLabel = "Unknown workspace",
): string {
  const trimmed = cwd?.trim() ?? "";
  if (!trimmed) {
    return fallbackLabel;
  }
  const cleaned = trimTrailingSeparators(trimmed);
  const normalized = cleaned.replaceAll(WINDOWS_SEPARATOR, POSIX_SEPARATOR);
  const parts = normalized.split(POSIX_SEPARATOR).filter(Boolean);
  return parts.at(-1) ?? cleaned;
}

function getDateTime(value: Date | null | undefined): number {
  if (!(value instanceof Date)) {
    return 0;
  }
  const time = value.getTime();
  return Number.isFinite(time) ? time : 0;
}

/**
 * T3 Sidebar V2: static creation order, newest thread on top. Activity never
 * reorders the list — a row holds its position from open until the user moves it.
 */
export function sortAgentsForSidebarV2(agents: readonly AggregatedAgent[]): AggregatedAgent[] {
  return [...agents].sort((left, right) => {
    const createdDiff = getDateTime(right.createdAt) - getDateTime(left.createdAt);
    if (createdDiff !== 0) {
      return createdDiff;
    }
    return left.id.localeCompare(right.id);
  });
}

interface ManagedWorktreeParts {
  hash: string;
  slug: string;
}

/**
 * Detects ChisaCode-managed worktree paths: `$HOME/worktrees/<hash>/<slug>`
 * or `.../.chisacode/worktrees/<hash>/<slug>`.
 */
export function extractManagedWorktreeParts(
  cwd: string | null | undefined,
): ManagedWorktreeParts | null {
  const trimmed = cwd?.trim() ?? "";
  if (!trimmed) {
    return null;
  }
  const normalized = trimmed.replaceAll(WINDOWS_SEPARATOR, POSIX_SEPARATOR);
  const match = normalized.match(MANAGED_WORKTREE_PATH_PATTERN);
  if (!match?.[1] || !match[2]) {
    return null;
  }
  return { hash: match[1].toLowerCase(), slug: match[2] };
}

/**
 * Whether a project key looks like a local filesystem path (drive letter,
 * leading slash, or backslash) rather than a remote-style key.
 */
function isLocalPathLikeProjectKey(value: string): boolean {
  return /^[a-zA-Z]:[\\/]/.test(value) || value.startsWith("/") || value.includes("\\");
}

function getPlacementProjectRoot(agent: AggregatedAgent): string | null {
  const placement = agent.projectPlacement;
  if (!placement) {
    return null;
  }
  const projectKey = placement.projectKey.trim();
  if (placement.checkout.isChisaCodeOwnedWorktree === true) {
    // Prefer the remote project key so worktree rows group under the same
    // bucket as non-worktree rows of the same project (e.g. the optimistic
    // draft of a new conversation). The main repo root is only a fallback
    // when the key is a cwd-derived artifact (raw worktree path or a stripped
    // home dir that never matched a workspace).
    if (projectKey && !isLocalPathLikeProjectKey(projectKey)) {
      return projectKey;
    }
    const mainRepoRoot = placement.checkout.mainRepoRoot?.trim() ?? "";
    if (mainRepoRoot) {
      return mainRepoRoot;
    }
  }
  return projectKey || null;
}

function getPlacementDisplayLabel(agent: AggregatedAgent): string | null {
  const placement = agent.projectPlacement;
  if (!placement) {
    return null;
  }
  const projectName = placement.projectName?.trim() ?? "";
  if (projectName) {
    // Prefer short repo name when remote-style "owner/repo".
    const slash = projectName.lastIndexOf("/");
    if (slash >= 0 && slash < projectName.length - 1) {
      return projectName.slice(slash + 1);
    }
    return projectName;
  }
  const root = getPlacementProjectRoot(agent);
  if (root) {
    return getAgentCwdGroupLabel(root);
  }
  return null;
}

/** Resolved sidebar group identity for a project/workspace bucket. */
export interface SidebarGroupIdentity {
  key: string;
  label: string;
  cwd: string | null;
  projectKey: string | null;
}

type GroupIdentity = SidebarGroupIdentity;

/** Workspace-like row used to map managed worktree hashes back to a project. */
export interface SidebarWorktreeProjectHintSource {
  workspaceDirectory?: string | null;
  projectRootPath?: string | null;
  projectId?: string | null;
  projectDisplayName?: string | null;
  project?: {
    projectKey?: string | null;
    projectName?: string | null;
    checkout?: {
      isChisaCodeOwnedWorktree?: boolean | null;
      mainRepoRoot?: string | null;
    } | null;
  } | null;
}

// eslint-disable-next-line complexity -- Hint resolution walks placement/registry/project fallbacks.
function identityFromHintSource(source: SidebarWorktreeProjectHintSource): GroupIdentity | null {
  const projectKey = source.project?.projectKey?.trim() || source.projectId?.trim() || null;
  const isWorktree = source.project?.checkout?.isChisaCodeOwnedWorktree === true;
  const mainRepoRoot = source.project?.checkout?.mainRepoRoot?.trim() ?? null;
  let placementRoot: string | null = null;
  if (isWorktree && projectKey && !isLocalPathLikeProjectKey(projectKey)) {
    // Same bucket as non-worktree rows of the project (remote key), not the
    // main repo root path.
    placementRoot = projectKey;
  } else if (isWorktree) {
    placementRoot = mainRepoRoot;
  }
  placementRoot = placementRoot || source.projectRootPath?.trim() || projectKey || null;
  if (!placementRoot) {
    return null;
  }
  const resolvedProjectKey =
    source.project?.projectKey?.trim() || source.projectId?.trim() || placementRoot;
  const projectName = source.project?.projectName?.trim() || source.projectDisplayName?.trim();
  let label = getAgentCwdGroupLabel(placementRoot);
  if (projectName) {
    const slash = projectName.lastIndexOf("/");
    label =
      slash >= 0 && slash < projectName.length - 1 ? projectName.slice(slash + 1) : projectName;
  }
  return {
    key: normalizeAgentCwdGroupKey(placementRoot),
    label,
    // The group's working directory must be a real path (used by the group
    // header's "new conversation" action); the remote key is never a path.
    cwd: isWorktree ? mainRepoRoot || source.projectRootPath?.trim() || null : placementRoot,
    projectKey: resolvedProjectKey,
  };
}

/**
 * Builds a hash → project identity index from known workspaces so a brand-new
 * worktree slug never flashes as its own project group.
 */
export function buildWorktreeProjectHintsFromSources(
  sources: Iterable<SidebarWorktreeProjectHintSource>,
): Map<string, GroupIdentity> {
  const byHash = new Map<string, GroupIdentity>();
  for (const source of sources) {
    const identity = identityFromHintSource(source);
    if (!identity) {
      continue;
    }
    const parts = extractManagedWorktreeParts(source.workspaceDirectory);
    if (parts && !byHash.has(parts.hash)) {
      byHash.set(parts.hash, identity);
    }
  }
  return byHash;
}

/**
 * Builds an exact-cwd → project identity index so a newly created worktree can
 * inherit the project as soon as its workspace row lands, even before placement
 * is attached to the agent snapshot.
 */
export function buildWorkspaceDirectoryProjectHintsFromSources(
  sources: Iterable<SidebarWorktreeProjectHintSource>,
): Map<string, GroupIdentity> {
  const byDirectory = new Map<string, GroupIdentity>();
  for (const source of sources) {
    const identity = identityFromHintSource(source);
    const directory = source.workspaceDirectory?.trim();
    if (!identity || !directory) {
      continue;
    }
    const key = normalizeAgentCwdGroupKey(directory);
    if (!byDirectory.has(key)) {
      byDirectory.set(key, identity);
    }
  }
  return byDirectory;
}

function buildWorktreeHashIndex(
  agents: readonly AggregatedAgent[],
  externalHints?: ReadonlyMap<string, GroupIdentity>,
): Map<string, GroupIdentity> {
  const byHash = new Map<string, GroupIdentity>(externalHints ?? []);
  for (const agent of agents) {
    const parts = extractManagedWorktreeParts(agent.cwd);
    if (!parts || byHash.has(parts.hash)) {
      continue;
    }
    const root = getPlacementProjectRoot(agent);
    if (!root) {
      continue;
    }
    const key = normalizeAgentCwdGroupKey(root);
    const label = getPlacementDisplayLabel(agent) ?? getAgentCwdGroupLabel(root);
    byHash.set(parts.hash, {
      key,
      label,
      // Real path for the group header's "new conversation" action.
      cwd:
        agent.projectPlacement?.checkout?.isChisaCodeOwnedWorktree === true
          ? agent.projectPlacement.checkout.mainRepoRoot?.trim() || root
          : root,
      projectKey: agent.projectPlacement?.projectKey.trim() || root,
    });
  }
  return byHash;
}

// eslint-disable-next-line complexity -- group identity walks placement/registry/project fallbacks
function resolveSidebarSessionGroupIdentity(
  agent: AggregatedAgent,
  worktreeHashIndex: ReadonlyMap<string, GroupIdentity>,
  workspaceDirectoryHints: ReadonlyMap<string, GroupIdentity> | undefined,
  fallbackLabel: string,
): GroupIdentity {
  const placementRoot = getPlacementProjectRoot(agent);
  if (placementRoot) {
    // A placement can carry the raw managed-worktree path (e.g. a cwd-derived
    // fallback before the workspace registry hydrates, or a server fallback
    // that never matched a registered workspace). Resolve such roots through
    // the worktree-hash index so the row lands under the real project instead
    // of a fake worktree/home directory.
    const worktreeParts = extractManagedWorktreeParts(placementRoot);
    if (worktreeParts) {
      const known = worktreeHashIndex.get(worktreeParts.hash);
      if (known) {
        return known;
      }
    }
    // The placement root can also be the stripped HOME of a CHISACODE_HOME
    // worktree (`<home>/.chisacode/worktrees/...`), which deriveProjectKey
    // cannot detect without process env (unavailable in sandboxed renderers).
    // When the agent's own cwd is a managed worktree path, resolve via the
    // cwd's hash instead of grouping under the home directory.
    const cwdWorktreeParts = extractManagedWorktreeParts(agent.cwd);
    if (cwdWorktreeParts) {
      const known = worktreeHashIndex.get(cwdWorktreeParts.hash);
      if (known) {
        return known;
      }
    }
    return {
      key: normalizeAgentCwdGroupKey(placementRoot),
      label: getPlacementDisplayLabel(agent) ?? getAgentCwdGroupLabel(placementRoot, fallbackLabel),
      // The group's working directory must be a real path (used by the group
      // header's "new conversation" action); a remote key or stripped home dir
      // is never a path — prefer the main repo root for worktree rows.
      cwd:
        agent.projectPlacement?.checkout?.isChisaCodeOwnedWorktree === true
          ? agent.projectPlacement.checkout.mainRepoRoot?.trim() || placementRoot
          : placementRoot,
      projectKey: agent.projectPlacement?.projectKey.trim() || placementRoot,
    };
  }

  const cwd = agent.cwd?.trim() || null;
  if (cwd && workspaceDirectoryHints) {
    const byDirectory = workspaceDirectoryHints.get(normalizeAgentCwdGroupKey(cwd));
    if (byDirectory) {
      return byDirectory;
    }
  }

  const worktreeParts = extractManagedWorktreeParts(agent.cwd);
  if (worktreeParts) {
    const known = worktreeHashIndex.get(worktreeParts.hash);
    if (known) {
      return known;
    }
    // Keep every unknown slug for this hash in one temporary bucket so the
    // sidebar never sprouts a second project row per worktree name. Prefer
    // any known sibling project's label when the hash index later fills in.
    return {
      key: `worktree-hash:${worktreeParts.hash}`,
      label: fallbackLabel,
      cwd: null,
      projectKey: null,
    };
  }

  return {
    key: normalizeAgentCwdGroupKey(cwd),
    label: getAgentCwdGroupLabel(cwd, fallbackLabel),
    cwd,
    projectKey: agent.projectPlacement?.projectKey.trim() || cwd,
  };
}

function isNewerDate(left: Date, right: Date): boolean {
  return getDateTime(left) > getDateTime(right);
}

/**
 * Groups agents into sidebar session sections keyed by workspace, with pinned agents lifted into a leading group.
 *
 * Ordering follows T3 Sidebar V2:
 * - Within a group, agents sort by createdAt descending (newest on top)
 * - Groups sort by their newest createdAt
 * - Activity timestamps never reshuffle rows
 * @param agents The agents to group
 * @param options Optional labels for unknown/pinned groups and a pinned-agent predicate
 * @returns The session groups sorted by newest creation time, with the pinned group first when present
 */
// eslint-disable-next-line complexity -- Grouping walks placement/worktree hints plus pinned lift.
export function groupAgentsForSidebar(
  agents: AggregatedAgent[],
  options?: {
    unknownWorkspaceLabel?: string;
    pinnedGroupLabel?: string;
    isPinnedAgent?: (agent: AggregatedAgent) => boolean;
    /**
     * Optional hash→project hints from the workspace registry so brand-new
     * managed worktrees group under the real project before placement lands.
     */
    worktreeProjectHints?: ReadonlyMap<string, GroupIdentity>;
    /**
     * Optional exact workspace-directory → project hints for brand-new worktrees.
     */
    workspaceDirectoryHints?: ReadonlyMap<string, GroupIdentity>;
  },
): SidebarSessionGroup[] {
  const groups = new Map<string, SidebarSessionGroup>();
  const unknownWorkspaceLabel = options?.unknownWorkspaceLabel ?? "Unknown workspace";
  const pinnedGroupLabel = options?.pinnedGroupLabel ?? "Pinned";
  const isPinnedAgent = options?.isPinnedAgent ?? (() => false);
  const pinnedAgents: AggregatedAgent[] = [];
  const worktreeHashIndex = buildWorktreeHashIndex(agents, options?.worktreeProjectHints);

  for (const agent of agents) {
    if (isPinnedAgent(agent)) {
      pinnedAgents.push(agent);
      continue;
    }

    const identity = resolveSidebarSessionGroupIdentity(
      agent,
      worktreeHashIndex,
      options?.workspaceDirectoryHints,
      unknownWorkspaceLabel,
    );
    const existing = groups.get(identity.key);
    if (existing) {
      existing.agents.push(agent);
      if (isNewerDate(agent.lastActivityAt, existing.newestActivityAt)) {
        existing.newestActivityAt = agent.lastActivityAt;
      }
      if (isNewerDate(agent.createdAt, existing.newestCreatedAt)) {
        existing.newestCreatedAt = agent.createdAt;
      }
      // Prefer a real project label over a transient worktree slug.
      if (identity.projectKey && !existing.projectKey) {
        existing.label = identity.label;
        existing.cwd = identity.cwd;
        existing.projectKey = identity.projectKey;
      } else if (
        identity.label &&
        existing.projectKey === null &&
        identity.key.startsWith("worktree-hash:") === false
      ) {
        existing.label = identity.label;
      }
      continue;
    }

    groups.set(identity.key, {
      key: identity.key,
      label: identity.label,
      cwd: identity.cwd,
      projectKey: identity.projectKey,
      agents: [agent],
      newestActivityAt: agent.lastActivityAt,
      newestCreatedAt: agent.createdAt,
    });
  }

  // Second pass: if a hash-only group later gained a sibling with placement in
  // another key, merge is already handled via worktreeHashIndex. Re-label any
  // remaining hash groups that now have a placement-bearing agent.
  for (const group of groups.values()) {
    if (!group.key.startsWith("worktree-hash:")) {
      continue;
    }
    for (const agent of group.agents) {
      const label = getPlacementDisplayLabel(agent);
      const root = getPlacementProjectRoot(agent);
      if (label && root) {
        group.label = label;
        group.cwd = root;
        group.projectKey = agent.projectPlacement?.projectKey.trim() || root;
        break;
      }
    }
  }

  const groupedAgents = Array.from(groups.values())
    .map((group) => ({
      key: group.key,
      label: group.label,
      cwd: group.cwd,
      projectKey: group.projectKey,
      newestActivityAt: group.newestActivityAt,
      newestCreatedAt: group.newestCreatedAt,
      agents: sortAgentsForSidebarV2(group.agents),
    }))
    .sort((left, right) => {
      const createdDiff = getDateTime(right.newestCreatedAt) - getDateTime(left.newestCreatedAt);
      if (createdDiff !== 0) {
        return createdDiff;
      }
      return left.key.localeCompare(right.key);
    });

  if (pinnedAgents.length === 0) {
    return groupedAgents;
  }

  const sortedPinnedAgents = sortAgentsForSidebarV2(pinnedAgents);
  return [
    {
      key: PINNED_SIDEBAR_SESSION_GROUP_KEY,
      label: pinnedGroupLabel,
      cwd: null,
      projectKey: null,
      agents: sortedPinnedAgents,
      newestActivityAt: sortedPinnedAgents[0]?.lastActivityAt ?? new Date(0),
      newestCreatedAt: sortedPinnedAgents[0]?.createdAt ?? new Date(0),
    },
    ...groupedAgents,
  ];
}
