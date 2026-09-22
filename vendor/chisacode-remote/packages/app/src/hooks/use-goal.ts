import { useCallback, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useHostRuntimeClient, useHostRuntimeIsConnected } from "@/runtime/host-runtime";

export function goalListQueryKey(serverId: string | null) {
  return ["goals", serverId] as const;
}

export function useGoals(serverId: string | null) {
  const queryClient = useQueryClient();
  const client = useHostRuntimeClient(serverId ?? "");
  const isConnected = useHostRuntimeIsConnected(serverId ?? "");
  const queryKey = useMemo(() => goalListQueryKey(serverId), [serverId]);

  const goalsQuery = useQuery({
    queryKey,
    enabled: Boolean(serverId && client && isConnected),
    staleTime: 5_000,
    queryFn: async () => {
      if (!client) throw new Error("Not connected");
      const result = await client.cindy.goalList();
      if (result.error) throw new Error(result.error);
      return result.goals;
    },
  });

  const setGoal = useCallback(
    async (
      agentId: string,
      objective: string,
      limits?: {
        maxTurns?: number | null;
        budgetTokens?: number | null;
        noProgressLimit?: number | null;
      },
    ) => {
      if (!client) return;
      const result = await client.cindy.goalSet({ agentId, objective, limits });
      if (!result.error) {
        void queryClient.invalidateQueries({ queryKey });
      }
      return result;
    },
    [client, queryClient, queryKey],
  );

  const cancelGoal = useCallback(
    async (agentId: string) => {
      if (!client) return;
      const result = await client.cindy.goalCancel({ agentId });
      if (!result.error) {
        void queryClient.invalidateQueries({ queryKey });
      }
      return result;
    },
    [client, queryClient, queryKey],
  );

  return {
    goals: goalsQuery.data ?? [],
    isLoading: goalsQuery.isLoading,
    setGoal,
    cancelGoal,
    refetch: goalsQuery.refetch,
  };
}
