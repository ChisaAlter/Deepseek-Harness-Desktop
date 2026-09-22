import { useCallback, type Dispatch, type SetStateAction } from "react";

import { getIsElectron } from "@/constants/platform";
import {
  resolveDockStateAfterAction,
  resolveWorkspacePaneCommand,
  type WorkspaceEnvironmentDockState,
  type WorkspaceEnvironmentDockTab,
  type WorkspacePaneCommand,
} from "@/screens/workspace/workspace-environment-dock-model";
import { createWorkspaceBrowser } from "@/stores/browser-store";
import type { WorkspaceTabTarget } from "@/workspace-tabs/identity";

type ForcedEnvironmentPanelMode = "forced-open" | "forced-closed";

type OpenWorkspaceTarget = (workspaceKey: string, target: WorkspaceTabTarget) => void;

interface UseWorkspaceDockActionsInput {
  isMobile: boolean;
  hasEnvironmentBrowserContext: boolean;
  hasEnvironmentPullRequest: boolean;
  persistenceKey: string | null;
  setEnvironmentDockState: Dispatch<SetStateAction<WorkspaceEnvironmentDockState>>;
  setEnvironmentPanelMode: (mode: ForcedEnvironmentPanelMode) => void;
  closeDesktopFileExplorer: () => void;
  handleOpenEnvironmentChanges: () => void;
  /** Production desktop fallback when explorer checkout is not ready yet. */
  openRightPanelDiff?: () => void;
  handleCreateTerminal: (input?: { paneId?: string }) => void;
  openWorkspaceTarget: OpenWorkspaceTarget;
}

interface UseWorkspaceDockActionsResult {
  handleOpenWorkspaceDockPane: (pane: WorkspaceEnvironmentDockTab) => void;
  handleOpenGitDock: () => void;
  handleOpenBrowserContextDock: () => void;
  handleOpenPullRequestDock: () => void;
}

/** Owns workspace dock state transitions and content-command routing. */
export function useWorkspaceDockActions(
  input: UseWorkspaceDockActionsInput,
): UseWorkspaceDockActionsResult {
  const {
    isMobile,
    hasEnvironmentBrowserContext,
    hasEnvironmentPullRequest,
    persistenceKey,
    setEnvironmentDockState,
    setEnvironmentPanelMode,
    closeDesktopFileExplorer,
    handleOpenEnvironmentChanges,
    openRightPanelDiff,
    handleCreateTerminal,
    openWorkspaceTarget,
  } = input;

  const handleOpenWorkspaceDockPane = useCallback(
    (pane: WorkspaceEnvironmentDockTab) => {
      setEnvironmentDockState((state) =>
        resolveDockStateAfterAction(state, { type: "openDockPane", pane }),
      );
      setEnvironmentPanelMode("forced-open");
      if (!isMobile) {
        closeDesktopFileExplorer();
      }
    },
    [closeDesktopFileExplorer, isMobile, setEnvironmentDockState, setEnvironmentPanelMode],
  );

  const handleApplyWorkspaceDockCommand = useCallback(
    (
      command: Extract<
        WorkspacePaneCommand,
        { type: "openDockPane" | "toggleDockPane" | "openGitSummary" }
      >,
    ) => {
      // Production: git summary is the right-panel Diff surface, not the floating env rail.
      if (command.type === "openGitSummary") {
        handleOpenEnvironmentChanges();
        return;
      }
      let nextOpen = true;
      setEnvironmentDockState((state) => {
        const nextState = resolveDockStateAfterAction(state, command);
        nextOpen = nextState.open;
        return nextState;
      });
      setEnvironmentPanelMode(nextOpen ? "forced-open" : "forced-closed");
      if (nextOpen && !isMobile) {
        closeDesktopFileExplorer();
      }
    },
    [
      closeDesktopFileExplorer,
      handleOpenEnvironmentChanges,
      isMobile,
      setEnvironmentDockState,
      setEnvironmentPanelMode,
    ],
  );

  const handleOpenTarget = useCallback(
    (targetKind: Extract<WorkspacePaneCommand, { type: "openTarget" }>["targetKind"]) => {
      if (targetKind === "diff") {
        handleOpenEnvironmentChanges();
        return;
      }
      if (targetKind === "pull-request") {
        handleOpenWorkspaceDockPane("pull-request");
        return;
      }
      if (targetKind !== "browser" && targetKind !== "terminal") {
        return;
      }
      if (!persistenceKey) {
        return;
      }

      if (targetKind === "terminal") {
        handleCreateTerminal();
        return;
      }
      if (!getIsElectron()) {
        return;
      }

      const { browserId } = createWorkspaceBrowser();
      openWorkspaceTarget(persistenceKey, { kind: "browser", browserId });
    },
    [
      handleCreateTerminal,
      handleOpenEnvironmentChanges,
      handleOpenWorkspaceDockPane,
      openWorkspaceTarget,
      persistenceKey,
    ],
  );

  const handleExecuteWorkspacePaneCommand = useCallback(
    (command: WorkspacePaneCommand) => {
      if (
        command.type === "openDockPane" ||
        command.type === "toggleDockPane" ||
        command.type === "openGitSummary"
      ) {
        handleApplyWorkspaceDockCommand(command);
        return;
      }
      if (command.type === "moveTabToDock") {
        return;
      }
      const resolution = resolveWorkspacePaneCommand(command);
      if (resolution.placement === "dock") {
        handleOpenWorkspaceDockPane(resolution.dockPane);
        return;
      }
      handleOpenTarget(resolution.targetKind);
    },
    [handleApplyWorkspaceDockCommand, handleOpenTarget, handleOpenWorkspaceDockPane],
  );

  const handleOpenGitDock = useCallback(() => {
    // Single production path: open Diff right surface (git write CTAs stay on topbar).
    handleOpenEnvironmentChanges();
    // If checkout identity is still hydrating, still open the Diff surface shell.
    openRightPanelDiff?.();
  }, [handleOpenEnvironmentChanges, openRightPanelDiff]);

  const handleOpenBrowserContextDock = useCallback(() => {
    if (!hasEnvironmentBrowserContext) {
      return;
    }
    handleExecuteWorkspacePaneCommand({
      type: "openTarget",
      targetKind: "browser",
      placement: "dock",
    });
  }, [handleExecuteWorkspacePaneCommand, hasEnvironmentBrowserContext]);

  const handleOpenPullRequestDock = useCallback(() => {
    if (hasEnvironmentPullRequest) {
      handleOpenWorkspaceDockPane("pull-request");
    }
  }, [handleOpenWorkspaceDockPane, hasEnvironmentPullRequest]);

  return {
    handleOpenWorkspaceDockPane,
    handleOpenGitDock,
    handleOpenBrowserContextDock,
    handleOpenPullRequestDock,
  };
}
