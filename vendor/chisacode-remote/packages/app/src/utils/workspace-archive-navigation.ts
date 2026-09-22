import type { Href } from "expo-router";
import type { WorkspaceDescriptor } from "@/stores/session-store";
import { buildHostNewWorkspaceRoute, buildHostRootRoute } from "@/utils/host-routes";
import { resolveWorkspaceRouteId } from "@/utils/workspace-execution";

function trimNonEmpty(value: string | null | undefined): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * Builds the route to open after archiving the currently viewed workspace
 * @param input Server id, archived workspace id, and available workspaces
 * @returns New-workspace route for the archived project's root, or host root as fallback
 */
export function buildWorkspaceArchiveRedirectRoute(input: {
  serverId: string;
  archivedWorkspaceId: string;
  workspaces: Iterable<WorkspaceDescriptor>;
}): Href {
  const archivedWorkspaceId = resolveWorkspaceRouteId({
    routeWorkspaceId: input.archivedWorkspaceId,
  });
  if (!archivedWorkspaceId) {
    return buildHostRootRoute(input.serverId);
  }

  const archivedWorkspace =
    Array.from(input.workspaces).find((workspace) => workspace.id === archivedWorkspaceId) ?? null;
  if (!archivedWorkspace) {
    return buildHostRootRoute(input.serverId);
  }
  const sourceDirectory =
    trimNonEmpty(archivedWorkspace?.projectRootPath) ??
    trimNonEmpty(archivedWorkspace?.workspaceDirectory);
  if (!sourceDirectory) {
    return buildHostRootRoute(input.serverId);
  }

  return buildHostNewWorkspaceRoute(input.serverId, sourceDirectory, {
    displayName: archivedWorkspace.projectDisplayName,
    projectId: archivedWorkspace.projectId,
  });
}
