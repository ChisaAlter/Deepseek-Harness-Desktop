import { useQuery } from "@tanstack/react-query";
import { useHostRuntimeClient, useHostRuntimeIsConnected } from "@/runtime/host-runtime";
import { agentPresetsQueryKey, fetchAgentPresets } from "./preset-catalog";

const AGENT_PRESETS_STALE_TIME_MS = 30_000;

export function useAgentPresetsQuery(serverId: string) {
  const client = useHostRuntimeClient(serverId);
  const isConnected = useHostRuntimeIsConnected(serverId);
  const query = useQuery({
    queryKey: agentPresetsQueryKey(serverId),
    queryFn: async () => {
      if (!client) {
        throw new Error("Daemon client not available");
      }
      return fetchAgentPresets(client);
    },
    enabled: Boolean(client) && isConnected,
    staleTime: AGENT_PRESETS_STALE_TIME_MS,
    refetchOnMount: "always",
    retry: 2,
  });

  return {
    presets: query.data ?? [],
    isLoading: Boolean(client) && isConnected && (query.isPending || query.isLoading),
    isError: query.isError,
  };
}
