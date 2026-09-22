import { useCallback, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useHostRuntimeClient, useHostRuntimeIsConnected } from "@/runtime/host-runtime";

export function snapshotListQueryKey(serverId: string | null, cwd: string) {
  return ["snapshots", serverId, cwd] as const;
}

export function useSnapshots(serverId: string | null, cwd: string) {
  const queryClient = useQueryClient();
  const client = useHostRuntimeClient(serverId ?? "");
  const isConnected = useHostRuntimeIsConnected(serverId ?? "");
  const queryKey = useMemo(() => snapshotListQueryKey(serverId, cwd), [serverId, cwd]);

  const snapshotsQuery = useQuery({
    queryKey,
    enabled: Boolean(serverId && client && isConnected && cwd),
    staleTime: 10_000,
    queryFn: async () => {
      if (!client) throw new Error("Not connected");
      const result = await client.cindy.snapshotList({ cwd });
      if (result.error) throw new Error(result.error);
      return result.snapshots;
    },
  });

  const createSnapshot = useCallback(
    async (label?: string) => {
      if (!client) return;
      const result = await client.cindy.snapshotCreate({ cwd, label });
      if (!result.error) void queryClient.invalidateQueries({ queryKey });
      return result;
    },
    [client, cwd, queryClient, queryKey],
  );

  const rewind = useCallback(
    async (commitHash: string) => {
      if (!client) return;
      const result = await client.cindy.snapshotRewind({ cwd, commitHash });
      if (!result.error) void queryClient.invalidateQueries({ queryKey });
      return result;
    },
    [client, cwd, queryClient, queryKey],
  );

  return {
    snapshots: snapshotsQuery.data ?? [],
    isLoading: snapshotsQuery.isLoading,
    createSnapshot,
    rewind,
    refetch: snapshotsQuery.refetch,
  };
}
