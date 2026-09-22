import { useCallback, useEffect, useMemo, useRef } from "react";
import { useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import type { AgentProvider, ProviderSnapshotEntry } from "@chisacode/protocol/agent-types";
import type { DaemonClient } from "@chisacode/client/internal/daemon-client";
import { useHostRuntimeClient, useHostRuntimeIsConnected } from "@/runtime/host-runtime";
import { useSessionStore } from "@/stores/session-store";
import { queryClient as singletonQueryClient } from "@/query/query-client";
import {
  isProvidersSnapshotHomeScope,
  normalizeProvidersSnapshotCwd,
  providersSnapshotQueryKey,
  providersSnapshotQueryRoot,
  providersSnapshotRequestOptions,
} from "@/hooks/providers-snapshot-query";

type GetProvidersSnapshotResult = Awaited<ReturnType<DaemonClient["getProvidersSnapshot"]>>;
type RefreshProvidersSnapshotResult = Awaited<ReturnType<DaemonClient["refreshProvidersSnapshot"]>>;

export { providersSnapshotQueryKey, providersSnapshotQueryRoot };

export type ProvidersSnapshotClient = Pick<
  DaemonClient,
  "getProvidersSnapshot" | "refreshProvidersSnapshot"
>;

export interface ProvidersSnapshotUpdateMessage {
  type: "providers_snapshot_update";
  payload: {
    cwd?: string;
    entries: ProviderSnapshotEntry[];
    generatedAt: string;
  };
}

interface ProvidersSnapshotCacheData {
  cwd?: string;
  entries: ProviderSnapshotEntry[];
  generatedAt: string;
  requestId: string;
}

function canonicalSnapshotCwd(cwd: string | undefined): string | null {
  return normalizeProvidersSnapshotCwd(cwd);
}

function cacheProvidersSnapshotResponse(input: {
  queryClient: QueryClient;
  serverId: string;
  requestedCwd: string | null;
  snapshot: GetProvidersSnapshotResult;
}): void {
  const responseCwd = canonicalSnapshotCwd(input.snapshot.cwd);
  const requestedCwd = normalizeProvidersSnapshotCwd(input.requestedCwd);
  const responseKey = responseCwd ? providersSnapshotQueryKey(input.serverId, responseCwd) : null;
  const requestedKey = providersSnapshotQueryKey(input.serverId, requestedCwd);

  // A workspace response without cwd is from an older daemon. Keep it under
  // the requested alias, but never guess that it belongs to the home scope.
  if (responseKey) {
    input.queryClient.setQueryData(responseKey, input.snapshot);
  }
  input.queryClient.setQueryData(requestedKey, input.snapshot);
}
export async function fetchProvidersSnapshot(input: {
  client: ProvidersSnapshotClient;
  cwd: string | null;
}): Promise<GetProvidersSnapshotResult> {
  return input.client.getProvidersSnapshot(providersSnapshotRequestOptions({ cwd: input.cwd }));
}

export async function refreshAndApplyProvidersSnapshot(input: {
  client: ProvidersSnapshotClient;
  queryClient: QueryClient;
  serverId: string;
  cwd: string | null;
  providers?: AgentProvider[];
}): Promise<RefreshProvidersSnapshotResult> {
  const refreshResult = await input.client.refreshProvidersSnapshot(
    providersSnapshotRequestOptions({ cwd: input.cwd, providers: input.providers }),
  );
  const snapshot = await fetchProvidersSnapshot({ client: input.client, cwd: input.cwd });
  cacheProvidersSnapshotResponse({
    queryClient: input.queryClient,
    serverId: input.serverId,
    requestedCwd: input.cwd,
    snapshot,
  });
  if (isProvidersSnapshotHomeScope(input.cwd)) {
    void input.queryClient.invalidateQueries({
      queryKey: providersSnapshotQueryRoot(input.serverId),
      exact: false,
    });
  }
  return refreshResult;
}

export function applyProvidersSnapshotUpdate(input: {
  serverId: string;
  queryClient: QueryClient;
  message: ProvidersSnapshotUpdateMessage;
  aliasCwd?: string | null;
}): void {
  if (input.message.type !== "providers_snapshot_update") {
    return;
  }
  const canonicalCwd = canonicalSnapshotCwd(input.message.payload.cwd);
  const data: ProvidersSnapshotCacheData = {
    ...(input.message.payload.cwd ? { cwd: input.message.payload.cwd } : {}),
    entries: input.message.payload.entries,
    generatedAt: input.message.payload.generatedAt,
    requestId: "providers_snapshot_update",
  };
  const canonicalKey = providersSnapshotQueryKey(input.serverId, canonicalCwd);
  input.queryClient.setQueryData(canonicalKey, data);
  if (canonicalCwd !== null && input.aliasCwd !== undefined) {
    const aliasCwd = normalizeProvidersSnapshotCwd(input.aliasCwd);
    if (aliasCwd !== canonicalCwd) {
      input.queryClient.setQueryData(providersSnapshotQueryKey(input.serverId, aliasCwd), data);
    }
  }
}

/**
 * Refetches the providers snapshot query only when its data is stale.
 *
 * This is the only action the model-selector open path may take. Opening the
 * selector must never force a provider re-probe: a forced refresh re-runs
 * availability checks and model discovery for every provider in parallel
 * (and, in the home scope, across every workspace scope on the daemon).
 * Probing is daemon-side work driven by warm-up and PUSH updates — a plain
 * stale read is always sufficient because the daemon's snapshot read warms
 * up any entry that is still loading.
 * @param queryClient The TanStack Query client
 * @param queryKey The providers snapshot query key
 * @returns A promise that resolves once the (possibly skipped) refetch settles
 */
export function refetchProvidersSnapshotIfStale(
  queryClient: QueryClient,
  queryKey: readonly unknown[],
): Promise<void> {
  return queryClient
    .refetchQueries({ queryKey, type: "active", stale: true })
    .then(() => undefined);
}

interface UseProvidersSnapshotResult {
  entries: ProviderSnapshotEntry[] | undefined;
  isLoading: boolean;
  isFetching: boolean;
  isRefreshing: boolean;
  error: string | null;
  refreshError: string | null;
  supportsSnapshot: boolean;
  refresh: (providers?: AgentProvider[]) => Promise<void>;
  refetchIfStale: () => void;
}

interface UseProvidersSnapshotOptions {
  enabled?: boolean;
  cwd?: string | null;
}

export function useProvidersSnapshot(
  serverId: string | null,
  options: UseProvidersSnapshotOptions = {},
): UseProvidersSnapshotResult {
  const queryClient = useQueryClient();
  const client = useHostRuntimeClient(serverId ?? "");
  const isConnected = useHostRuntimeIsConnected(serverId ?? "");
  const enabled = options.enabled ?? true;
  const cwd = normalizeProvidersSnapshotCwd(options.cwd);
  const supportsSnapshot = useSessionStore(
    (state) => state.sessions[serverId ?? ""]?.serverInfo?.features?.providersSnapshot === true,
  );

  const queryKey = useMemo(() => providersSnapshotQueryKey(serverId, cwd), [cwd, serverId]);

  const snapshotQuery = useQuery({
    queryKey,
    enabled: Boolean(enabled && supportsSnapshot && serverId && client && isConnected),
    staleTime: 60_000,
    queryFn: async () => {
      if (!client) {
        throw new Error("Host is not connected");
      }
      const snapshot = await fetchProvidersSnapshot({ client, cwd });
      cacheProvidersSnapshotResponse({
        queryClient,
        serverId: serverId!,
        requestedCwd: cwd,
        snapshot,
      });
      return snapshot;
    },
  });

  const refreshMutation = useMutation({
    mutationFn: async (providers?: AgentProvider[]) => {
      if (!client || !serverId) {
        return;
      }
      await refreshAndApplyProvidersSnapshot({
        client,
        queryClient,
        serverId,
        cwd,
        providers,
      });
    },
  });
  const {
    mutateAsync: refreshSnapshot,
    isPending: isRefreshing,
    error: refreshMutationError,
  } = refreshMutation;

  const reconnectGeneration = useRef(0);

  useEffect(() => {
    if (!isConnected || !serverId || !supportsSnapshot) {
      return;
    }
    reconnectGeneration.current += 1;
    if (reconnectGeneration.current === 1) {
      return;
    }
    void snapshotQuery.refetch();
    // Query refetch is stable for the lifetime of this query key.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isConnected, serverId, supportsSnapshot, queryKey]);

  useEffect(() => {
    if (!enabled || !supportsSnapshot || !client || !isConnected || !serverId) {
      return;
    }

    return client.on("providers_snapshot_update", (message) => {
      if (message.type !== "providers_snapshot_update") {
        return;
      }
      applyProvidersSnapshotUpdate({ serverId, queryClient, message, aliasCwd: cwd });
    });
  }, [client, cwd, enabled, isConnected, queryClient, serverId, supportsSnapshot]);

  const refresh = useCallback(
    async (providers?: AgentProvider[]) => {
      await refreshSnapshot(providers);
    },
    [refreshSnapshot],
  );

  const refetchIfStale = useCallback(() => {
    void refetchProvidersSnapshotIfStale(queryClient, queryKey);
  }, [queryClient, queryKey]);

  return {
    entries: snapshotQuery.data?.entries ?? undefined,
    isLoading: snapshotQuery.isLoading,
    isFetching: snapshotQuery.isFetching,
    isRefreshing,
    error: snapshotQuery.error instanceof Error ? snapshotQuery.error.message : null,
    refreshError: refreshMutationError instanceof Error ? refreshMutationError.message : null,
    supportsSnapshot,
    refresh,
    refetchIfStale,
  };
}

export function prefetchProvidersSnapshot(
  serverId: string,
  client: DaemonClient,
  options: { cwd?: string | null } = {},
): void {
  const cwd = normalizeProvidersSnapshotCwd(options.cwd);
  const queryKey = providersSnapshotQueryKey(serverId, cwd);
  void singletonQueryClient.prefetchQuery({
    queryKey,
    staleTime: 60_000,
    queryFn: () => fetchProvidersSnapshot({ client, cwd }),
  });
}
