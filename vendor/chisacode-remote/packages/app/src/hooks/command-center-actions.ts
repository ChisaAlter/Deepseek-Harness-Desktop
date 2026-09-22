import type { ShortcutKey } from "@/utils/format-shortcut";
import { tokenizeCommandCenterQuery } from "@/hooks/command-center-tokenizer";

const EMPTY_ACTION_ITEMS: CommandCenterActionItem[] = [];

type CommandCenterRoute = string;

export type CommandCenterActionIcon =
  | "plus"
  | "settings"
  | "home"
  | "changes"
  | "environment"
  | "terminal"
  | "agent"
  | "sessions";

export type CommandCenterDispatchAction =
  | "workspace.changes.open"
  | "workspace.environment.toggle"
  | "workspace.resume.copy"
  | "workspace.terminal.new"
  | "worktree.archive";

interface CommandCenterActionDefinition {
  id: string;
  titleKey: string;
  subtitleKey?: string;
  icon?: CommandCenterActionIcon;
  actionId?: string;
  keywords: string[];
  routeKind: "settings" | "home" | "sessions" | "current-workspace-draft" | "none";
  dispatchAction?: CommandCenterDispatchAction;
}

const COMMAND_CENTER_ACTIONS: readonly CommandCenterActionDefinition[] = [
  {
    id: "new-agent",
    titleKey: "workspace.openProject",
    subtitleKey: "commandCenter.openProjectSubtitle",
    icon: "plus",
    actionId: "new-agent",
    keywords: ["open", "project", "folder", "workspace", "repo"],
    routeKind: "none",
  },
  {
    id: "home",
    titleKey: "commandCenter.home",
    subtitleKey: "commandCenter.homeSubtitle",
    icon: "home",
    keywords: ["home", "start", "import", "session", "pair", "device", "providers"],
    routeKind: "home",
  },
  {
    id: "sessions",
    titleKey: "commandCenter.sessions",
    subtitleKey: "commandCenter.sessionsSubtitle",
    icon: "sessions",
    keywords: ["sessions", "history", "agents", "recent"],
    routeKind: "sessions",
  },
  {
    id: "new-agent-current-workspace",
    titleKey: "commandCenter.newAgentCurrentWorkspace",
    subtitleKey: "commandCenter.newAgentCurrentWorkspaceSubtitle",
    icon: "plus",
    keywords: ["new", "agent", "current", "workspace", "draft"],
    routeKind: "current-workspace-draft",
  },
  {
    id: "open-current-workspace-changes",
    titleKey: "commandCenter.openCurrentWorkspaceChanges",
    subtitleKey: "commandCenter.openCurrentWorkspaceChangesSubtitle",
    icon: "changes",
    keywords: ["changes", "diff", "git", "review", "files"],
    routeKind: "none",
    dispatchAction: "workspace.changes.open",
  },
  {
    id: "toggle-current-workspace-environment",
    titleKey: "commandCenter.toggleCurrentWorkspaceEnvironment",
    subtitleKey: "commandCenter.toggleCurrentWorkspaceEnvironmentSubtitle",
    icon: "environment",
    keywords: ["environment", "status", "workspace", "panel", "review"],
    routeKind: "none",
    dispatchAction: "workspace.environment.toggle",
  },
  {
    id: "new-terminal-current-workspace",
    titleKey: "commandCenter.newTerminalCurrentWorkspace",
    subtitleKey: "commandCenter.newTerminalCurrentWorkspaceSubtitle",
    icon: "terminal",
    actionId: "workspace-terminal-new",
    keywords: ["terminal", "shell", "console", "workspace"],
    routeKind: "none",
    dispatchAction: "workspace.terminal.new",
  },
  {
    id: "copy-current-workspace-resume-command",
    titleKey: "commandCenter.copyCurrentWorkspaceResumeCommand",
    subtitleKey: "commandCenter.copyCurrentWorkspaceResumeCommandSubtitle",
    icon: "agent",
    keywords: ["copy", "resume", "command", "agent", "cli"],
    routeKind: "none",
    dispatchAction: "workspace.resume.copy",
  },
  {
    id: "archive-current-worktree",
    titleKey: "commandCenter.archiveCurrentWorktree",
    subtitleKey: "commandCenter.archiveCurrentWorktreeSubtitle",
    icon: "changes",
    actionId: "archive-worktree",
    keywords: ["archive", "hide", "worktree", "workspace", "close", "cleanup"],
    routeKind: "none",
    dispatchAction: "worktree.archive",
  },
  {
    id: "settings",
    titleKey: "settings.title",
    subtitleKey: "commandCenter.settingsSubtitle",
    icon: "settings",
    keywords: ["settings", "preferences", "config", "configuration"],
    routeKind: "settings",
  },
];

export interface CommandCenterActionItem {
  kind: "action";
  id: string;
  title: string;
  subtitle?: string;
  icon?: CommandCenterActionIcon;
  route?: CommandCenterRoute;
  shortcutKeys?: ShortcutKey[][];
  dispatchAction?: CommandCenterDispatchAction;
}

function matchesActionQuery(
  query: string,
  action: CommandCenterActionDefinition,
  title: string,
  subtitle: string | undefined,
): boolean {
  const tokens = tokenizeCommandCenterQuery(query);
  if (tokens.length === 0) return true;

  const searchableText = [title, subtitle, ...action.keywords]
    .filter((value): value is string => typeof value === "string")
    .map((value) => value.toLowerCase());
  return tokens.every((token) => searchableText.some((value) => value.includes(token)));
}

function normalizeKind(value: string | null | undefined): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed.toLowerCase() : null;
}

function normalizeNonEmpty(value: string | null | undefined): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function hasValidWorkspaceRoute(value: { serverId: string; workspaceId: string } | null): boolean {
  return Boolean(normalizeNonEmpty(value?.serverId) && normalizeNonEmpty(value?.workspaceId));
}

function resolveActionTextKeys(
  action: CommandCenterActionDefinition,
  currentWorkspaceKind: string | null,
): { titleKey: string; subtitleKey?: string } {
  if (action.id === "archive-current-worktree" && currentWorkspaceKind !== "worktree") {
    return {
      titleKey: "commandCenter.hideCurrentWorkspace",
      subtitleKey: "commandCenter.hideCurrentWorkspaceSubtitle",
    };
  }
  return {
    titleKey: action.titleKey,
    subtitleKey: action.subtitleKey,
  };
}

export function buildCommandCenterActionItems(input: {
  open: boolean;
  query: string;
  currentWorkspaceRoute: { serverId: string; workspaceId: string } | null;
  currentWorkspaceKind?: string | null;
  currentProjectKind?: string | null;
  currentWorkspaceDraftRoute?: CommandCenterRoute;
  homeRoute?: CommandCenterRoute;
  sessionsRoute?: CommandCenterRoute;
  settingsRoute: CommandCenterRoute;
  t: (key: string) => string;
  resolveShortcutKeys: (actionId: string | undefined) => ShortcutKey[][] | undefined;
}): CommandCenterActionItem[] {
  if (!input.open) {
    return EMPTY_ACTION_ITEMS;
  }
  const currentWorkspaceKind = normalizeKind(input.currentWorkspaceKind);
  const currentProjectKind = normalizeKind(input.currentProjectKind);
  const hasCurrentWorkspaceRoute = hasValidWorkspaceRoute(input.currentWorkspaceRoute);
  return COMMAND_CENTER_ACTIONS.filter((action) => {
    if (action.routeKind === "home" && !input.homeRoute) return false;
    if (action.routeKind === "sessions" && !input.sessionsRoute) return false;
    if (
      action.routeKind === "current-workspace-draft" &&
      (!hasCurrentWorkspaceRoute || !input.currentWorkspaceDraftRoute)
    ) {
      return false;
    }
    if (action.dispatchAction && !hasCurrentWorkspaceRoute) return false;
    if (action.id === "open-current-workspace-changes" && currentProjectKind !== "git") {
      return false;
    }
    const textKeys = resolveActionTextKeys(action, currentWorkspaceKind);
    return matchesActionQuery(
      input.query,
      action,
      input.t(textKeys.titleKey),
      textKeys.subtitleKey ? input.t(textKeys.subtitleKey) : undefined,
    );
  }).map<CommandCenterActionItem>((action) => {
    const { titleKey, subtitleKey } = resolveActionTextKeys(action, currentWorkspaceKind);
    let route: CommandCenterRoute | undefined;
    if (action.routeKind === "settings") route = input.settingsRoute;
    else if (action.routeKind === "home") route = input.homeRoute;
    else if (action.routeKind === "sessions") route = input.sessionsRoute;
    else if (action.routeKind === "current-workspace-draft") {
      route = input.currentWorkspaceDraftRoute;
    }
    return {
      kind: "action",
      id: action.id,
      title: input.t(titleKey),
      subtitle: subtitleKey ? input.t(subtitleKey) : undefined,
      icon: action.icon,
      route,
      shortcutKeys: input.resolveShortcutKeys(action.actionId),
      dispatchAction: action.dispatchAction,
    };
  });
}
