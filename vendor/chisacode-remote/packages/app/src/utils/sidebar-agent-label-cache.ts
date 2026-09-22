import type { QueryClient } from "@tanstack/react-query";
import { agentHistoryQueryKey, agentHistoryQueryKeys } from "@/hooks/agent-history-query-key";

/**
 * Cache shapes used by the sidebar for optimistic agent-label mutations
 * (pin / snooze / settle). Kept loose so both list and history query payloads
 * can share the same patch helpers without depending on component modules.
 */
export interface AgentListCacheAgent {
  id?: string | null;
  labels?: Record<string, string>;
}

export interface AgentListCachePayload {
  entries?: Array<{ agent?: AgentListCacheAgent | null } | null>;
}

export interface AgentHistoryCacheAgent {
  id?: string | null;
  labels?: Record<string, string>;
}

export interface AgentHistoryCachePayload {
  pages?: Array<{ agents?: AgentHistoryCacheAgent[] | null } | null>;
}

export interface SidebarAgentLabelCacheSnapshot {
  sidebarAgentsList: AgentListCachePayload | undefined;
  allAgents: AgentListCachePayload | undefined;
  agentHistory: AgentHistoryCachePayload | undefined;
}

/**
 * Merges label patches into a sidebarAgentsList / allAgents query payload.
 * @param payload The current React Query payload, or undefined when uncached
 * @param input The agent id and labels to merge
 * @returns The patched payload, or the original reference when unchanged
 */
export function patchAgentLabelsInListPayload<T extends AgentListCachePayload | undefined>(
  payload: T,
  input: { agentId: string; labels: Record<string, string> },
): T {
  if (!payload || !Array.isArray(payload.entries)) {
    return payload;
  }

  let changed = false;
  const entries = payload.entries.map((entry) => {
    if (!entry?.agent || entry.agent.id !== input.agentId) {
      return entry;
    }
    changed = true;
    return {
      ...entry,
      agent: {
        ...entry.agent,
        labels: {
          ...entry.agent.labels,
          ...input.labels,
        },
      },
    };
  });

  return changed ? ({ ...payload, entries } as T) : payload;
}

/**
 * Merges label patches into a paginated agent-history query payload.
 * @param payload The current React Query payload, or undefined when uncached
 * @param input The agent id and labels to merge
 * @returns The patched payload, or the original reference when unchanged
 */
export function patchAgentLabelsInHistoryPayload<T extends AgentHistoryCachePayload | undefined>(
  payload: T,
  input: { agentId: string; labels: Record<string, string> },
): T {
  if (!payload || !Array.isArray(payload.pages)) {
    return payload;
  }

  let changed = false;
  const pages = payload.pages.map((page) => {
    if (!page || !Array.isArray(page.agents)) {
      return page;
    }

    let pageChanged = false;
    const agents = page.agents.map((agent) => {
      if (!agent || agent.id !== input.agentId) {
        return agent;
      }
      pageChanged = true;
      changed = true;
      return {
        ...agent,
        labels: {
          ...agent.labels,
          ...input.labels,
        },
      };
    });
    return pageChanged ? { ...page, agents } : page;
  });

  return changed ? ({ ...payload, pages } as T) : payload;
}

/**
 * Snapshots the sidebar-related React Query caches for a server so a failed
 * label mutation can roll them back.
 * @param queryClient The app React Query client
 * @param serverId The host server id
 * @returns A snapshot of the three sidebar-related caches
 */
export function getSidebarAgentLabelCacheSnapshot(
  queryClient: QueryClient,
  serverId: string,
): SidebarAgentLabelCacheSnapshot {
  // Soft sidebar uses the active-only history key; fall back to full history for other surfaces.
  return {
    sidebarAgentsList: queryClient.getQueryData<AgentListCachePayload | undefined>([
      "sidebarAgentsList",
      serverId,
    ]),
    allAgents: queryClient.getQueryData<AgentListCachePayload | undefined>(["allAgents", serverId]),
    agentHistory:
      queryClient.getQueryData<AgentHistoryCachePayload | undefined>(
        agentHistoryQueryKey(serverId, { includeArchived: false }),
      ) ??
      queryClient.getQueryData<AgentHistoryCachePayload | undefined>(
        agentHistoryQueryKey(serverId),
      ),
  };
}

function restoreCachedQuerySnapshot(
  queryClient: QueryClient,
  queryKey: readonly unknown[],
  snapshot: unknown,
): void {
  if (snapshot === undefined) {
    queryClient.removeQueries({ queryKey, exact: true });
    return;
  }
  queryClient.setQueryData(queryKey, snapshot);
}

/**
 * Restores a previously captured sidebar label-cache snapshot.
 * @param queryClient The app React Query client
 * @param serverId The host server id
 * @param snapshot The snapshot returned by {@link getSidebarAgentLabelCacheSnapshot}
 */
export function restoreSidebarAgentLabelCacheSnapshot(
  queryClient: QueryClient,
  serverId: string,
  snapshot: SidebarAgentLabelCacheSnapshot,
): void {
  restoreCachedQuerySnapshot(
    queryClient,
    ["sidebarAgentsList", serverId],
    snapshot.sidebarAgentsList,
  );
  restoreCachedQuerySnapshot(queryClient, ["allAgents", serverId], snapshot.allAgents);
  for (const queryKey of agentHistoryQueryKeys(serverId)) {
    restoreCachedQuerySnapshot(queryClient, queryKey, snapshot.agentHistory);
  }
}

/**
 * Optimistically patches agent labels into the three sidebar-related React
 * Query caches so pin / snooze / settle mutations stay visible across surfaces
 * that read from those caches rather than the live session store.
 * @param queryClient The app React Query client
 * @param input The server, agent, and labels to merge
 */
export function patchAgentLabelsInSidebarCaches(
  queryClient: QueryClient,
  input: { serverId: string; agentId: string; labels: Record<string, string> },
): void {
  queryClient.setQueryData<AgentListCachePayload | undefined>(
    ["sidebarAgentsList", input.serverId],
    (current) => patchAgentLabelsInListPayload(current, input),
  );
  queryClient.setQueryData<AgentListCachePayload | undefined>(
    ["allAgents", input.serverId],
    (current) => patchAgentLabelsInListPayload(current, input),
  );
  for (const queryKey of agentHistoryQueryKeys(input.serverId)) {
    queryClient.setQueryData<AgentHistoryCachePayload | undefined>(queryKey, (current) =>
      patchAgentLabelsInHistoryPayload(current, input),
    );
  }
}
