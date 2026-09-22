import { useCallback } from "react";
import { useTranslation } from "react-i18next";
import * as Clipboard from "expo-clipboard";
import type { DaemonClient } from "@chisacode/client/internal/daemon-client";
import { useToast } from "@/contexts/toast-context";
import { useSessionStore } from "@/stores/session-store";
import { resolveAgentResumeCommand } from "@/screens/workspace/workspace-utility-actions";

type WorkspaceUtilityClient = Pick<DaemonClient, "fetchAgentTimeline" | "refreshAgent">;

interface UseWorkspaceUtilityActionsInput {
  client: WorkspaceUtilityClient | null;
  isConnected: boolean;
  serverId: string;
  workspaceDirectory: string | null;
  currentBranchName: string | null;
  environmentPanelAgentId: string | null;
}

export function useWorkspaceUtilityActions({
  client,
  isConnected,
  serverId,
  workspaceDirectory,
  currentBranchName,
  environmentPanelAgentId,
}: UseWorkspaceUtilityActionsInput) {
  const { t } = useTranslation();
  const toast = useToast();

  const handleCopyAgentId = useCallback(
    async (agentId: string) => {
      if (!agentId) return;
      try {
        await Clipboard.setStringAsync(agentId);
        toast.copied(t("workspace.screen.agentIdCopied"));
      } catch {
        toast.error(t("workspace.screen.copyFailed"));
      }
    },
    [t, toast],
  );

  const handleCopyResumeCommand = useCallback(
    async (agentId: string) => {
      if (!agentId) return;
      const agent = useSessionStore.getState().sessions[serverId]?.agents?.get(agentId) ?? null;
      const resolution = resolveAgentResumeCommand(agent);
      if (!resolution.ok) {
        toast.error(
          t(
            resolution.reason === "session-unavailable"
              ? "workspace.screen.resumeIdUnavailable"
              : "workspace.screen.resumeCommandUnavailable",
          ),
        );
        return;
      }
      try {
        await Clipboard.setStringAsync(resolution.command);
        toast.copied(t("workspace.screen.resumeCommandCopied"));
      } catch {
        toast.error(t("workspace.screen.copyFailed"));
      }
    },
    [serverId, t, toast],
  );

  const handleCopyEnvironmentResumeCommand = useCallback(() => {
    if (environmentPanelAgentId) {
      void handleCopyResumeCommand(environmentPanelAgentId);
      return;
    }
    toast.error(t("workspace.screen.resumeIdUnavailable"));
  }, [environmentPanelAgentId, handleCopyResumeCommand, t, toast]);

  const handleReloadAgent = useCallback(
    async (agentId: string) => {
      if (!client || !isConnected) {
        toast.error(t("workspace.screen.hostDisconnected"));
        return;
      }

      toast.show(t("workspace.screen.reloadingAgent"), { durationMs: null });
      try {
        await client.refreshAgent(agentId);
        // Preserve the old cursor so the server returns a new-epoch reset instead of an incremental tail.
        const currentCursor = useSessionStore
          .getState()
          .sessions[serverId]?.agentTimelineCursor.get(agentId);
        await client.fetchAgentTimeline(agentId, {
          direction: "tail",
          projection: "canonical",
          ...(currentCursor
            ? { cursor: { epoch: currentCursor.epoch, seq: currentCursor.endSeq } }
            : {}),
        });
        toast.show(t("workspace.screen.agentReloaded"), { variant: "success" });
      } catch (error) {
        toast.error(
          error instanceof Error ? error.message : t("workspace.screen.reloadAgentFailed"),
        );
      }
    },
    [client, isConnected, serverId, t, toast],
  );

  const handleCopyWorkspacePath = useCallback(async () => {
    if (!workspaceDirectory) {
      toast.error(t("workspace.screen.workspacePathUnavailable"));
      return;
    }
    try {
      await Clipboard.setStringAsync(workspaceDirectory);
      toast.copied(t("workspace.screen.workspacePathCopied"));
    } catch {
      toast.error(t("workspace.screen.copyFailed"));
    }
  }, [t, toast, workspaceDirectory]);

  const handleCopyBranchName = useCallback(async () => {
    if (!currentBranchName) {
      toast.error(t("workspace.screen.branchNameUnavailable"));
      return;
    }
    try {
      await Clipboard.setStringAsync(currentBranchName);
      toast.copied(t("workspace.screen.branchNameCopied"));
    } catch {
      toast.error(t("workspace.screen.copyFailed"));
    }
  }, [currentBranchName, t, toast]);

  return {
    handleCopyAgentId,
    handleCopyResumeCommand,
    handleCopyEnvironmentResumeCommand,
    handleReloadAgent,
    handleCopyWorkspacePath,
    handleCopyBranchName,
  };
}
