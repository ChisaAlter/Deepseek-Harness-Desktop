import { useQuery } from "@tanstack/react-query";
import { getDesktopDaemonStatus, shouldUseDesktopDaemon } from "@/desktop/daemon/desktop-daemon";
import { resolveLocalDaemonServerId } from "@/hooks/local-daemon-hosts";
import { useHosts } from "@/runtime/host-runtime";

const DESKTOP_DAEMON_SERVER_ID_QUERY_KEY = ["desktop-daemon-server-id"] as const;

interface DesktopDaemonServerIdResult {
  serverId: string | null;
}

async function loadDesktopDaemonServerId(): Promise<DesktopDaemonServerIdResult> {
  const status = await getDesktopDaemonStatus();
  const serverId = status.serverId.trim();
  return {
    serverId: serverId.length > 0 ? serverId : null,
  };
}

export function useLocalDaemonServerId(): string | null {
  const isDesktopApp = shouldUseDesktopDaemon();
  const hosts = useHosts();

  const query = useQuery({
    queryKey: DESKTOP_DAEMON_SERVER_ID_QUERY_KEY,
    queryFn: loadDesktopDaemonServerId,
    enabled: isDesktopApp,
    staleTime: Infinity,
    gcTime: Infinity,
    refetchInterval: (activeQuery) => (activeQuery.state.data?.serverId ? false : 1000),
    refetchOnMount: false,
    refetchOnReconnect: false,
    refetchOnWindowFocus: false,
    retry: false,
  });

  return resolveLocalDaemonServerId({
    desktopServerId: isDesktopApp ? (query.data?.serverId ?? null) : null,
    hosts,
  });
}

export function useIsLocalDaemon(serverId: string): boolean {
  const normalizedServerId = serverId.trim();
  const localServerId = useLocalDaemonServerId();

  if (localServerId === null || normalizedServerId.length === 0) {
    return false;
  }

  return localServerId === normalizedServerId;
}
