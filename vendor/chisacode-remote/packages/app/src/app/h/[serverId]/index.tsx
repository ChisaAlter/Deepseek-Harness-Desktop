import { Redirect, useLocalSearchParams } from "expo-router";
import { buildHostNewWorkspaceRoute } from "@/utils/host-routes";

/**
 * Default host root → Soft Home (/new), not open-project cards.
 * 以默认路由实机为准：快捷方式进中栏应是 Soft Home。
 */
export default function HostIndexRoute() {
  const params = useLocalSearchParams<{ serverId?: string }>();
  const serverId = typeof params.serverId === "string" ? params.serverId : "";
  if (!serverId) return null;
  return <Redirect href={buildHostNewWorkspaceRoute(serverId)} />;
}
