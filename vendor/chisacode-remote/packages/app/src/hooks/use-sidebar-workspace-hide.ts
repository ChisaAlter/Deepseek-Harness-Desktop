import { useCallback, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { useToast } from "@/contexts/toast-context";
import type { SidebarWorkspaceEntry } from "@/hooks/use-sidebar-workspaces-list";
import { getHostRuntimeStore } from "@/runtime/host-runtime";
import { useActiveWorkspaceSelection } from "@/stores/navigation-active-workspace-store";
import { confirmDialog } from "@/utils/confirm-dialog";
import { redirectIfArchivingActiveWorkspace } from "@/utils/sidebar-workspace-archive-redirect";
import { archiveWorkspaceOptimistically } from "@/workspace/workspace-archive";

/** Owns the confirmation, optimistic state, and navigation flow for hiding a workspace. */
export function useSidebarWorkspaceHide(workspace: SidebarWorkspaceEntry) {
  const { t } = useTranslation();
  const toast = useToast();
  const activeWorkspaceSelection = useActiveWorkspaceSelection();
  const [isHidingWorkspace, setIsHidingWorkspace] = useState(false);
  const hideInFlightRef = useRef(false);

  const redirectAfterArchive = useCallback(() => {
    redirectIfArchivingActiveWorkspace({
      serverId: workspace.serverId,
      workspaceId: workspace.workspaceId,
      activeWorkspaceSelection,
    });
  }, [activeWorkspaceSelection, workspace.serverId, workspace.workspaceId]);

  const hideWorkspaceAfterConfirmation = useCallback(async () => {
    if (hideInFlightRef.current) {
      return;
    }
    hideInFlightRef.current = true;

    try {
      const confirmed = await confirmDialog({
        title: t("sidebar.hideWorkspaceTitle"),
        message: t("sidebar.hideWorkspaceMessage", { name: workspace.name }),
        confirmLabel: t("sidebar.hide"),
        cancelLabel: t("common.cancel"),
        destructive: true,
      });
      if (!confirmed) {
        return;
      }

      const client = getHostRuntimeStore().getClient(workspace.serverId);
      if (!client) {
        toast.error(t("sidebar.hostDisconnected"));
        return;
      }

      setIsHidingWorkspace(true);
      await archiveWorkspaceOptimistically({
        client,
        workspace,
        afterHide: redirectAfterArchive,
      });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("sidebar.hideWorkspaceFailed"));
    } finally {
      hideInFlightRef.current = false;
      setIsHidingWorkspace(false);
    }
  }, [redirectAfterArchive, t, toast, workspace]);

  const hideWorkspace = useCallback(() => {
    void hideWorkspaceAfterConfirmation();
  }, [hideWorkspaceAfterConfirmation]);

  return {
    hideWorkspace,
    isHidingWorkspace,
    redirectAfterArchive,
  };
}
