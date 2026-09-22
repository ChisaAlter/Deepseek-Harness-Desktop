import { useCallback } from "react";
import { router } from "expo-router";
import { useKeyboardActionHandler } from "@/hooks/use-keyboard-action-handler";
import type { KeyboardActionId } from "@/keyboard/keyboard-action-dispatcher";
import { useHosts } from "@/runtime/host-runtime";

const WORKSPACE_NEW_ACTIONS: readonly KeyboardActionId[] = ["workspace.new"];

/**
 * Registers a global keyboard handler for the "new workspace" action.
 * When triggered (Cmd+N / Ctrl+N), navigates to the new-workspace route
 * for the first connected host, or the active host if available.
 */
export function useGlobalNewWorkspaceAction() {
  const hosts = useHosts();

  const handle = useCallback(() => {
    // Pick any connected host — prefer the first in the list.
    if (hosts.length === 0) return false;
    const host = hosts[0];
    if (!host) return false;
    router.navigate(`/h/${host.serverId}/new` as never);
    return true;
  }, [hosts]);

  useKeyboardActionHandler({
    handlerId: "workspace-new-global",
    actions: WORKSPACE_NEW_ACTIONS,
    enabled: hosts.length > 0,
    priority: 0,
    handle,
  });
}
