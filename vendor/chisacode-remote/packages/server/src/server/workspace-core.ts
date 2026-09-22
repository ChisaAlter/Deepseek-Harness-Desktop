/**
 * Pure, stateless workspace/git helper functions extracted from Session.
 *
 * These functions have no access to Session state — they operate solely on
 * their parameters. Session.ts keeps forwarding wrappers so call-sites
 * (SessionContext, handler constructors) are unchanged.
 */

import { resolve, sep } from "path";
import type { WorkspaceGitRuntimeSnapshot, WorkspaceGitService } from "./workspace-git-service.js";
import type { WorkspaceDescriptorPayload, SessionOutboundMessage } from "./messages.js";
import { WORKSPACE_GIT_WATCH_REMOVED_STATE_KEY } from "./session-helpers.js";
import { deriveProjectSlug } from "./workspace-git-metadata.js";
import {
  buildWorkspaceScriptPayloads,
  readChisaCodeConfigForProjection,
} from "./script-status-projection.js";
import type { ScriptRouteStore } from "./script-proxy.js";
import type { WorkspaceScriptRuntimeStore } from "./workspace-script-runtime-store.js";
import type { ScriptHealthState } from "./script-health-monitor.js";
import type pino from "pino";
import type { WorkspaceGitWatchTarget } from "./session-internal-types.js";
import { normalizeWorkspaceId as normalizePersistedWorkspaceId } from "./workspace-registry-model.js";

/**
 * Check whether candidatePath is at or under rootPath using
 * strict prefix matching after path resolution.
 */
export function isPathWithinRoot(rootPath: string, candidatePath: string): boolean {
  const resolvedRoot = resolve(rootPath);
  const resolvedCandidate = resolve(candidatePath);
  if (resolvedCandidate === resolvedRoot) {
    return true;
  }
  return resolvedCandidate.startsWith(resolvedRoot + sep);
}

/**
 * Compute a stable descriptor state key for a workspace so the git watcher
 * can skip no-op updates.
 */
export function workspaceGitDescriptorStateKey(
  workspace: WorkspaceDescriptorPayload | null,
): string {
  if (!workspace) {
    return WORKSPACE_GIT_WATCH_REMOVED_STATE_KEY;
  }
  return JSON.stringify([
    workspace.name,
    workspace.diffStat ? [workspace.diffStat.additions, workspace.diffStat.deletions] : null,
  ]);
}

/**
 * Build a git-runtime payload suitable for a workspace descriptor,
 * or null when the workspace is not a git repository.
 */
export function buildWorkspaceGitRuntimePayload(
  snapshot: WorkspaceGitRuntimeSnapshot,
): NonNullable<WorkspaceDescriptorPayload["gitRuntime"]> | null {
  if (!snapshot.git.isGit) {
    return null;
  }
  return {
    currentBranch: snapshot.git.currentBranch,
    remoteUrl: snapshot.git.remoteUrl,
    isChisaCodeOwnedWorktree: snapshot.git.isChisaCodeOwnedWorktree,
    isDirty: snapshot.git.isDirty,
    aheadBehind: snapshot.git.aheadBehind,
    aheadOfOrigin: snapshot.git.aheadOfOrigin,
    behindOfOrigin: snapshot.git.behindOfOrigin,
  };
}

/**
 * Build a github-runtime payload from a workspace git snapshot.
 */
export function buildWorkspaceGitHubRuntimePayload(
  snapshot: WorkspaceGitRuntimeSnapshot,
): NonNullable<WorkspaceDescriptorPayload["githubRuntime"]> {
  return {
    featuresEnabled: snapshot.github.featuresEnabled,
    pullRequest: snapshot.github.pullRequest,
    error: snapshot.github.error,
  };
}

/** Reason for a git mutation notification. */
export type { GitMutationRefreshReason } from "./session-helpers.js";

/**
 * Resolve git metadata (project slug, current branch) for workspace scripts.
 *
 * @param workspaceDirectory The workspace directory to inspect
 * @param workspaceGitService Git service for snapshot access
 * @returns Metadata for script payloads, or undefined if no snapshot available
 */
export function resolveWorkspaceScriptGitMetadata(
  workspaceDirectory: string,
  workspaceGitService: Pick<WorkspaceGitService, "peekSnapshot">,
): { projectSlug: string; currentBranch: string | null } | undefined {
  const snapshot = workspaceGitService.peekSnapshot(workspaceDirectory);
  if (!snapshot) {
    return undefined;
  }
  return {
    projectSlug: deriveProjectSlug(
      workspaceDirectory,
      snapshot.git.isGit ? snapshot.git.remoteUrl : null,
    ),
    currentBranch: snapshot.git.currentBranch,
  };
}

/** Dependencies needed by buildWorkspaceScriptPayloadSnapshot. */
export interface BuildWorkspaceScriptPayloadSnapshotDeps {
  scriptRouteStore: ScriptRouteStore | null;
  scriptRuntimeStore: WorkspaceScriptRuntimeStore | null;
  getDaemonTcpPort: (() => number | null) | null;
  resolveScriptHealth: ((hostname: string) => ScriptHealthState | null) | null;
  workspaceGitService: Pick<WorkspaceGitService, "peekSnapshot">;
  sessionLogger: pino.Logger;
}

/**
 * Build the scripts array for a workspace descriptor payload without
 * access to Session state.
 */
export function buildWorkspaceScriptPayloadSnapshot(
  workspaceId: string,
  workspaceDirectory: string,
  deps: BuildWorkspaceScriptPayloadSnapshotDeps,
): WorkspaceDescriptorPayload["scripts"] {
  if (!deps.scriptRouteStore || !deps.scriptRuntimeStore) {
    return [];
  }
  return buildWorkspaceScriptPayloads({
    workspaceId,
    workspaceDirectory,
    chisacodeConfig: readChisaCodeConfigForProjection(workspaceDirectory, deps.sessionLogger),
    routeStore: deps.scriptRouteStore,
    runtimeStore: deps.scriptRuntimeStore,
    daemonPort: deps.getDaemonTcpPort?.() ?? null,
    gitMetadata: resolveWorkspaceScriptGitMetadata(workspaceDirectory, deps.workspaceGitService),
    resolveHealth: deps.resolveScriptHealth ?? undefined,
  });
}

/** Dependencies needed by emitWorkspaceScriptStatusUpdate. */
export interface EmitWorkspaceScriptStatusUpdateDeps extends BuildWorkspaceScriptPayloadSnapshotDeps {
  emit: (message: SessionOutboundMessage) => void;
}

/**
 * Emit a script_status_update message for a given workspace.
 */
export function emitWorkspaceScriptStatusUpdate(
  workspaceId: string,
  workspaceDirectory: string,
  deps: EmitWorkspaceScriptStatusUpdateDeps,
): void {
  deps.emit({
    type: "script_status_update",
    payload: {
      workspaceId,
      scripts: buildWorkspaceScriptPayloadSnapshot(workspaceId, workspaceDirectory, deps),
    },
  });
}

/**
 * Close all watchers and clear timers on a WorkspaceGitWatchTarget.
 * Does not remove the target from any maps — callers handle map cleanup.
 */
export function closeWorkspaceGitWatchTarget(target: WorkspaceGitWatchTarget): void {
  if (target.debounceTimer) {
    clearTimeout(target.debounceTimer);
    target.debounceTimer = null;
  }
  for (const watcher of target.watchers) {
    try {
      watcher.close();
    } catch {
      // Ignore watcher close errors
    }
  }
  target.watchers.length = 0;
}

/**
 * Remove a single workspace git watch target from the targets map.
 *
 * @param cwd The workspace directory
 * @param targets The targets map to mutate
 */
export function removeWorkspaceGitWatchTarget(
  cwd: string,
  targets: Map<string, WorkspaceGitWatchTarget>,
): void {
  const normalizedCwd = normalizePersistedWorkspaceId(cwd);
  const target = targets.get(normalizedCwd);
  if (target) {
    closeWorkspaceGitWatchTarget(target);
    targets.delete(normalizedCwd);
  }
}

/**
 * Remove all git-related subscriptions for a workspace directory.
 *
 * @param cwd The workspace directory
 * @param targets The targets map to mutate
 * @param fetchSubscriptions The fetch subscriptions map to mutate
 * @param subscriptions The general git subscriptions map to mutate
 */
export function removeWorkspaceGitSubscription(
  cwd: string,
  targets: Map<string, WorkspaceGitWatchTarget>,
  fetchSubscriptions: Map<string, () => void>,
  subscriptions: Map<string, () => void>,
): void {
  const normalizedCwd = normalizePersistedWorkspaceId(cwd);
  const target = targets.get(normalizedCwd);
  if (target) {
    const unsubscribeFetch = fetchSubscriptions.get(normalizedCwd);
    unsubscribeFetch?.();
    fetchSubscriptions.delete(normalizedCwd);
    closeWorkspaceGitWatchTarget(target);
    targets.delete(normalizedCwd);
  }
  subscriptions.get(normalizedCwd)?.();
  subscriptions.delete(normalizedCwd);
}
