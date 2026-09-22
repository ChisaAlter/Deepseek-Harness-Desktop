import type { Href } from "expo-router";
import { buildHostNewWorkspaceRoute } from "@/utils/host-routes";

/** Draft session row currently shown under a workspace in the left sidebar */
export interface SidebarSessionDraft {
  serverId: string;
  workspaceId: string;
  draftId: string;
  cwd: string | null;
  createdAt: Date;
}

/** Workspace metadata needed when collecting sidebar draft sessions */
export interface SidebarDraftWorkspaceMetadata {
  workspaceDirectory: string | null;
}

/**
 * Collects draft sessions that should appear under left-sidebar workspaces
 * @returns Draft session rows; currently always empty pending draft storage wiring
 */
export function collectSidebarDraftSessions(): SidebarSessionDraft[] {
  return [];
}

/**
 * 新对话 → Soft Home (/new)，不是 open-project 卡片墙。
 * 以默认路由实机为准。
 *
 * 当没有显式 sourceDirectory 时，把 dir 设为「上次草稿所选目录」，
 * 这样点「新对话」会落在用户上一次打开草稿的位置（哪怕没发消息）。
 */
export function resolveLeftSidebarNewConversationRoute(input: {
  activeServerId: string | null;
  pathname: string;
  sourceDirectory?: string | null;
  draftKey?: string | null;
  lastDraftDirectory?: string | null;
}): Href | null {
  const activeServerId = input.activeServerId?.trim() || null;
  if (!activeServerId) {
    return null;
  }
  void input.pathname;
  const sourceDirectory = input.sourceDirectory?.trim() || input.lastDraftDirectory?.trim() || null;
  return buildHostNewWorkspaceRoute(activeServerId, sourceDirectory, {
    draftKey: input.draftKey ?? undefined,
  });
}

/**
 * 侧栏主页 → Soft Home (/new)。
 */
export function resolveLeftSidebarHomeRoute(activeServerId: string | null): Href | null {
  const normalizedServerId = activeServerId?.trim() || null;
  if (!normalizedServerId) {
    return null;
  }
  return buildHostNewWorkspaceRoute(normalizedServerId);
}
