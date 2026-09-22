import { router } from "expo-router";
import { useSessionStore } from "@/stores/session-store";
import {
  redirectIfArchivingActiveWorkspace as redirectIfArchivingActiveWorkspacePure,
  type RedirectIfArchivingActiveWorkspaceInput,
} from "@/utils/workspace-archive-redirect";

/**
 * Sidebar-bound helper that redirects when archiving the active workspace
 * @param input Server/workspace ids and active workspace selection
 * @returns True when a redirect was performed via the app router
 */
export function redirectIfArchivingActiveWorkspace(
  input: RedirectIfArchivingActiveWorkspaceInput,
): boolean {
  return redirectIfArchivingActiveWorkspacePure(input, {
    navigateToRoute: (route) => router.replace(route),
    readWorkspaces: (serverId) =>
      useSessionStore.getState().sessions[serverId]?.workspaces.values() ?? [],
  });
}
