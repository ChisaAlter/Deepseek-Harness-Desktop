import { buildHostWorkspaceOpenRoute } from "@/utils/host-routes";

/** Resolved routes and workspace context backing the mobile sidebar quick-action sheet. */
export interface MobileSidebarQuickActionModel {
  workspaceId: string | null;
  changesRoute: string | null;
  terminalRoute: string | null;
}

/** Identifiers of the actions available in the mobile sidebar quick-action sheet. */
export type MobileSidebarQuickActionId = "resume" | "changes" | "terminal" | "sessions" | "close";

/** A quick-action button to render in the mobile sidebar, with its visual variant. */
export interface MobileSidebarQuickActionButtonModel {
  id: MobileSidebarQuickActionId;
  variant: "primary" | "secondary";
}

/** Minimal agent shape required to select and label a quick-action resume target. */
export interface MobileSidebarQuickActionAgent {
  id: string;
  serverId: string;
  title?: string | null;
  cwd?: string | null;
  archivedAt?: string | Date | null;
}

/** A resolved agent target (server id plus agent id) that a quick action can resume. */
export interface MobileSidebarQuickActionAgentTarget {
  serverId: string;
  agentId: string;
}

function trimNonEmpty(value: string | null | undefined): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function hasArchivedAt(value: string | Date | null | undefined): boolean {
  if (value instanceof Date) {
    return Number.isFinite(value.getTime());
  }
  return trimNonEmpty(value) !== null;
}

/**
 * Picks the agent the quick-action resume button should target.
 * @param agents The candidate agents
 * @param selectedAgentId The currently selected agent id, optionally qualified as "serverId:agentId"
 * @param preferredServerId Optional server id preferred when no selection matches
 * @returns The matching unarchived agent, or null when no agent is available
 */
export function selectMobileSidebarQuickActionAgent<Agent extends MobileSidebarQuickActionAgent>(
  agents: readonly Agent[],
  selectedAgentId: string | null | undefined,
  preferredServerId?: string | null,
): Agent | null {
  const availableAgents = agents.filter(
    (agent) =>
      !hasArchivedAt(agent.archivedAt) && trimNonEmpty(agent.serverId) && trimNonEmpty(agent.id),
  );
  const selected = trimNonEmpty(selectedAgentId);
  const preferredServer = trimNonEmpty(preferredServerId);
  if (selected) {
    const qualifiedMatch = availableAgents.find(
      (agent) => `${agent.serverId}:${agent.id}` === selected,
    );
    const preferredPlainMatch = preferredServer
      ? availableAgents.find((agent) => agent.serverId === preferredServer && agent.id === selected)
      : null;
    const plainMatch = availableAgents.find((agent) => agent.id === selected);
    const matched = qualifiedMatch ?? preferredPlainMatch ?? plainMatch;
    if (matched) {
      return matched;
    }
  }
  return (
    (preferredServer
      ? availableAgents.find((agent) => agent.serverId === preferredServer)
      : null) ??
    availableAgents[0] ??
    null
  );
}

/**
 * Derives the display label for a quick-action agent.
 * @param agent The agent to label
 * @returns The agent title, the last cwd segment, the agent id, or "Agent" as a last resort
 */
export function resolveMobileSidebarQuickActionAgentLabel(
  agent: Pick<MobileSidebarQuickActionAgent, "title" | "cwd" | "id">,
): string {
  return (
    trimNonEmpty(agent.title) ??
    resolveMobileSidebarQuickActionCwdLabel(agent.cwd) ??
    trimNonEmpty(agent.id) ??
    "Agent"
  );
}

function resolveMobileSidebarQuickActionCwdLabel(cwd: string | null | undefined): string | null {
  const value = trimNonEmpty(cwd);
  if (!value) {
    return null;
  }
  const normalized = value.replace(/\\/g, "/").replace(/\/+$/, "");
  const segments = normalized.split("/").filter((segment) => segment.length > 0);
  return segments.at(-1) ?? value;
}

/**
 * Resolves an agent into a resume target for quick actions.
 * @param agent The agent to resolve
 * @returns The server and agent ids, or null when either is blank
 */
export function resolveMobileSidebarQuickActionAgentTarget(
  agent: Pick<MobileSidebarQuickActionAgent, "serverId" | "id"> | null | undefined,
): MobileSidebarQuickActionAgentTarget | null {
  const serverId = trimNonEmpty(agent?.serverId);
  const agentId = trimNonEmpty(agent?.id);
  if (!serverId || !agentId) {
    return null;
  }
  return { serverId, agentId };
}

/**
 * Builds the model backing the mobile sidebar quick-action sheet for the current workspace context.
 * @param input The current server id, workspace id, and project kind
 * @returns The workspace id and available changes/terminal routes, all null when the context is incomplete
 */
export function buildMobileSidebarQuickActionModel(input: {
  serverId: string | null | undefined;
  workspaceId: string | null | undefined;
  projectKind: string | null | undefined;
}): MobileSidebarQuickActionModel {
  const serverId = trimNonEmpty(input.serverId);
  const workspaceId = trimNonEmpty(input.workspaceId);
  const canViewChanges = trimNonEmpty(input.projectKind)?.toLowerCase() === "git";
  if (!serverId || !workspaceId) {
    return {
      workspaceId: null,
      changesRoute: null,
      terminalRoute: null,
    };
  }
  return {
    workspaceId,
    changesRoute: canViewChanges
      ? buildHostWorkspaceOpenRoute(serverId, workspaceId, "changes:review")
      : null,
    terminalRoute: buildHostWorkspaceOpenRoute(serverId, workspaceId, "terminal:new"),
  };
}

/**
 * Builds the ordered list of quick-action buttons to show based on available targets and routes.
 * @param input Flags describing which targets and routes are available
 * @returns The ordered button models, always ending with the close action
 */
export function buildMobileSidebarQuickActionButtons(input: {
  hasAgentTarget: boolean;
  changesRoute: string | null | undefined;
  terminalRoute: string | null | undefined;
  canViewSessions: boolean;
}): MobileSidebarQuickActionButtonModel[] {
  const buttons: MobileSidebarQuickActionButtonModel[] = [];
  if (input.hasAgentTarget) {
    buttons.push({ id: "resume", variant: "primary" });
  }
  if (trimNonEmpty(input.changesRoute)) {
    buttons.push({ id: "changes", variant: "secondary" });
  }
  if (trimNonEmpty(input.terminalRoute)) {
    buttons.push({ id: "terminal", variant: "secondary" });
  }
  if (input.canViewSessions) {
    buttons.push({ id: "sessions", variant: "secondary" });
  }
  buttons.push({ id: "close", variant: "secondary" });
  return buttons;
}
