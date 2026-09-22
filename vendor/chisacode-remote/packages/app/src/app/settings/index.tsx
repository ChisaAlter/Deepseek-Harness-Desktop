import { Redirect, useLocalSearchParams, type Href } from "expo-router";
import { HostRouteBootstrapBoundary } from "@/components/host-route-bootstrap-boundary";
import { useIsCompactFormFactor } from "@/constants/layout";
import SettingsScreen from "@/screens/settings-screen";
import { buildSettingsSectionRoute, normalizeSettingsReturnToRoute } from "@/utils/host-routes";

const ROOT_VIEW = { kind: "root" as const };

export default function SettingsIndexRoute() {
  const isCompactLayout = useIsCompactFormFactor();
  const params = useLocalSearchParams<{ returnTo?: string | string[] }>();
  const returnTo = normalizeSettingsReturnToRoute(params.returnTo);

  if (!isCompactLayout) {
    return (
      <HostRouteBootstrapBoundary>
        <Redirect href={buildSettingsSectionRoute("general", { returnTo }) as Href} />
      </HostRouteBootstrapBoundary>
    );
  }

  return (
    <HostRouteBootstrapBoundary>
      <SettingsScreen view={ROOT_VIEW} />
    </HostRouteBootstrapBoundary>
  );
}
