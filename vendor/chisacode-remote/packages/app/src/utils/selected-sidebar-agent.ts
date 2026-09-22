import { useMemo } from "react";
import { useCreateFlowStore } from "@/stores/create-flow-store";
import {
  buildWorkspaceTabPersistenceKey,
  useWorkspaceLayoutStore,
} from "@/stores/workspace-layout-store";
import type { WorkspaceTabTarget } from "@/workspace-tabs/identity";

function trimNonEmpty(value: string | null | undefined): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * Resolves the agent id currently shown by the workspace center column
 * @param activeTarget The workspace active content target, if any
 * @returns The active agent id, or null when the workspace shows no agent
 */
export function resolveSelectedSidebarAgentIdFromWorkspaceLayout(
  activeTarget: WorkspaceTabTarget | null | undefined,
): string | null {
  if (!activeTarget || activeTarget.kind !== "agent") {
    return null;
  }
  return trimNonEmpty(activeTarget.agentId);
}

/**
 * Resolves the agent id that the workspace center column maps to, including the
 * optimistic agent of an in-flight draft create.
 *
 * While a draft create is in flight the layout target stays
 * `{ kind: "draft" }` until the daemon ack (the conversion runs only then), but
 * the optimistic sidebar row is already projected under the reserved agent id.
 * Returning that id immediately keeps the row selected from the moment the send
 * starts instead of after the create round-trip.
 * @param activeTarget The workspace active content target, if any
 * @param pendingDraftAgentId The reserved agent id of the in-flight draft create, if any
 * @returns The agent id to highlight in the sidebar, or null when none applies
 */
export function resolveSelectedSidebarAgentIdFromWorkspaceLayoutWithPending(
  activeTarget: WorkspaceTabTarget | null | undefined,
  pendingDraftAgentId: string | null | undefined,
): string | null {
  if (!activeTarget) {
    return null;
  }
  if (activeTarget.kind === "agent") {
    return trimNonEmpty(activeTarget.agentId);
  }
  if (activeTarget.kind === "draft") {
    return trimNonEmpty(pendingDraftAgentId);
  }
  return null;
}

/**
 * Subscribes to the workspace layout and create-flow stores and resolves the
 * agent id the workspace center column maps to, including the optimistic agent
 * of an in-flight draft create (see
 * `resolveSelectedSidebarAgentIdFromWorkspaceLayoutWithPending`).
 * @param workspaceRoute The workspace route, or null when not on a workspace
 * @returns The sidebar agent id to highlight, or null when none applies
 */
export function useSelectedSidebarAgentIdFromWorkspaceLayout(
  workspaceRoute: { serverId: string; workspaceId: string } | null,
): string | null {
  const workspaceKey = useMemo(
    () => (workspaceRoute ? buildWorkspaceTabPersistenceKey(workspaceRoute) : null),
    [workspaceRoute],
  );
  const activeTarget = useWorkspaceLayoutStore((state) =>
    workspaceKey ? state.activeTargetByWorkspace[workspaceKey] : undefined,
  );
  const pendingDraftAgentId = useCreateFlowStore((state) => {
    if (activeTarget?.kind !== "draft") {
      return undefined;
    }
    const pending = state.pendingByDraftId[activeTarget.draftId];
    return pending?.agentId ?? undefined;
  });
  return resolveSelectedSidebarAgentIdFromWorkspaceLayoutWithPending(
    activeTarget,
    pendingDraftAgentId,
  );
}
