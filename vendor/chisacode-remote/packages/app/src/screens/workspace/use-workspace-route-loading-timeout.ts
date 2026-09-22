import { useEffect, useState } from "react";
import type { HostRuntimeConnectionStatus } from "@/runtime/host-runtime";
import type { WorkspaceDescriptor } from "@/stores/session-store";

export const WORKSPACE_ROUTE_LOADING_TIMEOUT_MS = 12_000;

interface WorkspaceRouteLoadingTimeoutInput {
  routeKey: string;
  connectionStatus: HostRuntimeConnectionStatus;
  workspace: WorkspaceDescriptor | null;
  hasHydratedWorkspaces: boolean;
}

export interface WorkspaceRouteLoadingTimeoutResult {
  /** Online host still missing a workspace descriptor after the lookup budget. */
  workspaceLookupTimedOut: boolean;
  /** Connecting/idle host has been stuck long enough to offer recovery actions. */
  connectionRecoveryTimedOut: boolean;
}

/**
 * Arms the workspace-route loading budget for unresolved online lookups and for
 * stuck connecting/idle hosts so the gate can offer retry actions.
 * @param input Route identity, connection status, and workspace hydration facts
 * @returns Timeout flags for lookup missing-state and connection recovery
 */
export function useWorkspaceRouteLoadingTimedOut({
  routeKey,
  connectionStatus,
  workspace,
  hasHydratedWorkspaces,
}: WorkspaceRouteLoadingTimeoutInput): WorkspaceRouteLoadingTimeoutResult {
  const [workspaceLookupTimedOut, setWorkspaceLookupTimedOut] = useState(false);
  const [connectionRecoveryTimedOut, setConnectionRecoveryTimedOut] = useState(false);

  const shouldArmWorkspaceLookupTimeout =
    routeKey.trim().length > 0 &&
    connectionStatus === "online" &&
    !workspace &&
    !hasHydratedWorkspaces;

  const shouldArmConnectionRecoveryTimeout =
    routeKey.trim().length > 0 &&
    !workspace &&
    (connectionStatus === "connecting" || connectionStatus === "idle");

  useEffect(() => {
    if (!shouldArmWorkspaceLookupTimeout) {
      setWorkspaceLookupTimedOut(false);
      return;
    }

    setWorkspaceLookupTimedOut(false);
    const timeoutHandle = setTimeout(() => {
      setWorkspaceLookupTimedOut(true);
    }, WORKSPACE_ROUTE_LOADING_TIMEOUT_MS);

    return () => {
      clearTimeout(timeoutHandle);
    };
  }, [routeKey, shouldArmWorkspaceLookupTimeout]);

  useEffect(() => {
    if (!shouldArmConnectionRecoveryTimeout) {
      setConnectionRecoveryTimedOut(false);
      return;
    }

    setConnectionRecoveryTimedOut(false);
    const timeoutHandle = setTimeout(() => {
      setConnectionRecoveryTimedOut(true);
    }, WORKSPACE_ROUTE_LOADING_TIMEOUT_MS);

    return () => {
      clearTimeout(timeoutHandle);
    };
  }, [routeKey, shouldArmConnectionRecoveryTimeout]);

  return {
    workspaceLookupTimedOut,
    connectionRecoveryTimedOut,
  };
}
