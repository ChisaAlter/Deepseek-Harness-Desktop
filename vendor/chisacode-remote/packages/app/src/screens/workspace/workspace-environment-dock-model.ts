import type { WorkspaceDescriptor } from "@/stores/session-store";
import type { StreamItem, TurnChangesItem } from "@/types/stream";

export type WorkspaceEnvironmentDockTab =
  | "git-summary"
  | "pull-request"
  | "tasks"
  | "subagents"
  | "browser-context";

export const WORKSPACE_ENVIRONMENT_TABS: readonly WorkspaceEnvironmentDockTab[] = [
  "git-summary",
  "pull-request",
  "tasks",
  "subagents",
  "browser-context",
];

export interface WorkspaceEnvironmentDockState {
  open: boolean;
  activeTab: WorkspaceEnvironmentDockTab;
}

export type WorkspacePaneCommand =
  | { type: "openDockPane"; pane: WorkspaceEnvironmentDockTab }
  | { type: "toggleDockPane"; pane: WorkspaceEnvironmentDockTab }
  | { type: "moveTabToDock"; pane: WorkspaceEnvironmentDockTab; tabId: string }
  | { type: "openGitSummary" }
  | { type: "openTurnDiff"; turnId: string }
  | {
      type: "openTarget";
      targetKind: "agent" | "browser" | "diff" | "file" | "pull-request" | "terminal";
      placement: "current" | "new-tab" | "right" | "down" | "dock";
    };

export type WorkspacePaneCommandResolution =
  | { placement: "dock"; dockPane: WorkspaceEnvironmentDockTab }
  | {
      placement: "current" | "new-tab" | "right" | "down";
      targetKind: "agent" | "browser" | "diff" | "file" | "pull-request" | "terminal";
    };

export interface DockTabAvailabilityInput {
  hasPullRequest: boolean;
  hasTasks: boolean;
  hasSubagents: boolean;
  hasBrowserContext: boolean;
}

export interface GitWorkbenchSummary {
  state: "not-git" | "clean" | "dirty";
  branchLabel: string | null;
  changeCount: number;
  hasChanges: boolean;
  pullRequestLabel: string | null;
}

export interface BrowserContextSummary {
  title: string;
  subtitle: string;
  url: string;
  isLoading: boolean;
}

export interface WorkspaceDockCommandAvailabilityInput {
  command: WorkspacePaneCommand;
  hasBrowserContext: boolean;
  hasPullRequest: boolean;
}

interface PullRequestLike {
  number?: number | null;
  title: string;
  url?: string | null;
}

export function resolveDockStateAfterAction(
  state: WorkspaceEnvironmentDockState,
  action: Extract<
    WorkspacePaneCommand,
    { type: "openDockPane" | "toggleDockPane" | "openGitSummary" }
  >,
): WorkspaceEnvironmentDockState {
  if (action.type === "openGitSummary") {
    return { open: true, activeTab: "git-summary" };
  }

  if (action.type === "toggleDockPane" && state.open && state.activeTab === action.pane) {
    return { ...state, open: false };
  }

  return { open: true, activeTab: action.pane };
}

export function resolveDockTabAvailability(
  input: DockTabAvailabilityInput,
): WorkspaceEnvironmentDockTab[] {
  const tabs: WorkspaceEnvironmentDockTab[] = ["git-summary"];
  if (input.hasPullRequest) {
    tabs.push("pull-request");
  }
  if (input.hasTasks) {
    tabs.push("tasks");
  }
  if (input.hasSubagents) {
    tabs.push("subagents");
  }
  if (input.hasBrowserContext) {
    tabs.push("browser-context");
  }
  return tabs;
}

export function buildGitWorkbenchSummary(input: {
  isGitCheckout: boolean;
  branchName: string | null;
  diffStat: WorkspaceDescriptor["diffStat"];
  pullRequest: PullRequestLike | null;
}): GitWorkbenchSummary {
  if (!input.isGitCheckout) {
    return {
      state: "not-git",
      branchLabel: null,
      changeCount: 0,
      hasChanges: false,
      pullRequestLabel: null,
    };
  }

  const additions = input.diffStat?.additions ?? 0;
  const deletions = input.diffStat?.deletions ?? 0;
  const changeCount = additions + deletions;
  return {
    state: changeCount > 0 ? "dirty" : "clean",
    branchLabel: input.branchName,
    changeCount,
    hasChanges: changeCount > 0,
    pullRequestLabel: input.pullRequest ? buildPullRequestSummaryLabel(input.pullRequest) : null,
  };
}

export function buildBrowserContextSummary(input: {
  browser: { title?: string | null; url: string; isLoading?: boolean | null } | null;
}): BrowserContextSummary | null {
  if (!input.browser) {
    return null;
  }

  const title = input.browser.title?.trim() || input.browser.url;
  return {
    title,
    subtitle: resolveUrlHost(input.browser.url),
    url: input.browser.url,
    isLoading: Boolean(input.browser.isLoading),
  };
}

export function findLatestTurnChanges(input: {
  head?: readonly StreamItem[] | null;
  tail?: readonly StreamItem[] | null;
}): TurnChangesItem | null {
  const latestHead = findLatestTurnChangesItem(input.head);
  const latestTail = findLatestTurnChangesItem(input.tail);

  if (!latestHead) {
    return latestTail;
  }
  if (!latestTail) {
    return latestHead;
  }
  return latestHead.timestamp.getTime() >= latestTail.timestamp.getTime() ? latestHead : latestTail;
}

export function isWorkspaceDockCommandAvailable(
  input: WorkspaceDockCommandAvailabilityInput,
): boolean {
  const resolution = resolveWorkspacePaneCommand(input.command);
  if (resolution.placement !== "dock") {
    return true;
  }
  if (resolution.dockPane === "browser-context") {
    return input.hasBrowserContext;
  }
  if (resolution.dockPane === "pull-request") {
    return input.hasPullRequest;
  }
  return true;
}

export function resolveWorkspacePaneCommand(
  command: WorkspacePaneCommand,
): WorkspacePaneCommandResolution {
  if (
    command.type === "openDockPane" ||
    command.type === "toggleDockPane" ||
    command.type === "moveTabToDock"
  ) {
    return { placement: "dock", dockPane: command.pane };
  }
  if (command.type === "openGitSummary") {
    return { placement: "dock", dockPane: "git-summary" };
  }
  if (command.type === "openTurnDiff") {
    return { placement: "dock", dockPane: "git-summary" };
  }
  if (command.placement === "dock") {
    return { placement: "dock", dockPane: resolveDockPaneForTargetKind(command.targetKind) };
  }
  return { placement: command.placement, targetKind: command.targetKind };
}

function findLatestTurnChangesItem(
  items: readonly StreamItem[] | null | undefined,
): TurnChangesItem | null {
  let latest: TurnChangesItem | null = null;
  if (!items) {
    return latest;
  }

  for (const item of items) {
    if (item.kind !== "turn_changes") {
      continue;
    }
    if (!latest || item.timestamp.getTime() >= latest.timestamp.getTime()) {
      latest = item;
    }
  }
  return latest;
}

function buildPullRequestSummaryLabel(pullRequest: PullRequestLike): string {
  return typeof pullRequest.number === "number"
    ? `#${pullRequest.number} ${pullRequest.title}`
    : pullRequest.title;
}

function resolveDockPaneForTargetKind(
  kind: Extract<WorkspacePaneCommand, { type: "openTarget" }>["targetKind"],
): WorkspaceEnvironmentDockTab {
  if (kind === "browser") {
    return "browser-context";
  }
  if (kind === "pull-request") {
    return "pull-request";
  }
  return "git-summary";
}

function resolveUrlHost(url: string): string {
  try {
    return new URL(url).hostname || url;
  } catch {
    return url;
  }
}
