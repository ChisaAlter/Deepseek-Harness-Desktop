/**
 * Adapts ChisaCode's agent + workspace data into the sidebar v2 thread view
 * model. This is the seam where T3's "thread" maps to a ChisaCode agent
 * session: title, status signals, timestamps, project placement, branch, PR,
 * and the label-backed snooze/settled fields.
 */
import type { AggregatedAgent } from "@/hooks/use-aggregated-agents";
import { extractManagedWorktreeParts } from "@/utils/sidebar-session-groups";
import {
  SIDEBAR_LABEL_SETTLED_AT,
  SIDEBAR_LABEL_SETTLED_OVERRIDE,
  SIDEBAR_LABEL_SNOOZED_AT,
  SIDEBAR_LABEL_SNOOZED_UNTIL,
} from "./snooze";
import type { PartitionableThread } from "./shelves";

/** Agent lifecycle statuses that mean "in motion". */
const IN_MOTION_STATUSES = new Set(["running", "initializing"]);

/** Attention reasons that mean "waiting on the user". */
const USER_INPUT_ATTENTION_REASONS = new Set(["permission"]);

/** A sidebar v2 thread: the agent view model plus display fields. */
export interface SidebarV2Thread extends PartitionableThread {
  title: string;
  provider: string;
  serverId: string;
  projectKey: string | null;
  projectName: string | null;
  branch: string | null;
  cwd: string | null;
  worktreePath: string | null;
  changeRequestState: "open" | "closed" | "merged" | null;
  lastVisitedAt: string | null;
  requiresFinishedAttention: boolean;
  model: string | null;
  lastError: string | null;
}

/** Workspace-like metadata used to enrich an agent row. */
export interface SidebarV2WorkspaceHint {
  workspaceDirectory?: string | null;
  projectId?: string | null;
  projectDisplayName?: string | null;
  name?: string | null;
  gitRuntime?: { currentBranch?: string | null } | null;
  githubRuntime?: { pullRequest?: { state?: string | null } | null } | null;
  project?: {
    projectKey?: string | null;
    projectName?: string | null;
    checkout?: {
      isChisaCodeOwnedWorktree?: boolean | null;
      mainRepoRoot?: string | null;
      currentBranch?: string | null;
      remoteUrl?: string | null;
    } | null;
  } | null;
}

function isoOrNull(value: Date | null | undefined): string | null {
  if (!(value instanceof Date)) {
    return null;
  }
  const time = value.getTime();
  if (!Number.isFinite(time)) {
    return null;
  }
  return value.toISOString();
}

function labelOrNull(labels: Record<string, string> | undefined, key: string): string | null {
  const value = labels?.[key];
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function resolveProjectKey(
  agent: AggregatedAgent,
  worktreeProjectHints?: ReadonlyMap<string, { projectKey: string | null }>,
): string | null {
  const projectKey = agent.projectPlacement?.projectKey?.trim();
  if (projectKey) {
    // A managed-worktree cwd whose placement key was cwd-derived (e.g. the
    // stripped home dir of a CHISACODE_HOME worktree when the renderer cannot
    // detect the home dir) must resolve to the real project via the worktree
    // hash index, mirroring the by-project grouping fallback.
    const worktreeParts = extractManagedWorktreeParts(agent.cwd);
    if (worktreeParts) {
      const known = worktreeProjectHints?.get(worktreeParts.hash);
      const hintKey = known?.projectKey?.trim();
      if (hintKey) {
        return hintKey;
      }
    }
    return projectKey;
  }
  const cwd = agent.cwd?.trim();
  return cwd ? cwd : null;
}

function resolveProjectName(
  agent: AggregatedAgent,
  worktreeProjectHints?: ReadonlyMap<string, { projectKey: string | null }>,
): string | null {
  const projectName = agent.projectPlacement?.projectName?.trim();
  if (projectName) {
    return projectName;
  }
  const projectKey = resolveProjectKey(agent, worktreeProjectHints);
  if (!projectKey) {
    return null;
  }
  const normalized = projectKey.replace(/\\/g, "/").replace(/\/+$/, "");
  const segments = normalized.split("/").filter(Boolean);
  return segments.at(-1) ?? null;
}

function resolveBranch(
  agent: AggregatedAgent,
  workspace?: SidebarV2WorkspaceHint | null,
): string | null {
  const placementBranch = agent.projectPlacement?.checkout?.currentBranch?.trim();
  if (placementBranch) {
    return placementBranch;
  }
  const workspaceBranch = workspace?.gitRuntime?.currentBranch?.trim();
  if (workspaceBranch) {
    return workspaceBranch;
  }
  const checkoutBranch = workspace?.project?.checkout?.currentBranch?.trim();
  return checkoutBranch || null;
}

function resolveChangeRequestState(
  workspace?: SidebarV2WorkspaceHint | null,
): "open" | "closed" | "merged" | null {
  const state = workspace?.githubRuntime?.pullRequest?.state;
  if (state === "open" || state === "closed" || state === "merged") {
    return state;
  }
  return null;
}

function resolveWorktreePath(agent: AggregatedAgent): string | null {
  const placementRoot = agent.projectPlacement?.checkout?.worktreeRoot?.trim();
  if (placementRoot) {
    return placementRoot;
  }
  if (agent.projectPlacement?.checkout?.isChisaCodeOwnedWorktree === true) {
    return agent.cwd?.trim() || null;
  }
  return null;
}

function resolveSettledOverride(
  labels: Record<string, string> | undefined,
): SidebarV2Thread["settledOverride"] {
  const settledOverrideLabel = labelOrNull(labels, SIDEBAR_LABEL_SETTLED_OVERRIDE);
  if (settledOverrideLabel === "active" || settledOverrideLabel === "settled") {
    return settledOverrideLabel;
  }
  return null;
}

function resolveLatestUserMessageAt(
  agent: AggregatedAgent,
  lastActivityAt: string | null,
): string | null {
  const attentionAt = isoOrNull(agent.attentionTimestamp);
  if (agent.status === "running" || agent.status === "initializing") {
    return attentionAt ?? lastActivityAt;
  }
  return attentionAt;
}

/**
 * Adapts an aggregated agent into the sidebar v2 thread model.
 * @param agent The aggregated agent from live/history sources
 * @param workspace Optional workspace descriptor used to enrich branch/PR data
 * @param extras Optional fields not carried by the aggregated directory entry
 * @returns The thread view model
 */
export function agentToSidebarThread(
  agent: AggregatedAgent,
  workspace?: SidebarV2WorkspaceHint | null,
  extras?: { lastError?: string | null; model?: string | null },
  worktreeProjectHints?: ReadonlyMap<string, { projectKey: string | null }>,
): SidebarV2Thread {
  const labels = agent.labels ?? {};
  const hasPendingApprovals = (agent.pendingPermissionCount ?? 0) > 0;
  const hasPendingUserInput =
    agent.requiresAttention === true &&
    USER_INPUT_ATTENTION_REASONS.has(agent.attentionReason ?? "");
  const requiresFinishedAttention =
    agent.requiresAttention === true && agent.attentionReason === "finished";
  const lastActivityAt = isoOrNull(agent.lastActivityAt);
  const latestUserMessageAt = resolveLatestUserMessageAt(agent, lastActivityAt);
  const settledOverride = resolveSettledOverride(labels);
  const cwd = agent.cwd?.trim() || null;

  return {
    id: agent.id,
    serverId: agent.serverId,
    title: agent.title?.trim() || agent.id,
    provider: agent.provider,
    status: agent.status,
    lastError: extras?.lastError ?? null,
    lastActivityAt,
    latestUserMessageAt,
    createdAt: isoOrNull(agent.createdAt) ?? "1970-01-01T00:00:00.000Z",
    updatedAt: lastActivityAt ?? isoOrNull(agent.createdAt) ?? "1970-01-01T00:00:00.000Z",
    archivedAt: isoOrNull(agent.archivedAt),
    hasPendingApprovals,
    hasPendingUserInput,
    snoozedUntil: labelOrNull(labels, SIDEBAR_LABEL_SNOOZED_UNTIL),
    snoozedAt: labelOrNull(labels, SIDEBAR_LABEL_SNOOZED_AT),
    settledAt: labelOrNull(labels, SIDEBAR_LABEL_SETTLED_AT),
    settledOverride,
    projectKey: resolveProjectKey(agent, worktreeProjectHints),
    projectName: resolveProjectName(agent, worktreeProjectHints),
    branch: resolveBranch(agent, workspace),
    cwd,
    worktreePath: resolveWorktreePath(agent) ?? cwd,
    changeRequestState: resolveChangeRequestState(workspace),
    lastVisitedAt: null,
    requiresFinishedAttention,
    model: extras?.model ?? null,
  };
}

/**
 * Whether the agent is currently in motion (running/initializing).
 * @param status The agent lifecycle status
 * @returns True when the agent is working
 */
export function isAgentInMotion(status: string): boolean {
  return IN_MOTION_STATUSES.has(status);
}

/**
 * Builds a workspace lookup by normalized directory for enriching agent rows.
 * @param workspaces The workspace descriptors to index
 * @returns A map keyed by normalized workspace directory
 */
export function buildWorkspaceDirectoryIndex<T extends SidebarV2WorkspaceHint>(
  workspaces: Iterable<T>,
): Map<string, T> {
  const index = new Map<string, T>();
  for (const workspace of workspaces) {
    const directory = workspace.workspaceDirectory?.trim();
    if (!directory) {
      continue;
    }
    const key = normalizePathKey(directory);
    if (!index.has(key)) {
      index.set(key, workspace);
    }
  }
  return index;
}

function normalizePathKey(value: string): string {
  return value.replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
}

/**
 * Finds the workspace descriptor for an agent's cwd.
 * @param agent The aggregated agent
 * @param index The workspace directory index
 * @returns The workspace hint, or null
 */
export function findWorkspaceForAgent(
  agent: AggregatedAgent,
  index: ReadonlyMap<string, SidebarV2WorkspaceHint>,
): SidebarV2WorkspaceHint | null {
  const cwd = agent.cwd?.trim();
  if (!cwd) {
    return null;
  }
  return index.get(normalizePathKey(cwd)) ?? null;
}
