import { parseHostPort } from "@chisacode/protocol/daemon-endpoints";
import type { HostProfile } from "@/types/host-connection";

function isLoopbackHostName(host: string, isIpv6: boolean): boolean {
  const normalized = host.trim().toLowerCase();
  return (
    normalized === "localhost" ||
    normalized === "127.0.0.1" ||
    normalized === "0.0.0.0" ||
    (isIpv6 && (normalized === "::1" || normalized === "::"))
  );
}

export function isLoopbackDaemonHost(host: HostProfile): boolean {
  return host.connections.some((connection) => {
    if (connection.type !== "directTcp") {
      return false;
    }
    try {
      const { host: endpointHost, isIpv6 } = parseHostPort(connection.endpoint);
      return isLoopbackHostName(endpointHost, isIpv6);
    } catch {
      return false;
    }
  });
}

export function resolveLocalDaemonServerId(input: {
  desktopServerId: string | null;
  hosts: HostProfile[];
}): string | null {
  const desktopServerId = input.desktopServerId?.trim() ?? "";
  if (desktopServerId.length > 0) {
    return desktopServerId;
  }
  return input.hosts.find(isLoopbackDaemonHost)?.serverId ?? null;
}
