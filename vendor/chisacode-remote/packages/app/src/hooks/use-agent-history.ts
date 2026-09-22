import type {
  DaemonClient,
  FetchAgentHistoryOptions,
  FetchAgentHistoryPageInfo,
} from "@chisacode/client/internal/daemon-client";
import { useInfiniteQuery } from "@tanstack/react-query";
import { useCallback, useMemo } from "react";
import type { AggregatedAgent } from "@/hooks/use-aggregated-agents";
import { useHostRuntimeClient, useHostRuntimeIsConnected, useHosts } from "@/runtime/host-runtime";
import { buildAgentDirectoryState } from "@/utils/agent-directory-sync";
import { agentHistoryQueryKey } from "./agent-history-query-key";

const AGENT_HISTORY_PAGE_LIMIT = 200;
const AGENT_HISTORY_SORT: NonNullable<FetchAgentHistoryOptions["sort"]> = [
  { key: "updated_at", direction: "desc" },
];
const historyPageInFlight = new Map<string, Promise<AgentHistoryPage>>();

export interface AgentHistoryResult {
  agents: AggregatedAgent[];
  isLoading: boolean;
  isInitialLoad: boolean;
  isRevalidating: boolean;
  hasMore: boolean;
  isLoadingMore: boolean;
  refreshAll: () => void;
  loadMore: () => void;
}

export interface AgentHistoryPage {
  agents: AggregatedAgent[];
  pageInfo: FetchAgentHistoryPageInfo;
}

export type AgentHistoryClient = Pick<DaemonClient, "fetchAgentHistory">;

function buildHistoryPageInFlightKey(input: {
  serverId: string;
  cursor: string | null;
  includeArchived: boolean;
}): string {
  return JSON.stringify({
    serverId: input.serverId,
    cursor: input.cursor ?? null,
    includeArchived: input.includeArchived,
    sort: AGENT_HISTORY_SORT,
  });
}

export async function fetchAgentHistoryPage(input: {
  client: AgentHistoryClient;
  serverId: string;
  cursor: string | null;
  includeArchived?: boolean;
}): Promise<AgentHistoryPage> {
  const includeArchived = input.includeArchived ?? true;
  const inFlightKey = buildHistoryPageInFlightKey({
    serverId: input.serverId,
    cursor: input.cursor,
    includeArchived,
  });
  const existing = historyPageInFlight.get(inFlightKey);
  if (existing) {
    return existing;
  }

  const request = (async () => {
    const payload = await input.client.fetchAgentHistory({
      sort: AGENT_HISTORY_SORT,
      filter: { includeArchived },
      page: input.cursor
        ? { limit: AGENT_HISTORY_PAGE_LIMIT, cursor: input.cursor }
        : { limit: AGENT_HISTORY_PAGE_LIMIT },
    });

    const { agents } = buildAgentDirectoryState({
      serverId: input.serverId,
      entries: payload.entries,
    });

    return {
      agents: Array.from(agents.values(), (agent) => ({
        id: agent.id,
        serverId: input.serverId,
        serverLabel: input.serverId,
        title: agent.title ?? null,
        status: agent.status,
        lastActivityAt: agent.lastActivityAt,
        cwd: agent.cwd,
        provider: agent.provider,
        pendingPermissionCount: agent.pendingPermissions.length,
        requiresAttention: agent.requiresAttention,
        attentionReason: agent.attentionReason,
        attentionTimestamp: agent.attentionTimestamp ?? null,
        archivedAt: agent.archivedAt ?? null,
        createdAt: agent.createdAt,
        labels: agent.labels,
        projectPlacement: agent.projectPlacement ?? null,
      })),
      pageInfo: payload.pageInfo,
    };
  })();

  historyPageInFlight.set(inFlightKey, request);
  try {
    return await request;
  } finally {
    historyPageInFlight.delete(inFlightKey);
  }
}

export function useAgentHistory(options: {
  serverId?: string | null;
  enabled?: boolean;
  /**
   * Soft sidebar only shows non-archived sessions. Pass false so pageInfo.hasMore
   * matches the visible list and we do not offer "load more" for archived-only pages.
   * Defaults to true to preserve history screens that include archived rows.
   */
  includeArchived?: boolean;
}): AgentHistoryResult {
  const daemons = useHosts();
  const serverId = useMemo(() => {
    const value = options.serverId;
    return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
  }, [options.serverId]);
  const enabled = options.enabled ?? true;
  const includeArchived = options.includeArchived ?? true;
  const client = useHostRuntimeClient(serverId ?? "");
  const isConnected = useHostRuntimeIsConnected(serverId ?? "");
  const queryKey = useMemo(
    () => agentHistoryQueryKey(serverId, { includeArchived }),
    [includeArchived, serverId],
  );
  const serverLabel = daemons.find((daemon) => daemon.serverId === serverId)?.label ?? serverId;

  const historyQuery = useInfiniteQuery<
    AgentHistoryPage,
    Error,
    { pages: AgentHistoryPage[] },
    ReturnType<typeof agentHistoryQueryKey>,
    string | null
  >({
    queryKey,
    enabled: Boolean(enabled && serverId && client && isConnected),
    staleTime: 30_000,
    initialPageParam: null as string | null,
    getNextPageParam: (lastPage) =>
      lastPage.pageInfo.hasMore ? lastPage.pageInfo.nextCursor : null,
    queryFn: async ({ pageParam }) => {
      if (!serverId || !client) {
        throw new Error("Host is not connected");
      }
      return fetchAgentHistoryPage({
        client,
        serverId,
        cursor: pageParam,
        includeArchived,
      });
    },
  });
  const { data, fetchNextPage, hasNextPage, isFetching, isFetchingNextPage, isLoading, refetch } =
    historyQuery;

  const refreshAll = useCallback(() => {
    if (!serverId || !client || !isConnected) {
      return;
    }
    // Do not refetch while a loadMore is in flight: the refetch replaces pages
    // mid-flight, and the in-flight next-page result (captured against the old
    // last page cursor) would be appended to the new pages — duplicating or
    // dropping sessions.
    if (isFetchingNextPage) {
      return;
    }
    void refetch();
  }, [client, isConnected, isFetchingNextPage, refetch, serverId]);

  const loadMore = useCallback(() => {
    if (!serverId || !client || !isConnected || !hasNextPage || isFetchingNextPage) {
      return;
    }
    // Also skip while a background refetch is in flight: fetchNextPage captures
    // the cursor from the current last page, and appending to pages that a
    // concurrent refetch is about to replace corrupts the pagination chain.
    if (isFetching) {
      return;
    }
    void fetchNextPage();
  }, [client, fetchNextPage, hasNextPage, isConnected, isFetching, isFetchingNextPage, serverId]);

  const agents = useMemo(
    () =>
      (data?.pages ?? [])
        .flatMap((page) => page.agents)
        .map((agent) =>
          Object.assign({}, agent, {
            serverLabel: serverLabel ?? agent.serverLabel,
          }),
        ),
    [data?.pages, serverLabel],
  );
  const isInitialLoad = isLoading && agents.length === 0;
  const isRevalidating = isFetching && !isFetchingNextPage && agents.length > 0;

  return {
    agents,
    isLoading,
    isInitialLoad,
    isRevalidating,
    hasMore: hasNextPage,
    isLoadingMore: isFetchingNextPage,
    refreshAll,
    loadMore,
  };
}
