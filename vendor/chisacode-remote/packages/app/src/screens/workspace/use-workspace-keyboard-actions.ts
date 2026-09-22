import { useKeyboardActionHandler } from "@/hooks/use-keyboard-action-handler";
import { useStableEvent } from "@/hooks/use-stable-event";
import type { KeyboardActionDefinition } from "@/keyboard/keyboard-action-dispatcher";
import { isWorkspaceDockCommandAvailable } from "@/screens/workspace/workspace-environment-dock-model";

const WORKSPACE_TAB_ACTIONS = ["workspace.terminal.new"] as const;

const WORKSPACE_DOCK_ACTIONS = [
  "workspace.dock.git.open",
  "workspace.dock.browser.open",
  "workspace.dock.pr.open",
] as const;

const WORKSPACE_SIDEBAR_ACTIONS = ["sidebar.toggle.right"] as const;

const WORKSPACE_COMMAND_CENTER_ACTIONS = [
  "workspace.changes.open",
  "workspace.environment.toggle",
  "workspace.terminal.new",
  "workspace.resume.copy",
  "worktree.archive",
] as const;

const isWorkspaceActionHandlerActive = () => true;

interface UseWorkspaceKeyboardActionsInput {
  serverId: string;
  workspaceId: string;
  enabled: boolean;
  hasEnvironmentBrowserContext: boolean;
  hasEnvironmentPullRequest: boolean;
  onCreateTerminal: () => void;
  onToggleExplorer: () => void;
  onOpenGitDock: () => void;
  onOpenBrowserContextDock: () => void;
  onOpenPullRequestDock: () => void;
  onOpenEnvironmentChanges: () => void;
  onToggleEnvironmentPanel: () => void;
  onCopyEnvironmentResumeCommand: () => void;
  onArchiveWorktree: (() => void) | null;
}

/** Registers workspace-scoped keyboard and command-center actions. */
export function useWorkspaceKeyboardActions(input: UseWorkspaceKeyboardActionsInput): void {
  const handleWorkspaceTabAction = useStableEvent((action: KeyboardActionDefinition): boolean => {
    if (action.id === "workspace.terminal.new") {
      input.onCreateTerminal();
      return true;
    }
    return false;
  });

  const handleWorkspaceDockAction = useStableEvent((action: KeyboardActionDefinition): boolean => {
    if (action.id === "workspace.dock.git.open") {
      input.onOpenGitDock();
      return true;
    }
    if (action.id === "workspace.dock.browser.open") {
      if (
        !isWorkspaceDockCommandAvailable({
          command: { type: "openTarget", targetKind: "browser", placement: "dock" },
          hasBrowserContext: input.hasEnvironmentBrowserContext,
          hasPullRequest: input.hasEnvironmentPullRequest,
        })
      ) {
        return false;
      }
      input.onOpenBrowserContextDock();
      return true;
    }
    if (action.id === "workspace.dock.pr.open") {
      if (
        !isWorkspaceDockCommandAvailable({
          command: { type: "openDockPane", pane: "pull-request" },
          hasBrowserContext: input.hasEnvironmentBrowserContext,
          hasPullRequest: input.hasEnvironmentPullRequest,
        })
      ) {
        return false;
      }
      input.onOpenPullRequestDock();
      return true;
    }
    return false;
  });

  const handleWorkspaceSidebarAction = useStableEvent(
    (action: KeyboardActionDefinition): boolean => {
      if (action.id !== "sidebar.toggle.right") {
        return false;
      }
      input.onToggleExplorer();
      return true;
    },
  );

  const handleWorkspaceCommandCenterAction = useStableEvent(
    (action: KeyboardActionDefinition): boolean => {
      switch (action.id) {
        case "workspace.changes.open":
          input.onOpenEnvironmentChanges();
          return true;
        case "workspace.environment.toggle":
          input.onToggleEnvironmentPanel();
          return true;
        case "workspace.terminal.new":
          input.onCreateTerminal();
          return true;
        case "workspace.resume.copy":
          input.onCopyEnvironmentResumeCommand();
          return true;
        case "worktree.archive":
          if (!input.onArchiveWorktree) {
            return false;
          }
          input.onArchiveWorktree();
          return true;
        default:
          return false;
      }
    },
  );

  const handlerIdSuffix = `${input.serverId}:${input.workspaceId}`;
  useKeyboardActionHandler({
    handlerId: `workspace-tab-actions:${handlerIdSuffix}`,
    actions: WORKSPACE_TAB_ACTIONS,
    enabled: input.enabled,
    priority: 100,
    isActive: isWorkspaceActionHandlerActive,
    handle: handleWorkspaceTabAction,
  });
  useKeyboardActionHandler({
    handlerId: `workspace-dock-actions:${handlerIdSuffix}`,
    actions: WORKSPACE_DOCK_ACTIONS,
    enabled: input.enabled,
    priority: 100,
    isActive: isWorkspaceActionHandlerActive,
    handle: handleWorkspaceDockAction,
  });
  useKeyboardActionHandler({
    handlerId: `workspace-sidebar-actions:${handlerIdSuffix}`,
    actions: WORKSPACE_SIDEBAR_ACTIONS,
    enabled: input.enabled,
    priority: 100,
    isActive: isWorkspaceActionHandlerActive,
    handle: handleWorkspaceSidebarAction,
  });
  useKeyboardActionHandler({
    handlerId: `workspace-command-center-actions:${handlerIdSuffix}`,
    actions: WORKSPACE_COMMAND_CENTER_ACTIONS,
    enabled: input.enabled,
    priority: 100,
    isActive: isWorkspaceActionHandlerActive,
    handle: handleWorkspaceCommandCenterAction,
  });
}
