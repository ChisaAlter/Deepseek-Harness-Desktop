import type { Href } from "expo-router";
import type { ActiveWorkspaceSelection } from "@/stores/navigation-active-workspace-store";
import type { WorkspaceDescriptor } from "@/stores/session-store";
import { buildWorkspaceArchiveRedirectRoute } from "@/utils/workspace-archive-navigation";
import { resolveWorkspaceRouteId } from "@/utils/workspace-execution";

/** Inputs used to decide whether archiving the current workspace needs a route redirect */
export interface RedirectIfArchivingActiveWorkspaceInput {
  serverId: string;
  workspaceId: string;
  activeWorkspaceSelection: ActiveWorkspaceSelection | null;
}

/** Navigation and workspace-list dependencies for archive redirects */
export interface RedirectIfArchivingActiveWorkspaceDeps {
  navigateToRoute: (route: Href) => void;
  readWorkspaces: (serverId: string) => Iterable<WorkspaceDescriptor>;
}

function trimNonEmpty(value: string | null | undefined): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * Navigates away when the workspace being archived is the currently active one
 * @param input Server/workspace ids and the active workspace selection
 * @param deps Navigation callback and workspace list reader for the fallback route
 * @returns True when a redirect was performed
 */
export function redirectIfArchivingActiveWorkspace(
  input: RedirectIfArchivingActiveWorkspaceInput,
  deps: RedirectIfArchivingActiveWorkspaceDeps,
): boolean {
  const serverId = trimNonEmpty(input.serverId);
  const workspaceId = resolveWorkspaceRouteId({ routeWorkspaceId: input.workspaceId });
  const activeServerId = trimNonEmpty(input.activeWorkspaceSelection?.serverId);
  const activeWorkspaceId = resolveWorkspaceRouteId({
    routeWorkspaceId: input.activeWorkspaceSelection?.workspaceId,
  });
  if (!serverId || !workspaceId || !activeServerId || !activeWorkspaceId) {
    return false;
  }
  if (activeServerId !== serverId || activeWorkspaceId !== workspaceId) {
    return false;
  }

  deps.navigateToRoute(
    buildWorkspaceArchiveRedirectRoute({
      serverId,
      archivedWorkspaceId: workspaceId,
      workspaces: deps.readWorkspaces(serverId),
    }),
  );
  return true;
}
