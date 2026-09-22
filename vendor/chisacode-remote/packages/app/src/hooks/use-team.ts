import { useCallback, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useHostRuntimeClient, useHostRuntimeIsConnected } from "@/runtime/host-runtime";

export function teamQueryKey(serverId: string | null) {
  return ["team", serverId] as const;
}

export function useTeam(serverId: string | null) {
  const queryClient = useQueryClient();
  const client = useHostRuntimeClient(serverId ?? "");
  const isConnected = useHostRuntimeIsConnected(serverId ?? "");
  const queryKey = useMemo(() => teamQueryKey(serverId), [serverId]);

  const teamQuery = useQuery({
    queryKey,
    enabled: Boolean(serverId && client && isConnected),
    staleTime: 5_000,
    queryFn: async () => {
      if (!client) throw new Error("Not connected");
      const result = await client.cindy.teamListWorkers();
      if (result.error) throw new Error(result.error);
      return { team: result.team, workers: result.workers };
    },
  });

  const startTeam = useCallback(async () => {
    if (!client) return;
    const result = await client.cindy.teamStart();
    if (!result.error) void queryClient.invalidateQueries({ queryKey });
    return result;
  }, [client, queryClient, queryKey]);

  const endTeam = useCallback(async () => {
    if (!client) return;
    const result = await client.cindy.teamEnd();
    if (!result.error) void queryClient.invalidateQueries({ queryKey });
    return result;
  }, [client, queryClient, queryKey]);

  const createWorker = useCallback(
    async (options: {
      label: string;
      role?: string;
      provider?: string;
      model?: string;
      initialTask?: string;
    }) => {
      if (!client) return;
      const result = await client.cindy.teamCreateWorker(options);
      if (!result.error) void queryClient.invalidateQueries({ queryKey });
      return result;
    },
    [client, queryClient, queryKey],
  );

  const sendToWorker = useCallback(
    async (workerId: string, message: string) => {
      if (!client) return;
      return client.cindy.teamSendToWorker({ workerId, message });
    },
    [client],
  );

  const archiveWorker = useCallback(
    async (workerId: string) => {
      if (!client) return;
      const result = await client.cindy.teamArchiveWorker({ workerId });
      if (!result.error) void queryClient.invalidateQueries({ queryKey });
      return result;
    },
    [client, queryClient, queryKey],
  );

  const switchFocus = useCallback(
    async (workerId: string) => {
      if (!client) return;
      const result = await client.cindy.teamSwitchFocus({ workerId });
      if (!result.error) void queryClient.invalidateQueries({ queryKey });
      return result;
    },
    [client, queryClient, queryKey],
  );

  return {
    team: teamQuery.data?.team ?? null,
    workers: teamQuery.data?.workers ?? [],
    isLoading: teamQuery.isLoading,
    startTeam,
    endTeam,
    createWorker,
    sendToWorker,
    archiveWorker,
    switchFocus,
    refetch: teamQuery.refetch,
  };
}
