import type { HostProfile } from "@/types/host-connection";
import { parseServerIdFromPathname } from "@/utils/host-routes";

/**
 * Resolves the active host profile from the current route or host list fallback
 * @param hosts Known host profiles
 * @param pathname Current app pathname that may encode a server id
 * @returns Matching host for the route, otherwise the first host, or null when empty
 */
export function resolveActiveHost({
  hosts,
  pathname,
}: {
  hosts: readonly HostProfile[];
  pathname: string;
}): HostProfile | null {
  const serverIdFromPath = parseServerIdFromPathname(pathname);
  if (serverIdFromPath) {
    const routeMatch = hosts.find((host) => host.serverId === serverIdFromPath);
    if (routeMatch) {
      return routeMatch;
    }
  }

  return hosts[0] ?? null;
}
