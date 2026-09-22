import { useCallback, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useHostRuntimeClient, useHostRuntimeIsConnected } from "@/runtime/host-runtime";

export function learnListQueryKey(serverId: string | null) {
  return ["learn-runs", serverId] as const;
}

export function useLearn(serverId: string | null) {
  const queryClient = useQueryClient();
  const client = useHostRuntimeClient(serverId ?? "");
  const isConnected = useHostRuntimeIsConnected(serverId ?? "");
  const queryKey = useMemo(() => learnListQueryKey(serverId), [serverId]);

  const learnQuery = useQuery({
    queryKey,
    enabled: Boolean(serverId && client && isConnected),
    staleTime: 10_000,
    queryFn: async () => {
      if (!client) throw new Error("Not connected");
      const result = await client.cindy.learnList();
      if (result.error) throw new Error(result.error);
      return result.runs;
    },
  });

  const startLearn = useCallback(
    async (diff: string, files: string[], context?: string) => {
      if (!client) return;
      const result = await client.cindy.learnStart({ diff, files, context });
      if (!result.error) void queryClient.invalidateQueries({ queryKey });
      return result;
    },
    [client, queryClient, queryKey],
  );

  const applyRun = useCallback(
    async (runId: string) => {
      if (!client) return;
      const result = await client.cindy.learnApply({ runId });
      if (!result.error) void queryClient.invalidateQueries({ queryKey });
      return result;
    },
    [client, queryClient, queryKey],
  );

  const discardRun = useCallback(
    async (runId: string) => {
      if (!client) return;
      const result = await client.cindy.learnDiscard({ runId });
      if (!result.error) void queryClient.invalidateQueries({ queryKey });
      return result;
    },
    [client, queryClient, queryKey],
  );

  return {
    runs: learnQuery.data ?? [],
    isLoading: learnQuery.isLoading,
    startLearn,
    applyRun,
    discardRun,
    refetch: learnQuery.refetch,
  };
}
