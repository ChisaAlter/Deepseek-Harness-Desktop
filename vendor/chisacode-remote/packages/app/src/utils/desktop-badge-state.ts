import type { WorkspaceDescriptor } from "@/stores/session-store";

/** Workspace status values considered when computing the desktop app badge */
export type DesktopBadgeWorkspaceStatus = WorkspaceDescriptor["status"];

/**
 * Whether a workspace status should count toward the desktop badge
 * @param status Workspace status from the session store
 * @returns True for attention, needs_input, or failed workspaces
 */
export function isWorkspaceActionableForDesktopBadge(status: DesktopBadgeWorkspaceStatus): boolean {
  return status === "attention" || status === "needs_input" || status === "failed";
}

/**
 * Derives the macOS Dock badge count from workspace statuses
 * @param statuses Workspace statuses across the desktop session
 * @returns Actionable count when greater than zero, otherwise undefined to clear the badge
 */
export function deriveMacDockBadgeCountFromWorkspaceStatuses(
  statuses: readonly DesktopBadgeWorkspaceStatus[],
): number | undefined {
  const actionableCount = statuses.filter(isWorkspaceActionableForDesktopBadge).length;
  return actionableCount > 0 ? actionableCount : undefined;
}
