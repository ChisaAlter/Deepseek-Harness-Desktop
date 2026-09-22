/**
 * Session helper utilities extracted from Session to keep the class
 * focused on lifecycle and registration.
 *
 * Includes version-check helpers, path canonicalization, workspace checkout
 * builders, and shared constants used by multiple handlers.
 */

import { realpathSync } from "node:fs";
import { resolve, sep } from "path";
import { randomUUID } from "node:crypto";

import type { AgentStorage } from "./agent/agent-storage.js";
import type { AgentSnapshotPayload, ProjectPlacementPayload } from "./messages.js";
import type {
  PersistedProjectRecord,
  PersistedWorkspaceRecord,
  ProjectRegistry,
} from "./workspace-registry.js";
import type { WorkspaceGitRuntimeSnapshot } from "./workspace-git-service.js";

/** Sentry value used by the git watcher to indicate a workspace directory was removed. */
export const WORKSPACE_GIT_WATCH_REMOVED_STATE_KEY = "__removed__";

/** Supported sort keys for agent list queries. */
export const FETCH_AGENTS_SORT_KEYS = [
  "status_priority",
  "created_at",
  "updated_at",
  "title",
] as const;

/** A workspace's current pull request, guaranteed to have a number. */
export type CurrentWorkspacePullRequest = NonNullable<
  WorkspaceGitRuntimeSnapshot["github"]["pullRequest"]
> & {
  number: number;
};

/** Input for resolving a known project root from a git config directory. */
export interface ResolveKnownProjectRootForConfigInput {
  repoRoot: string;
  projectRegistry: Pick<ProjectRegistry, "list">;
}

/**
 * Given a repo root (e.g. from .git config), find the matching non-archived
 * project directory known to the project registry.
 *
 * Returns the canonical project root path, or null if no match is found.
 */
export async function resolveKnownProjectRootForConfig(
  input: ResolveKnownProjectRootForConfigInput,
): Promise<string | null> {
  const requestedRoot = canonicalizeConfigRoot(input.repoRoot);
  const projects = await input.projectRegistry.list();
  for (const project of projects) {
    if (project.archivedAt !== null) {
      continue;
    }
    const projectRoot = canonicalizeConfigRoot(project.rootPath);
    if (requestedRoot === projectRoot) {
      return projectRoot;
    }
  }
  return null;
}

/**
 * Resolve a repo root path to an absolute path with resolved symlinks,
 * stripping trailing separators for consistent comparison.
 */
export function canonicalizeConfigRoot(repoRoot: string): string {
  const resolved = resolve(repoRoot);
  try {
    return stripTrailingPathSeparators(realpathSync(resolved));
  } catch {
    return stripTrailingPathSeparators(resolved);
  }
}

/** Remove all trailing path separators from a path string. */
export function stripTrailingPathSeparators(path: string): string {
  let normalized = path;
  while (normalized.length > 1 && normalized.endsWith(sep)) {
    normalized = normalized.slice(0, -1);
  }
  return normalized;
}

/** Enum of git mutation reasons used to trigger workspace updates. */
export type GitMutationRefreshReason =
  | "commit-changes"
  | "pull"
  | "push"
  | "merge-to-base"
  | "merge-from-base"
  | "merge-pr"
  | "enable-pr-auto-merge"
  | "disable-pr-auto-merge"
  | "create-pr"
  | "switch-branch"
  | "rename-branch"
  | "create-branch"
  | "stash-push"
  | "stash-pop"
  | "create-worktree";

/**
 * Legacy provider IDs for clients that pre-date arbitrary provider support.
 *
 * TODO: Remove once all app store clients are on >=0.1.45 and understand
 * arbitrary provider strings. Clients before 0.1.45 validate providers with
 * z.enum(["claude", "codex", "opencode"]) and reject the entire session
 * message if they encounter an unknown provider.
 */
export const LEGACY_PROVIDER_IDS = new Set(["claude", "codex", "opencode"]);

/**
 * Mode icons known to clients before v0.1.84. Any other icon name is
 * downgraded to "ShieldCheck" for those clients.
 */
export const LEGACY_MODE_ICONS = new Set<string>([
  "ShieldCheck",
  "ShieldAlert",
  "ShieldOff",
  "ShieldQuestionMark",
]);

/** Minimum app version that supports arbitrary provider strings. */
export const MIN_VERSION_ALL_PROVIDERS = "0.1.45";

/** Minimum app version that supports flexible editor target identifiers. */
export const MIN_VERSION_FLEXIBLE_EDITOR_IDS = "0.1.50";

/** Convert an unknown error into a human-readable string. */
export function errorToFriendlyMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  return "Unknown error";
}

/**
 * Resolve a subscription ID.
 * If subscribe is falsey, returns null (no subscription).
 * If a requested ID is provided and non-empty, returns it.
 * Otherwise generates a new UUID.
 */
export function resolveSubscriptionId(
  subscribe: unknown,
  requestedSubscriptionId: string | undefined,
): string | null {
  if (!subscribe) return null;
  if (requestedSubscriptionId && requestedSubscriptionId.length > 0) {
    return requestedSubscriptionId;
  }
  return randomUUID();
}

/** Map a diff file to its change type indicator ("A"/"D"/"M"). */
export function diffChangeTypeFor(file: { isNew?: boolean; isDeleted?: boolean }): "A" | "D" | "M" {
  if (file.isNew) return "A";
  if (file.isDeleted) return "D";
  return "M";
}

/**
 * Build a checkout descriptor for a workspace/project pair.
 * Returns different shapes depending on whether the project is a git repo,
 * whether the workspace is a worktree, etc.
 */
export function buildWorkspaceCheckout(
  workspace: PersistedWorkspaceRecord,
  project: PersistedProjectRecord,
): ProjectPlacementPayload["checkout"] {
  if (project.kind !== "git") {
    return {
      cwd: workspace.cwd,
      isGit: false,
      currentBranch: null,
      remoteUrl: null,
      worktreeRoot: null,
      isChisaCodeOwnedWorktree: false,
      mainRepoRoot: null,
    };
  }
  if (workspace.kind === "worktree") {
    return {
      cwd: workspace.cwd,
      isGit: true,
      currentBranch: workspace.displayName,
      remoteUrl: null,
      worktreeRoot: workspace.cwd,
      isChisaCodeOwnedWorktree: true,
      mainRepoRoot: project.rootPath,
    };
  }
  return {
    cwd: workspace.cwd,
    isGit: true,
    currentBranch: workspace.displayName,
    remoteUrl: null,
    worktreeRoot: workspace.cwd,
    isChisaCodeOwnedWorktree: false,
    mainRepoRoot: null,
  };
}

/**
 * Compare an app version string against a minimum version.
 * Strips prerelease suffixes before comparison.
 */
export function isAppVersionAtLeast(appVersion: string | null, minVersion: string): boolean {
  if (!appVersion) return false;
  // Strip prerelease suffix: "0.1.45-beta.4" -> "0.1.45"
  const base = appVersion.replace(/-.*$/, "");
  const parts = base.split(".").map(Number);
  const minParts = minVersion.split(".").map(Number);
  for (let i = 0; i < minParts.length; i++) {
    const a = parts[i] ?? 0;
    const b = minParts[i] ?? 0;
    if (a > b) return true;
    if (a < b) return false;
  }
  return true;
}

/** Check if the connected client supports all provider IDs. */
export function clientSupportsAllProviders(appVersion: string | null): boolean {
  return isAppVersionAtLeast(appVersion, MIN_VERSION_ALL_PROVIDERS);
}

/** Check if the connected client supports flexible editor target IDs. */
export function clientSupportsFlexibleEditorIds(appVersion: string | null): boolean {
  return isAppVersionAtLeast(appVersion, MIN_VERSION_FLEXIBLE_EDITOR_IDS);
}

/** AgentStorage augmented with a beginDelete method for delete fencing. */
export type DeleteFencedAgentStorage = AgentStorage & {
  beginDelete(agentId: string): void;
};

/** If the agent storage supports delete fencing, begin a delete operation. */
export function beginAgentDeleteIfSupported(agentStorage: AgentStorage, agentId: string): void {
  if ("beginDelete" in agentStorage && typeof agentStorage.beginDelete === "function") {
    (agentStorage as DeleteFencedAgentStorage).beginDelete(agentId);
  }
}

/**
 * Resolve the error for a wait-for-agent-finish response.
 * Returns null if the agent completed successfully (non-error status),
 * or the last error message if the agent failed.
 */
export function resolveWaitForFinishError(options: {
  status: "permission" | "error" | "idle";
  final: AgentSnapshotPayload | null;
}): string | null {
  if (options.status !== "error") {
    return null;
  }
  const message = options.final?.lastError;
  return typeof message === "string" && message.trim().length > 0 ? message : "Agent failed";
}
